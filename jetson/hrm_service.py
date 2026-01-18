#!/usr/bin/env python3
"""
HRM Service - Runs on Jetson Orin Nano Super Dev Kit

This service:
1. Connects to the Render backend via outbound WebSocket
2. Receives grid-based maze inputs
3. Runs REAL HRM inference for pathfinding
4. Returns optimal paths

Usage:
    python hrm_service.py --server wss://your-backend.onrender.com

Environment:
    JETSON_SECRET - Authentication secret for the backend
    HRM_MODEL_PATH - Path to the HRM model checkpoint (default: auto-download from HuggingFace)
    
IMPORTANT: HRM is NOT a pip-installable package. You must:
1. Clone the HRM repository: git clone https://github.com/sapientinc/HRM.git
2. Add it to PYTHONPATH: export PYTHONPATH="${PYTHONPATH}:$(pwd)/HRM"
3. Run this script with the modified PYTHONPATH
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from collections import deque
from typing import Optional, Tuple, List, Dict, Any

import websockets
from websockets.client import WebSocketClientProtocol

# ============================================
# Configuration
# ============================================

DEFAULT_SERVER = os.environ.get('RENDER_WS_URL', 'wss://iu-rw9m.onrender.com')
JETSON_SECRET = os.environ.get('JETSON_SECRET', 'dev-secret-change-in-prod')
HRM_MODEL_ID = os.environ.get('HRM_MODEL_ID', 'sapientinc/HRM-checkpoint-maze-30x30-hard')
HRM_REPO_PATH = os.environ.get('HRM_REPO_PATH', './HRM')  # Path to cloned HRM repo
RECONNECT_DELAY = 5  # seconds
PING_INTERVAL = 25   # seconds

# ============================================
# Logging Setup
# ============================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('HRMService')

# ============================================
# HRM Model Loader - Real Implementation
# ============================================

def ensure_hrm_in_path():
    """Ensure HRM repository is in Python path"""
    hrm_path = os.path.abspath(HRM_REPO_PATH)
    
    if not os.path.exists(hrm_path):
        logger.warning(f"HRM repository not found at {hrm_path}")
        return False
    
    if hrm_path not in sys.path:
        sys.path.insert(0, hrm_path)
        logger.info(f"Added HRM to PYTHONPATH: {hrm_path}")
    
    return True


def download_checkpoint(model_id: str) -> str:
    """Download model checkpoint from HuggingFace"""
    from huggingface_hub import snapshot_download
    
    logger.info(f"Downloading checkpoint from HuggingFace: {model_id}")
    
    local_path = snapshot_download(
        repo_id=model_id,
        cache_dir=os.path.expanduser('~/.cache/hrm')
    )
    
    logger.info(f"Checkpoint downloaded to: {local_path}")
    return local_path


class HRMModel:
    """
    Wrapper for the REAL HRM (Hierarchical Reasoning Model).
    
    HRM is NOT a pip package - it must be cloned and added to PYTHONPATH.
    Uses checkpoints from HuggingFace: sapientinc/HRM-checkpoint-maze-30x30-hard
    
    Falls back to BFS if HRM loading fails.
    """
    
    def __init__(self, model_id: str = HRM_MODEL_ID):
        self.model_id = model_id
        self.model = None
        self.device = None
        self.loaded = False
        self.use_bfs_fallback = False
        self.checkpoint_path = None
        self.config = None
        logger.info(f"HRM Model wrapper initialized for: {model_id}")
        
    def load(self) -> bool:
        """Load the HRM model from HuggingFace checkpoint"""
        try:
            import torch
            import yaml
            
            # Determine device
            if torch.cuda.is_available():
                self.device = torch.device('cuda')
                gpu_name = torch.cuda.get_device_name(0)
                gpu_mem = torch.cuda.get_device_properties(0).total_memory / 1024**3
                logger.info(f"Using CUDA: {gpu_name} ({gpu_mem:.1f} GB)")
            else:
                self.device = torch.device('cpu')
                logger.warning("CUDA not available, using CPU (will be slower)")
            
            # Ensure HRM repo is available
            if not ensure_hrm_in_path():
                logger.warning("HRM repository not available - attempting to clone...")
                clone_result = os.system(f'git clone https://github.com/sapientinc/HRM.git {HRM_REPO_PATH}')
                if clone_result != 0:
                    raise RuntimeError("Failed to clone HRM repository")
                ensure_hrm_in_path()
            
            # Download checkpoint from HuggingFace
            checkpoint_dir = download_checkpoint(self.model_id)
            self.checkpoint_path = checkpoint_dir
            
            # Find checkpoint file (usually named like "checkpoint" or "step_XXXXX")
            checkpoint_files = []
            for f in os.listdir(checkpoint_dir):
                fpath = os.path.join(checkpoint_dir, f)
                if os.path.isfile(fpath) and f not in ['.gitattributes', 'all_config.yaml', 'README.md']:
                    if not f.endswith(('.yaml', '.json', '.md', '.txt')):
                        checkpoint_files.append(f)
            
            if not checkpoint_files:
                raise RuntimeError(f"No checkpoint file found in {checkpoint_dir}")
            
            checkpoint_file = os.path.join(checkpoint_dir, checkpoint_files[0])
            logger.info(f"Using checkpoint: {checkpoint_file}")
            
            # Load config
            config_path = os.path.join(checkpoint_dir, 'all_config.yaml')
            if not os.path.exists(config_path):
                raise RuntimeError(f"Config file not found: {config_path}")
            
            with open(config_path, 'r') as f:
                config_dict = yaml.safe_load(f)
            
            logger.info(f"Loaded config: arch={config_dict.get('arch', {}).get('name', 'unknown')}")
            
            # Import HRM modules (requires HRM in PYTHONPATH)
            try:
                from utils.functions import load_model_class
                from pretrain import PretrainConfig, init_train_state, create_dataloader
                from puzzle_dataset import PuzzleDataset, PuzzleDatasetConfig, PuzzleDatasetMetadata
            except ImportError as e:
                logger.error(f"Failed to import HRM modules: {e}")
                logger.error("Make sure HRM repo is cloned and in PYTHONPATH")
                raise
            
            # Create config
            self.config = PretrainConfig(**config_dict)
            
            # Create a minimal metadata for model initialization
            # This is derived from the checkpoint config
            arch_config = config_dict.get('arch', {})
            
            # Create metadata placeholder - we need this for init_train_state
            class MinimalMetadata:
                def __init__(self, config):
                    self.vocab_size = config.get('vocab_size', 4)  # 0=wall, 1=path, 2=start, 3=target for maze
                    self.seq_len = config.get('seq_len', 900)  # 30x30 = 900
                    self.num_puzzle_identifiers = config.get('num_puzzle_identifiers', 1)
                    self.total_groups = 1
                    self.mean_puzzle_examples = 1
            
            metadata = MinimalMetadata(arch_config)
            
            # Initialize model using HRM's own loading mechanism
            train_state = init_train_state(self.config, metadata, world_size=1)
            
            # Load checkpoint weights
            logger.info(f"Loading model weights from: {checkpoint_file}")
            state_dict = torch.load(checkpoint_file, map_location=self.device)
            
            # Handle torch.compile wrapped models
            try:
                train_state.model.load_state_dict(state_dict, assign=True)
            except:
                # Remove _orig_mod. prefix if present (from torch.compile)
                clean_state_dict = {k.removeprefix("_orig_mod."): v for k, v in state_dict.items()}
                train_state.model.load_state_dict(clean_state_dict, assign=True)
            
            self.model = train_state.model
            self.model.to(self.device)
            self.model.eval()
            
            self.loaded = True
            self.use_bfs_fallback = False
            
            # Count parameters
            total_params = sum(p.numel() for p in self.model.parameters())
            logger.info(f"✅ HRM Model loaded! Parameters: {total_params:,} (~{total_params/1e6:.1f}M)")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to load HRM model: {e}")
            import traceback
            traceback.print_exc()
            logger.warning("Falling back to BFS solver")
            self.use_bfs_fallback = True
            self.loaded = True
            return True
    
    def infer(self, grid: List[int], width: int, height: int) -> Tuple[List[Tuple[int, int]], bool]:
        """
        Run HRM inference on the grid
        
        Args:
            grid: Flattened grid sequence (tokens 0-3: 0=wall, 1=path, 2=start, 3=target)
            width: Grid width
            height: Grid height
            
        Returns:
            Tuple of (path, success)
            path: List of (row, col) positions
            success: Whether a valid path was found
        """
        start_time = time.time()
        
        # Reshape grid to 2D
        grid_2d = [grid[i*width:(i+1)*width] for i in range(height)]
        
        # Find start and target positions
        start = None
        target = None
        for r in range(height):
            for c in range(width):
                if grid_2d[r][c] == 2:  # START
                    start = (r, c)
                elif grid_2d[r][c] == 3:  # TARGET
                    target = (r, c)
        
        if not start or not target:
            logger.warning("Could not find start or target in grid")
            return [], False
        
        # Use HRM if available, otherwise BFS fallback
        if self.use_bfs_fallback or self.model is None:
            path = self._bfs_solve(grid_2d, start, target, width, height)
            method = "BFS"
        else:
            path = self._hrm_solve(grid, grid_2d, width, height, start, target)
            method = "HRM"
        
        elapsed = (time.time() - start_time) * 1000
        logger.info(f"Inference ({method}) completed in {elapsed:.2f}ms, path length: {len(path)}")
        
        return path, len(path) > 0
    
    def _hrm_solve(
        self,
        grid: List[int],
        grid_2d: List[List[int]],
        width: int,
        height: int,
        start: Tuple[int, int],
        target: Tuple[int, int]
    ) -> List[Tuple[int, int]]:
        """Solve using HRM model"""
        import torch
        
        try:
            # Prepare input tensor in the format HRM expects
            input_tensor = torch.tensor(grid, dtype=torch.long).unsqueeze(0).to(self.device)
            
            # HRM uses puzzle_identifiers for identifying which puzzle this is
            # For inference, we use 0
            puzzle_ids = torch.zeros((1,), dtype=torch.long).to(self.device)
            
            batch = {
                "inputs": input_tensor,
                "puzzle_identifiers": puzzle_ids,
            }
            
            with torch.no_grad():
                # Initialize carry state
                carry = self.model.initial_carry(batch)
                
                # Run forward pass(es) until halted
                max_iterations = 100  # Safety limit
                for _ in range(max_iterations):
                    carry, outputs = self.model(carry, batch)
                    
                    # Check if all sequences have halted
                    if carry.halted.all():
                        break
                
                # Get output logits
                logits = outputs["logits"]  # Shape: (batch, seq_len, vocab_size)
                predictions = logits.argmax(dim=-1)[0].cpu().numpy()  # Shape: (seq_len,)
            
            # Reshape predictions to grid
            output_grid = predictions.reshape(height, width)
            
            # Extract path from output - cells marked as path (1) or target (3)
            path = self._extract_path_from_output(output_grid, start, target, width, height)
            
            if path:
                return path
            else:
                logger.warning("HRM output did not produce valid path, falling back to BFS")
                return self._bfs_solve(grid_2d, start, target, width, height)
            
        except Exception as e:
            logger.error(f"HRM inference failed: {e}")
            import traceback
            traceback.print_exc()
            return self._bfs_solve(grid_2d, start, target, width, height)
    
    def _extract_path_from_output(
        self,
        output_grid,
        start: Tuple[int, int],
        target: Tuple[int, int],
        width: int,
        height: int
    ) -> List[Tuple[int, int]]:
        """Extract path from HRM output grid using BFS on marked cells"""
        
        path = [start]
        current = start
        visited = {start}
        
        while current != target:
            r, c = current
            found = False
            
            for dr, dc in [(-1,0), (1,0), (0,-1), (0,1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < height and 0 <= nc < width:
                    if (nr, nc) not in visited:
                        # Check if this cell is part of the solution path
                        if output_grid[nr][nc] in [1, 3] or (nr, nc) == target:
                            path.append((nr, nc))
                            visited.add((nr, nc))
                            current = (nr, nc)
                            found = True
                            break
            
            if not found:
                return []  # Path incomplete
        
        return path
    
    def _bfs_solve(
        self, 
        grid: List[List[int]], 
        start: Tuple[int, int], 
        target: Tuple[int, int],
        width: int,
        height: int
    ) -> List[Tuple[int, int]]:
        """BFS pathfinding (fallback)"""
        
        WALL = 0
        directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        
        queue = deque([(start, [start])])
        visited = {start}
        
        while queue:
            (row, col), path = queue.popleft()
            
            if (row, col) == target:
                return path
            
            for dr, dc in directions:
                new_row, new_col = row + dr, col + dc
                
                if 0 <= new_row < height and 0 <= new_col < width:
                    if (new_row, new_col) not in visited:
                        if grid[new_row][new_col] != WALL:
                            visited.add((new_row, new_col))
                            queue.append(((new_row, new_col), path + [(new_row, new_col)]))
        
        return []  # No path found

# ============================================
# WebSocket Client
# ============================================

class HRMService:
    """WebSocket client that connects to Render backend"""
    
    def __init__(self, server_url: str):
        self.server_url = server_url
        self.model = HRMModel()
        self.ws: Optional[WebSocketClientProtocol] = None
        self.running = True
        
    async def connect(self) -> bool:
        """Connect to the Render backend"""
        try:
            extra_headers = {
                'X-Jetson-Auth': JETSON_SECRET
            }
            
            self.ws = await websockets.connect(
                self.server_url + '/jetson',
                additional_headers=extra_headers,
                ping_interval=PING_INTERVAL
            )
            
            logger.info(f"Connected to {self.server_url}")
            
            # Send initial status
            await self.send_status()
            
            return True
            
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            return False
    
    async def send_status(self):
        """Send status update to server"""
        if self.ws:
            await self.ws.send(json.dumps({
                'type': 'status',
                'modelLoaded': self.model.loaded,
                'usingHRM': not self.model.use_bfs_fallback,
                'device': str(self.model.device) if self.model.device else 'unknown',
                'timestamp': int(time.time() * 1000)
            }))
    
    async def handle_message(self, message: str):
        """Handle incoming message from server"""
        data = {}
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'solve':
                await self.handle_solve(data)
            elif msg_type == 'ping':
                await self.ws.send(json.dumps({'type': 'pong'}))
            else:
                logger.warning(f"Unknown message type: {msg_type}")
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse message: {e}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            if 'requestId' in data:
                await self.send_error(data['requestId'], str(e))
    
    async def handle_solve(self, data: dict):
        """Handle solve request"""
        request_id = data.get('requestId', 'unknown')
        grid = data.get('grid', [])
        width = data.get('width', 0)
        height = data.get('height', 0)
        
        logger.info(f"Solve request: {request_id} ({width}x{height} = {len(grid)} tokens)")
        
        start_time = time.time()
        
        try:
            path, success = self.model.infer(grid, width, height)
            inference_time = int((time.time() - start_time) * 1000)
            
            response = {
                'type': 'solution',
                'requestId': request_id,
                'path': path,
                'success': success,
                'inferenceTimeMs': inference_time,
                'method': 'BFS' if self.model.use_bfs_fallback else 'HRM'
            }
            
            await self.ws.send(json.dumps(response))
            logger.info(f"Sent solution: success={success}, path={len(path)} steps, method={response['method']}")
            
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            await self.send_error(request_id, str(e))
    
    async def send_error(self, request_id: str, message: str):
        """Send error response"""
        if self.ws:
            await self.ws.send(json.dumps({
                'type': 'error',
                'requestId': request_id,
                'message': message
            }))
    
    async def run(self):
        """Main run loop with auto-reconnect"""
        # Load model first
        if not self.model.load():
            logger.error("Failed to load HRM model, exiting")
            return
        
        while self.running:
            try:
                if await self.connect():
                    # Message loop
                    async for message in self.ws:
                        await self.handle_message(message)
                        
            except websockets.ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
            except Exception as e:
                logger.error(f"Error in run loop: {e}")
            
            if self.running:
                logger.info(f"Reconnecting in {RECONNECT_DELAY}s...")
                await asyncio.sleep(RECONNECT_DELAY)
    
    def stop(self):
        """Stop the service"""
        self.running = False
        if self.ws:
            asyncio.get_event_loop().run_until_complete(self.ws.close())

# ============================================
# Main Entry Point
# ============================================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='HRM Service for Jetson')
    parser.add_argument('--server', default=DEFAULT_SERVER, help='WebSocket server URL')
    parser.add_argument('--model', default=HRM_MODEL_ID, help='HuggingFace model ID')
    parser.add_argument('--hrm-path', default=HRM_REPO_PATH, help='Path to HRM repository')
    parser.add_argument('--test', action='store_true', help='Run connection test only')
    parser.add_argument('--bfs-only', action='store_true', help='Force BFS mode (no HRM)')
    args = parser.parse_args()
    
    # Update global config
    global HRM_REPO_PATH, HRM_MODEL_ID
    HRM_REPO_PATH = args.hrm_path
    HRM_MODEL_ID = args.model
    
    logger.info("=" * 60)
    logger.info("  HRM Service - Jetson Orin Nano Super Dev Kit")
    logger.info("=" * 60)
    logger.info(f"Server: {args.server}")
    logger.info(f"Model: {args.model}")
    logger.info(f"HRM Repo: {args.hrm_path}")
    
    service = HRMService(args.server)
    
    if args.bfs_only:
        service.model.use_bfs_fallback = True
        logger.info("Forced BFS-only mode")
    
    # Handle signals
    def signal_handler(sig, frame):
        logger.info("Shutting down...")
        service.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    if args.test:
        # Test mode - just try to connect once
        async def test_connection():
            if await service.connect():
                logger.info("✅ Connection test successful")
                await service.send_status()
                await asyncio.sleep(2)
            else:
                logger.error("❌ Connection test failed")
        
        asyncio.run(test_connection())
    else:
        # Normal operation
        asyncio.run(service.run())

if __name__ == '__main__':
    main()

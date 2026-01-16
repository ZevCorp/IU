#!/usr/bin/env python3
"""
HRM Service - Runs on Jetson Orin Nano Super Dev Kit

This service:
1. Connects to the Render backend via outbound WebSocket
2. Receives grid-based maze inputs
3. Runs HRM inference for pathfinding
4. Returns optimal paths

Usage:
    python hrm_service.py --server wss://your-backend.onrender.com

Environment:
    JETSON_SECRET - Authentication secret for the backend
    HRM_MODEL_PATH - Path to the HRM model weights (optional)
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from collections import deque
from typing import Optional, Tuple, List

import websockets
from websockets.client import WebSocketClientProtocol

# ============================================
# Configuration
# ============================================

DEFAULT_SERVER = os.environ.get('RENDER_WS_URL', 'wss://iu-rw9m.onrender.com')
JETSON_SECRET = os.environ.get('JETSON_SECRET', 'dev-secret-change-in-prod')
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
# HRM Model Wrapper (Placeholder for actual HRM)
# ============================================

class HRMModel:
    """
    Wrapper for the HRM (Hierarchical Reasoning Model) with 27M parameters.
    
    For v1, we use BFS as a placeholder since actual HRM requires:
    - PyTorch with the model weights
    - GPU (CUDA) optimization for Jetson
    - Proper tokenization of the grid
    
    TODO: Replace with actual HRM inference when weights are available
    """
    
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.model = None
        self.loaded = False
        logger.info("HRM Model wrapper initialized (using BFS placeholder for v1)")
        
    def load(self) -> bool:
        """Load the HRM model weights"""
        try:
            # TODO: Load actual HRM model
            # import torch
            # self.model = torch.load(self.model_path)
            # self.model.eval()
            
            self.loaded = True
            logger.info("HRM Model loaded (placeholder mode)")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load HRM model: {e}")
            return False
    
    def infer(self, grid: List[int], width: int, height: int) -> Tuple[List[Tuple[int, int]], bool]:
        """
        Run HRM inference on the grid
        
        Args:
            grid: Flattened grid sequence (tokens 0-3)
            width: Grid width
            height: Grid height
            
        Returns:
            Tuple of (path, success)
            path: List of (row, col) positions
            success: Whether a valid path was found
        """
        start_time = time.time()
        
        # Reshape grid
        grid_2d = [grid[i*width:(i+1)*width] for i in range(height)]
        
        # Find start and target positions
        start = None
        target = None
        for r in range(height):
            for c in range(width):
                if grid_2d[r][c] == 2:  # CURRENT
                    start = (r, c)
                elif grid_2d[r][c] == 3:  # TARGET
                    target = (r, c)
        
        if not start or not target:
            logger.warning("Could not find start or target in grid")
            return [], False
        
        # Use BFS as placeholder (actual HRM would replace this)
        path = self._bfs_solve(grid_2d, start, target, width, height)
        
        elapsed = (time.time() - start_time) * 1000
        logger.info(f"Inference completed in {elapsed:.2f}ms, path length: {len(path)}")
        
        return path, len(path) > 0
    
    def _bfs_solve(
        self, 
        grid: List[List[int]], 
        start: Tuple[int, int], 
        target: Tuple[int, int],
        width: int,
        height: int
    ) -> List[Tuple[int, int]]:
        """BFS pathfinding (placeholder for HRM)"""
        
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
                'timestamp': int(time.time() * 1000)
            }))
    
    async def handle_message(self, message: str):
        """Handle incoming message from server"""
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
                'inferenceTimeMs': inference_time
            }
            
            await self.ws.send(json.dumps(response))
            logger.info(f"Sent solution: success={success}, path={len(path)} steps")
            
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
    parser.add_argument('--test', action='store_true', help='Run connection test only')
    args = parser.parse_args()
    
    logger.info("=" * 50)
    logger.info("  HRM Service - Jetson Orin Nano")
    logger.info("=" * 50)
    logger.info(f"Server: {args.server}")
    
    service = HRMService(args.server)
    
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

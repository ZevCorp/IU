#!/usr/bin/env python3
"""
Bank Service — Main orchestrator for Ü Bank on Jetson Orin Nano.

Extends the existing HRM service pattern to handle:
1. Voice commands from Android → SLM intent extraction
2. Graph updates from Android → Graph compilation
3. Intent → Plan → Execution via HRM pathfinding
4. Real-time execution monitoring and re-planning

Connects to the same Render WebSocket relay as hrm_service.py.
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from typing import Optional, Dict, Any, List

import websockets
from websockets.client import WebSocketClientProtocol

from slm_service import SLMService, Intent
from graph_compiler import GraphCompiler, AppGraph, load_graph_from_json, visualize_grid
from planner import Planner, ExecutionPlan

# ============================================
# Configuration
# ============================================

DEFAULT_SERVER = os.environ.get('RENDER_WS_URL', 'wss://iu-rw9m.onrender.com')
JETSON_SECRET = os.environ.get('JETSON_SECRET', 'dev-secret-change-in-prod')
RECONNECT_DELAY = 5
PING_INTERVAL = 25

# ============================================
# Logging
# ============================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('BankService')

# ============================================
# HRM Model Interface
# ============================================

class HRMInterface:
    """
    Interface to the HRM model for maze solving.
    Reuses the existing HRMModel from hrm_service.py.
    """

    def __init__(self):
        self.model = None
        self.loaded = False

    def load(self) -> bool:
        """Load HRM model"""
        try:
            # Import from the existing hrm_service
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'jetson'))
            from hrm_service import HRMModel
            
            self.model = HRMModel()
            success = self.model.load()
            self.loaded = success
            return success
        except ImportError:
            logger.warning("HRM model not available, will use BFS fallback")
            self.loaded = False
            return False

    def solve(self, grid: List[int], width: int, height: int):
        """Solve a maze grid"""
        if self.model and self.loaded:
            return self.model.infer(grid, width, height)
        return [], False


# ============================================
# Bank Service
# ============================================

class BankService:
    """
    Main service orchestrating SLM + GraphCompiler + HRM + Planner.
    
    Message flow:
    1. Android sends voice_command → SLM extracts intent
    2. Android sends graph_update → GraphCompiler stores graph
    3. On intent: Planner generates execution plan using HRM
    4. Plan sent to Android for execution
    5. Android reports action_result → verify and re-plan if needed
    """

    def __init__(self, server_url: str):
        self.server_url = server_url
        self.ws: Optional[WebSocketClientProtocol] = None
        self.running = True

        # Core modules
        self.slm = SLMService()
        self.compiler = GraphCompiler()
        self.hrm = HRMInterface()

        # State
        self.app_graphs: Dict[str, AppGraph] = {}  # package → graph
        self.current_screen: Dict[str, str] = {}    # package → current screen id
        self.active_plans: Dict[str, ExecutionPlan] = {}  # requestId → plan
        self.android_connected = False

    async def start(self):
        """Initialize all modules and start the service"""
        logger.info("=" * 60)
        logger.info("  Ü Bank Service — Jetson Orin Nano")
        logger.info("=" * 60)

        # Load SLM
        logger.info("Loading SLM...")
        slm_ok = self.slm.load()
        if not slm_ok:
            logger.warning("SLM not loaded — will use rule-based NLU")

        # Load HRM
        logger.info("Loading HRM...")
        hrm_ok = self.hrm.load()
        if not hrm_ok:
            logger.warning("HRM not loaded — will use BFS pathfinding")

        logger.info("All modules initialized")

        # Start WebSocket loop
        await self._ws_loop()

    async def _ws_loop(self):
        """Main WebSocket loop with auto-reconnect"""
        while self.running:
            try:
                if await self._connect():
                    async for message in self.ws:
                        await self._handle_message(message)
            except websockets.ConnectionClosed as e:
                logger.warning(f"Connection closed: {e}")
            except Exception as e:
                logger.error(f"Error in WS loop: {e}")

            if self.running:
                logger.info(f"Reconnecting in {RECONNECT_DELAY}s...")
                await asyncio.sleep(RECONNECT_DELAY)

    async def _connect(self) -> bool:
        """Connect to the Render backend"""
        try:
            self.ws = await websockets.connect(
                self.server_url + '/jetson',
                additional_headers={'X-Jetson-Auth': JETSON_SECRET},
                ping_interval=PING_INTERVAL
            )
            logger.info(f"Connected to {self.server_url}")

            # Send status
            await self._send({
                'type': 'status',
                'service': 'u-bank',
                'slmLoaded': self.slm.loaded,
                'hrmLoaded': self.hrm.loaded,
                'timestamp': int(time.time() * 1000)
            })

            return True
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            return False

    async def _send(self, message: Dict):
        """Send a message to the server"""
        if self.ws:
            await self.ws.send(json.dumps(message, ensure_ascii=False))

    # ============================================
    # Message Routing
    # ============================================

    async def _handle_message(self, raw: str):
        """Route incoming messages to handlers"""
        try:
            msg = json.loads(raw)
            msg_type = msg.get('type', '')

            handlers = {
                'voice_command': self._handle_voice_command,
                'graph_update': self._handle_graph_update,
                'ui_state': self._handle_ui_state,
                'action_result': self._handle_action_result,
                'explore_complete': self._handle_explore_complete,
                'ping': self._handle_ping,
                'solve': self._handle_solve,  # Legacy HRM maze solving
            }

            handler = handlers.get(msg_type)
            if handler:
                await handler(msg)
            else:
                logger.debug(f"Unknown message type: {msg_type}")

        except json.JSONDecodeError:
            logger.error(f"Invalid JSON: {raw[:100]}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            import traceback
            traceback.print_exc()

    # ============================================
    # Voice Command → Intent → Plan
    # ============================================

    async def _handle_voice_command(self, msg: Dict):
        """
        Handle voice command from Android.
        Pipeline: speech text → SLM → intent → planner → execution plan
        """
        payload = msg.get('payload', {})
        text = payload.get('text', '')
        app_package = payload.get('app', 'com.bancolombia.app')
        request_id = msg.get('requestId', f"vc-{int(time.time()*1000)}")

        logger.info(f"Voice command: \"{text}\"")

        # Step 1: Extract intent with SLM
        intent_data = self.slm.extract_intent(text)
        intent = Intent(
            name=intent_data['intent'],
            confidence=intent_data['confidence'],
            params=intent_data.get('params', {}),
            raw_text=text
        )

        logger.info(f"Intent: {intent.name} (confidence: {intent.confidence})")

        # Send intent confirmation to Android for display
        await self._send({
            'type': 'intent_confirmed',
            'requestId': request_id,
            'payload': {
                'intent': intent.name,
                'confidence': intent.confidence,
                'params': intent.params,
                'summary': self._intent_summary(intent),
                'requiresConfirmation': intent.name in [
                    'send_money', 'pay_bill', 'transfer_pocket'
                ]
            }
        })

        # Step 2: Check if we have the app graph
        graph = self.app_graphs.get(app_package)
        if not graph:
            logger.warning(f"No graph for {app_package} — requesting exploration")
            await self._send({
                'type': 'explore_request',
                'requestId': request_id,
                'payload': {
                    'app': app_package,
                    'depth': 4,
                    'intent': intent.name  # Hint for targeted exploration
                }
            })
            return

        # Step 3: Generate execution plan
        current = self.current_screen.get(app_package, 'home')

        planner = Planner(graph, self.compiler)
        plan = planner.plan(
            intent=intent,
            current_screen=current,
            hrm_solve_fn=self.hrm.solve if self.hrm.loaded else None
        )

        # Store active plan
        self.active_plans[request_id] = plan

        # Step 4: Send plan to Android
        plan_msg = planner.to_protocol_message(plan)
        plan_msg['requestId'] = request_id
        await self._send(plan_msg)

        logger.info(f"Plan sent: {len(plan.steps)} steps → Android")

    def _intent_summary(self, intent: Intent) -> str:
        """Generate human-readable summary for display on Ü face"""
        if intent.name == 'send_money':
            amt = intent.params.get('amount', '?')
            rcpt = intent.params.get('recipient', '?')
            return f"Enviar ${amt:,} a {rcpt}" if isinstance(amt, int) else f"Enviar a {rcpt}"
        if intent.name == 'check_balance':
            return "Consultar saldo"
        if intent.name == 'pay_bill':
            return f"Pagar {intent.params.get('service', 'servicio')}"
        if intent.name == 'transfer_pocket':
            return "Mover dinero entre bolsillos"
        return intent.name

    # ============================================
    # Graph Management
    # ============================================

    async def _handle_graph_update(self, msg: Dict):
        """Handle graph update from Android's AccessibilityService explorer"""
        payload = msg.get('payload', {})
        app_package = payload.get('app', '')
        graph_json = payload.get('graph', {})

        if not app_package or not graph_json:
            logger.warning("Invalid graph_update: missing app or graph")
            return

        graph = load_graph_from_json(graph_json)
        self.app_graphs[app_package] = graph

        node_count = len(graph.nodes)
        edge_count = len(graph.edges)
        logger.info(f"Graph updated: {app_package} ({node_count} nodes, {edge_count} edges)")

        # Acknowledge
        await self._send({
            'type': 'graph_ack',
            'payload': {
                'app': app_package,
                'nodes': node_count,
                'edges': edge_count
            }
        })

    async def _handle_ui_state(self, msg: Dict):
        """Handle UI state update from Android"""
        payload = msg.get('payload', {})
        app_package = payload.get('currentApp', '')
        screen_id = payload.get('screenFingerprint', '')

        if app_package and screen_id:
            self.current_screen[app_package] = screen_id
            logger.debug(f"UI state: {app_package} → {screen_id}")

    async def _handle_explore_complete(self, msg: Dict):
        """Handle completion of graph exploration"""
        payload = msg.get('payload', {})
        app_package = payload.get('app', '')
        request_id = msg.get('requestId', '')

        logger.info(f"Exploration complete for {app_package}")

        # If there's a pending plan for this request, retry planning
        if request_id in self.active_plans:
            # Re-trigger the voice command handling
            logger.info("Re-planning with updated graph...")

    # ============================================
    # Execution Monitoring
    # ============================================

    async def _handle_action_result(self, msg: Dict):
        """
        Handle action execution result from Android.
        Verify state and re-plan if needed.
        """
        payload = msg.get('payload', {})
        request_id = msg.get('requestId', '')
        step_index = payload.get('stepIndex', -1)
        success = payload.get('success', False)
        new_screen = payload.get('newScreenFingerprint', '')
        error = payload.get('error', '')

        plan = self.active_plans.get(request_id)
        if not plan:
            logger.warning(f"No active plan for request: {request_id}")
            return

        if success:
            logger.info(f"Step {step_index} succeeded → screen: {new_screen}")

            # Update current screen
            app = plan.intent.params.get('app', 'com.bancolombia.app')
            if new_screen:
                self.current_screen[app] = new_screen

            # Check if plan is complete
            if step_index >= len(plan.steps) - 1:
                logger.info(f"Plan complete: {plan.summary}")
                await self._send({
                    'type': 'plan_complete',
                    'requestId': request_id,
                    'payload': {'summary': plan.summary, 'success': True}
                })
                del self.active_plans[request_id]
        else:
            logger.warning(f"Step {step_index} failed: {error}")

            # Re-plan from current state
            expected = plan.steps[step_index].expected_screen if step_index < len(plan.steps) else ''
            if new_screen and new_screen != expected:
                logger.info(f"Unexpected screen: {new_screen} (expected: {expected})")
                logger.info("Re-planning...")

                # TODO: Re-plan from new_screen to the original target
                await self._send({
                    'type': 'plan_error',
                    'requestId': request_id,
                    'payload': {
                        'stepIndex': step_index,
                        'error': error,
                        'action': 'retry'  # or 'abort'
                    }
                })

    # ============================================
    # Legacy HRM Support
    # ============================================

    async def _handle_solve(self, msg: Dict):
        """Handle legacy maze solve requests (backward compat with hrm_service)"""
        request_id = msg.get('requestId', 'unknown')
        grid = msg.get('grid', [])
        width = msg.get('width', 0)
        height = msg.get('height', 0)

        logger.info(f"Legacy solve: {request_id} ({width}x{height})")

        path, success = self.hrm.solve(grid, width, height)
        inference_time = 0  # Already measured inside

        await self._send({
            'type': 'solution',
            'requestId': request_id,
            'path': path,
            'success': success,
            'inferenceTimeMs': inference_time
        })

    async def _handle_ping(self, msg: Dict):
        """Handle ping"""
        await self._send({'type': 'pong'})

    # ============================================
    # Shutdown
    # ============================================

    def stop(self):
        """Stop the service"""
        self.running = False
        if self.ws:
            asyncio.get_event_loop().run_until_complete(self.ws.close())


# ============================================
# Main
# ============================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description='Ü Bank Service — Jetson')
    parser.add_argument('--server', default=DEFAULT_SERVER, help='WebSocket server URL')
    parser.add_argument('--test-slm', action='store_true', help='Test SLM only')
    parser.add_argument('--test-compiler', action='store_true', help='Test graph compiler only')
    args = parser.parse_args()

    if args.test_slm:
        # Quick SLM test
        slm = SLMService()
        tests = [
            "Envía 50 mil a María",
            "Cuánto tengo en mi cuenta",
            "Paga el recibo de la luz",
        ]
        for t in tests:
            r = slm.extract_intent(t)
            print(f"  \"{t}\" → {r['intent']} ({r['confidence']:.2f}) {r['params']}")
        return

    if args.test_compiler:
        # Quick compiler test
        from graph_compiler import GraphCompiler, load_graph_from_json, visualize_grid
        sample = {
            "app": "com.bancolombia.app",
            "nodes": {
                "home": {"label": "Inicio", "edges": ["transfers", "pockets"]},
                "transfers": {"label": "Transferencias", "edges": ["send", "home"]},
                "pockets": {"label": "Bolsillos", "edges": ["home"]},
                "send": {"label": "Enviar", "edges": ["confirm"]},
                "confirm": {"label": "Confirmar", "edges": ["success"]},
                "success": {"label": "Éxito", "edges": ["home"]},
            },
            "edges": []
        }
        graph = load_graph_from_json(sample)
        compiler = GraphCompiler()
        result = compiler.compile(graph, "home", "confirm")
        print(visualize_grid(result['grid_2d'], result['node_positions']))
        return

    # Normal operation
    service = BankService(args.server)

    def signal_handler(sig, frame):
        logger.info("Shutting down...")
        service.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    asyncio.run(service.start())


if __name__ == '__main__':
    main()

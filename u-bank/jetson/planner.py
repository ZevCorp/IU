#!/usr/bin/env python3
"""
Planner — Converts SLM intent output into an execution plan.

Pipeline:
1. SLM extracts intent + params from user speech
2. Planner maps intent to checkpoint sequence using the app graph
3. For each checkpoint transition, GraphCompiler creates a maze
4. HRM solves each maze
5. Planner assembles the full execution plan with concrete actions

The planner is the bridge between "what the user wants" (SLM)
and "how to get there" (HRM + graph).
"""

import json
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

from graph_compiler import (
    AppGraph, GraphCompiler, GraphEdge,
    load_graph_from_json, visualize_grid
)

logger = logging.getLogger('Planner')

# ============================================
# Data Classes
# ============================================

@dataclass
class Intent:
    """Parsed user intent from SLM"""
    name: str                          # e.g. "send_money"
    confidence: float                  # 0.0 - 1.0
    params: Dict[str, Any] = field(default_factory=dict)
    raw_text: str = ""


@dataclass
class ActionStep:
    """A single executable action on the Android device"""
    index: int
    action: str                        # "tap", "fill", "swipe", "scroll", "back", "wait"
    selector: Dict[str, str] = field(default_factory=dict)  # How to find the element
    value: str = ""                    # For "fill" actions
    expected_screen: str = ""          # Expected screen after action
    description: str = ""              # Human-readable description
    timeout_ms: int = 5000


@dataclass
class ExecutionPlan:
    """Complete plan to execute a user intent"""
    intent: Intent
    steps: List[ActionStep] = field(default_factory=list)
    checkpoints: List[str] = field(default_factory=list)
    summary: str = ""
    requires_confirmation: bool = True
    estimated_time_ms: int = 0


# ============================================
# Intent → Checkpoint Mapping
# ============================================

# Pre-defined checkpoint sequences for common banking intents.
# These are the "sub-goals" that HRM will navigate between.
# The planner uses the graph to find the actual path between each pair.

INTENT_CHECKPOINTS = {
    "send_money": [
        "home",
        "transfers",
        "send_contact",
        "enter_amount",
        "confirm_send",
        "success"
    ],
    "send_money_from_pocket": [
        "home",
        "pockets",
        "pocket_detail",
        "withdraw_pocket",
        "home",
        "transfers",
        "send_contact",
        "enter_amount",
        "confirm_send",
        "success"
    ],
    "check_balance": [
        "home"
        # Balance is visible on home screen
    ],
    "transfer_pocket": [
        "home",
        "pockets",
        "pocket_detail",
        "withdraw_pocket"
    ],
    "pay_bill": [
        "home",
        "payments",
        "pay_bill"
    ],
    "transaction_history": [
        "home"
        # History is accessible from home
    ]
}


# ============================================
# Planner
# ============================================

class Planner:
    """
    Converts user intent into a concrete execution plan.
    
    Uses the app graph + HRM to find optimal navigation paths,
    then enriches each step with the actual UI actions needed.
    """

    def __init__(self, graph: AppGraph, compiler: GraphCompiler):
        self.graph = graph
        self.compiler = compiler

    def plan(
        self,
        intent: Intent,
        current_screen: str,
        hrm_solve_fn=None
    ) -> ExecutionPlan:
        """
        Generate an execution plan for the given intent.
        
        Args:
            intent: Parsed user intent
            current_screen: Current screen ID on the Android device
            hrm_solve_fn: Optional function(grid, width, height) → (path, success)
                          If None, uses BFS fallback
        
        Returns:
            ExecutionPlan with concrete action steps
        """
        logger.info(f"Planning for intent: {intent.name} (from: {current_screen})")

        # Determine checkpoint sequence
        checkpoints = self._resolve_checkpoints(intent, current_screen)
        logger.info(f"Checkpoints: {' → '.join(checkpoints)}")

        # Build execution steps
        steps = []
        step_index = 0

        for i in range(len(checkpoints) - 1):
            from_screen = checkpoints[i]
            to_screen = checkpoints[i + 1]

            if from_screen == to_screen:
                continue

            # Compile maze for this transition
            try:
                maze_result = self.compiler.compile(self.graph, from_screen, to_screen)
            except ValueError as e:
                logger.error(f"Failed to compile maze {from_screen} → {to_screen}: {e}")
                continue

            # Solve with HRM or BFS fallback
            path_nodes = []

            if hrm_solve_fn:
                path, success = hrm_solve_fn(
                    maze_result["grid"],
                    maze_result["width"],
                    maze_result["height"]
                )
                if success and path:
                    # Decode HRM grid path back to node sequence
                    path_nodes = self.compiler.decode_hrm_path(
                        path, maze_result["node_positions"]
                    )

            # Fallback to direct graph BFS if HRM didn't produce a path
            if not path_nodes:
                path_nodes = self._bfs_graph_path(from_screen, to_screen)

            if not path_nodes:
                logger.warning(f"No path found: {from_screen} → {to_screen}")
                continue

            # Convert node sequence to action steps
            for j in range(len(path_nodes) - 1):
                node_from = path_nodes[j]
                node_to = path_nodes[j + 1]

                action_step = self._build_action_step(
                    step_index, node_from, node_to, intent
                )
                if action_step:
                    steps.append(action_step)
                    step_index += 1

            # Add parameter-filling steps at appropriate checkpoints
            param_steps = self._build_param_steps(
                step_index, to_screen, intent
            )
            for ps in param_steps:
                steps.append(ps)
                step_index += 1

        # Build summary
        summary = self._build_summary(intent)

        plan = ExecutionPlan(
            intent=intent,
            steps=steps,
            checkpoints=checkpoints,
            summary=summary,
            requires_confirmation=self._needs_confirmation(intent),
            estimated_time_ms=len(steps) * 2000  # ~2s per step
        )

        logger.info(f"Plan generated: {len(steps)} steps, ~{plan.estimated_time_ms}ms")
        return plan

    def _resolve_checkpoints(self, intent: Intent, current_screen: str) -> List[str]:
        """Determine the checkpoint sequence for an intent"""
        # Check if we have a pre-defined sequence
        intent_key = intent.name

        # Special case: send_money with source pocket
        if intent.name == "send_money" and intent.params.get("source", "").startswith("bolsillo"):
            intent_key = "send_money_from_pocket"

        checkpoints = INTENT_CHECKPOINTS.get(intent_key, [])

        if not checkpoints:
            logger.warning(f"No checkpoint sequence for intent: {intent.name}")
            return [current_screen]

        # Prepend current screen if not already the first checkpoint
        if checkpoints[0] != current_screen:
            checkpoints = [current_screen] + checkpoints

        # Remove duplicates while preserving order
        seen = set()
        deduped = []
        for cp in checkpoints:
            if cp not in seen or cp == "home":  # Allow revisiting home
                seen.add(cp)
                deduped.append(cp)

        return deduped

    def _bfs_graph_path(self, start: str, target: str) -> List[str]:
        """BFS on the graph to find node sequence (fallback when HRM unavailable)"""
        from collections import deque

        queue = deque([(start, [start])])
        visited = {start}

        while queue:
            current, path = queue.popleft()

            if current == target:
                return path

            for neighbor in self.graph.get_neighbors(current):
                if neighbor not in visited and neighbor in self.graph.nodes:
                    visited.add(neighbor)
                    queue.append((neighbor, path + [neighbor]))

        return []

    def _build_action_step(
        self,
        index: int,
        from_node: str,
        to_node: str,
        intent: Intent
    ) -> Optional[ActionStep]:
        """Build a concrete action step for a node transition"""
        # Find the edge
        edge = self.graph.get_edge(from_node, to_node)

        if edge and edge.action:
            return ActionStep(
                index=index,
                action=edge.action.get("type", "tap"),
                selector=edge.action.get("selector", {}),
                expected_screen=to_node,
                description=f"Navigate: {from_node} → {to_node}"
            )

        # Fallback: look at the target node's accessibility snapshot
        target_node = self.graph.nodes.get(to_node)
        if target_node and target_node.accessibility_snapshot:
            key_elements = target_node.accessibility_snapshot.get("key_elements", [])
            if key_elements:
                elem = key_elements[0]
                return ActionStep(
                    index=index,
                    action="tap",
                    selector={
                        "id": elem.get("id", ""),
                        "text": elem.get("text", ""),
                        "content_desc": elem.get("content_desc", "")
                    },
                    expected_screen=to_node,
                    description=f"Tap: {elem.get('text', to_node)}"
                )

        # Generic tap with text matching
        label = target_node.label if target_node else to_node
        return ActionStep(
            index=index,
            action="tap",
            selector={"text": label, "content_desc": label},
            expected_screen=to_node,
            description=f"Navigate to: {label}"
        )

    def _build_param_steps(
        self,
        start_index: int,
        screen: str,
        intent: Intent
    ) -> List[ActionStep]:
        """Build steps for filling in parameters at a specific screen"""
        steps = []
        idx = start_index

        if screen == "enter_amount" and "amount" in intent.params:
            steps.append(ActionStep(
                index=idx,
                action="fill",
                selector={"id": "amount_input", "class": "android.widget.EditText"},
                value=str(intent.params["amount"]),
                expected_screen=screen,
                description=f"Enter amount: ${intent.params['amount']:,}"
            ))
            idx += 1

        if screen == "send_contact" and "recipient" in intent.params:
            steps.append(ActionStep(
                index=idx,
                action="fill",
                selector={"id": "search_recipient", "class": "android.widget.EditText"},
                value=intent.params["recipient"],
                expected_screen=screen,
                description=f"Search recipient: {intent.params['recipient']}"
            ))
            idx += 1
            # Tap on the found recipient
            steps.append(ActionStep(
                index=idx,
                action="tap",
                selector={"text": intent.params["recipient"]},
                expected_screen=screen,
                description=f"Select: {intent.params['recipient']}"
            ))
            idx += 1

        if screen == "pocket_detail" and "source" in intent.params:
            pocket_name = intent.params["source"].replace("bolsillo_", "")
            steps.append(ActionStep(
                index=idx,
                action="tap",
                selector={"text": pocket_name, "content_desc": pocket_name},
                expected_screen=screen,
                description=f"Select pocket: {pocket_name}"
            ))
            idx += 1

        return steps

    def _build_summary(self, intent: Intent) -> str:
        """Build a human-readable summary of the plan"""
        if intent.name == "send_money":
            amount = intent.params.get("amount", "?")
            recipient = intent.params.get("recipient", "?")
            source = intent.params.get("source", "cuenta principal")
            return f"Enviar ${amount:,} a {recipient} desde {source}"

        if intent.name == "check_balance":
            return "Consultar saldo"

        if intent.name == "transfer_pocket":
            return "Transferir entre bolsillos"

        if intent.name == "pay_bill":
            return f"Pagar servicio: {intent.params.get('service', '?')}"

        return f"Ejecutar: {intent.name}"

    def _needs_confirmation(self, intent: Intent) -> bool:
        """Determine if this intent requires user confirmation before execution"""
        # Money-moving intents always need confirmation
        return intent.name in ["send_money", "send_money_from_pocket", "pay_bill", "transfer_pocket"]

    def to_protocol_message(self, plan: ExecutionPlan) -> Dict:
        """Convert plan to WebSocket protocol message"""
        return {
            "type": "execute_plan",
            "payload": {
                "intent": {
                    "name": plan.intent.name,
                    "confidence": plan.intent.confidence,
                    "params": plan.intent.params
                },
                "summary": plan.summary,
                "requiresConfirmation": plan.requires_confirmation,
                "estimatedTimeMs": plan.estimated_time_ms,
                "checkpoints": plan.checkpoints,
                "steps": [
                    {
                        "index": step.index,
                        "action": step.action,
                        "selector": step.selector,
                        "value": step.value,
                        "expectedScreen": step.expected_screen,
                        "description": step.description,
                        "timeoutMs": step.timeout_ms
                    }
                    for step in plan.steps
                ]
            }
        }


# ============================================
# Self-test
# ============================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Load sample graph
    sample_graph_json = {
        "app": "com.bancolombia.app",
        "nodes": {
            "home": {"label": "Inicio", "edges": ["transfers", "pockets", "payments", "qr"]},
            "transfers": {"label": "Transferencias", "edges": ["send_contact", "send_account", "home"]},
            "pockets": {"label": "Bolsillos", "edges": ["pocket_detail", "home"]},
            "payments": {"label": "Pagos", "edges": ["pay_bill", "home"]},
            "qr": {"label": "QR", "edges": ["home"]},
            "send_contact": {"label": "Enviar a Contacto", "edges": ["enter_amount", "transfers"]},
            "send_account": {"label": "Enviar a Cuenta", "edges": ["enter_amount", "transfers"]},
            "pocket_detail": {"label": "Detalle Bolsillo", "edges": ["withdraw_pocket", "pockets"]},
            "enter_amount": {"label": "Ingresar Monto", "edges": ["confirm_send"]},
            "confirm_send": {"label": "Confirmar Envío", "edges": ["success"]},
            "success": {"label": "Éxito", "edges": ["home"]},
            "withdraw_pocket": {"label": "Retirar de Bolsillo", "edges": ["pocket_detail"]},
            "pay_bill": {"label": "Pagar Servicio", "edges": ["payments"]}
        },
        "edges": []
    }

    graph = load_graph_from_json(sample_graph_json)
    compiler = GraphCompiler()
    planner = Planner(graph, compiler)

    # Test: "Envía 50 mil a María"
    intent = Intent(
        name="send_money",
        confidence=0.95,
        params={"amount": 50000, "recipient": "María"},
        raw_text="Envía 50 mil a María"
    )

    plan = planner.plan(intent, current_screen="home")

    print(f"\n{'='*60}")
    print(f"  Plan: {plan.summary}")
    print(f"  Checkpoints: {' → '.join(plan.checkpoints)}")
    print(f"  Steps: {len(plan.steps)}")
    print(f"  Confirmation needed: {plan.requires_confirmation}")
    print(f"  Estimated time: {plan.estimated_time_ms}ms")
    print(f"{'='*60}")

    for step in plan.steps:
        print(f"  [{step.index}] {step.action.upper():6s} | {step.description}")
        if step.value:
            print(f"         value: {step.value}")
        if step.selector:
            print(f"         selector: {step.selector}")

    # Print protocol message
    print(f"\n{'='*60}")
    print("  WebSocket Message:")
    print(json.dumps(planner.to_protocol_message(plan), indent=2, ensure_ascii=False))

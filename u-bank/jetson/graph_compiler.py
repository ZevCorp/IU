#!/usr/bin/env python3
"""
Graph Compiler — Converts an app navigation graph (JSON) into a 30x30 maze
that HRM can solve for optimal pathfinding.

The key insight: HRM was trained on 30x30 mazes with 6-token vocabulary.
We map UI screens to spatial positions in the grid, trace walkable paths
between connected screens, and let HRM find the optimal route.

Token vocabulary (matching HRM training):
  0 = WALL      (no transition possible)
  1 = PATH      (walkable — transition exists)
  2 = START     (current screen)
  3 = TARGET    (destination screen)
  4 = SOLUTION  (HRM output — optimal path)
  5 = ERROR     (HRM output — inference error)
"""

import json
import math
import logging
from typing import Dict, List, Tuple, Optional, Any
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger('GraphCompiler')

# ============================================
# Constants
# ============================================

GRID_SIZE = 30
GRID_TOKENS = GRID_SIZE * GRID_SIZE  # 900

WALL = 0
PATH = 1
START = 2
TARGET = 3

# Minimum spacing between nodes in the grid
NODE_SPACING = 4
# Border padding
BORDER = 1

# ============================================
# Data Classes
# ============================================

@dataclass
class GraphNode:
    """A screen/state in the app navigation graph"""
    id: str
    label: str
    edges: List[str] = field(default_factory=list)
    activity: str = ""
    accessibility_snapshot: Dict = field(default_factory=dict)
    dynamic: bool = False
    grid_pos: Optional[Tuple[int, int]] = None  # Assigned during compilation


@dataclass
class GraphEdge:
    """A transition between two screens"""
    from_node: str
    to_node: str
    action: Dict = field(default_factory=dict)
    weight: int = 1
    bidirectional: bool = False


@dataclass
class AppGraph:
    """Complete navigation graph for an app"""
    app_package: str
    nodes: Dict[str, GraphNode] = field(default_factory=dict)
    edges: List[GraphEdge] = field(default_factory=list)
    version: str = "1.0.0"

    def get_neighbors(self, node_id: str) -> List[str]:
        """Get all nodes reachable from a given node"""
        neighbors = []
        for edge in self.edges:
            if edge.from_node == node_id:
                neighbors.append(edge.to_node)
            elif edge.bidirectional and edge.to_node == node_id:
                neighbors.append(edge.from_node)
        # Also check node's own edge list
        node = self.nodes.get(node_id)
        if node:
            for e in node.edges:
                if e not in neighbors:
                    neighbors.append(e)
        return neighbors

    def get_edge(self, from_id: str, to_id: str) -> Optional[GraphEdge]:
        """Get the edge between two nodes"""
        for edge in self.edges:
            if edge.from_node == from_id and edge.to_node == to_id:
                return edge
            if edge.bidirectional and edge.to_node == from_id and edge.from_node == to_id:
                return edge
        return None


# ============================================
# Graph Compiler
# ============================================

class GraphCompiler:
    """
    Compiles an app navigation graph into a 30x30 maze for HRM.
    
    Strategy:
    1. Assign each node a position in the 30x30 grid using force-directed layout
    2. Trace walkable paths between connected nodes (Bresenham-like)
    3. Mark current position as START(2) and destination as TARGET(3)
    4. Flatten to 900 tokens for HRM input
    """

    def __init__(self):
        self.grid = [[WALL] * GRID_SIZE for _ in range(GRID_SIZE)]
        self.node_positions: Dict[str, Tuple[int, int]] = {}
        self.position_to_node: Dict[Tuple[int, int], str] = {}

    def compile(
        self,
        graph: AppGraph,
        start_node: str,
        target_node: str
    ) -> Dict[str, Any]:
        """
        Compile the graph into a 30x30 maze with START and TARGET marked.
        
        Returns:
            {
                "grid": List[int],          # Flattened 900 tokens
                "grid_2d": List[List[int]],  # 30x30 2D grid
                "width": 30,
                "height": 30,
                "node_positions": {node_id: (row, col)},
                "position_to_node": {"r,c": node_id},
                "start_pos": (row, col),
                "target_pos": (row, col)
            }
        """
        # Reset grid
        self.grid = [[WALL] * GRID_SIZE for _ in range(GRID_SIZE)]
        self.node_positions = {}
        self.position_to_node = {}

        # Step 1: Layout nodes in the grid
        self._layout_nodes(graph)

        # Step 2: Trace paths between connected nodes
        self._trace_edges(graph)

        # Step 3: Mark START and TARGET
        if start_node not in self.node_positions:
            raise ValueError(f"Start node '{start_node}' not found in graph")
        if target_node not in self.node_positions:
            raise ValueError(f"Target node '{target_node}' not found in graph")

        start_r, start_c = self.node_positions[start_node]
        target_r, target_c = self.node_positions[target_node]

        self.grid[start_r][start_c] = START
        self.grid[target_r][target_c] = TARGET

        # Step 4: Flatten
        flat_grid = []
        for row in self.grid:
            flat_grid.extend(row)

        # Build position-to-node mapping for output
        pos_to_node_str = {}
        for pos, node_id in self.position_to_node.items():
            pos_to_node_str[f"{pos[0]},{pos[1]}"] = node_id

        return {
            "grid": flat_grid,
            "grid_2d": [row[:] for row in self.grid],
            "width": GRID_SIZE,
            "height": GRID_SIZE,
            "node_positions": dict(self.node_positions),
            "position_to_node": pos_to_node_str,
            "start_pos": (start_r, start_c),
            "target_pos": (target_r, target_c)
        }

    def _layout_nodes(self, graph: AppGraph):
        """
        Assign grid positions to nodes using a hierarchical grid layout.
        
        Strategy: BFS from the first node, placing nodes in a grid pattern
        with enough spacing for paths between them.
        """
        if not graph.nodes:
            return

        node_ids = list(graph.nodes.keys())
        n = len(node_ids)

        # Calculate grid dimensions for node placement
        # Leave space for borders and paths between nodes
        usable_size = GRID_SIZE - 2 * BORDER
        cols = max(1, int(math.ceil(math.sqrt(n))))
        rows = max(1, int(math.ceil(n / cols)))

        # Calculate spacing
        col_spacing = max(NODE_SPACING, usable_size // max(cols, 1))
        row_spacing = max(NODE_SPACING, usable_size // max(rows, 1))

        # Clamp spacing to fit in grid
        col_spacing = min(col_spacing, (usable_size - 1) // max(cols - 1, 1)) if cols > 1 else usable_size // 2
        row_spacing = min(row_spacing, (usable_size - 1) // max(rows - 1, 1)) if rows > 1 else usable_size // 2

        # BFS ordering for layout (keeps related nodes close)
        ordered = self._bfs_order(graph, node_ids[0])
        # Add any disconnected nodes
        for nid in node_ids:
            if nid not in ordered:
                ordered.append(nid)

        # Place nodes
        for idx, node_id in enumerate(ordered):
            row_idx = idx // cols
            col_idx = idx % cols

            r = BORDER + 1 + row_idx * row_spacing
            c = BORDER + 1 + col_idx * col_spacing

            # Clamp to grid bounds
            r = min(r, GRID_SIZE - BORDER - 1)
            c = min(c, GRID_SIZE - BORDER - 1)

            # Ensure no collision
            while (r, c) in self.position_to_node:
                c += 1
                if c >= GRID_SIZE - BORDER:
                    c = BORDER + 1
                    r += 1
                if r >= GRID_SIZE - BORDER:
                    break

            self.node_positions[node_id] = (r, c)
            self.position_to_node[(r, c)] = node_id
            self.grid[r][c] = PATH  # Mark node position as walkable

            logger.debug(f"Node '{node_id}' placed at ({r}, {c})")

    def _bfs_order(self, graph: AppGraph, start: str) -> List[str]:
        """BFS traversal order for layout"""
        visited = []
        queue = deque([start])
        seen = {start}

        while queue:
            node = queue.popleft()
            visited.append(node)

            for neighbor in graph.get_neighbors(node):
                if neighbor not in seen and neighbor in graph.nodes:
                    seen.add(neighbor)
                    queue.append(neighbor)

        return visited

    def _trace_edges(self, graph: AppGraph):
        """
        Trace walkable paths between connected nodes in the grid.
        Uses L-shaped paths (horizontal then vertical) to avoid diagonal issues.
        """
        traced = set()

        for edge in graph.edges:
            key = (edge.from_node, edge.to_node)
            if key in traced:
                continue
            traced.add(key)

            if edge.from_node not in self.node_positions or edge.to_node not in self.node_positions:
                continue

            r1, c1 = self.node_positions[edge.from_node]
            r2, c2 = self.node_positions[edge.to_node]

            self._trace_l_path(r1, c1, r2, c2)

            if edge.bidirectional:
                traced.add((edge.to_node, edge.from_node))

        # Also trace edges from node.edges lists
        for node_id, node in graph.nodes.items():
            for neighbor_id in node.edges:
                key = (node_id, neighbor_id)
                if key in traced:
                    continue
                traced.add(key)

                if node_id not in self.node_positions or neighbor_id not in self.node_positions:
                    continue

                r1, c1 = self.node_positions[node_id]
                r2, c2 = self.node_positions[neighbor_id]

                self._trace_l_path(r1, c1, r2, c2)

    def _trace_l_path(self, r1: int, c1: int, r2: int, c2: int):
        """
        Trace an L-shaped path from (r1,c1) to (r2,c2).
        Goes horizontal first, then vertical.
        Only marks cells that are currently WALL as PATH.
        """
        # Horizontal segment
        c_step = 1 if c2 >= c1 else -1
        c = c1
        while c != c2:
            if self.grid[r1][c] == WALL:
                self.grid[r1][c] = PATH
            c += c_step
        if self.grid[r1][c2] == WALL:
            self.grid[r1][c2] = PATH

        # Vertical segment
        r_step = 1 if r2 >= r1 else -1
        r = r1
        while r != r2:
            if self.grid[r][c2] == WALL:
                self.grid[r][c2] = PATH
            r += r_step
        if self.grid[r2][c2] == WALL:
            self.grid[r2][c2] = PATH

    def decode_hrm_path(
        self,
        hrm_path: List[Tuple[int, int]],
        node_positions: Dict[str, Tuple[int, int]]
    ) -> List[str]:
        """
        Convert HRM grid path back to a sequence of node IDs.
        
        Args:
            hrm_path: List of (row, col) positions from HRM
            node_positions: Mapping of node_id → (row, col)
            
        Returns:
            Ordered list of node IDs along the path
        """
        # Build reverse mapping
        pos_to_node = {}
        for node_id, pos in node_positions.items():
            pos_to_node[pos] = node_id

        # Extract nodes from path
        node_sequence = []
        for r, c in hrm_path:
            if (r, c) in pos_to_node:
                node_id = pos_to_node[(r, c)]
                if not node_sequence or node_sequence[-1] != node_id:
                    node_sequence.append(node_id)

        return node_sequence


# ============================================
# Graph Loading
# ============================================

def load_graph_from_json(json_data: Dict) -> AppGraph:
    """Load an AppGraph from JSON (as sent by Android)"""
    graph = AppGraph(
        app_package=json_data.get("app", "unknown"),
        version=json_data.get("version", "1.0.0")
    )

    # Load nodes
    nodes_data = json_data.get("nodes", {})
    for node_id, node_data in nodes_data.items():
        node = GraphNode(
            id=node_id,
            label=node_data.get("label", node_id),
            edges=node_data.get("edges", []),
            activity=node_data.get("activity", ""),
            accessibility_snapshot=node_data.get("accessibility_snapshot", {}),
            dynamic=node_data.get("dynamic", False)
        )
        graph.nodes[node_id] = node

    # Load edges
    edges_data = json_data.get("edges", [])
    for edge_data in edges_data:
        edge = GraphEdge(
            from_node=edge_data["from"],
            to_node=edge_data["to"],
            action=edge_data.get("action", {}),
            weight=edge_data.get("weight", 1),
            bidirectional=edge_data.get("bidirectional", False)
        )
        graph.edges.append(edge)

    return graph


def visualize_grid(grid_2d: List[List[int]], node_positions: Dict[str, Tuple[int, int]] = None) -> str:
    """Pretty-print a grid for debugging"""
    symbols = {0: '█', 1: '·', 2: 'S', 3: 'T', 4: '★', 5: '✗'}
    lines = []

    # Build position-to-label map
    pos_labels = {}
    if node_positions:
        for node_id, (r, c) in node_positions.items():
            pos_labels[(r, c)] = node_id[0].upper()  # First letter

    for r, row in enumerate(grid_2d):
        line = ""
        for c, cell in enumerate(row):
            if (r, c) in pos_labels and cell == PATH:
                line += pos_labels[(r, c)]
            else:
                line += symbols.get(cell, '?')
        lines.append(line)

    return "\n".join(lines)


# ============================================
# Self-test
# ============================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    # Create a sample Bancolombia graph
    sample_graph = {
        "app": "com.bancolombia.app",
        "version": "1.0.0",
        "nodes": {
            "home": {
                "label": "Inicio",
                "edges": ["transfers", "pockets", "payments", "qr"]
            },
            "transfers": {
                "label": "Transferencias",
                "edges": ["send_contact", "send_account", "home"]
            },
            "pockets": {
                "label": "Bolsillos",
                "edges": ["pocket_detail", "home"]
            },
            "payments": {
                "label": "Pagos",
                "edges": ["pay_bill", "home"]
            },
            "qr": {
                "label": "QR",
                "edges": ["home"]
            },
            "send_contact": {
                "label": "Enviar a Contacto",
                "edges": ["enter_amount", "transfers"]
            },
            "send_account": {
                "label": "Enviar a Cuenta",
                "edges": ["enter_amount", "transfers"]
            },
            "pocket_detail": {
                "label": "Detalle Bolsillo",
                "edges": ["withdraw_pocket", "pockets"]
            },
            "enter_amount": {
                "label": "Ingresar Monto",
                "edges": ["confirm_send"]
            },
            "confirm_send": {
                "label": "Confirmar Envío",
                "edges": ["success"]
            },
            "success": {
                "label": "Éxito",
                "edges": ["home"]
            },
            "withdraw_pocket": {
                "label": "Retirar de Bolsillo",
                "edges": ["pocket_detail"]
            },
            "pay_bill": {
                "label": "Pagar Servicio",
                "edges": ["payments"]
            }
        },
        "edges": []
    }

    graph = load_graph_from_json(sample_graph)
    compiler = GraphCompiler()

    # Compile: home → confirm_send
    result = compiler.compile(graph, "home", "confirm_send")

    print(f"\nGrid {result['width']}x{result['height']} ({len(result['grid'])} tokens)")
    print(f"Start: {result['start_pos']}")
    print(f"Target: {result['target_pos']}")
    print(f"\nNode positions:")
    for nid, pos in result['node_positions'].items():
        print(f"  {nid}: {pos}")
    print(f"\nMaze:")
    print(visualize_grid(result['grid_2d'], result['node_positions']))

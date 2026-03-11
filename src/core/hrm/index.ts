/**
 * Core HRM (Hierarchical Recursive Memory) Logic
 * Graph to Grid conversion and Maze building for generic UIs
 */

import {
    UIGraph,
    UINode,
    UIGrid,
    GridToken
} from '../types.js';

// ============================================
// Graph → Grid Conversion (HRM Format)
// ============================================

/**
 * Converts UI graph to HRM-compatible 2D grid
 * Uses topological layout to position nodes
 */
export function graphToGrid(
    graph: UIGraph,
    currentStateId: string,
    targetStateId: string
): UIGrid {
    const nodes = Array.from(graph.nodes.values());
    const nodeCount = nodes.length;

    // Calculate grid size (square grid that fits all nodes)
    // Add padding for walls
    const gridSize = Math.ceil(Math.sqrt(nodeCount)) + 2;

    // Initialize grid with walls
    const grid: number[][] = Array(gridSize)
        .fill(null)
        .map(() => Array(gridSize).fill(GridToken.WALL));

    // Position nodes in grid
    const stateToPosition = new Map<string, [number, number]>();
    const positionToState = new Map<string, string>();

    // Simple generic layout: place nodes in order
    // In a real generic system, this would use a force-directed or topological sort
    let row = 1;
    let col = 1;

    nodes.forEach(node => {
        if (col >= gridSize - 1) {
            col = 1;
            row++;
        }

        let token = GridToken.WALKABLE;
        if (node.id === currentStateId) token = GridToken.CURRENT;
        else if (node.id === targetStateId) token = GridToken.TARGET;

        grid[row][col] = token;
        stateToPosition.set(node.id, [row, col]);
        positionToState.set(`${row},${col}`, node.id);

        col++;
    });

    // Find current and target positions
    const currentPos = stateToPosition.get(currentStateId) || [1, 1];
    const targetPos = stateToPosition.get(targetStateId) || [1, 1];

    // Mark valid transitions (connect adjacent walkable cells)
    graph.edges.forEach(edge => {
        const fromPos = stateToPosition.get(edge.from);
        const toPos = stateToPosition.get(edge.to);

        if (fromPos && toPos) {
            // For non-adjacent nodes, we may need to add intermediate walkable cells
            // For now, simple approach: mark a path between them
            const [r1, c1] = fromPos;
            const [r2, c2] = toPos;

            // If not adjacent, mark intermediate cells as walkable
            if (Math.abs(r1 - r2) > 1 || Math.abs(c1 - c2) > 1) {
                // Simple horizontal then vertical path
                const minR = Math.min(r1, r2);
                const maxR = Math.max(r1, r2);
                const minC = Math.min(c1, c2);
                const maxC = Math.max(c1, c2);

                for (let r = minR; r <= maxR; r++) {
                    if (grid[r][c1] === GridToken.WALL) {
                        grid[r][c1] = GridToken.WALKABLE;
                    }
                }
                for (let c = minC; c <= maxC; c++) {
                    if (grid[r2][c] === GridToken.WALL) {
                        grid[r2][c] = GridToken.WALKABLE;
                    }
                }
            }
        }
    });

    // Flatten grid to sequence (row-major order)
    const sequence = grid.flat();

    return {
        grid,
        sequence,
        width: gridSize,
        height: gridSize,
        currentPos,
        targetPos,
        positionToState,
        stateToPosition
    };
}

/**
 * Converts HRM path (grid positions) back to UI actions
 */
export function pathToActions(
    path: [number, number][],
    uiGrid: UIGrid,
    graph: UIGraph
): { stateId: string; node: UINode }[] {
    return path
        .map(([row, col]) => {
            const stateId = uiGrid.positionToState.get(`${row},${col}`);
            if (!stateId) return null;
            const node = graph.nodes.get(stateId);
            if (!node) return null;
            return { stateId, node };
        })
        .filter((x): x is { stateId: string; node: UINode } => x !== null);
}

/**
 * Creates an empty generic graph
 */
export function createEmptyGraph(): UIGraph {
    return {
        nodes: new Map(),
        edges: [],
        metadata: {
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            explorationComplete: false
        }
    };
}

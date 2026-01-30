/**
 * MedEMR - Navigation Solver
 * Finds optimal paths through UI graph using BFS (HRM simulation for v1)
 */

import type { UIGraph, UIGrid, UIAction, NavigationGoal, NavigationResult, UINode } from './types';
import { GridToken } from './types';
import { graphToGrid, pathToActions } from './formalizer';

// ============================================
// BFS Solver (HRM Simulation)
// ============================================

/**
 * Solves navigation using BFS on the grid
 * This simulates HRM behavior for v1 - will be replaced with actual HRM via Jetson
 */
export function solveBFS(
    grid: number[][],
    start: [number, number],
    target: [number, number]
): [number, number][] | null {
    const height = grid.length;
    const width = grid[0].length;

    // BFS state
    const queue: { pos: [number, number]; path: [number, number][] }[] = [
        { pos: start, path: [start] }
    ];
    const visited = new Set<string>();
    visited.add(`${start[0]},${start[1]}`);

    // 4-directional movement
    const directions: [number, number][] = [
        [-1, 0],  // up
        [1, 0],   // down
        [0, -1],  // left
        [0, 1]    // right
    ];

    while (queue.length > 0) {
        const current = queue.shift()!;
        const [row, col] = current.pos;

        // Check if we reached target
        if (row === target[0] && col === target[1]) {
            return current.path;
        }

        // Explore neighbors
        for (const [dr, dc] of directions) {
            const newRow = row + dr;
            const newCol = col + dc;
            const key = `${newRow},${newCol}`;

            // Bounds check
            if (newRow < 0 || newRow >= height || newCol < 0 || newCol >= width) {
                continue;
            }

            // Already visited
            if (visited.has(key)) {
                continue;
            }

            // Wall check
            const cell = grid[newRow][newCol];
            if (cell === GridToken.WALL) {
                continue;
            }

            // Valid move
            visited.add(key);
            queue.push({
                pos: [newRow, newCol],
                path: [...current.path, [newRow, newCol]]
            });
        }
    }

    // No path found
    return null;
}

// ============================================
// High-Level Navigation API
// ============================================

/**
 * Find path between two states in the UI graph
 */
export function findPath(
    graph: UIGraph,
    currentStateId: string,
    targetStateId: string
): NavigationResult {
    // Validate states exist
    if (!graph.nodes.has(currentStateId)) {
        return {
            reachable: false,
            actions: [],
            statePath: [],
            source: 'bfs',
            error: `Current state ${currentStateId} not found in graph`
        };
    }

    if (!graph.nodes.has(targetStateId)) {
        return {
            reachable: false,
            actions: [],
            statePath: [],
            source: 'bfs',
            error: `Target state ${targetStateId} not found in graph`
        };
    }

    // Convert to grid
    const uiGrid = graphToGrid(graph, currentStateId, targetStateId);

    // Solve using BFS
    const gridPath = solveBFS(uiGrid.grid, uiGrid.currentPos, uiGrid.targetPos);

    if (!gridPath) {
        return {
            reachable: false,
            actions: [],
            statePath: [],
            source: 'bfs',
            error: 'No path found between states'
        };
    }

    // Convert grid path back to state path
    const statePathWithNodes = pathToActions(gridPath, uiGrid, graph);
    const statePath = statePathWithNodes.map(x => x.stateId);

    // Build action sequence
    const actions: UIAction[] = [];
    for (let i = 0; i < statePath.length - 1; i++) {
        const fromState = statePath[i];
        const toState = statePath[i + 1];

        // Find edge between these states
        const edge = graph.edges.find(e => e.from === fromState && e.to === toState);
        if (edge) {
            actions.push(edge.action);
        }
    }

    return {
        reachable: true,
        actions,
        statePath,
        source: 'bfs'
    };
}

/**
 * Resolve a navigation goal to a target state ID
 */
export function resolveGoal(graph: UIGraph, goal: NavigationGoal): string | null {
    // Direct state ID
    if (goal.stateId) {
        return graph.nodes.has(goal.stateId) ? goal.stateId : null;
    }

    // Find by screen name
    if (goal.screenName) {
        for (const [id, node] of graph.nodes) {
            if (node.screenName === goal.screenName || node.screenName.startsWith(goal.screenName)) {
                return id;
            }
        }
    }

    // Find by element selector
    if (goal.elementSelector) {
        for (const [id, node] of graph.nodes) {
            const hasElement = node.elements.some(el => el.selector === goal.elementSelector);
            if (hasElement) return id;
        }
    }

    // Find by element label
    if (goal.elementLabel) {
        const searchLabel = goal.elementLabel.toLowerCase();
        for (const [id, node] of graph.nodes) {
            const hasElement = node.elements.some(
                el => el.label.toLowerCase().includes(searchLabel)
            );
            if (hasElement) return id;
        }
    }

    return null;
}

/**
 * Navigate to a goal using the UI graph
 */
export function navigate(
    graph: UIGraph,
    currentStateId: string,
    goal: NavigationGoal
): NavigationResult {
    const targetStateId = resolveGoal(graph, goal);

    if (!targetStateId) {
        return {
            reachable: false,
            actions: [],
            statePath: [],
            source: 'bfs',
            error: `Could not resolve goal: ${JSON.stringify(goal)}`
        };
    }

    return findPath(graph, currentStateId, targetStateId);
}

// ============================================
// Grid Utilities
// ============================================

/**
 * Print grid to console for debugging
 */
export function printGrid(grid: number[][]): void {
    const symbols: Record<number, string> = {
        [GridToken.WALL]: '█',
        [GridToken.WALKABLE]: '·',
        [GridToken.CURRENT]: 'S',
        [GridToken.TARGET]: 'T'
    };

    console.log('\nUI Grid:');
    for (const row of grid) {
        console.log(row.map(cell => symbols[cell] || '?').join(' '));
    }
    console.log();
}

/**
 * Visualize path on grid
 */
export function printGridWithPath(
    grid: number[][],
    path: [number, number][]
): void {
    // Copy grid
    const visualGrid = grid.map(row => [...row]);

    // Mark path
    const pathSet = new Set(path.map(([r, c]) => `${r},${c}`));

    const symbols: Record<number | string, string> = {
        [GridToken.WALL]: '█',
        [GridToken.WALKABLE]: '·',
        [GridToken.CURRENT]: 'S',
        [GridToken.TARGET]: 'T',
        'path': '○'
    };

    console.log('\nPath Visualization:');
    for (let r = 0; r < visualGrid.length; r++) {
        const row = visualGrid[r];
        const line = row.map((cell, c) => {
            if (cell === GridToken.CURRENT || cell === GridToken.TARGET) {
                return symbols[cell];
            }
            if (pathSet.has(`${r},${c}`)) {
                return symbols['path'];
            }
            return symbols[cell] || '?';
        }).join(' ');
        console.log(line);
    }
    console.log();
}

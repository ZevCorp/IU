// Edge Navigator Module
// Constrains facial state movement to the graph's 1-skeleton (nodes + edges)
// Movement is parameterized as position on active edge: { edge: [from, to], t: 0..1 }

import type { FacialState } from './facialState';
import type { GraphEdge } from '../VisualGraph/state/graphState';

/**
 * Active graph state - position lives on an edge, not in free 3D space
 */
export interface ActiveGraphState {
    currentEdge: {
        from: string;
        to: string;
    };
    t: number; // 0..1 position on edge (0 = from, 1 = to)
}

/**
 * Projected position from edge state
 */
export interface EdgeProjectedState {
    position: [number, number, number];
    activeEdge: ActiveGraphState;
    nearestNodeId: string;
    isAtNode: boolean; // true when t ≈ 0 or t ≈ 1
}

export interface EdgeNavigator {
    update(facialState: FacialState): EdgeProjectedState;
    getState(): ActiveGraphState;
    setGraphData(
        edges: GraphEdge[],
        positions: Map<string, [number, number, number]>
    ): void;
    reset(): void;
}

/**
 * Creates an edge navigator that constrains movement to graph edges
 */
export function createEdgeNavigator(): EdgeNavigator {
    let edges: GraphEdge[] = [];
    let positions = new Map<string, [number, number, number]>();

    // Current state: which edge and where on it
    let currentState: ActiveGraphState = {
        currentEdge: { from: 'neutral', to: 'attention' },
        t: 0
    };

    // Smoothing for t transitions
    let targetT = 0;
    let smoothT = 0;
    const SMOOTH_FACTOR = 0.08;
    const NODE_THRESHOLD = 0.05; // Within this distance to endpoint = at node

    /**
     * Get all edges connected to a node
     */
    const getConnectedEdges = (nodeId: string): GraphEdge[] => {
        return edges.filter(e => e.from === nodeId || e.to === nodeId);
    };

    /**
     * Check if two edges share a node
     */
    const edgesShareNode = (
        edge1: { from: string; to: string },
        edge2: GraphEdge
    ): string | null => {
        if (edge1.to === edge2.from) return edge1.to;
        if (edge1.to === edge2.to) return edge1.to;
        if (edge1.from === edge2.from) return edge1.from;
        if (edge1.from === edge2.to) return edge1.from;
        return null;
    };

    /**
     * Select best edge based on facial state direction
     * Uses attention for forward/backward, activation for edge preference
     */
    const selectNextEdge = (
        currentNode: string,
        facialState: FacialState,
        previousEdge: { from: string; to: string }
    ): { edge: GraphEdge; direction: 1 | -1 } | null => {
        const connected = getConnectedEdges(currentNode);
        if (connected.length === 0) return null;

        // Filter out the edge we just came from (unless it's the only option)
        const otherEdges = connected.filter(e =>
            !(e.from === previousEdge.from && e.to === previousEdge.to) &&
            !(e.from === previousEdge.to && e.to === previousEdge.from)
        );

        const candidates = otherEdges.length > 0 ? otherEdges : connected;

        // Use activation to pick which edge (simple modulo selection)
        const edgeIndex = Math.floor(facialState.activation * candidates.length) % candidates.length;
        const selectedEdge = candidates[edgeIndex];

        // Determine direction based on which end connects to currentNode
        const direction: 1 | -1 = selectedEdge.from === currentNode ? 1 : -1;

        return { edge: selectedEdge, direction };
    };

    /**
     * Interpolate position along an edge
     */
    const getPositionOnEdge = (
        edge: { from: string; to: string },
        t: number
    ): [number, number, number] => {
        const fromPos = positions.get(edge.from);
        const toPos = positions.get(edge.to);

        if (!fromPos || !toPos) {
            return [0, 0, 0];
        }

        // Clamp t to [0, 1]
        const clampedT = Math.max(0, Math.min(1, t));

        return [
            fromPos[0] + (toPos[0] - fromPos[0]) * clampedT,
            fromPos[1] + (toPos[1] - fromPos[1]) * clampedT,
            fromPos[2] + (toPos[2] - fromPos[2]) * clampedT
        ];
    };

    return {
        update(facialState: FacialState): EdgeProjectedState {
            // Map attention to movement direction on current edge
            // attention < 0.4 = move toward from (t decreases)
            // attention > 0.6 = move toward to (t increases)
            // 0.4-0.6 = hold position

            const movementSpeed = 0.02;

            if (facialState.attention > 0.6) {
                targetT = Math.min(1, targetT + movementSpeed);
            } else if (facialState.attention < 0.4) {
                targetT = Math.max(0, targetT - movementSpeed);
            }

            // Smooth interpolation
            smoothT += (targetT - smoothT) * SMOOTH_FACTOR;

            // Check for node transitions
            const isAtFromNode = smoothT < NODE_THRESHOLD;
            const isAtToNode = smoothT > (1 - NODE_THRESHOLD);
            const isAtNode = isAtFromNode || isAtToNode;

            // Handle edge transitions at nodes
            if (isAtFromNode && targetT < 0.01) {
                // At 'from' node, check for transition to connected edge
                const nextEdgeInfo = selectNextEdge(
                    currentState.currentEdge.from,
                    facialState,
                    currentState.currentEdge
                );

                if (nextEdgeInfo) {
                    const { edge, direction } = nextEdgeInfo;
                    currentState = {
                        currentEdge: { from: edge.from, to: edge.to },
                        t: direction === 1 ? 0 : 1
                    };
                    targetT = direction === 1 ? 0.1 : 0.9;
                    smoothT = direction === 1 ? 0 : 1;
                }
            } else if (isAtToNode && targetT > 0.99) {
                // At 'to' node, check for transition to connected edge
                const nextEdgeInfo = selectNextEdge(
                    currentState.currentEdge.to,
                    facialState,
                    currentState.currentEdge
                );

                if (nextEdgeInfo) {
                    const { edge, direction } = nextEdgeInfo;
                    currentState = {
                        currentEdge: { from: edge.from, to: edge.to },
                        t: direction === 1 ? 0 : 1
                    };
                    targetT = direction === 1 ? 0.1 : 0.9;
                    smoothT = direction === 1 ? 0 : 1;
                }
            }

            // Update current t
            currentState.t = smoothT;

            // Calculate 3D position from edge state
            const position = getPositionOnEdge(currentState.currentEdge, smoothT);

            // Determine nearest node
            const nearestNodeId = smoothT < 0.5
                ? currentState.currentEdge.from
                : currentState.currentEdge.to;

            return {
                position,
                activeEdge: { ...currentState },
                nearestNodeId,
                isAtNode
            };
        },

        getState(): ActiveGraphState {
            return { ...currentState };
        },

        setGraphData(
            newEdges: GraphEdge[],
            newPositions: Map<string, [number, number, number]>
        ): void {
            edges = newEdges;
            positions = newPositions;

            // Validate current edge still exists, otherwise reset to first valid edge
            const currentEdgeExists = edges.some(e =>
                (e.from === currentState.currentEdge.from && e.to === currentState.currentEdge.to) ||
                (e.to === currentState.currentEdge.from && e.from === currentState.currentEdge.to)
            );

            if (!currentEdgeExists && edges.length > 0) {
                currentState = {
                    currentEdge: { from: edges[0].from, to: edges[0].to },
                    t: 0
                };
                targetT = 0;
                smoothT = 0;
            }
        },

        reset(): void {
            if (edges.length > 0) {
                currentState = {
                    currentEdge: { from: edges[0].from, to: edges[0].to },
                    t: 0
                };
            }
            targetT = 0;
            smoothT = 0;
        }
    };
}

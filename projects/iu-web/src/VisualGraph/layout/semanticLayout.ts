// Semantic Layout System
// Calculates node positions based on semantic relationships

import { GraphNode, GraphEdge } from '../state/graphState';

interface LayoutConfig {
    radius: number;
    centerWeight: number;
    connectionSpread: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
    radius: 4,
    centerWeight: 0.3,
    connectionSpread: 1.2,
};

/**
 * Calculates semantic positions for nodes based on their connections.
 * Uses a layered circular layout with depth based on connectivity.
 */
export function semanticLayout(
    nodes: GraphNode[],
    edges: GraphEdge[],
    config: Partial<LayoutConfig> = {}
): Map<string, [number, number, number]> {
    const { radius, centerWeight, connectionSpread } = { ...DEFAULT_CONFIG, ...config };
    const positions = new Map<string, [number, number, number]>();

    // Calculate connection count for each node
    const connectionCount = new Map<string, number>();
    nodes.forEach(node => connectionCount.set(node.id, 0));

    edges.forEach(edge => {
        connectionCount.set(edge.from, (connectionCount.get(edge.from) || 0) + 1);
        connectionCount.set(edge.to, (connectionCount.get(edge.to) || 0) + 1);
    });

    // Sort nodes by connection count (most connected = more central)
    const sortedNodes = [...nodes].sort((a, b) => {
        const countA = connectionCount.get(a.id) || 0;
        const countB = connectionCount.get(b.id) || 0;
        return countB - countA;
    });

    // Assign layers based on connectivity
    const layers: GraphNode[][] = [];
    const nodeLayer = new Map<string, number>();

    sortedNodes.forEach((node, index) => {
        const connections = connectionCount.get(node.id) || 0;
        let layer: number;

        if (connections >= 4) {
            layer = 0; // Core
        } else if (connections >= 2) {
            layer = 1; // Middle
        } else {
            layer = 2; // Outer
        }

        if (!layers[layer]) layers[layer] = [];
        layers[layer].push(node);
        nodeLayer.set(node.id, layer);
    });

    // Position nodes in concentric circles
    layers.forEach((layerNodes, layerIndex) => {
        const layerRadius = radius * (layerIndex * connectionSpread + centerWeight);
        const angleStep = (2 * Math.PI) / layerNodes.length;

        layerNodes.forEach((node, nodeIndex) => {
            // Add slight randomness for organic feel
            const angleOffset = (Math.random() - 0.5) * 0.2;
            const angle = angleStep * nodeIndex + angleOffset;

            // Y position varies by layer for depth
            const yOffset = (layerIndex - 1) * 0.8 + (Math.random() - 0.5) * 0.3;

            const x = Math.cos(angle) * layerRadius;
            const y = yOffset;
            const z = Math.sin(angle) * layerRadius;

            positions.set(node.id, [x, y, z]);
        });
    });

    return positions;
}

/**
 * Gets the center point of specified nodes
 */
export function getCenterOfNodes(
    nodeIds: string[],
    positions: Map<string, [number, number, number]>
): [number, number, number] {
    if (nodeIds.length === 0) return [0, 0, 0];

    let sumX = 0, sumY = 0, sumZ = 0;
    let count = 0;

    nodeIds.forEach(id => {
        const pos = positions.get(id);
        if (pos) {
            sumX += pos[0];
            sumY += pos[1];
            sumZ += pos[2];
            count++;
        }
    });

    if (count === 0) return [0, 0, 0];

    return [sumX / count, sumY / count, sumZ / count];
}

/**
 * Gets the bounding sphere radius for specified nodes
 */
export function getBoundingRadius(
    nodeIds: string[],
    positions: Map<string, [number, number, number]>
): number {
    const center = getCenterOfNodes(nodeIds, positions);
    let maxDist = 0;

    nodeIds.forEach(id => {
        const pos = positions.get(id);
        if (pos) {
            const dx = pos[0] - center[0];
            const dy = pos[1] - center[1];
            const dz = pos[2] - center[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            maxDist = Math.max(maxDist, dist);
        }
    });

    return maxDist + 1.5; // Padding
}

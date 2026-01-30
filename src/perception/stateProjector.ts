// State Projector Module
// Projects facial state vector to 3D position within the semantic graph

import type { FacialState } from './facialState';

export interface ProjectedState {
    position: [number, number, number];
    nearestNodeId: string | null;
    proximity: number; // 0-1, how close to nearest node
}

/**
 * Projects a facial state to a position in the 3D graph space.
 * 
 * Mapping:
 * - attention → X axis movement (low attention = left/curiosity, high = right/focus)
 * - verticalFocus → Y axis (looking down = bottom, up = top)
 * - activation → Z depth (low activation = back, high = front)
 */
export function projectFacialStateToGraph(
    state: FacialState,
    nodePositions: Map<string, [number, number, number]>,
    config: {
        xRange?: number;
        yRange?: number;
        zRange?: number;
    } = {}
): ProjectedState {
    const { xRange = 6, yRange = 3, zRange = 4 } = config;

    // Map state to position
    // attention: 0-1 → -xRange/2 to +xRange/2
    const x = (state.attention - 0.5) * xRange;

    // verticalFocus: -1 to 1 → -yRange/2 to +yRange/2
    const y = state.verticalFocus * (yRange / 2);

    // activation: 0-1 → +zRange/2 to -zRange/2 (high activation = forward)
    const z = (0.5 - state.activation) * zRange;

    const position: [number, number, number] = [x, y, z];

    // Find nearest node
    let nearestNodeId: string | null = null;
    let minDistance = Infinity;

    nodePositions.forEach((nodePos, nodeId) => {
        const dx = position[0] - nodePos[0];
        const dy = position[1] - nodePos[1];
        const dz = position[2] - nodePos[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < minDistance) {
            minDistance = distance;
            nearestNodeId = nodeId;
        }
    });

    // Calculate proximity (1 = very close, 0 = far)
    // Using a soft threshold around 2 units distance
    const proximity = Math.max(0, 1 - minDistance / 3);

    return {
        position,
        nearestNodeId,
        proximity
    };
}

/**
 * Smoothly interpolates between projected positions for easing.
 */
export function lerpProjectedPosition(
    current: [number, number, number],
    target: [number, number, number],
    factor: number
): [number, number, number] {
    return [
        current[0] + (target[0] - current[0]) * factor,
        current[1] + (target[1] - current[1]) * factor,
        current[2] + (target[2] - current[2]) * factor
    ];
}

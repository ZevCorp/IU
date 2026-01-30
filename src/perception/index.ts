// Perception Module
// Connects camera input to facial state recognition with edge-constrained navigation

export { createCameraInput, type CameraInput } from './cameraInput';
export {
    createFacialStateGenerator,
    type FacialState,
    type FacialStateGenerator,
    type JEPAEmbedding,
    embedFrameWithJEPA
} from './facialState';
export {
    projectFacialStateToGraph,
    lerpProjectedPosition,
    type ProjectedState
} from './stateProjector';
export {
    createEdgeNavigator,
    type EdgeNavigator,
    type ActiveGraphState,
    type EdgeProjectedState
} from './edgeNavigator';

import { createCameraInput, CameraInput } from './cameraInput';
import { createFacialStateGenerator, FacialState, FacialStateGenerator } from './facialState';
import { createEdgeNavigator, EdgeNavigator, EdgeProjectedState } from './edgeNavigator';
import type { GraphEdge } from '../VisualGraph/state/graphState';

export interface PerceptionPipeline {
    start(): Promise<void>;
    stop(): void;
    onStateChange(callback: (state: FacialState, projected: EdgeProjectedState) => void): () => void;
    getState(): FacialState | null;
    getProjectedState(): EdgeProjectedState | null;
    setGraphData(edges: GraphEdge[], positions: Map<string, [number, number, number]>): void;
}

/**
 * Creates the full perception pipeline: camera → facial state → edge-constrained navigation
 */
export function createPerceptionPipeline(): PerceptionPipeline {
    const camera = createCameraInput(5); // 5 FPS
    const stateGenerator = createFacialStateGenerator();
    const navigator = createEdgeNavigator();

    let currentState: FacialState | null = null;
    let currentProjected: EdgeProjectedState | null = null;

    const stateCallbacks = new Set<(state: FacialState, projected: EdgeProjectedState) => void>();

    // Handle incoming frames
    const handleFrame = (frame: ImageData) => {
        // Generate facial state from frame
        currentState = stateGenerator.update(frame);

        // Project to edge-constrained position
        currentProjected = navigator.update(currentState);

        // Notify subscribers
        stateCallbacks.forEach(cb => cb(currentState!, currentProjected!));
    };

    let unsubscribeFrame: (() => void) | null = null;

    return {
        async start(): Promise<void> {
            unsubscribeFrame = camera.onFrame(handleFrame);
            await camera.start();
        },

        stop(): void {
            camera.stop();
            if (unsubscribeFrame) {
                unsubscribeFrame();
                unsubscribeFrame = null;
            }
            currentState = null;
            currentProjected = null;
        },

        onStateChange(callback: (state: FacialState, projected: EdgeProjectedState) => void): () => void {
            stateCallbacks.add(callback);
            return () => stateCallbacks.delete(callback);
        },

        getState(): FacialState | null {
            return currentState;
        },

        getProjectedState(): EdgeProjectedState | null {
            return currentProjected;
        },

        setGraphData(edges: GraphEdge[], positions: Map<string, [number, number, number]>): void {
            navigator.setGraphData(edges, positions);
        }
    };
}

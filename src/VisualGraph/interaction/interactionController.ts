// Interaction Controller
// Provides clean interface for graph interactions

import { graphStateManager, GraphState } from '../state/graphState';

export interface InteractionCallbacks {
    onFocus?: (nodeId: string) => void;
    onCompare?: (nodeIdA: string, nodeIdB: string) => void;
    onConfirm?: (nodeId: string) => void;
    onReturnToContext?: () => void;
}

class InteractionController {
    private callbacks: InteractionCallbacks = {};

    setCallbacks(callbacks: InteractionCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Focus on a single node - enters Transaction mode
     * Camera moves smoothly to frame the node
     */
    focus(nodeId: string): void {
        graphStateManager.setFocusedNode(nodeId);
        this.callbacks.onFocus?.(nodeId);
    }

    /**
     * Compare two nodes - enters Decision mode
     * Camera frames both nodes for clear comparison
     */
    compare(nodeIdA: string, nodeIdB: string): void {
        graphStateManager.setCompareNodes(nodeIdA, nodeIdB);
        this.callbacks.onCompare?.(nodeIdA, nodeIdB);
    }

    /**
     * Confirm selection of a node
     * Triggers confirmation visual feedback
     */
    confirm(nodeId: string): void {
        graphStateManager.confirmNode(nodeId);
        this.callbacks.onConfirm?.(nodeId);
    }

    /**
     * Return to exploration context
     * Camera returns to orbit mode
     */
    returnToContext(): void {
        graphStateManager.returnToContext();
        this.callbacks.onReturnToContext?.();
    }

    /**
     * Get current graph state
     */
    getState(): GraphState {
        return graphStateManager.getState();
    }

    /**
     * Subscribe to state changes
     */
    subscribe(listener: (state: GraphState) => void): () => void {
        return graphStateManager.subscribe(listener);
    }
}

// Singleton instance
export const interactionController = new InteractionController();

// Keyboard handler for quick interactions
export function setupKeyboardControls(): () => void {
    const handleKeydown = (event: KeyboardEvent) => {
        switch (event.key) {
            case 'Escape':
                interactionController.returnToContext();
                break;
            case 'Enter':
                const state = interactionController.getState();
                if (state.focusedNodeId) {
                    interactionController.confirm(state.focusedNodeId);
                }
                break;
        }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
}

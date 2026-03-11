/**
 * StateEngine.ts
 * 
 * Manages smooth transitions between face states using GSAP.
 * This is the central orchestrator for all state changes.
 */

import gsap from 'gsap';
import { FaceState, DEFAULT_STATE, PRESETS, createState } from '../FaceState';
import { faceEventBus } from '../../events/FaceEventBus';

// =====================================================
// Types
// =====================================================

interface TransitionOptions {
    /** Duration in seconds */
    duration?: number;
    /** GSAP easing function */
    ease?: string;
    /** Callback when transition completes */
    onComplete?: () => void;
}

const DEFAULT_TRANSITION: TransitionOptions = {
    duration: 0.5,
    ease: 'power2.inOut'
};

// =====================================================
// StateEngine Class
// =====================================================

export class StateEngine {
    private currentState: FaceState;
    private targetState: FaceState;
    private animatedState: FaceState;
    private currentPresetName: string = 'neutral';
    private timeline: gsap.core.Timeline | null = null;

    // Callback to apply state changes to face components
    private onStateUpdate: ((state: FaceState) => void) | null = null;

    constructor(initialState?: Partial<FaceState>) {
        this.currentState = createState(initialState);
        this.targetState = { ...this.currentState };
        this.animatedState = { ...this.currentState };
    }

    /**
     * Set the callback for state updates
     */
    setStateUpdateCallback(callback: (state: FaceState) => void): void {
        this.onStateUpdate = callback;
    }

    /**
     * Get the current animated state
     */
    getState(): FaceState {
        return { ...this.animatedState };
    }

    /**
     * Get the target state
     */
    getTargetState(): FaceState {
        return { ...this.targetState };
    }

    /**
     * Get current preset name
     */
    getCurrentPresetName(): string {
        return this.currentPresetName;
    }

    /**
     * Transition to a preset state by name
     */
    transitionToPreset(
        presetName: string,
        options: TransitionOptions = {}
    ): void {
        const preset = PRESETS[presetName];
        if (!preset) {
            console.warn(`Unknown preset: ${presetName}`);
            return;
        }

        this.currentPresetName = presetName;
        this.transitionTo(createState(preset), options);
    }

    /**
     * Transition to a specific state
     */
    transitionTo(
        newState: Partial<FaceState>,
        options: TransitionOptions = {}
    ): void {
        const opts = { ...DEFAULT_TRANSITION, ...options };

        // Set target state
        this.targetState = createState({ ...this.currentState, ...newState });

        // Kill any existing transition
        if (this.timeline) {
            this.timeline.kill();
        }

        // Emit transition start event
        faceEventBus.emit('state:transition:start', {
            from: this.currentPresetName,
            to: this.currentPresetName,
            duration: opts.duration || 0.5
        });

        // Create new timeline
        this.timeline = gsap.timeline({
            onUpdate: () => {
                if (this.onStateUpdate) {
                    this.onStateUpdate({ ...this.animatedState });
                }
            },
            onComplete: () => {
                this.currentState = { ...this.targetState };
                this.timeline = null;

                faceEventBus.emit('state:transition:end', {
                    to: this.currentPresetName
                });

                if (opts.onComplete) {
                    opts.onComplete();
                }
            }
        });

        // Animate all properties
        this.timeline.to(this.animatedState, {
            ...this.targetState,
            duration: opts.duration,
            ease: opts.ease
        }, 0);
    }

    /**
     * Apply micro-state variations (additive to current state)
     * These are applied on top of the animated state
     */
    applyMicroState(microState: Partial<FaceState>): FaceState {
        const combined: FaceState = { ...this.animatedState };

        // Add micro variations to relevant properties
        if (microState.offsetX !== undefined) {
            combined.offsetX = (combined.offsetX || 0) + microState.offsetX;
        }
        if (microState.offsetY !== undefined) {
            combined.offsetY = (combined.offsetY || 0) + microState.offsetY;
        }
        if (microState.headTilt !== undefined) {
            combined.headTilt = (combined.headTilt || 0) + microState.headTilt;
        }
        if (microState.scale !== undefined) {
            combined.scale = (combined.scale || 1) * microState.scale;
        }
        if (microState.leftBrowHeight !== undefined) {
            combined.leftBrowHeight = (combined.leftBrowHeight || 0) + microState.leftBrowHeight;
        }
        if (microState.rightBrowHeight !== undefined) {
            combined.rightBrowHeight = (combined.rightBrowHeight || 0) + microState.rightBrowHeight;
        }
        if (microState.mouthCurve !== undefined) {
            combined.mouthCurve = (combined.mouthCurve || 0) + microState.mouthCurve;
        }

        return combined;
    }

    /**
     * Set state immediately (no animation)
     */
    setState(newState: Partial<FaceState>): void {
        // Kill any existing transition
        if (this.timeline) {
            this.timeline.kill();
            this.timeline = null;
        }

        const fullState = createState({ ...this.currentState, ...newState });
        this.currentState = fullState;
        this.targetState = fullState;
        this.animatedState = fullState;

        if (this.onStateUpdate) {
            this.onStateUpdate({ ...this.animatedState });
        }

        faceEventBus.emit('state:changed', {
            stateName: this.currentPresetName,
            state: this.currentState
        });
    }

    /**
     * Override eye openness (for blink system)
     * Applies directly without affecting other state
     */
    overrideEyeOpenness(openness: number): void {
        this.animatedState.eyeOpenness = openness;

        if (this.onStateUpdate) {
            this.onStateUpdate({ ...this.animatedState });
        }
    }

    /**
     * Check if currently transitioning
     */
    isTransitioning(): boolean {
        return this.timeline !== null && this.timeline.isActive();
    }

    /**
     * Stop all transitions
     */
    stop(): void {
        if (this.timeline) {
            this.timeline.kill();
            this.timeline = null;
        }
    }
}

// =====================================================
// Export
// =====================================================

let stateEngineInstance: StateEngine | null = null;

export function getStateEngine(): StateEngine {
    if (!stateEngineInstance) {
        stateEngineInstance = new StateEngine();
    }
    return stateEngineInstance;
}

export function createStateEngine(initialState?: Partial<FaceState>): StateEngine {
    return new StateEngine(initialState);
}

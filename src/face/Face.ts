/**
 * Face.ts
 * 
 * Main face controller that orchestrates all components and animation systems.
 * This is the primary interface for controlling the animated face.
 */

import { FaceState, createState, PRESETS } from './FaceState';
import { createEyebrows, Eyebrow } from './components/Eyebrow';
import { createEyes, Eye } from './components/Eye';
import { createMouth, Mouth } from './components/Mouth';
import { StateEngine, createStateEngine } from './animation/StateEngine';
import { BlinkSystem, createBlinkSystem } from './animation/BlinkSystem';
import { MicroExpressions, createMicroExpressions } from './animation/MicroExpressions';
import { faceEventBus } from '../events/FaceEventBus';

// =====================================================
// Face Class
// =====================================================

export class Face {
    // DOM Elements
    private faceGroup: SVGGElement;

    // Components
    private eyebrows: { left: Eyebrow; right: Eyebrow };
    private eyes: { left: Eye; right: Eye };
    private mouth: Mouth;

    // Animation Systems
    private stateEngine: StateEngine;
    private blinkSystem: BlinkSystem;
    private microExpressions: MicroExpressions;

    // Current combined state (base + micro)
    private currentCombinedState: FaceState;

    // Micro state from MicroExpressions
    private currentMicroState: Partial<FaceState> = {};

    constructor() {
        // Get the main face group
        const faceGroup = document.getElementById('face-group');
        if (!faceGroup) {
            throw new Error('Face group element not found');
        }
        this.faceGroup = faceGroup as unknown as SVGGElement;

        // Initialize components
        this.eyebrows = createEyebrows();
        this.eyes = createEyes();
        this.mouth = createMouth();

        // Initialize state engine
        this.stateEngine = createStateEngine();
        this.stateEngine.setStateUpdateCallback((state) => {
            this.applyState(state);
        });

        // Set initial state to smile in the engine
        // This ensures MicroExpressions (which use engine state) don't revert us to neutral
        this.stateEngine.transitionToPreset('smile', { duration: 0 });

        // Initialize blink system
        this.blinkSystem = createBlinkSystem();
        this.blinkSystem.setBlinkCallback((openness) => {
            this.stateEngine.overrideEyeOpenness(openness);
            // Directly update eyes for immediate visual feedback during blink
            this.eyes.left.update({
                openness,
                squint: this.currentCombinedState.eyeSquint
            });
            this.eyes.right.update({
                openness,
                squint: this.currentCombinedState.eyeSquint
            });
        });

        // Initialize micro-expressions
        this.microExpressions = createMicroExpressions();
        this.microExpressions.setUpdateCallback((microState) => {
            this.currentMicroState = microState;
            // Combine base state with micro variations
            const combined = this.stateEngine.applyMicroState(microState);
            this.applyState(combined);
        });

        // Initial state
        this.currentCombinedState = createState({ ...PRESETS.smile });

        // Apply initial state
        this.applyState(this.currentCombinedState);

        // Emit system ready
        faceEventBus.emit('system:ready', {});
    }

    /**
     * Start all animation systems
     */
    start(): void {
        this.blinkSystem.start();
        this.microExpressions.start();
    }

    /**
     * Stop all animation systems
     */
    stop(): void {
        this.blinkSystem.stop();
        this.microExpressions.stop();
        this.stateEngine.stop();
    }

    /**
     * Transition to a preset state
     */
    transitionTo(presetName: string, duration: number = 0.5): void {
        this.stateEngine.transitionToPreset(presetName, { duration });
        // Update blink system with target openness
        const preset = PRESETS[presetName];
        if (preset && preset.eyeOpenness !== undefined) {
            this.blinkSystem.setCurrentOpenness(preset.eyeOpenness);
        }
    }

    /**
     * Set a specific state immediately
     */
    setState(state: Partial<FaceState>): void {
        this.stateEngine.setState(state);
        if (state.eyeOpenness !== undefined) {
            this.blinkSystem.setCurrentOpenness(state.eyeOpenness);
        }
    }

    /**
     * Get current state
     */
    getState(): FaceState {
        return this.stateEngine.getState();
    }

    /**
     * Enable/disable micro-expressions
     */
    setMicroExpressionsEnabled(enabled: boolean): void {
        if (enabled) {
            this.microExpressions.start();
        } else {
            this.microExpressions.stop();
            // Reset micro state
            this.currentMicroState = {};
            this.applyState(this.stateEngine.getState());
        }
    }

    /**
     * Trigger a manual blink
     */
    triggerBlink(): Promise<void> {
        return this.blinkSystem.triggerBlink();
    }

    /**
     * Get available preset names
     */
    getPresets(): string[] {
        return Object.keys(PRESETS);
    }

    // =====================================================
    // Private Methods
    // =====================================================

    private applyState(state: FaceState): void {
        this.currentCombinedState = state;

        // Update components
        this.eyebrows.left.updateFromState(state);
        this.eyebrows.right.updateFromState(state);
        this.eyes.left.updateFromState(state);
        this.eyes.right.updateFromState(state);
        this.mouth.updateFromState(state);

        // Apply global transforms to face group
        this.applyGlobalTransforms(state);
    }

    private applyGlobalTransforms(state: FaceState): void {
        const { headTilt, scale, offsetX, offsetY } = state;

        // Build transform string
        // The face group is already translated to center (200, 250)
        // We apply additional transforms on top
        const transforms: string[] = [];

        // Offset (drift)
        if (offsetX !== 0 || offsetY !== 0) {
            transforms.push(`translate(${offsetX}, ${offsetY})`);
        }

        // Scale (breathing)
        if (scale !== 1) {
            transforms.push(`scale(${scale})`);
        }

        // Rotation (head tilt) around center
        if (headTilt !== 0) {
            transforms.push(`rotate(${headTilt})`);
        }

        // Apply to face group
        // We need to maintain the base translation
        const baseTransform = 'translate(200, 250)';
        const additionalTransforms = transforms.join(' ');

        this.faceGroup.setAttribute(
            'transform',
            additionalTransforms
                ? `${baseTransform} ${additionalTransforms}`
                : baseTransform
        );
    }
}

// =====================================================
// Factory Export
// =====================================================

let faceInstance: Face | null = null;

export function initializeFace(): Face {
    if (faceInstance) {
        faceInstance.stop();
    }
    faceInstance = new Face();
    return faceInstance;
}

export function getFace(): Face | null {
    return faceInstance;
}

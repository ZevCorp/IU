/**
 * MicroExpressions.ts
 * 
 * Creates subtle, continuous micro-movements that make the face feel alive.
 * Uses noise-based animation for organic, non-repetitive motion.
 * 
 * The key principle: the face should NEVER feel completely static.
 */

import gsap from 'gsap';
import { FaceState, DEFAULT_STATE } from '../FaceState';
import { faceEventBus } from '../../events/FaceEventBus';

// =====================================================
// Simple Noise Implementation
// =====================================================

/**
 * Simple 1D noise function using sine waves
 * (Avoids external dependencies like simplex-noise)
 */
class SimpleNoise {
    private seed: number;

    constructor(seed: number = Math.random() * 1000) {
        this.seed = seed;
    }

    /**
     * Get noise value at position t
     * Returns value between -1 and 1
     */
    get(t: number): number {
        // Combine multiple sine waves at different frequencies
        const s = this.seed;
        return (
            Math.sin(t * 0.5 + s) * 0.5 +
            Math.sin(t * 1.3 + s * 2.1) * 0.3 +
            Math.sin(t * 2.7 + s * 0.7) * 0.2
        );
    }
}

// =====================================================
// Configuration
// =====================================================

interface MicroConfig {
    /** Overall intensity of micro-movements (0-1) */
    intensity: number;
    /** Speed multiplier for movements */
    speed: number;
    /** Whether drift is enabled */
    enableDrift: boolean;
    /** Whether breathing effect is enabled */
    enableBreathing: boolean;
    /** Whether eyebrow micro-movements are enabled */
    enableBrowMovement: boolean;
    /** Whether mouth micro-movements are enabled */
    enableMouthMovement: boolean;
}

const DEFAULT_CONFIG: MicroConfig = {
    intensity: 1,
    speed: 1,
    enableDrift: true,
    enableBreathing: true,
    enableBrowMovement: true,
    enableMouthMovement: true
};

// =====================================================
// MicroExpressions Class
// =====================================================

export class MicroExpressions {
    private config: MicroConfig;
    private isActive: boolean = false;
    private startTime: number = 0;
    private rafId: number | null = null;

    // Noise generators for different parameters
    private noiseGenerators: {
        offsetX: SimpleNoise;
        offsetY: SimpleNoise;
        headTilt: SimpleNoise;
        scale: SimpleNoise;
        leftBrow: SimpleNoise;
        rightBrow: SimpleNoise;
        mouth: SimpleNoise;
    };

    // Callback to apply micro-state changes
    private onUpdate: ((microState: Partial<FaceState>) => void) | null = null;

    constructor(config: Partial<MicroConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Initialize noise generators with different seeds
        this.noiseGenerators = {
            offsetX: new SimpleNoise(1),
            offsetY: new SimpleNoise(2),
            headTilt: new SimpleNoise(3),
            scale: new SimpleNoise(4),
            leftBrow: new SimpleNoise(5),
            rightBrow: new SimpleNoise(6),
            mouth: new SimpleNoise(7)
        };
    }

    /**
     * Set the update callback
     */
    setUpdateCallback(callback: (microState: Partial<FaceState>) => void): void {
        this.onUpdate = callback;
    }

    /**
     * Start micro-expression animation
     */
    start(): void {
        if (this.isActive) return;

        this.isActive = true;
        this.startTime = performance.now();
        this.animate();

        faceEventBus.emit('animation:micro', {
            type: 'start',
            intensity: this.config.intensity
        });
    }

    /**
     * Stop micro-expression animation
     */
    stop(): void {
        this.isActive = false;

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        faceEventBus.emit('animation:micro', {
            type: 'stop',
            intensity: 0
        });
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<MicroConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): MicroConfig {
        return { ...this.config };
    }

    // =====================================================
    // Private Animation Loop
    // =====================================================

    private animate = (): void => {
        if (!this.isActive) return;

        const elapsed = (performance.now() - this.startTime) / 1000;
        const t = elapsed * this.config.speed;
        const intensity = this.config.intensity;

        const microState: Partial<FaceState> = {};

        // Drift (subtle position movement)
        if (this.config.enableDrift) {
            microState.offsetX = this.noiseGenerators.offsetX.get(t * 0.3) * 3 * intensity;
            microState.offsetY = this.noiseGenerators.offsetY.get(t * 0.25) * 2 * intensity;
            microState.headTilt = this.noiseGenerators.headTilt.get(t * 0.2) * 2 * intensity;
        }

        // Breathing (subtle scale oscillation)
        if (this.config.enableBreathing) {
            // Slower, more regular breathing pattern
            const breathPhase = Math.sin(elapsed * 0.8) * 0.003;
            microState.scale = 1 + breathPhase * intensity;
        }

        // Eyebrow micro-movements
        if (this.config.enableBrowMovement) {
            microState.leftBrowHeight = this.noiseGenerators.leftBrow.get(t * 0.15) * 0.05 * intensity;
            microState.rightBrowHeight = this.noiseGenerators.rightBrow.get(t * 0.18) * 0.05 * intensity;
        }

        // Mouth micro-movements (very subtle)
        if (this.config.enableMouthMovement) {
            microState.mouthCurve = this.noiseGenerators.mouth.get(t * 0.1) * 0.02 * intensity;
        }

        // Apply the micro-state
        if (this.onUpdate) {
            this.onUpdate(microState);
        }

        // Continue loop
        this.rafId = requestAnimationFrame(this.animate);
    };

    /**
     * Check if active
     */
    isRunning(): boolean {
        return this.isActive;
    }
}

// =====================================================
// Export
// =====================================================

let microExpressionsInstance: MicroExpressions | null = null;

export function getMicroExpressions(): MicroExpressions {
    if (!microExpressionsInstance) {
        microExpressionsInstance = new MicroExpressions();
    }
    return microExpressionsInstance;
}

export function createMicroExpressions(config?: Partial<MicroConfig>): MicroExpressions {
    return new MicroExpressions(config);
}

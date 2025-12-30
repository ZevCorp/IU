/**
 * BlinkSystem.ts
 * 
 * Manages natural, irregular blinking for the face.
 * Creates realistic blink patterns that make the face feel alive.
 */

import gsap from 'gsap';
import { faceEventBus } from '../../events/FaceEventBus';

// =====================================================
// Configuration
// =====================================================

interface BlinkConfig {
    /** Minimum time between blinks (ms) */
    minInterval: number;
    /** Maximum time between blinks (ms) */
    maxInterval: number;
    /** Blink duration (ms) */
    blinkDuration: number;
    /** Chance of double blink (0-1) */
    doubleBlinkChance: number;
    /** Callback to close eyes */
    onBlink: (openness: number) => void;
}

const DEFAULT_CONFIG: BlinkConfig = {
    minInterval: 2000,
    maxInterval: 6000,
    blinkDuration: 120,
    doubleBlinkChance: 0.15,
    onBlink: () => { }
};

// =====================================================
// BlinkSystem Class
// =====================================================

export class BlinkSystem {
    private config: BlinkConfig;
    private isActive: boolean = false;
    private blinkTimeline: gsap.core.Timeline | null = null;
    private nextBlinkTimeout: number | null = null;
    private currentOpenness: number = 1;

    constructor(config: Partial<BlinkConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start the automatic blinking system
     */
    start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.scheduleNextBlink();
    }

    /**
     * Stop the automatic blinking system
     */
    stop(): void {
        this.isActive = false;

        if (this.nextBlinkTimeout !== null) {
            clearTimeout(this.nextBlinkTimeout);
            this.nextBlinkTimeout = null;
        }

        if (this.blinkTimeline) {
            this.blinkTimeline.kill();
            this.blinkTimeline = null;
        }
    }

    /**
     * Set the callback for blink animations
     */
    setBlinkCallback(callback: (openness: number) => void): void {
        this.config.onBlink = callback;
    }

    /**
     * Set current eye openness (for proper restoration after blink)
     */
    setCurrentOpenness(openness: number): void {
        this.currentOpenness = openness;
    }

    /**
     * Trigger a single blink immediately
     */
    async triggerBlink(): Promise<void> {
        return this.performBlink();
    }

    // =====================================================
    // Private Methods
    // =====================================================

    private scheduleNextBlink(): void {
        if (!this.isActive) return;

        const { minInterval, maxInterval } = this.config;
        const delay = minInterval + Math.random() * (maxInterval - minInterval);

        this.nextBlinkTimeout = window.setTimeout(() => {
            this.performBlink().then(() => {
                this.scheduleNextBlink();
            });
        }, delay);
    }

    private async performBlink(): Promise<void> {
        const { blinkDuration, doubleBlinkChance, onBlink } = this.config;
        const restoreOpenness = this.currentOpenness;

        // Create blink animation
        return new Promise<void>((resolve) => {
            // State object for GSAP to animate
            const state = { openness: restoreOpenness };

            this.blinkTimeline = gsap.timeline({
                onComplete: () => {
                    this.blinkTimeline = null;
                    resolve();
                }
            });

            // Close eyes
            this.blinkTimeline.to(state, {
                openness: 0,
                duration: blinkDuration / 2000,
                ease: 'power2.in',
                onUpdate: () => onBlink(state.openness)
            });

            // Open eyes
            this.blinkTimeline.to(state, {
                openness: restoreOpenness,
                duration: blinkDuration / 2000,
                ease: 'power2.out',
                onUpdate: () => onBlink(state.openness)
            });

            // Chance for double blink
            if (Math.random() < doubleBlinkChance) {
                // Small pause
                this.blinkTimeline.to({}, { duration: 0.08 });

                // Second blink (slightly faster)
                this.blinkTimeline.to(state, {
                    openness: 0,
                    duration: blinkDuration / 2500,
                    ease: 'power2.in',
                    onUpdate: () => onBlink(state.openness)
                });

                this.blinkTimeline.to(state, {
                    openness: restoreOpenness,
                    duration: blinkDuration / 2500,
                    ease: 'power2.out',
                    onUpdate: () => onBlink(state.openness)
                });
            }

            // Emit event
            faceEventBus.emit('animation:blink', { eye: 'both' });
        });
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<BlinkConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Check if blinking is active
     */
    isRunning(): boolean {
        return this.isActive;
    }
}

// =====================================================
// Singleton Export
// =====================================================

let blinkSystemInstance: BlinkSystem | null = null;

export function getBlinkSystem(): BlinkSystem {
    if (!blinkSystemInstance) {
        blinkSystemInstance = new BlinkSystem();
    }
    return blinkSystemInstance;
}

export function createBlinkSystem(config?: Partial<BlinkConfig>): BlinkSystem {
    return new BlinkSystem(config);
}

/**
 * GazeController.ts
 * 
 * Monitors gaze direction and triggers actions:
 * - Sustained gaze left/right → Transfer face
 * - Wink → Mirror to SVG face
 */

import { FaceDetector, FaceDetectionState, GazeDirection, getFaceDetector } from './FaceDetector';

// =====================================================
// Types
// =====================================================

export interface GazeControllerConfig {
    /** How long to hold gaze before triggering transfer (ms) */
    gazeHoldDuration: number;
    /** Cooldown after transfer before allowing another (ms) */
    transferCooldown: number;
    /** Minimum time for wink to register (ms) */
    winkMinDuration: number;
    /** Maximum time for wink (longer = eyes closed, not wink) (ms) */
    winkMaxDuration: number;
}

const DEFAULT_CONFIG: GazeControllerConfig = {
    gazeHoldDuration: 1000,   // 1 second sustained gaze to transfer
    transferCooldown: 2000,   // 2 seconds between transfers
    winkMinDuration: 100,     // At least 100ms
    winkMaxDuration: 500      // Max 500ms (otherwise it's just closed eyes)
};

type TransferCallback = (direction: 'left' | 'right') => void;
type WinkCallback = (side: 'left' | 'right') => void;

// =====================================================
// GazeController Class
// =====================================================

export class GazeController {
    private config: GazeControllerConfig;
    private faceDetector: FaceDetector;

    // Gaze tracking
    private currentGaze: GazeDirection = 'center';
    private gazeStartTime: number = 0;
    private lastTransferTime: number = 0;

    // Wink tracking
    private winkStartTime: number = 0;
    private isWinking: boolean = false;

    // Callbacks
    private onTransfer: TransferCallback | null = null;
    private onWink: WinkCallback | null = null;

    // State
    private enabled: boolean = false;

    constructor(config: Partial<GazeControllerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.faceDetector = getFaceDetector();
    }

    /**
     * Start monitoring gaze
     */
    start(): void {
        this.enabled = true;

        this.faceDetector.onDetection((state) => {
            if (this.enabled) {
                this.processState(state);
            }
        });

        console.log('[GazeController] Started');
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        this.enabled = false;
        console.log('[GazeController] Stopped');
    }

    /**
     * Set callback for face transfer
     */
    setOnTransfer(callback: TransferCallback): void {
        this.onTransfer = callback;
    }

    /**
     * Set callback for wink detection
     */
    setOnWink(callback: WinkCallback): void {
        this.onWink = callback;
    }

    /**
     * Check if enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    // =====================================================
    // Processing
    // =====================================================

    private processState(state: FaceDetectionState): void {
        if (!state.faceDetected) {
            this.resetGazeTracking();
            return;
        }

        this.processGaze(state.gazeDirection);
        this.processWink(state);
    }

    private processGaze(gaze: GazeDirection): void {
        const now = Date.now();

        // Check cooldown
        if (now - this.lastTransferTime < this.config.transferCooldown) {
            return;
        }

        if (gaze !== this.currentGaze) {
            // Gaze changed - reset timer
            this.currentGaze = gaze;
            this.gazeStartTime = now;
        } else if (gaze !== 'center') {
            // Same non-center gaze - check if held long enough
            const holdDuration = now - this.gazeStartTime;

            if (holdDuration >= this.config.gazeHoldDuration) {
                this.triggerTransfer(gaze as 'left' | 'right');
                this.lastTransferTime = now;
                this.resetGazeTracking();
            }
        }
    }

    private processWink(state: FaceDetectionState): void {
        const now = Date.now();

        if (state.isWinking && !this.isWinking) {
            // Wink started
            this.isWinking = true;
            this.winkStartTime = now;
        } else if (!state.isWinking && this.isWinking) {
            // Wink ended - check duration
            const winkDuration = now - this.winkStartTime;

            if (winkDuration >= this.config.winkMinDuration &&
                winkDuration <= this.config.winkMaxDuration) {
                // Valid wink!
                const side = state.leftEyeOpen ? 'right' : 'left';
                this.triggerWink(side);
            }

            this.isWinking = false;
        }
    }

    private resetGazeTracking(): void {
        this.currentGaze = 'center';
        this.gazeStartTime = 0;
    }

    private triggerTransfer(direction: 'left' | 'right'): void {
        console.log(`[GazeController] Transfer triggered: ${direction}`);
        if (this.onTransfer) {
            this.onTransfer(direction);
        }
    }

    private triggerWink(side: 'left' | 'right'): void {
        console.log(`[GazeController] Wink detected: ${side}`);
        if (this.onWink) {
            this.onWink(side);
        }
    }
}

// =====================================================
// Singleton
// =====================================================

let instance: GazeController | null = null;

export function getGazeController(): GazeController {
    if (!instance) {
        instance = new GazeController();
    }
    return instance;
}

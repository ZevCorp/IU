/**
 * Gaze Trigger
 * Detects "Eye Contact" (Direct Gaze) to trigger the Semantic Brain.
 * This is a specialized layer on top of FaceDetector.
 */

import { getFaceDetector, FaceDetector, GazeDirection } from '../../detection/FaceDetector';
import { getRoleManager, DeviceRole } from '../../sync/roles/RoleManager';

// Screen context type from AX Reader
interface ScreenContext {
    app: string | null;
    window: string | null;
    gazeDirection: string;  // 'left' | 'center' | 'right'
    snapshot: Array<{
        id: string;
        type: string;
        label: string | null;
        bbox: { x: number; y: number; w: number; h: number };
    }>;
}

export class GazeTrigger {
    private faceDetector: FaceDetector;
    private onTriggerCallback: (() => void) | null = null;

    // Config
    private minGazeDuration = 1000; // 1 second of direct eye contact
    private gazeStartTime = 0;
    private isGazing = false;
    private enabled = false;

    // Screen context tracking
    private lastGazeSection: GazeDirection = 'center';
    private screenContext: ScreenContext | null = null;
    private onContextCallback: ((context: ScreenContext) => void) | null = null;

    constructor() {
        this.faceDetector = getFaceDetector();

        // Listen to role changes
        const roleManager = getRoleManager();
        roleManager.onRoleChange((role) => {
            if (role === DeviceRole.MAIN) {
                this.start();
            } else {
                this.stop();
            }
        });

        if (roleManager.isMain()) {
            this.start();
        }
    }

    public start() {
        if (this.enabled) return;
        this.enabled = true;

        this.faceDetector.onDetection((state) => {
            if (!this.enabled) return;

            // Track gaze section changes for screen context
            if (state.faceDetected && state.gazeDirection !== this.lastGazeSection) {
                const prevSection = this.lastGazeSection;
                this.lastGazeSection = state.gazeDirection;

                // When user looks away from center, capture what they're seeing
                if (state.gazeDirection !== 'center') {
                    this.requestScreenContext(state.gazeDirection);
                    console.log(`[GazeTrigger] 👁️ Section changed: ${prevSection} → ${state.gazeDirection}`);
                }
            }

            // Check if looking at "center" (Camera)
            if (state.faceDetected && state.gazeDirection === 'center') {
                if (!this.isGazing) {
                    this.isGazing = true;
                    this.gazeStartTime = Date.now();
                    console.log('[GazeTrigger] Eye contact started...');
                } else {
                    // Check duration
                    const duration = Date.now() - this.gazeStartTime;
                    if (duration > this.minGazeDuration) {
                        this.trigger();
                        this.isGazing = false; // Reset to prevent double trigger
                        this.gazeStartTime = Date.now() + 2000; // Cooldown
                    }
                }
            } else {
                // Looked away
                if (this.isGazing) {
                    // console.log('[GazeTrigger] Eye contact broken');
                }
                this.isGazing = false;
            }
        });

        console.log('[GazeTrigger] Active - Waiting for eye contact');
    }

    public stop() {
        this.enabled = false;
        console.log('[GazeTrigger] Stopped');
    }

    private trigger() {
        console.log('[GazeTrigger] 👁️ EYE CONTACT TRIGGER! Activating Semantic Brain...');
        if (this.onTriggerCallback) {
            this.onTriggerCallback();
        }
    }

    public onTrigger(callback: () => void) {
        this.onTriggerCallback = callback;
    }

    /**
     * Subscribe to screen context updates
     */
    public onScreenContext(callback: (context: ScreenContext) => void) {
        this.onContextCallback = callback;
    }

    /**
     * Get the current screen context (if captured)
     */
    public getScreenContext(): ScreenContext | null {
        return this.screenContext;
    }

    /**
     * Request screen context from the main process
     */
    private async requestScreenContext(direction: GazeDirection) {
        try {
            // @ts-ignore - iuOS is exposed via preload
            if (typeof window !== 'undefined' && window.iuOS?.getScreenContext) {
                const context = await window.iuOS.getScreenContext(direction);
                if (context && context.snapshot) {
                    this.screenContext = context;
                    console.log(`[GazeTrigger] 📄 Captured ${context.snapshot.length} elements from ${context.app}`);

                    if (this.onContextCallback) {
                        this.onContextCallback(context);
                    }
                }
            }
        } catch (e) {
            console.warn('[GazeTrigger] Failed to get screen context:', e);
        }
    }
}

// Singleton
let instance: GazeTrigger | null = null;

export function getGazeTrigger(): GazeTrigger {
    if (!instance) instance = new GazeTrigger();
    return instance;
}

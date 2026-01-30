/**
 * Gaze Trigger
 * Detects "Eye Contact" (Direct Gaze) to trigger the Semantic Brain.
 * This is a specialized layer on top of FaceDetector.
 */

import { getFaceDetector, FaceDetector } from '../../detection/FaceDetector';
import { getRoleManager, DeviceRole } from '../../sync/roles/RoleManager';

export class GazeTrigger {
    private faceDetector: FaceDetector;
    private onTriggerCallback: (() => void) | null = null;

    // Config
    private minGazeDuration = 1000; // 1 second of direct eye contact
    private gazeStartTime = 0;
    private isGazing = false;
    private enabled = false;

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
}

// Singleton
let instance: GazeTrigger | null = null;

export function getGazeTrigger(): GazeTrigger {
    if (!instance) instance = new GazeTrigger();
    return instance;
}

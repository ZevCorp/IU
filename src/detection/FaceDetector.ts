/**
 * FaceDetector.ts
 * 
 * Uses MediaPipe Face Mesh to detect:
 * - Gaze direction (left/center/right)
 * - Eye state (open/closed)
 * - Wink detection
 */

import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

// =====================================================
// Types
// =====================================================

export type GazeDirection = 'left' | 'center' | 'right';

export interface FaceDetectionState {
    gazeDirection: GazeDirection;
    leftEyeOpen: boolean;
    rightEyeOpen: boolean;
    isWinking: boolean;
    winkingSide: 'left' | 'right' | null;
    faceDetected: boolean;
}

type DetectionCallback = (state: FaceDetectionState) => void;

// =====================================================
// Landmark Indices (MediaPipe Face Mesh)
// =====================================================

// Iris landmarks
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;

// Eye corners for reference
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

// Eyelid landmarks for blink detection
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;

// =====================================================
// FaceDetector Class
// =====================================================

export class FaceDetector {
    private faceMesh: FaceMesh | null = null;
    private camera: Camera | null = null;
    private videoElement: HTMLVideoElement | null = null;
    private callbacks: Set<DetectionCallback> = new Set();
    private isRunning = false;
    private lastState: FaceDetectionState = {
        gazeDirection: 'center',
        leftEyeOpen: true,
        rightEyeOpen: true,
        isWinking: false,
        winkingSide: null,
        faceDetected: false
    };

    /**
     * Initialize the face detector
     */
    async init(videoElement: HTMLVideoElement): Promise<void> {
        this.videoElement = videoElement;

        // Initialize MediaPipe Face Mesh
        this.faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            }
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // Enables iris tracking
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.processResults(results));

        console.log('[FaceDetector] Initialized');
    }

    /**
     * Start detection
     */
    async start(): Promise<void> {
        if (!this.videoElement || !this.faceMesh) {
            throw new Error('FaceDetector not initialized');
        }

        this.camera = new Camera(this.videoElement, {
            onFrame: async () => {
                if (this.faceMesh && this.videoElement) {
                    await this.faceMesh.send({ image: this.videoElement });
                }
            },
            width: 640,
            height: 480
        });

        await this.camera.start();
        this.isRunning = true;
        console.log('[FaceDetector] Started');
    }

    /**
     * Stop detection
     */
    stop(): void {
        if (this.camera) {
            this.camera.stop();
        }
        this.isRunning = false;
        console.log('[FaceDetector] Stopped');
    }

    /**
     * Subscribe to detection updates
     */
    onDetection(callback: DetectionCallback): () => void {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    /**
     * Get current state
     */
    getState(): FaceDetectionState {
        return { ...this.lastState };
    }

    /**
     * Check if running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    // =====================================================
    // Processing
    // =====================================================

    private processResults(results: Results): void {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.updateState({ ...this.lastState, faceDetected: false });
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // Calculate gaze direction
        const gazeDirection = this.calculateGazeDirection(landmarks);

        // Calculate eye openness
        const leftEyeOpen = this.isEyeOpen(landmarks, 'left');
        const rightEyeOpen = this.isEyeOpen(landmarks, 'right');

        // Detect wink (one eye closed, other open)
        const isWinking = (leftEyeOpen && !rightEyeOpen) || (!leftEyeOpen && rightEyeOpen);
        const winkingSide = isWinking ? (leftEyeOpen ? 'right' : 'left') : null;

        this.updateState({
            gazeDirection,
            leftEyeOpen,
            rightEyeOpen,
            isWinking,
            winkingSide,
            faceDetected: true
        });
    }

    private calculateGazeDirection(landmarks: any[]): GazeDirection {
        // Get iris center and eye corners
        const leftIris = landmarks[LEFT_IRIS_CENTER];
        const leftInner = landmarks[LEFT_EYE_INNER];
        const leftOuter = landmarks[LEFT_EYE_OUTER];

        const rightIris = landmarks[RIGHT_IRIS_CENTER];
        const rightInner = landmarks[RIGHT_EYE_INNER];
        const rightOuter = landmarks[RIGHT_EYE_OUTER];

        // Calculate horizontal position of iris within eye (0 = outer, 1 = inner)
        const leftEyeWidth = Math.abs(leftInner.x - leftOuter.x);
        const leftIrisPos = (leftIris.x - leftOuter.x) / leftEyeWidth;

        const rightEyeWidth = Math.abs(rightInner.x - rightOuter.x);
        const rightIrisPos = (rightIris.x - rightOuter.x) / rightEyeWidth;

        // Average both eyes
        const avgIrisPos = (leftIrisPos + rightIrisPos) / 2;

        // Thresholds for gaze detection
        // Note: In webcam view, left/right are mirrored
        if (avgIrisPos < 0.35) {
            return 'left';  // Looking screen-left (user's right)
        } else if (avgIrisPos > 0.65) {
            return 'right'; // Looking screen-right (user's left)
        }
        return 'center';
    }

    private isEyeOpen(landmarks: any[], eye: 'left' | 'right'): boolean {
        const topIdx = eye === 'left' ? LEFT_EYE_TOP : RIGHT_EYE_TOP;
        const bottomIdx = eye === 'left' ? LEFT_EYE_BOTTOM : RIGHT_EYE_BOTTOM;

        const top = landmarks[topIdx];
        const bottom = landmarks[bottomIdx];

        // Calculate vertical distance (eye height)
        const eyeHeight = Math.abs(top.y - bottom.y);

        // Threshold for "closed" - very small opening
        // This value may need tuning
        return eyeHeight > 0.015;
    }

    private updateState(newState: FaceDetectionState): void {
        // Only notify if state changed
        const changed =
            newState.gazeDirection !== this.lastState.gazeDirection ||
            newState.isWinking !== this.lastState.isWinking ||
            newState.faceDetected !== this.lastState.faceDetected;

        this.lastState = newState;

        if (changed) {
            this.callbacks.forEach(cb => cb(newState));
        }
    }
}

// =====================================================
// Singleton
// =====================================================

let instance: FaceDetector | null = null;

export function getFaceDetector(): FaceDetector {
    if (!instance) {
        instance = new FaceDetector();
    }
    return instance;
}

/**
 * FaceDetector.ts
 * 
 * Replaces MediaPipe with face-api.js for robust facial recognition using Deep Learning.
 * 
 * Features:
 * - Loads face-api.js from CDN
 * - Loads AI models from local /models directory
 * - Detects faces, landmarks (68 points), and computes Face Descriptors (128-d embeddings)
 */

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

export interface FaceData {
    detection: any; // face-api.js FaceDetection
    landmarks: any; // face-api.js FaceLandmarks68
    descriptor: Float32Array | null; // The unique face embedding
}

type DetectionCallback = (state: FaceDetectionState) => void;
type FaceDataCallback = (data: FaceData | null) => void;

// =====================================================
// FaceDetector Class
// =====================================================

export class FaceDetector {
    private videoElement: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private callbacks: Set<DetectionCallback> = new Set();
    private faceDataCallbacks: Set<FaceDataCallback> = new Set();
    private isRunning = false;
    private animationFrameId: number | null = null;

    private lastState: FaceDetectionState = {
        gazeDirection: 'center',
        leftEyeOpen: true,
        rightEyeOpen: true,
        isWinking: false,
        winkingSide: null,
        faceDetected: false
    };

    // Store raw data for external access
    private lastFaceData: FaceData | null = null;

    // FaceAPI reference
    private faceapi: any = null;

    /**
     * Initialize the face detector and load models
     */
    async init(videoElement: HTMLVideoElement): Promise<void> {
        this.videoElement = videoElement;

        // Load face-api.js from CDN
        await this.loadScript('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js');

        this.faceapi = (window as any).faceapi;
        if (!this.faceapi) {
            throw new Error('face-api.js failed to load');
        }

        console.log('[FaceDetector] Loading AI models...');

        // Load models from public/models
        const modelPath = '/models';
        try {
            await Promise.all([
                this.faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath), // Detection (accurate)
                this.faceapi.nets.faceLandmark68Net.loadFromUri(modelPath), // Landmarks
                this.faceapi.nets.faceRecognitionNet.loadFromUri(modelPath), // Descriptors
                // Optional: Expression net if needed later
                // this.faceapi.nets.faceExpressionNet.loadFromUri(modelPath) 
            ]);
            console.log('[FaceDetector] AI Models loaded successfully');
        } catch (error) {
            console.error('[FaceDetector] Failed to load models:', error);
            throw new Error('Failed to load facial recognition models');
        }

        console.log('[FaceDetector] Initialized');
    }

    private async loadScript(src: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Start detection loop
     */
    async start(): Promise<void> {
        if (!this.videoElement || !this.faceapi) {
            throw new Error('FaceDetector not initialized');
        }

        try {
            // Request camera access
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });

            this.videoElement.srcObject = stream;

            // Wait for video to be ready
            await new Promise<void>((resolve) => {
                if (this.videoElement!.readyState >= 2) {
                    resolve();
                } else {
                    this.videoElement!.onloadeddata = () => resolve();
                }
            });

            await this.videoElement.play();

            // Create hidden canvas for internal processing if needed
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
            }

            this.isRunning = true;
            this.detectLoop();
            console.log('[FaceDetector] Camera started and detection loop active');
        } catch (error) {
            console.error('[FaceDetector] Failed to start camera:', error);
            throw new Error('Could not access camera');
        }
    }

    /**
     * Stop detection
     */
    stop(): void {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Stop camera stream
        if (this.videoElement && this.videoElement.srcObject) {
            const stream = this.videoElement.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }

        console.log('[FaceDetector] Stopped');
    }

    /**
     * Main detection loop
     */
    private async detectLoop() {
        if (!this.isRunning || !this.videoElement) return;

        // Skip if video is paused or ended
        if (this.videoElement.paused || this.videoElement.ended) {
            this.animationFrameId = requestAnimationFrame(() => this.detectLoop());
            return;
        }

        try {
            // Options for SSD Mobilenet (slower but more accurate than TinyFace)
            const options = new this.faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });

            // Detect face with landmarks and descriptor
            const result = await this.faceapi
                .detectSingleFace(this.videoElement, options)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (result) {
                // Process result
                const faceData: FaceData = {
                    detection: result.detection,
                    landmarks: result.landmarks,
                    descriptor: result.descriptor
                };

                this.lastFaceData = faceData;
                this.processFaceData(faceData);

                // Notify callbacks
                this.faceDataCallbacks.forEach(cb => cb(faceData));
            } else {
                this.lastFaceData = null;
                this.updateState({ ...this.lastState, faceDetected: false });
                this.faceDataCallbacks.forEach(cb => cb(null));
            }

        } catch (error) {
            console.error('[FaceDetector] Detection error:', error);
        }

        // Continue loop
        // Throttle to avoid freezing UI (e.g. every 100ms instead of every frame)
        // Or simplify: requestAnimationFrame but skip frames manually if needed
        this.animationFrameId = requestAnimationFrame(() => this.detectLoop());
    }

    /**
     * Process face data to update state (gaze, eyes, etc.)
     */
    private processFaceData(data: FaceData) {
        // Calculate gaze and eye state from 68 landmarks
        // Note: face-api.js 68 points are different from MediaPipe 468
        const landmarks = data.landmarks.positions; // Array of {x, y}

        // Simple gaze estimation based on nose orientation vs face box
        // This is a simplified version compared to MediaPipe iris tracking
        const nose = landmarks[30]; // Nose tip
        const leftEye = landmarks[36]; // Left eye outer corner
        const rightEye = landmarks[45]; // Right eye outer corner

        // Calculate face center X
        const faceCenterX = (leftEye.x + rightEye.x) / 2;

        let gaze: GazeDirection = 'center';
        if (nose.x < leftEye.x) gaze = 'right'; // Mirrored
        else if (nose.x > rightEye.x) gaze = 'left';

        // Fake eye open state (face-api landmarks don't track eyelids precisely enough for simple blink without EAR)
        // For this demo, we assume eyes are open if face is detected with high confidence
        const leftEyeOpen = true;
        const rightEyeOpen = true;

        this.updateState({
            gazeDirection: gaze,
            leftEyeOpen,
            rightEyeOpen,
            isWinking: false,
            winkingSide: null,
            faceDetected: true
        });
    }

    private updateState(newState: FaceDetectionState): void {
        const changed =
            newState.gazeDirection !== this.lastState.gazeDirection ||
            newState.faceDetected !== this.lastState.faceDetected;

        this.lastState = newState;

        if (changed) {
            this.callbacks.forEach(cb => cb(newState));
        }
    }

    // =====================================================
    // Public API
    // =====================================================

    onDetection(callback: DetectionCallback): () => void {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    /**
     * Subscribe to full face data updates (including descriptor)
     * This replaces onLandmarksDetected
     */
    onFaceDataDetected(callback: FaceDataCallback): () => void {
        this.faceDataCallbacks.add(callback);
        return () => this.faceDataCallbacks.delete(callback);
    }

    // Legacy support for existing code calling onLandmarksDetected
    onLandmarksDetected(callback: (data: any) => void): () => void {
        return this.onFaceDataDetected(callback);
    }

    getState(): FaceDetectionState {
        return { ...this.lastState };
    }

    getRawLandmarks(): FaceData | null {
        return this.lastFaceData;
    }

    isActive(): boolean {
        return this.isRunning;
    }
}

// Singleton
let instance: FaceDetector | null = null;

export function getFaceDetector(): FaceDetector {
    if (!instance) {
        instance = new FaceDetector();
    }
    return instance;
}

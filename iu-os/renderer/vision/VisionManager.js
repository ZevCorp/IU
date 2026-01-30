/**
 * VisionManager.js
 * Handles Webcam Input & MediaPipe Face Mesh detection.
 * Detects:
 * 1. Gaze Direction (Where is the user looking?)
 * 2. Attention (Is user looking at THIS window?)
 * 3. Gestures (Action triggers, gated by attention)
 */

class VisionManager {
    constructor() {
        this.videoElement = document.querySelector('.input_video');
        this.faceMesh = null;
        this.camera = null;
        this.isReady = false;

        // State
        this.state = {
            isAttentive: false,   // True if looking at the correct zone
            isGestureActive: false,
            currentZone: 'center', // left, center, right
            targetZone: 'right',   // Where this app window is located
            headPose: { yaw: 0, pitch: 0, roll: 0 },
            gaze: { x: 0.5, y: 0.5 },
            lastEyebrowTime: 0,
            prevEyebrowRaised: false
        };

        // Configuration
        this.config = {
            attentionThreshold: 15, // Degrees for head pose (backup)
            bufferTime: 800,
            // Gaze Zones (0-1 range of eye movement)
            zoneThresholds: {
                left: 0.4,   // < 0.4 is Left
                right: 0.6   // > 0.6 is Right
            }
        };

        // Callbacks
        this.onAttentionChange = null;
        this.onGesture = null;
        this.onFaceUpdate = null;

        this.init();
    }

    async init() {
        console.log('👁️ VisionManager Initializing with Gaze Tracking...');

        // Initialize Face Mesh
        this.faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            }
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true, // Critical for Iris tracking
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.onResults(results));

        // Initialize Camera
        if (this.videoElement) {
            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    await this.faceMesh.send({ image: this.videoElement });
                },
                width: 640,
                height: 480
            });

            await this.camera.start();
            console.log('📷 Camera started');
            this.isReady = true;
        }
    }

    setWindowPosition(position) {
        // position: 'left', 'center', 'right'
        console.log(`🔲 VisionManager: Window Position set to ${position}`);
        this.state.targetZone = position;

        // Setup simple demo zones for visual debugging?
    }

    onResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.updateAttention(false);
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // --- 1. Gaze & Zone Detection ---

        // Iris: 468 (Left), 473 (Right)
        // Eye Corners Left: 133 (Inner), 33 (Outer)
        // Eye Corners Right: 362 (Inner), 263 (Outer)

        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        const leftEyeInner = landmarks[133];
        const leftEyeOuter = landmarks[33];
        const rightEyeInner = landmarks[362];
        const rightEyeOuter = landmarks[263];

        // Calculate normalized gaze X (0=Left, 1=Right looking relative to eye)
        // Note: For webcam "mirror" mode:
        // User looks RIGHT -> Iris moves to image RIGHT.
        const leftGazeX = (leftIris.x - leftEyeInner.x) / (leftEyeOuter.x - leftEyeInner.x);
        const rightGazeX = (rightIris.x - rightEyeInner.x) / (rightEyeOuter.x - rightEyeInner.x);

        // Average
        let gazeX = (leftGazeX + rightGazeX) / 2;

        // --- Head Pose & Proximity ---
        const nose = landmarks[1];
        const leftEar = landmarks[234];
        const rightEar = landmarks[454];
        const midEarsX = (leftEar.x + rightEar.x) / 2;

        // 1. Proximity
        const proximity = Math.abs(rightEar.x - leftEar.x);

        // 2. Yaw (Rotation)
        const yaw = (nose.x - midEarsX) * 100;

        // 3. Dynamic Threshold (Extremely Sensitive at Distance)
        // Adjusted per request: Higher sensitivity when face is small (proximity < 0.2)
        const yawThreshold = Math.max(0.2, proximity * 15);

        // --- Zone Logic ---
        let detectedZone = 'center';
        if (yaw > yawThreshold) detectedZone = 'left';
        else if (yaw < -yawThreshold) detectedZone = 'right';
        else detectedZone = 'center';

        this.state.currentZone = detectedZone;

        // --- 2. Attention ---
        const isLookingAtWindow = (detectedZone === this.state.targetZone);
        this.updateAttention(isLookingAtWindow);

        // --- 3. Gesture: SHARP NOD (Acentuación con la Cabeza) ---
        // Logic: Calculate Pitch Velocity (Delta Pitch)
        // We need 'pitch' from Head Pose
        const chin = landmarks[152];
        const topHead = landmarks[10];
        const pitch = (nose.y - (chin.y + topHead.y) / 2) * 100;

        this.state.headPose = { yaw, pitch, roll: 0 };

        // Pitch History for Velocity
        const now = Date.now();
        if (!this.state.pitchHistory) this.state.pitchHistory = [];
        this.state.pitchHistory.push({ p: pitch, t: now });

        // Keep last 300ms
        this.state.pitchHistory = this.state.pitchHistory.filter(h => now - h.t < 300);

        // Analyze Nod
        if (this.state.isAttentive) {
            // Check for "Sharp Down then Up" or just "Sharp Down" movement
            // Velocity = (CurrentPitch - OldPitch)
            // Look for a large rapid change

            if (this.state.pitchHistory.length > 2) {
                const oldest = this.state.pitchHistory[0];
                const deltaPitch = pitch - oldest.p; // + is Down, - is Up (usually, verify coords)

                // Note: In MediaPipe, Y increases downwards ?? 
                // Let's check: TopHead.y < Chin.y. 
                // If Nose goes DOWN, Nose.y increases. Pitch increases.
                // So POSITIVE delta = NOD DOWN.

                // Threshold for "Muy Marcada" - Reduced from 7.0 to 3.0
                const velocity = deltaPitch;

                // Check for rapid DOWN movement (> 3.0 degrees in < 300ms)
                const isNoddingDown = velocity > 3.0;

                if (isNoddingDown) {
                    if (!this.state.isGestureActive) {
                        console.log(`📉 NOD DETECTED! Velocity: ${velocity.toFixed(1)}`);
                        this.state.isGestureActive = true;
                        this.triggerGesture('call');
                        // Cooldown
                        this.state.pitchHistory = [];
                    }
                } else {
                    // Reset if stabilized? No, let cooldown handle it naturally
                    if (Math.abs(velocity) < 1.5) this.state.isGestureActive = false;
                }
            }
        }

        // Send Data to UI
        if (this.onFaceUpdate) {
            this.onFaceUpdate({
                isAttentive: this.state.isAttentive,
                currentZone: detectedZone,
                targetZone: this.state.targetZone,
                gazeX: gazeX.toFixed(2),
                headPose: this.state.headPose
            });
        }
    }

    updateAttention(isNowAttentive) {
        if (this.state.isAttentive !== isNowAttentive) {
            this.state.isAttentive = isNowAttentive;
            console.log(`👀 Attention State Changed: ${isNowAttentive} (Zone: ${this.state.currentZone})`);

            if (this.onAttentionChange) {
                this.onAttentionChange(isNowAttentive);
            }
        }
    }

    triggerGesture(gestureName) {
        console.log(`✨ ACTION TRIGGERED: ${gestureName}`);
        if (this.onGesture) {
            this.onGesture(gestureName);
        }
    }

    // Setters
    setOnAttentionChange(cb) { this.onAttentionChange = cb; }
    setOnGesture(cb) { this.onGesture = cb; }
    setOnFaceUpdate(cb) { this.onFaceUpdate = cb; }
}

// Export
window.VisionManager = VisionManager;

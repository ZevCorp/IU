/**
 * VisionManager.js
 * Handles Webcam Input & MediaPipe Face Landmarker detection.
 * Uses the new Tasks Vision API with 52 blendshapes for reliable gesture detection.
 * Detects:
 * 1. Gaze Direction (Where is the user looking?) — via 478 landmarks
 * 2. Attention (Is user looking at THIS window?) — via head pose from landmarks
 * 3. Gestures (Action triggers, gated by attention) — via nod detection
 * 4. Facial Expressions (52 blendshapes) — fed to DopamineEngine
 */

class VisionManager {
    constructor() {
        this.videoElement = document.querySelector('.input_video');
        this.faceLandmarker = null;
        this.camera = null;
        this.isReady = false;
        this._rafId = null;

        // State
        this.state = {
            isAttentive: false,   // True if looking at the correct zone
            inDeepAttention: false, // True only when in thinking mode (dwell reached)
            isGestureActive: false,
            currentZone: 'center', // left, center, right
            lastCapturedZone: null, // For screen context capture
            targetZone: 'right',   // Where this app window is located
            headPose: { yaw: 0, pitch: 0, roll: 0 },
            gaze: { x: 0.5, y: 0.5 },
            lastEyebrowTime: 0,
            prevEyebrowRaised: false,
            screenContext: null    // Last captured screen context
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

        // DopamineEngine integration
        this.dopamineEngine = null;
        this.onDopamineResponse = null;

        this.init();
    }

    async init() {
        console.log('👁️ VisionManager Initializing with FaceLandmarker (Blendshapes)...');

        // Wait for MediaPipe Tasks Vision module to load (ES module is deferred)
        if (!window.FilesetResolver || !window.FaceLandmarker) {
            console.log('⏳ Waiting for MediaPipe Tasks Vision module...');
            await new Promise((resolve) => {
                if (window.FilesetResolver && window.FaceLandmarker) {
                    resolve();
                } else {
                    window.addEventListener('mediapipe-ready', resolve, { once: true });
                }
            });
            console.log('✅ MediaPipe Tasks Vision module loaded');
        }

        try {
            // Load MediaPipe Tasks Vision WASM
            const vision = await window.FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );

            // Create FaceLandmarker with blendshapes enabled
            this.faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numFaces: 1,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: false,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            console.log('✅ FaceLandmarker created with blendshapes');
        } catch (e) {
            console.error('❌ FaceLandmarker init failed:', e);
            return;
        }

        // Initialize Camera stream
        if (this.videoElement) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, facingMode: 'user' }
                });
                this.videoElement.srcObject = stream;
                this.videoElement.addEventListener('loadeddata', () => {
                    this.isReady = true;
                    this.startDetectionLoop();
                    console.log('📷 Camera started (FaceLandmarker mode)');
                });
                await this.videoElement.play();
            } catch (e) {
                console.error('❌ Camera init failed:', e);
            }
        }
    }

    startDetectionLoop() {
        let lastVideoTime = -1;

        const detect = () => {
            if (!this.isReady || !this.faceLandmarker) {
                this._rafId = requestAnimationFrame(detect);
                return;
            }

            const nowMs = performance.now();
            if (this.videoElement.currentTime !== lastVideoTime) {
                lastVideoTime = this.videoElement.currentTime;
                const results = this.faceLandmarker.detectForVideo(this.videoElement, nowMs);
                this.onResults(results);
            }

            this._rafId = requestAnimationFrame(detect);
        };

        detect();
    }

    setWindowPosition(position) {
        // position: 'left', 'center', 'right'
        console.log(`🔲 VisionManager: Window Position set to ${position}`);
        this.state.targetZone = position;

        // Setup simple demo zones for visual debugging?
    }

    onResults(results) {
        if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
            this.updateAttention(false);
            return;
        }

        const landmarks = results.faceLandmarks[0];

        // --- 0. Feed DopamineEngine (blendshapes — 52 calibrated coefficients) ---
        if (this.dopamineEngine && this.dopamineEngine.isActive) {
            const blendshapes = (results.faceBlendshapes && results.faceBlendshapes.length > 0)
                ? results.faceBlendshapes[0].categories
                : null;
            this.dopamineEngine.processBlendshapes(blendshapes, landmarks);
        }

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

        // --- Screen Context Capture (when looking away from U) ---
        if (detectedZone !== 'center' && detectedZone !== this.state.lastCapturedZone) {
            this.state.lastCapturedZone = detectedZone;
            this.captureScreenContext(detectedZone);
        }

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

        // Analyze Nod - ONLY when in DEEP ATTENTION (thinking mode)
        if (this.state.isAttentive && this.state.inDeepAttention) {
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
                        console.log(`📉 NOD DETECTED (Deep Attention)! Velocity: ${velocity.toFixed(1)}`);
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
        } else if (this.state.isAttentive && !this.state.inDeepAttention) {
            // Shallow attention - gestures are disabled
            // Reset gesture state to prevent stale activations
            this.state.isGestureActive = false;
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
    setOnDopamineResponse(cb) { this.onDopamineResponse = cb; }

    // DopamineEngine initialization
    initDopamineEngine() {
        if (typeof DopamineEngine === 'undefined') {
            console.warn('🧬 DopamineEngine not loaded');
            return;
        }

        this.dopamineEngine = new DopamineEngine();

        // Wire response callback through VisionManager
        this.dopamineEngine.onResponse = (preset, intensity, meta) => {
            if (this.onDopamineResponse) {
                this.onDopamineResponse(preset, intensity, meta);
            }
        };

        this.dopamineEngine.onGestureDetected = (gesture, confidence) => {
            console.log(`🧬 [Dopamine] Detected: ${gesture} (${(confidence * 100).toFixed(0)}%)`);
        };

        this.dopamineEngine.start();
        console.log('🧬 DopamineEngine initialized via VisionManager');
    }

    getDopamineEngine() {
        return this.dopamineEngine;
    }
    setDeepAttention(isDeep) {
        this.state.inDeepAttention = isDeep;
        console.log(`🧠 Deep Attention: ${isDeep ? 'ENABLED' : 'DISABLED'} (Gestures ${isDeep ? 'active' : 'inactive'})`);
    }

    // Screen Context Capture
    async captureScreenContext(zone) {
        try {
            if (window.iuOS && window.iuOS.getScreenContext) {
                const context = await window.iuOS.getScreenContext(zone);
                if (context && context.snapshot) {
                    this.state.screenContext = context;
                    console.log(`📄 [Context] Captured ${context.snapshot.length} elements from ${context.app || 'unknown'} (zone: ${zone})`);

                    // Log first few elements for debugging
                    if (context.snapshot.length > 0) {
                        const sample = context.snapshot.slice(0, 3).map(el =>
                            `[${el.type}] "${el.label?.substring(0, 30) || 'no label'}"`
                        ).join(', ');
                        console.log(`   📋 Sample: ${sample}`);
                    }
                }
            }
        } catch (e) {
            console.warn('[VisionManager] Failed to capture screen context:', e);
        }
    }

    // Get current screen context (for dwell suggestions)
    getScreenContext() {
        return this.state.screenContext;
    }
}

// Export
window.VisionManager = VisionManager;

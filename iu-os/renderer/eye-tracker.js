/**
 * IÜ OS - Eye Tracker
 * Uses MediaPipe Face Mesh for gaze detection
 */

class EyeTracker {
    constructor(options = {}) {
        this.options = {
            activationTime: options.activationTime || 500, // ms to look at zone to activate
            cameraWidth: options.cameraWidth || 640,
            cameraHeight: options.cameraHeight || 480,
            ...options
        };

        this.faceMesh = null;
        this.camera = null;
        this.isRunning = false;
        this.currentGaze = null;
        this.zones = [];
        this.lookingAtZone = null;
        this.lookStartTime = null;

        // Metrics
        this.metrics = {
            totalActivations: 0,
            successfulActivations: 0,
            falsePositives: 0,
            averageActivationTime: 0,
            activationTimes: []
        };

        // Callbacks
        this.onGazeUpdate = null;
        this.onZoneActivated = null;
        this.onLookingAtZone = null;
    }

    async init() {
        console.log('👁️ Initializing eye tracker...');

        // Get video element or create one
        this.video = document.createElement('video');
        this.video.style.display = 'none';
        document.body.appendChild(this.video);

        try {
            // Request camera access
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: this.options.cameraWidth,
                    height: this.options.cameraHeight,
                    facingMode: 'user'
                }
            });

            this.video.srcObject = stream;
            await this.video.play();

            // Initialize Face Mesh
            await this.initFaceMesh();

            console.log('✅ Eye tracker ready');
            return true;
        } catch (error) {
            console.error('❌ Eye tracker initialization failed:', error);
            return false;
        }
    }

    async initFaceMesh() {
        // Import MediaPipe dynamically
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        const { Camera } = await import('@mediapipe/camera_utils');

        this.faceMesh = new FaceMesh({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
            }
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.processResults(results));

        this.camera = new Camera(this.video, {
            onFrame: async () => {
                if (this.isRunning && this.faceMesh) {
                    await this.faceMesh.send({ image: this.video });
                }
            },
            width: this.options.cameraWidth,
            height: this.options.cameraHeight
        });
    }

    registerZone(id, bounds) {
        // bounds = { x, y, width, height } in screen coordinates
        this.zones.push({ id, bounds });
    }

    clearZones() {
        this.zones = [];
    }

    start() {
        this.isRunning = true;
        this.camera?.start();
        console.log('👁️ Eye tracking started');
    }

    stop() {
        this.isRunning = false;
        this.camera?.stop();
        console.log('👁️ Eye tracking stopped');
    }

    processResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.currentGaze = null;
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];

        // Extract eye landmarks for gaze estimation
        // Left eye: 33, 133, 159, 145
        // Right eye: 362, 263, 386, 374
        // Iris: 468-472 (left), 473-477 (right)

        const leftIris = landmarks[468];
        const rightIris = landmarks[473];
        const leftEyeInner = landmarks[133];
        const leftEyeOuter = landmarks[33];
        const rightEyeInner = landmarks[362];
        const rightEyeOuter = landmarks[263];

        // Calculate gaze direction based on iris position relative to eye corners
        const leftGazeX = (leftIris.x - leftEyeInner.x) / (leftEyeOuter.x - leftEyeInner.x);
        const rightGazeX = (rightIris.x - rightEyeInner.x) / (rightEyeOuter.x - rightEyeInner.x);

        // Average both eyes
        const gazeX = (leftGazeX + rightGazeX) / 2;

        // Convert to screen coordinates (simplified - would need calibration for precision)
        const screenX = window.innerWidth * (1 - gazeX);
        const screenY = window.innerHeight * 0.5; // Simplified: assume looking at center height

        this.currentGaze = { x: screenX, y: screenY };

        if (this.onGazeUpdate) {
            this.onGazeUpdate(this.currentGaze);
        }

        // Check if looking at any zone
        this.checkZones();
    }

    checkZones() {
        if (!this.currentGaze) return;

        let foundZone = null;

        for (const zone of this.zones) {
            if (this.isPointInZone(this.currentGaze, zone.bounds)) {
                foundZone = zone;
                break;
            }
        }

        const now = Date.now();

        if (foundZone) {
            if (this.lookingAtZone?.id !== foundZone.id) {
                // Started looking at new zone
                this.lookingAtZone = foundZone;
                this.lookStartTime = now;

                if (this.onLookingAtZone) {
                    this.onLookingAtZone(foundZone.id, 0);
                }
            } else {
                // Still looking at same zone
                const lookDuration = now - this.lookStartTime;

                if (this.onLookingAtZone) {
                    this.onLookingAtZone(foundZone.id, lookDuration);
                }

                // Check if looked long enough to activate
                if (lookDuration >= this.options.activationTime) {
                    this.activateZone(foundZone.id, lookDuration);
                    this.lookingAtZone = null;
                    this.lookStartTime = null;
                }
            }
        } else {
            this.lookingAtZone = null;
            this.lookStartTime = null;

            if (this.onLookingAtZone) {
                this.onLookingAtZone(null, 0);
            }
        }
    }

    isPointInZone(point, bounds) {
        return (
            point.x >= bounds.x &&
            point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.height
        );
    }

    activateZone(zoneId, activationTime) {
        console.log(`🎯 Zone ${zoneId} activated in ${activationTime}ms`);

        // Update metrics
        this.metrics.totalActivations++;
        this.metrics.successfulActivations++;
        this.metrics.activationTimes.push(activationTime);
        this.metrics.averageActivationTime =
            this.metrics.activationTimes.reduce((a, b) => a + b, 0) /
            this.metrics.activationTimes.length;

        if (this.onZoneActivated) {
            this.onZoneActivated(zoneId, activationTime, this.getAccuracy());
        }
    }

    getAccuracy() {
        if (this.metrics.totalActivations === 0) return 100;
        return Math.round(
            (this.metrics.successfulActivations / this.metrics.totalActivations) * 100
        );
    }

    getMetrics() {
        return {
            ...this.metrics,
            accuracy: this.getAccuracy()
        };
    }

    destroy() {
        this.stop();
        if (this.video) {
            const stream = this.video.srcObject;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            this.video.remove();
        }
        console.log('👁️ Eye tracker destroyed');
    }
}

export default EyeTracker;

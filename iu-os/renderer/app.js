/**
 * IÜ OS - App
 * Standalone face renderer replicating iü.space exactly
 * Uses the same Bezier curve logic from the web version
 */

console.log('🚀 IÜ OS starting...');

// =====================================================
// Bezier Utilities (from src/utils/bezier.ts)
// =====================================================

function quadraticBezier(start, control, end) {
    return `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
}

function cubicBezier(start, control1, control2, end) {
    return `M${start.x},${start.y} C${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`;
}

function verticalLine(start, length) {
    return `M${start.x},${start.y} L${start.x},${start.y + length}`;
}

function generateEyebrowPath(baseX, baseY, width, height, curve, flip = false) {
    const halfWidth = width / 2;
    const flipMultiplier = flip ? -1 : 1;

    const startX = baseX - halfWidth * flipMultiplier;
    const endX = baseX + halfWidth * flipMultiplier;

    // Uniform lift: both ends of the eyebrow raise equally with the height parameter
    const startY = baseY - height;
    const endY = baseY - height;

    const controlX = baseX;
    const controlY = baseY - height - (curve * 15);

    return quadraticBezier(
        { x: startX, y: startY },
        { x: controlX, y: controlY },
        { x: endX, y: endY }
    );
}

function generateEyePaths(centerX, centerY, openness) {
    const lineHeight = 25 * openness;
    const verticalOffset = lineHeight / 2;

    const line = verticalLine(
        { x: centerX, y: centerY - verticalOffset },
        Math.max(0, lineHeight)
    );

    return { top: '', line, bottom: '' };
}

function generateMouthPath(centerX, centerY, width, curve, leftCorner, rightCorner, openness = 0) {
    const halfWidth = width / 2;

    const baseOffset = curve * 15;
    const leftY = centerY - baseOffset - (leftCorner * 8);
    const rightY = centerY - baseOffset - (rightCorner * 8);

    const start = { x: centerX - halfWidth, y: leftY };
    const end = { x: centerX + halfWidth, y: rightY };

    const curveDepth = -curve * 12;
    const midY = centerY + curveDepth;
    const asymmetryShift = (rightCorner - leftCorner) * 10;

    const control1 = { x: centerX - halfWidth * 0.3 + asymmetryShift, y: midY };
    const control2 = { x: centerX + halfWidth * 0.3 + asymmetryShift, y: midY };

    if (openness > 0.05) {
        const bottomOffset = openness * 15;
        const bottomY = centerY + bottomOffset;
        const topPath = cubicBezier(start, control1, control2, end);
        const bottomPath = ` Q${centerX},${bottomY} ${start.x},${leftY}`;
        return topPath + bottomPath;
    }

    return cubicBezier(start, control1, control2, end);
}

// =====================================================
// Intent Prediction Cache (Global for access in attention handler)
// =====================================================
let cachedPredictions = null;        // The actual predictions (without "quieres hablar")
let lastLookedAwayTime = 0;          // Timestamp when user last looked away
const PREDICTION_CACHE_TTL = 15000;  // 15 seconds since looked away

// =====================================================
// Face State
// =====================================================

const state = {
    eyeOpenness: 1,
    leftEyeOpenness: -1,
    rightEyeOpenness: -1,
    eyeSquint: 0,
    leftBrowHeight: 0,
    rightBrowHeight: 0,
    leftBrowCurve: 0.2,
    rightBrowCurve: 0.2,
    mouthCurve: 0,
    mouthWidth: 1,
    leftCornerHeight: 0,
    rightCornerHeight: 0,
    mouthOpenness: 0,
    headTilt: 0 // In degrees
};

const PRESETS = {
    neutral: {
        eyeOpenness: 0.88, eyeSquint: 0.12, leftBrowHeight: -0.5, rightBrowHeight: 3, leftBrowCurve: 0.15, rightBrowCurve: 0.45,
        mouthCurve: 0.55, mouthWidth: 0.95, leftCornerHeight: 0.05, rightCornerHeight: 0.45, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 4
    },
    smile: {
        eyeOpenness: 0.85, eyeSquint: 0.15, leftBrowHeight: 2, rightBrowHeight: 2.5, leftBrowCurve: 0.3, rightBrowCurve: 0.4,
        mouthCurve: 0.7, mouthWidth: 1.1, leftCornerHeight: 0.3, rightCornerHeight: 0.5, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 0
    },
    mild_attention: {
        eyeOpenness: 0.85, eyeSquint: 0.15, leftBrowHeight: 0, rightBrowHeight: 4, leftBrowCurve: 0.2, rightBrowCurve: 0.5,
        mouthCurve: 0.6, mouthWidth: 0.92, leftCornerHeight: 0, rightCornerHeight: 0.5, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 6
    },
    thinking: {
        eyeOpenness: 0.75, eyeSquint: 0.2, leftBrowHeight: -1, rightBrowHeight: 4, leftBrowCurve: 0.1, rightBrowCurve: 0.5,
        mouthCurve: 0.7, mouthWidth: 0.95, leftCornerHeight: 0.2, rightCornerHeight: 0.1, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 6
    },
    wink: {
        eyeOpenness: 1, leftEyeOpenness: 1, rightEyeOpenness: 0.1, eyeSquint: 0,
        leftBrowHeight: 2, rightBrowHeight: -1, leftBrowCurve: 0.3, rightBrowCurve: 0.1,
        mouthCurve: 0.5, mouthWidth: 1, leftCornerHeight: 0, rightCornerHeight: 0.6, mouthOpenness: 0,
        headTilt: 5
    },
    listening: {
        eyeOpenness: 1.15, eyeSquint: -0.05, leftBrowHeight: 8, rightBrowHeight: 8, leftBrowCurve: 0.5, rightBrowCurve: 0.5, // Stronger Attention
        mouthCurve: 0.9, mouthWidth: 1.1, leftCornerHeight: 0.3, rightCornerHeight: 0.3, mouthOpenness: 0.05,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 0
    }
};

// =====================================================
// Face Renderer
// =====================================================

class Face {
    constructor() {
        this.leftEyebrow = document.getElementById('left-eyebrow');
        this.rightEyebrow = document.getElementById('right-eyebrow');
        this.leftEyeLine = document.getElementById('left-eye-line');
        this.rightEyeLine = document.getElementById('right-eye-line');
        this.mouth = document.getElementById('mouth');
        this.thinkingLabel = document.getElementById('thinking-label');

        this.gazeX = 0;
        this.gazeY = 0;
        this.targetZone = 'right'; // Default

        this.currentState = { ...PRESETS.smile };
        this.render();
        this.startBlink();
    }

    setTargetZone(zone) {
        this.targetZone = zone;
        this.render();
    }

    setState(newState) {
        Object.assign(this.currentState, newState);
        this.render();
    }

    transitionTo(preset, duration = 300) {
        const target = PRESETS[preset];
        if (!target) return;

        const start = { ...this.currentState };
        const startTime = performance.now();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            for (const key in target) {
                if (start[key] !== undefined) {
                    this.currentState[key] = start[key] + (target[key] - start[key]) * eased;
                }
            }

            this.render();

            if (t < 1) requestAnimationFrame(animate);
        };

        animate();

        // Show/hide thinking label
        if (preset === 'thinking') {
            this.thinkingLabel.classList.remove('hidden');
        } else {
            this.thinkingLabel.classList.add('hidden');
        }
    }

    render() {
        let s = { ...this.currentState };

        // CONTEXT-AWARE TWIST:
        let rotationY = s.headTilt || 0;

        if (this.targetZone === 'center') {
            rotationY = 0; // No giro en el centro
            if (s.headTilt > 0) {
                // Cejas exageradas y simétricas en el centro para "Atención Profunda"
                s.leftBrowHeight = 12;
                s.rightBrowHeight = 12;
                s.leftBrowCurve = 0.7;
                s.rightBrowCurve = 0.7;
            }
        } else if (this.targetZone === 'right') {
            // Swap Brows
            [s.leftBrowHeight, s.rightBrowHeight] = [s.rightBrowHeight, s.leftBrowHeight];
            [s.leftBrowCurve, s.rightBrowCurve] = [s.rightBrowCurve, s.leftBrowCurve];
            // Swap Mouth Corners
            [s.leftCornerHeight, s.rightCornerHeight] = [s.rightCornerHeight, s.leftCornerHeight];
            // Inverse Turn: If on the right, turning "towards center" means rotateY should be negative
            rotationY = -rotationY;
        }

        // Face turn (Y-axis rotation for "giro sobre su eje" effect)
        const group = document.getElementById('face-group');
        if (group) {
            // Apply a mix of a slight Z-rotation (tilt) and a stronger Y-rotation (turn)
            // for the "thinking" look, ensuring it feels like a rotation on its axis.
            group.style.transform = `translate(200px, 250px) rotateY(${rotationY * 2.5}deg) rotateZ(${rotationY * 0.5}deg)`;
            group.style.transformOrigin = 'center';
            group.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
        }

        // Eyebrows
        this.leftEyebrow.setAttribute('d', generateEyebrowPath(-55, -55, 35, s.leftBrowHeight, s.leftBrowCurve, false));
        this.rightEyebrow.setAttribute('d', generateEyebrowPath(55, -55, 35, s.rightBrowHeight, s.rightBrowCurve, true));

        // Left eye
        const leftOpenness = s.leftEyeOpenness >= 0 ? s.leftEyeOpenness : s.eyeOpenness;
        const leftPaths = generateEyePaths(-55 + this.gazeX, -25 + this.gazeY, leftOpenness * (1 - s.eyeSquint * 0.4));
        this.leftEyeLine.setAttribute('d', leftPaths.line);

        // Right eye
        const rightOpenness = s.rightEyeOpenness >= 0 ? s.rightEyeOpenness : s.eyeOpenness;
        const rightPaths = generateEyePaths(55 + this.gazeX, -25 + this.gazeY, rightOpenness * (1 - s.eyeSquint * 0.4));
        this.rightEyeLine.setAttribute('d', rightPaths.line);

        // Mouth
        this.mouth.setAttribute('d', generateMouthPath(
            0, 50, 60 * s.mouthWidth, s.mouthCurve,
            s.leftCornerHeight, s.rightCornerHeight, s.mouthOpenness
        ));
    }

    blink() {
        // Guard: Don't blink if vanished
        if (this.currentState.eyeOpenness === 0 && this.currentState.leftEyeOpenness === 0) return;

        const originalLeft = this.currentState.leftEyeOpenness;
        const originalRight = this.currentState.rightEyeOpenness;
        const originalMain = this.currentState.eyeOpenness;

        this.currentState.eyeOpenness = 0;
        this.currentState.leftEyeOpenness = 0;
        this.currentState.rightEyeOpenness = 0;
        this.render();

        setTimeout(() => {
            this.currentState.eyeOpenness = originalMain >= 0 ? originalMain : 1;
            this.currentState.leftEyeOpenness = originalLeft;
            this.currentState.rightEyeOpenness = originalRight;
            this.render();
        }, 100);
    }

    startBlink() {
        setInterval(() => {
            // Only blink if eyes are supposed to be open (not vanished)
            if (this.currentState.eyeOpenness > 0.1 && Math.random() > 0.7) {
                this.blink();
            }
        }, 2500);
    }

    vanish() {
        // 1. Transition to neutral first for smooth exit
        this.transitionTo('neutral', 100);

        // 2. Schedule the disappearance
        setTimeout(() => {
            const vanishState = {
                headTilt: 0,
                leftBrowHeight: 0,
                rightBrowHeight: 0,
                mouthOpenness: 0,
                mouthWidth: 0
            };
            Object.assign(this.currentState, vanishState);
            this.render();

            // Fade out opacity
            const group = document.getElementById('face-group');
            if (group) {
                group.style.opacity = '0.2';
                group.style.filter = 'blur(4px)';
                group.style.transition = 'all 1s ease';
            }
        }, 150);

        if (this.thinkingLabel) this.thinkingLabel.classList.add('hidden');
    }

    emerge() {
        // Restore opacity
        const group = document.getElementById('face-group');
        if (group) {
            group.style.opacity = '1';
            group.style.filter = 'none';
            group.style.transition = 'all 0.5s ease';
        }
    }

    bounce() {
        const group = document.getElementById('face-group');
        if (group) {
            // Simple CSS animation for bounce
            group.style.transition = 'transform 0.1s ease-out';
            group.style.transform = 'translate(200, 250) translateX(20px)';

            setTimeout(() => {
                group.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                const s = this.currentState;
                group.style.transform = `translate(200px, 250px) rotate(${s.headTilt || 0}deg) translateX(0)`;
            }, 100);
        }
    }

    setEyeColor(color) {
        if (this.leftEyeLine) this.leftEyeLine.style.stroke = color;
        if (this.rightEyeLine) this.rightEyeLine.style.stroke = color;
        if (this.mouth) this.mouth.style.stroke = color;

        // Also try to help visibility if using CSS classes
        const strokes = document.querySelectorAll('.face-stroke');
        strokes.forEach(s => s.style.stroke = color);
    }

    lookAt(x, y) {
        // x, y are normalized 0-1 (0.5 is center)
        const range = 8; // Dampened from 20 to 8 for subtler, more premium movement
        this.gazeX = (x - 0.5) * range;
        this.gazeY = (y - 0.5) * range;
        this.render();
    }
}

// =====================================================
// Theme Toggle
// =====================================================

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `btn-${theme}`);
    });

    // Broadcast theme change
    if (deviceSync && deviceSync.isConnected()) {
        deviceSync.broadcastSharedState({ theme });
    }
}

// =====================================================
// Initialize
// =====================================================

let face;
let panelCollapsed = true;
let isSimpleMode = false;
let deviceSync = null;
let qrConnect = null;
let visionManager = null; // Vision
let attentionDwellTimeout = null; // Dwell timer for deep attention
let relaxTimeout = null; // Buffer for attention jitter

// Navigation State
let currentView = 'face'; // face | brain | settings
const VIEWS = ['face', 'brain', 'settings'];
let neuralGraph = null;
let navHudTimeout = null;


function init() {
    face = new Face();

    // Initialize VisionManager
    if (typeof VisionManager !== 'undefined') {
        visionManager = new VisionManager();

        // Initialize AudioLoop
        if (typeof AudioLoop !== 'undefined') {
            window.audioLoop = new AudioLoop();
        }

        // --- AUTO-DETECT WINDOW POSITION ---
        // Check every 1s where the window is relative to the screen
        setInterval(() => {
            const winX = window.screenX;
            const winWidth = window.outerWidth;
            const screenWidth = window.screen.availWidth;

            const center = winX + (winWidth / 2);
            const ratio = center / screenWidth;

            let pos = 'center';
            if (ratio < 0.35) pos = 'left';
            else if (ratio > 0.65) pos = 'right';

            // Update Visual Manager & Face
            if (visionManager.state.targetZone !== pos) {
                console.log(`🔲 Auto-Detected Window Position: ${pos.toUpperCase()} (Ratio: ${ratio.toFixed(2)})`);
                visionManager.setWindowPosition(pos);
                if (face) face.setTargetZone(pos);

                // Update UI buttons if they exist
                document.querySelectorAll('.pos-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === `pos-${pos}`);
                });
            }
        }, 1000);

        // 0. Initialize DopamineEngine (natural gesture interaction)
        visionManager.initDopamineEngine();

        // Wire dopamine responses to Ü face (human-realistic timing)
        visionManager.setOnDopamineResponse((preset, intensity, meta) => {
            if (conversationState !== 'idle') return;
            if (visionManager.state.inDeepAttention) return;

            // Decay transitions are slower and softer than active responses
            const isDecay = meta.strategy === 'decay';
            const transitionMs = isDecay ? 1200 : 800;

            console.log(`🧬 [Dopamine] → Ü: ${preset} (${meta.strategy}, cos=${meta.cosineScore.toFixed(2)}) ← user ${meta.userGesture} (${(meta.confidence * 100).toFixed(0)}%)`);

            if (face) {
                face.transitionTo(preset, transitionMs);

                // Reinforcement: check 3s later if user is still engaged positively
                if (!isDecay) {
                    const engine = visionManager.getDopamineEngine();
                    if (engine) {
                        setTimeout(() => {
                            const engineState = engine.getState();
                            if (engineState.lastGesture === 'smile' || engineState.lastGesture === 'nod') {
                                engine.reinforceLastInteraction(true);
                            }
                        }, 3000);
                    }
                }
            }
        });

        // Wire micro-expressions (rare, subtle — only blink_slow, eyes_widen, brow_flash)
        const dopEngine = visionManager.getDopamineEngine();
        if (dopEngine) {
            dopEngine.onMicroExpression = (microType, params) => {
                if (!face || conversationState !== 'idle') return;

                switch (microType) {
                    case 'blink_slow':
                        face.blink();
                        break;
                    case 'brow_flash': {
                        const origLeft = face.currentState.leftBrowHeight;
                        const origRight = face.currentState.rightBrowHeight;
                        face.setState({ leftBrowHeight: origLeft + 3, rightBrowHeight: origRight + 3 });
                        setTimeout(() => {
                            face.setState({ leftBrowHeight: origLeft, rightBrowHeight: origRight });
                        }, 400);
                        break;
                    }
                    case 'eyes_widen': {
                        const origOpenness = face.currentState.eyeOpenness;
                        face.setState({ eyeOpenness: Math.min(1.2, origOpenness + 0.15) });
                        setTimeout(() => {
                            face.setState({ eyeOpenness: origOpenness });
                        }, 500);
                        break;
                    }
                }
            };
        }

        // 1. Eye Tracking & Debug
        visionManager.setOnFaceUpdate((data) => {
            if (face) {
                // Look at user if attentive (EXPRESSIVE EYE CONTACT)
                if (data.isAttentive) {
                    // Soften Eye Contact: point to a middle ground
                    let targetX = 0.5;
                    let targetY = 0.5;

                    if (data.targetZone === 'left') {
                        targetX = 0.7; // Look slightly Right (Softened)
                    } else if (data.targetZone === 'right') {
                        targetX = 0.3; // Look slightly Left (Softened)
                    } else {
                        targetX = 0.5;
                    }

                    // Soften Vertical: Dampen influence significantly (divide by 150 instead of 80)
                    targetY = 0.5 + (data.headPose.pitch / 150);

                    // Range limit to avoid extreme looks
                    face.lookAt(targetX, Math.max(0.3, Math.min(0.7, targetY)));
                } else {
                    // Optional: Glance around or follow vaguely?
                    // For now, relax to center/idle
                    // face.lookAt(0.5, 0.5); 
                }

                if (data.debug) {
                    console.log('📐 Face Debug:', data.debug);
                }
            }
        });

        // 2. Attention State Feedback
        visionManager.setOnAttentionChange((isAttentive) => {
            console.log('👀 Attention State:', isAttentive);

            // Clear any pending deep attention timer
            if (attentionDwellTimeout) {
                clearTimeout(attentionDwellTimeout);
                attentionDwellTimeout = null;
            }

            if (isAttentive) {
                // Clear any pending relax timeout if user looks back
                if (relaxTimeout) {
                    clearTimeout(relaxTimeout);
                    relaxTimeout = null;
                }

                // STAGE 1: MILD ATTENTION (Immediate)
                if (face) {
                    face.setEyeColor('#ffffff'); // Stay WHITE for mild attention

                    if (conversationState === 'idle') {
                        face.transitionTo('mild_attention');
                    }

                    // Disable deep attention (gestures won't work in shallow attention)
                    if (visionManager) {
                        visionManager.setDeepAttention(false);
                    }

                    // Schedule STAGE 2: CONTEXTUAL INTENT (Thinking) after 1.5s
                    attentionDwellTimeout = setTimeout(async () => {
                        console.log('🧠 CONTEXTUAL INTENT ACTIVATED (Dwell Reached)');
                        if (face && conversationState === 'idle') {
                            // Keep WHITE eyes in thinking mode
                            face.transitionTo('thinking');

                            // Enable deep attention (gestures now active)
                            if (visionManager) {
                                visionManager.setDeepAttention(true);
                            }

                            // 🚀 TRIGGER CONTEXTUAL INTENT FLOW (cache is handled inside)
                            await triggerContextualIntent();
                        }
                        attentionDwellTimeout = null;
                    }, 1500);
                }
            } else {
                // USER LOOKED AWAY -> RELAX (Delayed to handle jitter)
                if (relaxTimeout) clearTimeout(relaxTimeout);

                relaxTimeout = setTimeout(() => {
                    // Record when user looked away (for cache timing)
                    lastLookedAwayTime = Date.now();

                    if (face) {
                        hideIntentCarousel();

                        // Disable deep attention (gestures inactive)
                        if (visionManager) {
                            visionManager.setDeepAttention(false);
                        }

                        // Return to Smile and Center Eyes
                        if (conversationState === 'idle') {
                            face.transitionTo('smile');
                            face.lookAt(0.5, 0.5);
                        }
                    }
                    relaxTimeout = null;
                }, 1000); // 1s buffer for blinks or fast head movements
            }
        });

        // 3. Gesture Trigger (Gated by Attention internally)
        visionManager.setOnGesture((gesture) => {
            if (gesture === 'call') {
                console.log('📞 CALL GESTURE DETECTED (Gated)!');

                // If carousel is active, ACTIVATE current intent
                if (isCarouselActive) {
                    activateCurrentIntent();
                    return;
                }

                // Trigger conversation if not active
                if (conversationState === 'idle') {
                    // Wink for the nod gesture
                    face.transitionTo('wink');

                    setTimeout(() => {
                        toggleConversation();
                        showToast('🗣️ Escuchando...');
                    }, 400);

                    // Return to thinking (attentive state) after the wink
                    setTimeout(() => {
                        if (conversationState === 'active') {
                            face.transitionTo('thinking');
                        }
                    }, 1200);
                }
            }
        });

    }

    // =====================================================
    // Device Role Toggles (PC / Sensors)
    // =====================================================
    let localRole = null; // 'pc' | 'sensors' | null

    const rolePC = document.getElementById('role-pc');
    const roleSensors = document.getElementById('role-sensors');

    function setRole(role) {
        // Toggle: if already active, deactivate
        if (localRole === role) {
            localRole = null;
            console.log('[App] Role deactivated');
        } else {
            localRole = role;
            console.log(`[App] Role set to: ${role}`);
        }

        // Update UI
        if (rolePC) rolePC.classList.toggle('active', localRole === 'pc');
        if (roleSensors) roleSensors.classList.toggle('active', localRole === 'sensors');

        // Sync with other devices
        if (deviceSync) {
            deviceSync.setDeviceRole(localRole);
        }

        // Apply role behavior
        applyRoleBehavior();
    }

    function applyRoleBehavior() {
        if (localRole === 'sensors') {
            // Activate VisionManager and AudioLoop
            if (visionManager) {
                visionManager.start();
                console.log('[App] 🎥 Sensors ACTIVATED (camera/audio)');
            }
            showToast('🎙️ Sensores activados');
        } else if (localRole === 'pc') {
            // PC role: Playwright is controlled by main process
            // Optionally stop sensors if they were running
            if (visionManager) {
                visionManager.stop();
                console.log('[App] 🖥️ PC Mode - Sensors OFF');
            }
            showToast('🖥️ Control de PC activado');
        } else {
            // No role selected - default behavior
            console.log('[App] No role selected - default mode');
        }
    }

    if (rolePC) {
        rolePC.addEventListener('click', () => setRole('pc'));
    }
    if (roleSensors) {
        roleSensors.addEventListener('click', () => setRole('sensors'));
    }


    // Initialize DeviceSync
    if (typeof getDeviceSync === 'function') {
        deviceSync = getDeviceSync();

        // Set up connection status callbacks
        deviceSync.setOnConnectionChange((connected, devices) => {
            updateConnectionStatus(connected, devices);
        });

        // Connect to Render server
        deviceSync.connect().then((success) => {
            console.log('[App] DeviceSync connection:', success ? 'success' : 'failed');
        });

        // Listen for remote role changes
        deviceSync.setOnRoleChange((deviceId, role, allRoles) => {
            console.log(`[App] Remote device ${deviceId} changed role to: ${role}`);
            // Could show indicator of remote roles if needed
        });

        // Listen for incoming faces
        deviceSync.setOnFaceReceived((state, direction) => {
            console.log('[App] Face received via transfer!', state);
            if (face) {
                face.emerge(); // Bring face back

                // Animate transition to the new face
                face.setState(state);
            }
        });

        // Listen for shared state (Theme Sync & Expression Sync)
        deviceSync.setOnSharedStateChange((sharedState) => {
            // Theme Sync
            if (sharedState.theme) {
                console.log('[App] Received theme sync:', sharedState.theme);
                document.documentElement.setAttribute('data-theme', sharedState.theme);

                // Update buttons locally
                document.querySelectorAll('.theme-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.id === `btn-${sharedState.theme}`);
                });
            }

            // Sync Active Preset (Expression)
            if (sharedState.activePreset) {
                console.log('[App] Received preset sync:', sharedState.activePreset);
                const preset = sharedState.activePreset;
                // Update UI button
                setActiveButton(`btn-${preset}`);
                // Verify if it exists in PRESETS
                if (PRESETS[preset]) {
                    face.emerge();
                    face.transitionTo(preset);
                }
            }
        });


        // Answer Face Requests (Someone is summoning the face!)
        if (deviceSync.setOnRequestFace) {
            deviceSync.setOnRequestFace((requestingDeviceId) => {
                console.log('[App] Face summoned by another device! Sending it over.');
                performTransfer();
            });
        }


        // Initialize QR Connect
        if (typeof QRConnect === 'function') {
            qrConnect = new QRConnect(deviceSync);
        }
    }

    // Menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const controlsPanel = document.getElementById('controls-panel');

    menuToggle.addEventListener('click', () => {
        panelCollapsed = !panelCollapsed;
        controlsPanel.classList.toggle('collapsed', panelCollapsed);
        menuToggle.classList.toggle('active', !panelCollapsed);
    });

    // State buttons
    const activateState = (id, state) => {
        document.getElementById(id).addEventListener('click', () => {
            setActiveButton(id);
            face.emerge();
            face.transitionTo(state);

            // Broadcast expression change
            if (deviceSync && deviceSync.isConnected()) {
                deviceSync.broadcastSharedState({ activePreset: state });
            }
        });
    };

    activateState('btn-neutral', 'neutral');
    activateState('btn-smile', 'smile');
    activateState('btn-thinking', 'thinking');
    activateState('btn-wink', 'wink');

    // Theme buttons
    document.getElementById('btn-dark').addEventListener('click', () => setTheme('dark'));
    document.getElementById('btn-light').addEventListener('click', () => setTheme('light'));

    // Mode toggle
    const simpleModeBtn = document.getElementById('btn-simple-mode');
    if (simpleModeBtn) {
        simpleModeBtn.addEventListener('click', () => {
            isSimpleMode = !isSimpleMode;
            simpleModeBtn.classList.toggle('active', isSimpleMode);
            showToast(isSimpleMode ? '⚡ Modo Simple: Activado' : '⚡ Modo Estándar');
        });
    }

    // QR Share button
    const qrShareBtn = document.getElementById('btn-qr-share');
    if (qrShareBtn) {
        qrShareBtn.addEventListener('click', () => {
            if (qrConnect) {
                qrConnect.toggle();
            } else {
                console.error('[App] QRConnect not initialized');
            }
        });
    }

    // Transfer button (Top) becomes Conversation Toggle
    const transferBtn = document.getElementById('btn-transfer-top');
    console.log('[DEBUG] Searching for #btn-transfer-top:', transferBtn);
    if (transferBtn) {
        // Initial State
        // REMOVED: updateConversationUI('idle'); to prevent forcing Neutral state at startup

        transferBtn.onclick = async (e) => {
            console.log('🎤 [App] Button CLICKED (onclick event)');
            try {
                await toggleConversation();
            } catch (err) {
                console.error('🎤 [App] Click handler error:', err);
            }
        };
        console.log('[DEBUG] Listener attached to #btn-transfer-top');
    } else {
        console.error('[DEBUG] Could NOT find #btn-transfer-top in the DOM');
    }

    // --- NAVIGATION HUD & VIEW SWITCHING ---

    function showNavHud(view) {
        const hud = document.getElementById('nav-hud');
        const text = document.getElementById('nav-hud-text');
        if (!hud || !text) return;

        const labels = {
            face: 'Ü Home',
            brain: 'Neural Graph',
            settings: 'Settings'
        };

        text.textContent = labels[view] || view;
        hud.classList.remove('hidden');

        if (navHudTimeout) clearTimeout(navHudTimeout);
        navHudTimeout = setTimeout(() => {
            hud.classList.add('hidden');
        }, 1500);
    }

    function switchView(view) {
        if (!VIEWS.includes(view)) return;
        if (currentView === view) return;

        currentView = view;
        console.log(`🌐 [Navigation] Switching to: ${view.toUpperCase()}`);

        // Update Body for CSS-based transitions
        document.body.className = `view-${view}`;

        // Manage Neural Graph
        const canvas = document.getElementById('neural-canvas');
        if (view === 'brain') {
            canvas.classList.remove('hidden');
            if (neuralGraph) neuralGraph.start();
        } else {
            if (neuralGraph) neuralGraph.stop();
            setTimeout(() => {
                if (currentView !== 'brain') canvas.classList.add('hidden');
            }, 800);
        }

        // Manage Settings Panel
        const panel = document.getElementById('controls-panel');
        const menuToggle = document.getElementById('menu-toggle');
        if (view === 'settings') {
            panel.classList.remove('collapsed');
            if (menuToggle) menuToggle.classList.add('active');
            panelCollapsed = false;
        } else {
            panel.classList.add('collapsed');
            if (menuToggle) menuToggle.classList.remove('active');
            panelCollapsed = true;
        }

        showNavHud(view);
    }

    // Initialize View
    document.body.className = 'view-face';

    // Trackpad / Wheel Navigation (Cool & Fluid)
    let wheelTimeout;
    window.addEventListener('wheel', (e) => {
        // Horizontal: Intents / Transfer
        if (Math.abs(e.deltaX) > 40 && Math.abs(e.deltaY) < 30) {
            if (isCarouselActive && currentIntents.length > 0) {
                if (e.deltaX > 0 && focusedIntentIndex < currentIntents.length - 1) {
                    focusedIntentIndex++;
                } else if (e.deltaX < 0 && focusedIntentIndex > 0) {
                    focusedIntentIndex--;
                }
                updateCarouselVisuals();
                return;
            }

            if (!wheelTimeout) {
                performTransfer();
                wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 1200);
            }
        }
        // Vertical: Switch Views (Cool Navigation)
        else if (Math.abs(e.deltaY) > 60 && Math.abs(e.deltaX) < 30) {
            if (!wheelTimeout) {
                const currentIndex = VIEWS.indexOf(currentView);
                let nextIndex = currentIndex;

                if (e.deltaY > 0 && currentIndex < VIEWS.length - 1) {
                    nextIndex++; // Scroll Down
                } else if (e.deltaY < 0 && currentIndex > 0) {
                    nextIndex--; // Scroll Up
                }

                if (nextIndex !== currentIndex) {
                    switchView(VIEWS[nextIndex]);
                    wheelTimeout = setTimeout(() => { wheelTimeout = null; }, 800);
                }
            }
        }
    });

    // Initialize Neural Graph
    const neuralCanvas = document.getElementById('neural-canvas');
    if (neuralCanvas && typeof NeuralGraph !== 'undefined') {
        neuralCanvas.width = window.innerWidth;
        neuralCanvas.height = window.innerHeight;
        neuralGraph = new NeuralGraph(neuralCanvas);

        // Populate with some initial nodes
        for (let i = 0; i < 10; i++) {
            neuralGraph.addNode(i, `Node ${i}`);
        }
        for (let i = 0; i < 15; i++) {
            const from = Math.floor(Math.random() * 10);
            const to = Math.floor(Math.random() * 10);
            if (from !== to) neuralGraph.addEdge(from, to);
        }
    }

    console.log('✅ IÜ OS ready');
}

function performTransfer() {
    const devices = deviceSync ? deviceSync.getConnectedDevices() : [];
    const hasPeers = devices.length > 0; // Check if any OTHER device is connected

    if (deviceSync && deviceSync.isConnected() && hasPeers) {
        console.log('[App] Pushing face state...');

        // Copy state
        const stateToSend = { ...face.currentState };

        // Send
        deviceSync.startTransfer('right', stateToSend);

        // Vanish locally
        face.vanish();
    } else {
        // Bounce animation on face to indicate "nowhere to go"
        if (face) face.bounce();

        // Show elegant toast message
        showToast('No hay dispositivos conectados para transferir.');
    }
}

function showToast(message, duration = 3000) {
    let toast = document.getElementById('toast-message');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-message';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('visible');

    setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

// Conversation Logic
let conversationState = 'idle'; // idle | active

async function toggleConversation() {
    console.log('🎤 [App] Button clicked');

    if (!window.iuOS) {
        console.error('❌ [App] Electron API (window.iuOS) is not available! Check preload.js');
        showToast('Error: API de Electron no disponible', 5000);
        return;
    }

    const btn = document.getElementById('btn-transfer-top');
    if (btn) btn.disabled = true;

    const action = conversationState === 'idle' ? 'start' : 'stop';
    console.log(`🎤 [App] Toggling conversation to: ${action} (Mode: ${isSimpleMode ? 'simple' : 'standard'})`);

    try {
        const result = await window.iuOS.conversationControl(action, { isSimpleMode });
        console.log('[App] Received from Backend:', result);

        if (result.success) {
            conversationState = result.state;
            updateConversationUI(conversationState);
        } else {
            console.error('[App] Conversation failed:', result.error);
            showToast(`Error: ${result.error || 'Unknown failure'}`, 5000);
        }
    } catch (e) {
        console.error('[App] Conversation IPC error:', e);
        showToast('Error de comunicación interna', 5000);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function updateConversationUI(state) {
    const btn = document.getElementById('btn-transfer-top');
    if (!btn) return;

    if (state === 'active') {
        // Stop state
        btn.innerHTML = '<span class="transfer-text">Terminar</span>';
        btn.classList.add('active-conversation');

        // Show "Empezando conversación" in intent carousel
        const container = document.getElementById('intent-carousel');
        const track = document.getElementById('intent-track');
        const label = document.getElementById('intent-label');
        const details = document.getElementById('intent-details');

        if (container && track && label) {
            container.classList.remove('hidden');
            isCarouselActive = false; // Not interactive during voice

            track.innerHTML = ''; // No icon for this message
            label.textContent = 'Empezando conversación';
            if (details) details.classList.add('hidden');

            // Hide after 3 seconds
            setTimeout(() => {
                container.classList.add('hidden');
            }, 3000);
        }

        // Ensure face is visible
        if (face) {
            face.emerge();
            // REMOVED: transitionTo('listening') to avoid overriding user-selected expressions
        }
    } else {
        // Idle/Start state
        btn.innerHTML = '<span class="transfer-text">Hablar</span>';
        btn.classList.remove('active-conversation');

        // REMOVED: transitionTo('neutral') to keep current expression (e.g. Smile)


        // Hide transcript
        const container = document.getElementById('transcript-container');
        const textElement = document.getElementById('transcript-text');
        if (container) container.classList.add('hidden');
        if (textElement) textElement.innerHTML = '';
        displayedWords = [];
    }
}

function setActiveButton(activeId) {
    document.querySelectorAll('.state-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === activeId);
    });
}

function updateConnectionStatus(connected, devices) {
    const indicator = document.getElementById('sync-indicator');
    const statusText = document.getElementById('sync-status-text');

    if (indicator) {
        indicator.classList.toggle('active', connected);
    }

    if (statusText) {
        if (devices && devices.length > 0) {
            statusText.textContent = `${devices.length} device${devices.length > 1 ? 's' : ''} connected`;
        } else if (connected) {
            statusText.textContent = 'Connected to server';
        } else {
            statusText.textContent = 'Not connected';
        }
    }
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Conversation Text Listener
let displayedWords = [];

if (window.iuOS && window.iuOS.onConversationText) {
    window.iuOS.onConversationText((text) => {
        const container = document.getElementById('transcript-container');
        const textElement = document.getElementById('transcript-text');

        if (container && textElement) {
            const words = text.split(/\s+/).filter(w => w.length > 0);

            // 1. If the message is completely new or cleared, reset
            if (words.length < displayedWords.length) {
                textElement.innerHTML = '';
                displayedWords = [];
            }

            container.classList.remove('hidden');

            words.forEach((word, index) => {
                let span = textElement.children[index];

                // 2. If it's a truly new index, create a new span
                if (!span) {
                    span = document.createElement('span');
                    span.className = 'word-fade';
                    // Delay animation for a more natural streaming look
                    span.style.animationDelay = `${Math.min((index - displayedWords.length) * 50, 300)}ms`;
                    textElement.appendChild(span);
                }

                // 3. Update text content only if it has changed
                if (displayedWords[index] !== word) {
                    // If it's a semantic change (not just completion), re-trigger animation
                    if (displayedWords[index] && !word.startsWith(displayedWords[index])) {
                        span.classList.remove('word-fade');
                        void span.offsetWidth; // force reflow
                        span.classList.add('word-fade');
                    }

                    span.textContent = word;
                    displayedWords[index] = word;
                }
            });

            // 4. Cleanup any lingering extra words
            while (textElement.children.length > words.length) {
                textElement.removeChild(textElement.lastChild);
                displayedWords.pop();
            }
        }
    });
}

/*
// Memory Status Listener (Temporarily disabled - relying on ChatGPT default memory)
if (window.iuOS && window.iuOS.onMemoryStatus) {
    window.iuOS.onMemoryStatus((status) => {
        console.log('🧠 [Memory Status]:', status);
        if (status === 'searching') {
            if (face) {
                face.setEyeColor('#00ff88'); // Green for memory action
                face.transitionTo('thinking');
            }
            showToast('🧠 Recordando...');
        } else if (status === 'injected') {
            // Success feedback
            if (face) face.bounce();
            showToast('✅ Memoria recuperada');
        }
    });
}
*/
// Task Checklist Listener
if (window.iuOS && window.iuOS.onTaskUpdate) {
    window.iuOS.onTaskUpdate((tasks) => {
        console.log('📋 [Tasks Update]:', tasks);
        renderChecklist(tasks);
    });
}

function renderChecklist(tasks) {
    const container = document.getElementById('checklist-container');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = ''; // Clear current tasks

    tasks.forEach(task => {
        const item = document.createElement('div');
        item.className = `checklist-item ${task.status === 'completed' ? 'completed' : ''}`;

        item.innerHTML = `
            <div class="check-icon"></div>
            <span class="task-text">${task.text}</span>
        `;

        container.appendChild(item);
    });

    // Auto-hide after some time if all tasks are completed? 
    // Or keep it visible as long as there are tasks.
}

// =====================================================
// Contextual Intent Logic
// =====================================================

let isCarouselActive = false;
let isThinkingMode = false; // Persists until predictions arrive
let currentIntents = [];
let focusedIntentIndex = 0;
let hideDefaultTimeout = null; // 5s timer to hide "Quieres hablar?"
let hideCarouselTimeout = null; // 10s timer to hide carousel after last item

// Note: cachedPredictions, lastLookedAwayTime, PREDICTION_CACHE_TTL are defined at top of file

async function triggerContextualIntent() {
    console.log('🚀 [Intent] Starting Contextual Intent flow...');
    const container = document.getElementById('intent-carousel');
    const track = document.getElementById('intent-track');
    const label = document.getElementById('intent-label');
    const details = document.getElementById('intent-details');

    if (!container || !track || !label) return;

    // CACHE CHECK: if user looked away less than 15s ago and we have predictions
    const timeSinceLookedAway = Date.now() - lastLookedAwayTime;
    const hasValidCache = cachedPredictions && cachedPredictions.length > 0 && timeSinceLookedAway < PREDICTION_CACHE_TTL;

    if (hasValidCache) {
        console.log(`🎯 [Intent] Using cache (looked away ${Math.round(timeSinceLookedAway / 1000)}s ago)`);
        isCarouselActive = true;
        container.classList.remove('hidden');
        // Show cached predictions directly (no "quieres hablar" first)
        renderIntentCarousel(cachedPredictions);
        return;
    }

    // FRESH REQUEST: Enter thinking mode
    isCarouselActive = true;
    isThinkingMode = true;
    container.classList.remove('hidden');

    // Clear any existing timers
    if (hideDefaultTimeout) clearTimeout(hideDefaultTimeout);
    if (hideCarouselTimeout) clearTimeout(hideCarouselTimeout);

    // Update thinking label
    const thinkingLabel = document.getElementById('thinking-label');
    if (thinkingLabel) thinkingLabel.textContent = 'Pensando...';

    // No default options - just show "Pensando..." until predictions arrive
    currentIntents = [];
    focusedIntentIndex = 0;
    track.innerHTML = '';
    label.textContent = '';
    if (details) details.textContent = '';

    // Activate thinking mode in backend
    window.iuOS.activateThinkingMode().catch(e => {
        console.warn('⚠️ [Intent] Thinking mode activation failed:', e);
    });

    // Get implicit suggestions from pre-recorded audio
    let audioBlob = null;
    if (window.audioLoop && window.audioLoop.hasAudio()) {
        audioBlob = window.audioLoop.getAudioBuffer();
        if (audioBlob) {
            console.log(`[Intent] Audio blob captured: ${audioBlob.size} bytes`);
        }
    }

    try {
        const audioBase64 = (audioBlob && audioBlob.size > 100) ? await blobToBase64(audioBlob) : null;

        const result = await window.iuOS.getIntentPredictions({
            audio: audioBase64,
            tasks: [],
            isSimpleMode: isSimpleMode
        });

        if (result.success && result.predictions && result.predictions.length > 0) {
            // Clear the 5s hide timer since we got predictions
            if (hideDefaultTimeout) clearTimeout(hideDefaultTimeout);

            // Exit thinking mode after receiving predictions
            isThinkingMode = false;
            if (thinkingLabel) thinkingLabel.textContent = '';

            // Remove gray styling now that we have real predictions
            if (label) label.classList.remove('gray-hint');

            const realPredictions = result.predictions.map(p => ({
                category: p.category,
                label: p.label,
                detail: p.detail || '',
                probability: p.probability
            }));

            cachedPredictions = realPredictions;
            console.log('💾 [Intent] Predictions cached');

            // Show predictions (no "quieres hablar" prepended)
            renderIntentCarousel(realPredictions);
            focusedIntentIndex = 0;
            updateCarouselVisuals();

            // Schedule hide after 10s on last item
            scheduleCarouselHide();
        } else {
            // No predictions, hide after a bit
            isThinkingMode = false;
            if (thinkingLabel) thinkingLabel.textContent = '';
            hideCarouselTimeout = setTimeout(() => {
                hideIntentCarousel();
            }, 3000);
        }
    } catch (e) {
        console.error('❌ [Intent] Flow failed:', e);
        isThinkingMode = false;
    }
}

// Schedule carousel to hide 10s after reaching the last item
function scheduleCarouselHide() {
    // Will be called when rotation reaches last item
    // Implemented in startCarouselRotation
}

function renderIntentCarousel(predictions) {
    const track = document.getElementById('intent-track');
    const label = document.getElementById('intent-label');
    const details = document.getElementById('intent-details');
    if (!track || !label) return;

    currentIntents = predictions;
    focusedIntentIndex = 0; // Start with first item (Quieres hablar?)

    track.innerHTML = '';
    predictions.forEach((intent, index) => {
        const item = document.createElement('div');
        item.className = `intent-item ${index === focusedIntentIndex ? 'focus' : ''}`;

        const icons = {
            'pago': '💰',
            'mensaje': '💬',
            'llamada': '📞',
            'tarea': '📋',
            'musica': '🎵',
            'clima': '☁️',
            'luz': '💡',
            'ayuda': '🗣️'
        };
        const icon = icons[intent.category] || '✨';

        item.innerHTML = `<div class="intent-icon">${icon}</div>`;
        track.appendChild(item);
    });

    updateCarouselVisuals();

    // Start auto-rotation every 5 seconds
    startCarouselRotation();
}

let carouselRotationInterval = null;

function startCarouselRotation() {
    // Clear existing intervals/timeouts
    if (carouselRotationInterval) {
        clearInterval(carouselRotationInterval);
    }
    if (hideCarouselTimeout) {
        clearTimeout(hideCarouselTimeout);
    }

    // Rotate to next intent every 5 seconds
    carouselRotationInterval = setInterval(() => {
        if (currentIntents.length > 1 && isCarouselActive) {
            focusedIntentIndex = (focusedIntentIndex + 1) % currentIntents.length;
            updateCarouselVisuals();

            // If we reached the last item, wait 10s then hide
            if (focusedIntentIndex === currentIntents.length - 1) {
                console.log('⏱️ [Carousel] Reached last item, will hide in 10s');
                hideCarouselTimeout = setTimeout(() => {
                    console.log('⏱️ [Carousel] Hiding after 10s on last item');
                    hideIntentCarousel();
                }, 10000);
            }
        } else if (currentIntents.length === 1 && isCarouselActive) {
            // Only one item, hide after 10s
            hideCarouselTimeout = setTimeout(() => {
                hideIntentCarousel();
            }, 10000);
            clearInterval(carouselRotationInterval);
        }
    }, 5000);
}

function stopCarouselRotation() {
    if (carouselRotationInterval) {
        clearInterval(carouselRotationInterval);
        carouselRotationInterval = null;
    }
}

function updateCarouselVisuals() {
    const track = document.getElementById('intent-track');
    const label = document.getElementById('intent-label');
    const details = document.getElementById('intent-details');
    const items = track.querySelectorAll('.intent-item');

    items.forEach((item, index) => {
        item.classList.toggle('focus', index === focusedIntentIndex);
    });

    if (currentIntents[focusedIntentIndex]) {
        const focused = currentIntents[focusedIntentIndex];
        label.textContent = focused.label;
        if (details && focused.detail) {
            details.textContent = focused.detail;
            details.classList.remove('hidden');
        } else if (details) {
            details.classList.add('hidden');
        }
    }
}

function hideIntentCarousel() {
    isCarouselActive = false;
    isThinkingMode = false;

    // Clear all timers
    if (hideDefaultTimeout) clearTimeout(hideDefaultTimeout);
    if (hideCarouselTimeout) clearTimeout(hideCarouselTimeout);
    if (typeof stopCarouselRotation === 'function') {
        stopCarouselRotation();
    }

    const container = document.getElementById('intent-carousel');
    if (container) container.classList.add('hidden');

    // Clear thinking label
    const thinkingLabel = document.getElementById('thinking-label');
    if (thinkingLabel) thinkingLabel.textContent = '';
}

function activateCurrentIntent() {
    const intent = currentIntents[focusedIntentIndex];
    if (!intent) return;

    console.log('🎯 [Intent] ACTIVATING:', intent.label);

    // For other intents, show toast (simulated for now)
    showToast(`✅ Ejecutando: ${intent.label}`);
    if (face) face.bounce();

    setTimeout(() => {
        hideIntentCarousel();
        if (face) face.transitionTo('smile');
    }, 1500);
}

function blobToBase64(blob) {
    return new Promise((resolve, _) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

// =====================================================
// Explicit Intent Predictions (from user voice)
// =====================================================

// Insert explicit predictions at the START of carousel (after "Quieres hablar")
function appendExplicitPredictions(predictions) {
    if (!predictions || predictions.length === 0) return;
    if (!isCarouselActive) return;

    console.log('🎯 [Explicit] Inserting', predictions.length, 'explicit predictions at START');

    const track = document.getElementById('intent-track');
    if (!track) return;

    const icons = {
        'pago': '💰',
        'mensaje': '💬',
        'llamada': '📞',
        'tarea': '📋',
        'musica': '🎵',
        'clima': '☁️',
        'luz': '💡',
        'ayuda': '🆘',
        'comida': '🍔',
        'transporte': '🚗'
    };

    // Filter out duplicates
    const newPredictions = predictions.filter(pred =>
        !currentIntents.some(i => i.label === pred.label)
    );

    if (newPredictions.length === 0) return;

    // Insert at position 1 (after "Quieres hablar" which is at 0)
    const insertPosition = Math.min(1, currentIntents.length);

    newPredictions.forEach((pred, index) => {
        // Add to currentIntents at the beginning (after quieres hablar)
        currentIntents.splice(insertPosition + index, 0, {
            category: pred.category,
            label: pred.label,
            detail: pred.detail || '',
            probability: pred.probability,
            explicit: true
        });
    });

    // Re-render the entire track with new order
    track.innerHTML = '';
    currentIntents.forEach((intent, index) => {
        const item = document.createElement('div');
        item.className = 'intent-item' + (intent.explicit ? ' explicit' : '') + (index === insertPosition ? ' focus' : '');

        const icon = document.createElement('div');
        icon.className = 'intent-icon';
        icon.textContent = icons[intent.category] || (intent.label === '¿Quieres hablar?' ? '🗣️' : '✨');

        item.appendChild(icon);
        track.appendChild(item);
    });

    // Focus on the first new prediction
    focusedIntentIndex = insertPosition;
    updateCarouselVisuals();

    // Restart carousel rotation
    startCarouselRotation();

    // Update cache
    cachedPredictions = currentIntents.filter(i => i.label !== '¿Quieres hablar?');

    console.log('📊 [Explicit] Carousel now has', currentIntents.length, 'intents, focused on index', focusedIntentIndex);
}

// Listen for explicit predictions from main process
if (window.iuOS && window.iuOS.onExplicitPredictions) {
    window.iuOS.onExplicitPredictions((predictions) => {
        console.log('📥 [Explicit] Received predictions from main:', predictions);
        appendExplicitPredictions(predictions);
    });
}

// Listen for system ready notification
if (window.iuOS && window.iuOS.onSystemReady) {
    window.iuOS.onSystemReady(() => {
        console.log('✅ System prompt injected, ChatGPT ready');
        showToast('U está listo');
    });
}

// Listen for voice state changes to update the talk button
if (window.iuOS && window.iuOS.onVoiceStateChanged) {
    window.iuOS.onVoiceStateChanged((state) => {
        console.log('🎙️ [VoiceState] Received state:', state);
        const btn = document.getElementById('btn-transfer-top');
        if (!btn) return;

        const textSpan = btn.querySelector('.transfer-text');
        if (state === 'active') {
            isConversationActive = true;
            btn.classList.add('active-conversation');
            if (textSpan) textSpan.textContent = 'Terminar';
        } else if (state === 'inactive') {
            isConversationActive = false;
            btn.classList.remove('active-conversation');
            if (textSpan) textSpan.textContent = 'Hablar';
        }
    });
}

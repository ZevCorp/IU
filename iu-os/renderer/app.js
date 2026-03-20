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
    },
    looking_at_screen: {
        eyeOpenness: 0.80, eyeSquint: 0.18, leftBrowHeight: 1, rightBrowHeight: 1, leftBrowCurve: 0.2, rightBrowCurve: 0.2,
        mouthCurve: 0.5, mouthWidth: 0.9, leftCornerHeight: 0, rightCornerHeight: 0, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: -8
    },
    action_complete: {
        eyeOpenness: 0.90, eyeSquint: 0.10, leftBrowHeight: 3, rightBrowHeight: 3, leftBrowCurve: 0.3, rightBrowCurve: 0.3,
        mouthCurve: 0.75, mouthWidth: 1.05, leftCornerHeight: 0.3, rightCornerHeight: 0.3, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 0
    },
    happy: {
        eyeOpenness: 1.1, eyeSquint: -0.1, leftBrowHeight: 5, rightBrowHeight: 5, leftBrowCurve: 0.6, rightBrowCurve: 0.6,
        mouthCurve: 0.8, mouthWidth: 1.1, leftCornerHeight: 0.5, rightCornerHeight: 0.5, mouthOpenness: 0.1,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 5
    },
    idle: {
        eyeOpenness: 0.88, eyeSquint: 0.12, leftBrowHeight: -0.5, rightBrowHeight: 3, leftBrowCurve: 0.15, rightBrowCurve: 0.45,
        mouthCurve: 0.55, mouthWidth: 0.95, leftCornerHeight: 0.05, rightCornerHeight: 0.45, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 4
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

    setEyeColor(color) {
        if (this.leftEyeLine) this.leftEyeLine.style.stroke = color;
        if (this.rightEyeLine) this.rightEyeLine.style.stroke = color;
        if (this.leftEyebrow) this.leftEyebrow.style.stroke = color;
        if (this.rightEyebrow) this.rightEyebrow.style.stroke = color;
        if (this.mouth) this.mouth.style.stroke = color;
        document.documentElement.style.setProperty('--face-color', color);
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
        // DISABLE VANISH IN STICKY MODE (Automation)
        if (document.body.classList.contains('sticky-mode')) {
            console.log('🛑 [Face] Vanish blocked in Sticky Mode');
            return;
        }

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
        document.documentElement.style.setProperty('--face-color', color);

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

let lastBgDark = true;

function updateFaceColorBasedOnContext(isBgDark = lastBgDark) {
    lastBgDark = isBgDark;
    if (!face) return;
    const isSmall = window.currentActiveWindowMode === 'small';
    const isGlass = document.body.classList.contains('glass-mode');

    if (isSmall || isGlass) {
        // Contextual real-time background color
        face.setEyeColor(isBgDark ? '#ffffff' : '#1a1a1a');
    } else {
        // Static UI theme color
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        face.setEyeColor(currentTheme === 'light' ? '#0a0a0a' : '#ffffff');
    }
}

// =====================================================
// Theme Toggle
// =====================================================

function setTheme(theme, shouldBroadcast = true) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeLabel = document.getElementById('theme-label');
    const themeIcon = document.getElementById('theme-icon');
    if (themeLabel) themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    if (themeIcon) themeIcon.textContent = theme === 'dark' ? '◐' : '◑';

    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.id !== 'btn-glass' && btn.id !== 'btn-theme-toggle') {
            btn.classList.toggle('active', btn.id === `btn-${theme}`);
        }
    });

    // Update face color using context logic to respect glass/small constraints
    updateFaceColorBasedOnContext();

    if (window.currentActiveWindowMode) {
        applyVisualMode(window.currentActiveWindowMode);
    }

    // Broadcast theme change
    if (shouldBroadcast && deviceSync && deviceSync.isConnected()) {
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
const VIEWS = ['face', 'settings'];
let neuralGraph = null;
let navHudTimeout = null;

// Brain / Reminder State
let pendingReminder = null;
let hasProposedReminder = false;
const wakeUpSound = new Audio('assets/hey_pss_pss.mp3');
let inceptionOnboardingState = null;



function init() {
    face = new Face();

    // Global exposure for StickyFaceController
    window.face = face;
    window.setExpression = (name) => face.transitionTo(name);

    // Check for special window modes loaded via query param
    const urlParams = new URLSearchParams(window.location.search);

    // --- BOOTLOADER SEQUENCE ---
    if (urlParams.get('mode') === 'bootloader') {
        const overlay = document.getElementById('bootloader-overlay');
        const faceCont = document.getElementById('face-container');
        const btnLeft = document.getElementById('boot-btn-left');
        const btnRight = document.getElementById('boot-btn-right');
        const btnBottom = document.getElementById('boot-btn-bottom');
        const cursor = document.getElementById('bootloader-cursor');

        if (overlay && faceCont && cursor) {
            window.isBootloading = true;
            faceCont.classList.add('bootload-active');
            face.transitionTo('mild_attention');

            setTimeout(() => {
                if (btnLeft) btnLeft.classList.add('visible');
                if (btnRight) btnRight.classList.add('visible');
                if (btnBottom) btnBottom.classList.add('visible');
            }, 5000);

            setTimeout(() => {
                cursor.style.opacity = '1';
                setTimeout(() => moveCursorAndClick(btnLeft, 0.25, 0.4, () => {
                    setTimeout(() => moveCursorAndClick(btnRight, 0.75, 0.4, () => {
                        setTimeout(() => moveCursorAndClick(btnBottom, 0.5, 0.75, () => {
                            setTimeout(() => {
                                cursor.style.opacity = '0';
                                overlay.classList.add('fade-out');
                                faceCont.classList.remove('bootload-active');
                                setTimeout(() => {
                                    overlay.classList.add('hidden');
                                    window.isBootloading = false;
                                    face.transitionTo('smile');
                                    face.lookAt(0.5, 0.5);
                                    if (window.iuOS && window.iuOS.setWindowMode) {
                                        window.iuOS.setWindowMode('small');
                                    }
                                }, 1500);
                            }, 1000);
                        }), 1500);
                    }), 1500);
                }), 500);
            }, 10000);

            function moveCursorAndClick(btn, gazeX, gazeY, nextStep) {
                if (!btn) return nextStep();
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                cursor.style.left = cx + 'px';
                cursor.style.top = cy + 'px';

                face.transitionTo('mild_attention');
                face.lookAt(gazeX, gazeY);

                setTimeout(() => {
                    face.transitionTo('thinking'); // expression!
                    btn.classList.add('clicked');
                    setTimeout(() => {
                        btn.classList.remove('clicked');
                        btn.classList.add('fade-out');
                        face.transitionTo('smile');
                        nextStep();
                    }, 250);
                }, 1200);
            }
        }
    } else {
        const overlay = document.getElementById('bootloader-overlay');
        if (overlay) overlay.classList.add('hidden');
    }
    // ---------------------------

    initInceptionOnboarding();

    // Small mode: independent window, apply visuals immediately with no transition
    if (urlParams.get('mode') === 'small') {
        console.log('🔵 [Renderer] Detected ?mode=small — applying small window layout');
        window.currentActiveWindowMode = 'small';
        document.body.classList.add('mode-small');
        const svgEl = document.getElementById('face-svg');
        if (svgEl) svgEl.setAttribute('viewBox', '50 80 300 340');
    }



    // Adapt face color to system theme (nativeTheme-based, zero-overhead)
    if (window.iuOS && window.iuOS.sampleBgLuminance) {
        window.iuOS.sampleBgLuminance().then(({ isDark }) => {
            updateFaceColorBasedOnContext(isDark);
        }).catch(() => { });
    }
    // Also listen for live theme changes
    if (window.iuOS && window.iuOS.onBgLuminanceChanged) {
        window.iuOS.onBgLuminanceChanged(({ isDark }) => {
            updateFaceColorBasedOnContext(isDark);
        });
    }

    if (urlParams.get('mode') === 'sticky') {
        console.log('🤖 [App] Starting in Sticky Mode (Automation)');
        document.body.classList.add('sticky-mode');
        // Ensure face is WHITE on BLACK background
        face.setEyeColor('#ffffff');

        // ZOOM IN: Crop view tightly around face features
        // Face center ~ 200,250. 
        // Showing range ~ 125-275 (x), 175-325 (y) --> NOW SLIGHTLY ZOOMED OUT: 110-290, 160-340
        const svg = document.getElementById('face-svg');
        if (svg) {
            // Updated ViewBox for "un poco mas pequeña" + "bajala 2px" (shift y up)
            // Previous: 90 140 220 220
            // New:      90 135 220 220 (Shift Y up by 5 units = Face moves DOWN)
            svg.setAttribute('viewBox', '90 135 220 220');
            svg.style.transform = 'none'; // Remove any CSS scaling to avoid double-scaling
        }


        // Disable controls panel
        const controls = document.getElementById('controls-panel');
        if (controls) controls.style.display = 'none';

        // Hide scrollbars
        document.body.style.overflow = 'hidden';
    }

    // Initialize VisionManager
    if (typeof VisionManager !== 'undefined') {
        visionManager = new VisionManager();

        if (typeof AudioLoop !== 'undefined' && urlParams.get('mode') !== 'sticky') { // No audio loop in sticky mode to avoid self-echo/conflicts
            window.audioLoop = new AudioLoop();

            // Voice Wake Word Handler
            window.audioLoop.setOnWakeWord((type, text) => {
                handleWakeWord(type, text);
            });
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
            if (window.isBootloading) return;
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
            if (window.isBootloading) return;
            // --- REMINDER LOGIC ---
            if (isAttentive && pendingReminder && !hasProposedReminder) {
                console.log('👀 [App] User looked at reminder! Initiating proposal...');
                hasProposedReminder = true;

                // 1. Trigger Voice Mode
                if (window.iuOS && window.iuOS.conversationControl) {
                    window.iuOS.conversationControl('start');
                }

                // 2. Visual Visual Cue
                if (face) {
                    face.transitionTo('thinking');
                    showToast(`🗣️ ${pendingReminder.task} (Asiente para confirmar)`);
                }
                return; // Prioritize reminder over standard attention flow
            }
            // ----------------------

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
            // --- REMINDER CONFIRMATION ---
            if (pendingReminder && hasProposedReminder && (gesture === 'nod' || gesture === 'call')) {
                console.log('✅ [App] Reminder Confirmed via Gesture:', gesture);

                if (window.iuOS && window.iuOS.brainConfirmTask) {
                    window.iuOS.brainConfirmTask(pendingReminder.taskId);
                }

                showToast('✅ Iniciando tarea...');
                pendingReminder = null;
                hasProposedReminder = false;

                if (face) face.transitionTo('action_complete');
                return;
            }
            // -----------------------------

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
            // Stop Sensors if toggled off
            if (role === 'sensors' && visionManager) {
                // visionManager.stop(); // Optional: Keep running?
            }
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
                // visionManager.start(); // It starts by default
                console.log('[App] 🎥 Sensors ACTIVATED (camera/audio)');
            }
            if (window.audioLoop) {
                console.log('[App] 🎤 Audio Loop ensured active');
                // window.audioLoop.start(); // It also starts by default
            }
            // showToast('Sensores activados');
            // Show "Sensores activados" in intent carousel (same style as "Empezando conversación")
            const container = document.getElementById('intent-carousel');
            const track = document.getElementById('intent-track');
            const label = document.getElementById('intent-label');
            const details = document.getElementById('intent-details');

            if (container && track && label) {
                container.classList.remove('hidden');
                isCarouselActive = false; // Not interactive

                track.innerHTML = ''; // No icon for this message
                label.textContent = 'Sensores activados';
                if (details) details.classList.add('hidden');

                // Hide after 3 seconds
                setTimeout(() => {
                    container.classList.add('hidden');
                }, 3000);
            }
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

    // Default to Sensors role for immediate functionality
    setTimeout(() => {
        if (!localRole) setRole('sensors');
    }, 1000);

    // Initialize DeviceSync
    if (typeof getDeviceSync === 'function') {
        deviceSync = getDeviceSync();

        // Set up connection status callbacks
        deviceSync.setOnConnectionChange((connected, devices) => {
            updateConnectionStatus(connected, devices);
        });

        // Handle Remote Instructions (Zapier + Context)
        deviceSync.setOnRemoteInstruction((instruction, context) => {
            console.log('⚡ [App] Remote instruction:', instruction, 'Context:', context);
            const userCommand = context ? `[Contexto: ${context}] ${instruction}` : instruction;

            showToast(`⚡ Instrucción remota: ${instruction}`);

            // Execute via main process
            if (window.iuOS && window.iuOS.executeExplicitAction) {
                window.iuOS.executeExplicitAction(userCommand);
            }
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
                setTheme(sharedState.theme, false);
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

    // Check for Brain Wake Up (Reminders)
    if (window.iuOS && window.iuOS.onBrainWakeUp) {
        window.iuOS.onBrainWakeUp((data) => {
            console.log('🔔 [App] WAKE UP! Reminder:', data.task);
            wakeUpSound.play().catch(e => console.error('Audio play failed:', e));

            pendingReminder = data;
            hasProposedReminder = false;

            showToast(`🔔 ${data.task}`);
            if (face) face.emerge();

            // If in PC mode (sensors off), we should probably alert user more aggressively
            // or switch role if possible.
        });
    }

    // Chat toggle button (top-right)
    const chatToggleBtn = document.getElementById('btn-chat-toggle');
    if (chatToggleBtn) {
        chatToggleBtn.addEventListener('click', () => {
            if (window.iuOS && window.iuOS.toggleChatWindow) {
                window.iuOS.toggleChatWindow();
            }
        });
    }

    // Menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const controlsPanel = document.getElementById('controls-panel');
    const btnExperimentalToggle = document.getElementById('btn-experimental-toggle');
    const btnExperimentalBack = document.getElementById('btn-experimental-back');
    const controlsViews = Array.from(document.querySelectorAll('#controls-panel .controls-view'));

    const updateControlsScrollHints = () => {
        controlsViews.forEach((view) => {
            const hasOverflow = view.scrollHeight > view.clientHeight + 1;
            const atTop = view.scrollTop <= 1;
            const atBottom = (view.scrollTop + view.clientHeight) >= (view.scrollHeight - 1);
            view.classList.toggle('can-scroll-top', hasOverflow && !atTop);
            view.classList.toggle('can-scroll-bottom', hasOverflow && !atBottom);
        });
    };

    controlsViews.forEach((view) => {
        view.addEventListener('scroll', updateControlsScrollHints, { passive: true });
    });
    window.addEventListener('resize', updateControlsScrollHints);

    const setExperimentalView = (isOpen) => {
        if (!controlsPanel) return;
        controlsPanel.classList.toggle('experimental-open', isOpen);
        if (btnExperimentalToggle) {
            btnExperimentalToggle.textContent = isOpen ? 'back' : 'experimental';
            btnExperimentalToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
        requestAnimationFrame(updateControlsScrollHints);
    };

    if (menuToggle && controlsPanel) {
        menuToggle.addEventListener('click', () => {
            panelCollapsed = !panelCollapsed;
            controlsPanel.classList.toggle('collapsed', panelCollapsed);
            menuToggle.classList.toggle('active', !panelCollapsed);
            if (panelCollapsed) setExperimentalView(false);
            if (!panelCollapsed) requestAnimationFrame(updateControlsScrollHints);
        });
    }

    if (btnExperimentalToggle) {
        btnExperimentalToggle.addEventListener('click', () => {
            if (controlsPanel && controlsPanel.classList.contains('collapsed')) return;
            const isOpen = controlsPanel && controlsPanel.classList.contains('experimental-open');
            setExperimentalView(!isOpen);
        });
    }

    if (btnExperimentalBack) {
        btnExperimentalBack.addEventListener('click', () => setExperimentalView(false));
    }
    requestAnimationFrame(updateControlsScrollHints);

    // State buttons
    const activateState = (id, state) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                setActiveButton(id);
                face.emerge();
                face.transitionTo(state);

                // Broadcast expression change
                if (deviceSync && deviceSync.isConnected()) {
                    deviceSync.broadcastSharedState({ activePreset: state });
                }
            });
        }
    };

    activateState('btn-neutral', 'neutral');
    activateState('btn-smile', 'smile');
    activateState('btn-thinking', 'thinking');
    activateState('btn-wink', 'wink');

    // Theme buttons
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = document.getElementById('theme-label');
    const btnGlass = document.getElementById('btn-glass');

    let isGlassMode = document.body.classList.contains('glass-mode');

    const setSwitchButtonState = (btn, isActive) => {
        if (!btn) return;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    };

    const syncThemeToggleVisual = () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (themeLabel) themeLabel.textContent = currentTheme === 'dark' ? 'Dark' : 'Light';
        if (themeIcon) themeIcon.textContent = currentTheme === 'dark' ? '◐' : '◑';
        if (btnThemeToggle) btnThemeToggle.setAttribute('aria-pressed', 'true');
    };

    syncThemeToggleVisual();

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            setTheme(nextTheme);
            syncThemeToggleVisual();
        });
    }

    if (btnGlass) {
        setSwitchButtonState(btnGlass, isGlassMode);
        btnGlass.addEventListener('click', () => {
            isGlassMode = !isGlassMode;
            document.body.classList.toggle('glass-mode', isGlassMode);
            setSwitchButtonState(btnGlass, isGlassMode);
            updateFaceColorBasedOnContext();
            showToast(isGlassMode ? 'Modo Transparente: Activado' : 'Modo Transparente: Desactivado');
        });
    }

    // Hand Gestures toggle
    const btnHandGestures = document.getElementById('btn-hand-gestures');
    if (btnHandGestures) {
        let handGesturesEnabled = false;
        const applyHandGesturesState = (enabled) => {
            handGesturesEnabled = enabled;
            setSwitchButtonState(btnHandGestures, enabled);
        };

        const syncHandGesturesState = async () => {
            if (!window.iuOS || !window.iuOS.getHandWindowState) return;
            try {
                const state = await window.iuOS.getHandWindowState();
                const active = !!(state && state.created && state.visible);
                applyHandGesturesState(active);
            } catch (e) {
                console.warn('⚠️ Could not read hand gesture state:', e);
            }
        };

        syncHandGesturesState();

        btnHandGestures.addEventListener('click', async () => {
            try {
                if (window.iuOS && window.iuOS.toggleHandWindow) {
                    const result = await window.iuOS.toggleHandWindow();
                    if (result && typeof result.visible === 'boolean') {
                        applyHandGesturesState(result.visible);
                    }
                    setTimeout(() => {
                        syncHandGesturesState();
                    }, 180);
                    showToast(handGesturesEnabled ? 'Gestos con manos: Activados' : 'Gestos con manos: Desactivados');
                } else {
                    applyHandGesturesState(!handGesturesEnabled);
                }
            } catch (e) {
                console.error('❌ Failed to toggle hand gestures:', e);
                showToast('No se pudo cambiar gestos');
            }
        });
    }

    // Mode toggle
    const simpleModeBtn = document.getElementById('btn-simple-mode');
    if (simpleModeBtn) {
        simpleModeBtn.addEventListener('click', () => {
            isSimpleMode = !isSimpleMode;
            simpleModeBtn.classList.toggle('active', isSimpleMode);
            showToast(isSimpleMode ? '⚡ Modo Simple: Activado' : '⚡ Modo Estándar');
        });
    }

    // Disconnection Mode toggle
    const disconnectBtn = document.getElementById('btn-disconnect-mode');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async () => {
            console.log('🧠 Triggering Disconnection Mode (1h)...');
            showToast('🧠 Iniciando Modo Desconexión...');
            try {
                if (window.iuOS && window.iuOS.startDisconnectionMode) {
                    const result = await window.iuOS.startDisconnectionMode(60);
                    if (result.success) {
                        showToast('✅ Modo Desconexión ACTIVO');
                    } else {
                        showToast('❌ Error: ' + result.error);
                    }
                } else {
                    console.error('❌ iuOS API not found');
                }
            } catch (e) {
                console.error('Failed to start disconnection mode:', e);
                showToast('❌ Error al iniciar');
            }
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

    // Narration Space button
    const narrationBtn = document.getElementById('btn-narration-space');
    if (narrationBtn) {
        narrationBtn.addEventListener('click', () => {
            console.log('🌌 [App] Activating Narration Space...');
            if (window.iuOS && window.iuOS.activateNarrationSpace) {
                window.iuOS.activateNarrationSpace();
            } else {
                console.error('❌ iuOS.activateNarrationSpace API not available');
            }
        });
    }

    // Learning Mode button
    let isLearning = false;
    let learningSaveInterval = null;
    const btnLearningMode = document.getElementById('btn-learning-mode');
    const learningModeState = document.getElementById('learning-mode-state');

    const setLearnProgress = (pct) => {
        if (!btnLearningMode) return;
        const value = Math.max(0, Math.min(100, pct));
        btnLearningMode.style.setProperty('--learn-progress', `${value}%`);
    };

    const stopLearnProgress = () => {
        if (learningSaveInterval) {
            clearInterval(learningSaveInterval);
            learningSaveInterval = null;
        }
    };

    const startLearnSavingProgress = () => {
        stopLearnProgress();
        if (!btnLearningMode) return;
        btnLearningMode.classList.add('is-saving');
        setLearnProgress(6);
        let progress = 6;
        learningSaveInterval = setInterval(() => {
            progress = Math.min(92, progress + Math.max(2, (94 - progress) * 0.12));
            setLearnProgress(progress);
            if (progress >= 92) stopLearnProgress();
        }, 120);
    };

    const completeLearnSavingProgress = () => {
        stopLearnProgress();
        setLearnProgress(100);
        setTimeout(() => {
            if (!btnLearningMode) return;
            btnLearningMode.classList.remove('is-saving');
            setLearnProgress(0);
        }, 220);
    };

    const setLearningUI = (state) => {
        if (!btnLearningMode) return;
        const isActive = state === 'on' || state === 'saving';
        setSwitchButtonState(btnLearningMode, isActive);
        btnLearningMode.classList.toggle('is-saving', state === 'saving');
        if (learningModeState) {
            learningModeState.textContent = state === 'off' ? 'Off' : (state === 'saving' ? 'Saving...' : 'On');
            learningModeState.classList.toggle('on', state !== 'off');
            learningModeState.classList.toggle('saving', state === 'saving');
        }
    };
    setLearningUI('off');
    setLearnProgress(0);

    if (btnLearningMode) {
        btnLearningMode.addEventListener('click', async () => {
            const nextLearningState = !isLearning;
            try {
                isLearning = nextLearningState;
                if (isLearning) {
                    setLearningUI('on');
                    console.log('🎓 [App] Starting Learning Mode...');
                    if (window.iuOS && window.iuOS.invoke) {
                        await window.iuOS.invoke('learning-start', { name: 'Workflow ' + new Date().toLocaleTimeString() });
                    }
                } else {
                    setLearningUI('saving');
                    startLearnSavingProgress();
                    console.log('🎓 [App] Stopping Learning Mode...');
                    if (window.iuOS && window.iuOS.invoke) {
                        const result = await window.iuOS.invoke('learning-stop');
                        console.log('🎓 Learning synthesized:', result.synthesized);
                    }
                    completeLearnSavingProgress();
                    setLearningUI('off');
                }
            } catch (e) {
                console.error('❌ Error toggling learning mode:', e);
                isLearning = !nextLearningState;
                stopLearnProgress();
                btnLearningMode.classList.remove('is-saving');
                setLearnProgress(0);
                setLearningUI(isLearning ? 'on' : 'off');
                showToast('No se pudo cambiar el modo aprendizaje.');
            }
        });
    }

    // View Learnings button + modal
    const btnViewLearnings = document.getElementById('btn-view-learnings');
    const learningsModal = document.getElementById('learnings-modal');
    const learningsList = document.getElementById('learnings-list');
    const btnCloseLearnings = document.getElementById('btn-close-learnings');

    const closeLearningsModal = () => {
        if (learningsModal) learningsModal.style.display = 'none';
    };

    const renderLearningCard = (wf) => {
        const steps = Array.isArray(wf.steps) ? wf.steps : [];
        const topSteps = steps.slice(0, 4).map((s) => {
            const target = s.target || 'paso';
            const purpose = s.purpose || '';
            return `<div style="font-size:12px; color:#c9d2dc; line-height:1.35;">• ${target}${purpose ? ` — ${purpose}` : ''}</div>`;
        }).join('');

        return `
          <div style="border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:10px 12px; background:rgba(255,255,255,0.02);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <div style="font-size:15px; font-weight:600; color:#f2f5f7; min-width:0;">${wf.workflowName || 'Aprendizaje'}</div>
              <button class="state-btn delete-learning-btn" data-file="${wf.file}" style="padding:4px 8px; font-size:11px; color:#ff8f8f; border-color:rgba(255,143,143,0.45);">Eliminar</button>
            </div>
            <div style="font-size:12px; color:#9fb0c1; margin-top:3px;">${wf.summary || 'Sin resumen'}</div>
            <div style="font-size:11px; color:#7f8b96; margin-top:6px;">Apps: ${(wf.apps || []).join(', ') || 'N/A'} · Pasos: ${steps.length}</div>
            <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">${topSteps}</div>
          </div>
        `;
    };

    const openLearningsModal = async () => {
        if (!window.iuOS || !window.iuOS.listLearnedWorkflows || !learningsModal || !learningsList) return;
        learningsModal.style.display = 'flex';
        learningsList.innerHTML = '<div style="font-size:12px; color:#9fb0c1;">Cargando aprendizajes...</div>';
        try {
            const result = await window.iuOS.listLearnedWorkflows();
            const workflows = (result && result.success && Array.isArray(result.workflows)) ? result.workflows : [];
            if (workflows.length === 0) {
                learningsList.innerHTML = '<div style="font-size:12px; color:#9fb0c1;">No hay aprendizajes guardados todavía.</div>';
                return;
            }
            learningsList.innerHTML = workflows.map(renderLearningCard).join('');
        } catch (e) {
            learningsList.innerHTML = `<div style="font-size:12px; color:#ff8f8f;">Error cargando aprendizajes: ${e.message}</div>`;
        }
    };

    if (btnViewLearnings) {
        btnViewLearnings.addEventListener('click', openLearningsModal);
    }
    if (learningsList) {
        learningsList.addEventListener('click', async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            const deleteBtn = target.closest('.delete-learning-btn');
            if (!deleteBtn) return;
            const file = deleteBtn.getAttribute('data-file');
            if (!file || !window.iuOS || !window.iuOS.invoke) return;
            try {
                deleteBtn.setAttribute('disabled', 'true');
                deleteBtn.textContent = '...';
                const result = await window.iuOS.invoke('learning-delete-workflow', { file });
                if (result && result.success) {
                    showToast('Aprendizaje eliminado.');
                    await openLearningsModal();
                } else {
                    showToast('No se pudo eliminar aprendizaje.');
                    deleteBtn.textContent = 'Eliminar';
                    deleteBtn.removeAttribute('disabled');
                }
            } catch (err) {
                console.error('❌ Error deleting learning:', err);
                showToast('Error eliminando aprendizaje.');
                deleteBtn.textContent = 'Eliminar';
                deleteBtn.removeAttribute('disabled');
            }
        });
    }
    if (btnCloseLearnings) {
        btnCloseLearnings.addEventListener('click', closeLearningsModal);
    }
    if (learningsModal) {
        learningsModal.addEventListener('click', (e) => {
            if (e.target === learningsModal) closeLearningsModal();
        });
    }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLearningsModal();
    });

    // Mirar juntos button — toggle persistent mode
    let mirarJuntosActive = false;
    const mirarJuntosBtn = document.getElementById('btn-mirar-juntos');
    if (mirarJuntosBtn) {
        mirarJuntosBtn.addEventListener('click', () => {
            mirarJuntosActive = !mirarJuntosActive;
            mirarJuntosBtn.classList.toggle('active', mirarJuntosActive);
            mirarJuntosBtn.textContent = mirarJuntosActive ? 'Mirar juntos ●' : 'Mirar juntos';
            console.log(`👁️ [App] Mirar juntos: ${mirarJuntosActive ? 'ON' : 'OFF'}`);
            if (window.iuOS && window.iuOS.toggleMirarJuntos) {
                window.iuOS.toggleMirarJuntos(mirarJuntosActive);
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

    // Trackpad / Wheel Navigation (Horizontal only)
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

    // Initialize Window Modes & Gestures
    setupWindowModes();

    // Enable manual dragging (since we removed -webkit-app-region: drag)
    setupManualDrag();

    console.log('✅ IÜ OS ready');
}

function renderInceptionOnboarding(state) {
    const card = document.getElementById('inception-onboarding-card');
    const copy = document.getElementById('inception-onboarding-copy');
    const status = document.getElementById('inception-onboarding-status');
    const startBtn = document.getElementById('btn-inception-start');
    const dismissBtn = document.getElementById('btn-inception-dismiss');
    if (!card || !copy || !status || !startBtn || !dismissBtn) return;

    inceptionOnboardingState = state || inceptionOnboardingState || {};
    const current = inceptionOnboardingState || {};
    const shouldShow = Boolean(current.shouldPrompt || current.status === 'running' || current.status === 'waiting_user' || current.status === 'error');
    card.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;

    if (current.status === 'completed') {
        card.classList.add('hidden');
        return;
    }

    if (current.status === 'waiting_user') {
        copy.textContent = 'IU Chrome quedo abierto en Inception. Completa el paso que falte y luego continua la configuracion.';
        startBtn.textContent = 'Continuar configuracion';
    } else if (current.status === 'running') {
        copy.textContent = 'U esta usando IU Chrome para dejar lista tu API personal de Inception sin tocar el flujo normal del sistema.';
        startBtn.textContent = 'Configurando...';
    } else if (current.status === 'error') {
        copy.textContent = 'Hubo un bloqueo durante el onboarding. Puedes reintentar cuando quieras.';
        startBtn.textContent = 'Reintentar';
    } else {
        copy.textContent = 'U puede abrir Inception en IU Chrome y dejar lista tu API personal para usarla como provider de texto.';
        startBtn.textContent = 'Configurar';
    }

    status.textContent = current.lastMessage || current.lastError || '';
    startBtn.disabled = current.status === 'running';
    dismissBtn.disabled = current.status === 'running';
}

async function initInceptionOnboarding() {
    const startBtn = document.getElementById('btn-inception-start');
    const dismissBtn = document.getElementById('btn-inception-dismiss');

    if (startBtn && !startBtn.dataset.bound) {
        startBtn.dataset.bound = '1';
        startBtn.addEventListener('click', async () => {
            if (!window.iuOS || !window.iuOS.startInceptionOnboarding) return;
            const next = await window.iuOS.startInceptionOnboarding().catch(() => null);
            if (next) renderInceptionOnboarding(next);
        });
    }

    if (dismissBtn && !dismissBtn.dataset.bound) {
        dismissBtn.dataset.bound = '1';
        dismissBtn.addEventListener('click', async () => {
            if (!window.iuOS || !window.iuOS.dismissInceptionOnboarding) return;
            const next = await window.iuOS.dismissInceptionOnboarding().catch(() => null);
            if (next) renderInceptionOnboarding(next);
        });
    }

    if (window.iuOS && window.iuOS.onInceptionOnboardingStatus) {
        window.iuOS.onInceptionOnboardingStatus((state) => {
            renderInceptionOnboarding(state);
        });
    }

    if (window.iuOS && window.iuOS.getInceptionOnboardingState) {
        const initial = await window.iuOS.getInceptionOnboardingState().catch(() => null);
        if (initial) renderInceptionOnboarding(initial);
    }
}

/**
 * Manual Dragging to allow mouse events (gestures) on drag area
 */
function setupManualDrag() {
    let isDragging = false;
    let startMouseX, startMouseY;
    let startWinX, startWinY;

    const dragTarget = document.body; // Change from #app to body to catch more generically
    if (!dragTarget) return;

    const shouldSkipDrag = (target) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest('button, a, input, textarea, select, [data-no-drag], #controls-panel, #learnings-modal');
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.cursor = '';
    };

    dragTarget.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        if (shouldSkipDrag(e.target)) return;

        e.preventDefault();
        isDragging = true;
        startMouseX = e.screenX;
        startMouseY = e.screenY;
        startWinX = window.screenX;
        startWinY = window.screenY;
        document.body.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) {
            // Determine if mouse is over an interactive element or the face
            const isInteractive = !!e.target.closest('button, a, input, textarea, select, [data-no-drag], #controls-panel, #face-container, .boot-btn, #learnings-modal');
            if (window.iuOS && window.iuOS.setClickThrough) {
                // Ignore general mouse clicks (pass through to OS) EXCEPT when hovering our active elements
                window.iuOS.setClickThrough(!isInteractive);
            }
            return;
        }

        const deltaX = e.screenX - startMouseX;
        const deltaY = e.screenY - startMouseY;

        if (window.iuOS && window.iuOS.windowMove) {
            window.iuOS.windowMove({
                x: startWinX + deltaX,
                y: startWinY + deltaY
            });
        }
    });

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
}

/**
 * Setup Window Resizing via Pinch Gesture
 */
function setupWindowModes() {
    const MODES_CYCLE = ['small', 'medium', 'large'];
    let lastScaleChange = 0;
    const PINCH_THRESHOLD = 8;
    let modeDebounce = false;
    let lastModeChangeAt = 0;
    const MODE_STEP_COOLDOWN_MS = 320;

    // Per-gesture flags: only ONE mode change allowed per complete gesture
    let inNativeGesture = false;
    let gestureModeDone = false;

    const GESTURE_DEAD_MS = 350;

    const tryChangeMode = (delta) => {
        const now = Date.now();
        if (modeDebounce || (now - lastModeChangeAt) < MODE_STEP_COOLDOWN_MS) return false;
        const changed = changeMode(delta);
        if (changed) {
            lastModeChangeAt = now;
            modeDebounce = true;
            // Set dead time: block new gesturestart for 350ms after mode change
            gestureDeadUntil = now + GESTURE_DEAD_MS;
            inNativeGesture = false; // Current gesture is done
            gestureModeDone = true;
            setTimeout(() => { modeDebounce = false; }, 180);
        }
        return changed;
    };

    // 1. Detect Pinch (Wheel + Ctrl) — only fires when NOT in a native gesture
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            if (inNativeGesture) return; // Native gesture takes priority
            lastScaleChange += e.deltaY;

            if (Math.abs(lastScaleChange) > PINCH_THRESHOLD) {
                const delta = lastScaleChange > 0 ? -1 : 1;
                tryChangeMode(delta);
                lastScaleChange = 0;
            }
        }
    }, { passive: false });

    // Dead time after a mode change: block new gestures for 350ms to prevent
    // the "finishing gesture" from being re-detected in the new window size.
    let gestureDeadUntil = 0;

    // 2. Native Mac Pinch — mark gesture boundaries, allow only ONE mode step per gesture
    window.addEventListener('gesturestart', () => {
        if (Date.now() < gestureDeadUntil) return; // Still in dead time — ignore
        inNativeGesture = true;
        gestureModeDone = false;
        lastScaleChange = 0;
    });

    window.addEventListener('gestureend', () => {
        inNativeGesture = false;
        gestureModeDone = false;
        lastScaleChange = 0;
    });

    window.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        if (gestureModeDone) return; // Only one mode change per gesture

        if (e.scale > 1.05) {
            if (tryChangeMode(1)) gestureModeDone = true; // Pinch out -> Larger
        } else if (e.scale < 0.95) {
            if (tryChangeMode(-1)) gestureModeDone = true; // Pinch in -> Smaller
        }
    });

    function changeMode(delta) {
        if (!window.iuOS) return;
        const currentMode = window.currentActiveWindowMode || 'large';
        let idx = MODES_CYCLE.indexOf(currentMode);
        if (idx === -1) idx = 2; // Default to large

        let nextIdx = idx + delta;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= MODES_CYCLE.length) nextIdx = MODES_CYCLE.length - 1;

        if (nextIdx !== idx) {
            console.log(`📡 Requesting window mode: ${MODES_CYCLE[nextIdx]}`);
            window.iuOS.setWindowMode(MODES_CYCLE[nextIdx]);
            return true;
        }
        return false;
    }

    // 3. Listen for Mode Changes from Main Process
    if (window.iuOS && window.iuOS.onWindowModeChanged) {
        window.iuOS.onWindowModeChanged((mode) => {
            console.log(`🔲 Window Mode Changed: ${mode}`);
            window.currentActiveWindowMode = mode;
            applyVisualMode(mode);
        });
    }
}

/**
 * Apply visual styles for specific window modes
 */
function applyVisualMode(mode) {
    const svg = document.getElementById('face-svg');
    if (!svg) return;

    console.log(`🎨 Applying visual mode: ${mode}`);

    // Reset all mode classes
    document.body.classList.remove('sticky-mode', 'mode-small', 'mode-medium');
    svg.setAttribute('viewBox', '0 0 400 500');

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';

    if (mode === 'small') {
        // Pre-set transparent BEFORE adding class to bypass the CSS background-color transition.
        document.body.style.background = 'transparent';
        document.body.style.backgroundColor = 'transparent';

        const appEl = document.getElementById('app');
        if (appEl) {
            appEl.style.background = 'transparent';
            appEl.style.backgroundColor = 'transparent';
        }

        document.body.classList.add('mode-small');
        svg.setAttribute('viewBox', '50 80 300 340');
    } else {
        // Restore CSS-managed background when leaving small mode
        requestAnimationFrame(() => {
            document.body.style.background = '';
            document.body.style.backgroundColor = '';
            const appEl = document.getElementById('app');
            if (appEl) {
                appEl.style.background = '';
                appEl.style.backgroundColor = '';
            }
        });
        if (mode === 'medium') {
            document.body.classList.add('mode-medium');
        }
        // Live background luminance checking handles eye color
    }
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

let toastHideTimer = null;

function showToast(message, duration = 3000, variant = 'default') {
    let toast = document.getElementById('toast-message');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-message';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.toggle('toast-subtle', variant === 'subtle');
    toast.classList.add('visible');

    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
        toast.classList.remove('visible');
        toastHideTimer = null;
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

    if (state === 'active') {
        // Stop state
        if (btn) {
            btn.innerHTML = '<span class="transfer-text">Terminar</span>';
            btn.classList.add('active-conversation');
        }

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
        if (btn) {
            btn.innerHTML = '<span class="transfer-text">Hablar</span>';
            btn.classList.remove('active-conversation');
        }
        // REMOVED: transitionTo('neutral') to keep current expression (e.g. Smile)


        // Hide transcript
        const container = document.getElementById('transcript-container');
        const textElement = document.getElementById('transcript-text');
        if (container) container.classList.add('hidden');
        clearTranscriptTextAfterFade(textElement);
        if (transcriptHideTimer) {
            clearTimeout(transcriptHideTimer);
            transcriptHideTimer = null;
        }
    }
}

function setActiveButton(activeId) {
    document.querySelectorAll('.state-btn[data-state-button="true"]').forEach(btn => {
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

// Conversation Text state
let displayedWords = [];
let transcriptSourceWords = [];
let transcriptHideTimer = null;
let transcriptClearTimer = null;

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Conversation Text Listener

function getTranscriptVisibleWordBudget() {
    const mode = document.body.classList.contains('mode-medium') ? 'medium' : 'regular';
    const width = window.innerWidth || 300;
    if (mode === 'medium') {
        if (width <= 220) return 10;
        if (width <= 260) return 14;
        return 18;
    }
    if (width <= 280) return 18;
    if (width <= 360) return 24;
    return 32;
}

function renderTranscriptWindow(words, textElement, trailingSpace = false) {
    const budget = getTranscriptVisibleWordBudget();
    const visibleWords = words.slice(-budget);

    while (textElement.children.length > visibleWords.length) {
        textElement.removeChild(textElement.lastChild);
    }

    visibleWords.forEach((word, index) => {
        let span = textElement.children[index];
        const isLastVisible = index === visibleWords.length - 1;
        const isPotentiallyIncomplete = !trailingSpace && isLastVisible;
        if (!span) {
            span = document.createElement('span');
            span.className = isPotentiallyIncomplete ? '' : 'word-fade';
            textElement.appendChild(span);
        }

        const prevWord = displayedWords[index];
        if (prevWord !== word) {
            const grewByChunk = !!prevWord && word.startsWith(prevWord);
            const shouldAnimate = !isPotentiallyIncomplete && !grewByChunk;
            if (shouldAnimate) {
                span.classList.remove('word-fade');
                void span.offsetWidth;
                span.classList.add('word-fade');
            }
            span.textContent = word;
        }

        if (isPotentiallyIncomplete) {
            span.classList.remove('word-fade');
        } else if (!span.classList.contains('word-fade')) {
            span.classList.add('word-fade');
        }
    });

    displayedWords = visibleWords;
}

function clearTranscriptTextAfterFade(textElement) {
    if (transcriptClearTimer) {
        clearTimeout(transcriptClearTimer);
    }
    transcriptClearTimer = setTimeout(() => {
        if (!textElement) return;
        textElement.innerHTML = '';
        displayedWords = [];
        transcriptSourceWords = [];
        transcriptClearTimer = null;
    }, 540);
}

window.addEventListener('resize', () => {
    const textElement = document.getElementById('transcript-text');
    if (!textElement || transcriptSourceWords.length === 0) return;
    renderTranscriptWindow(transcriptSourceWords, textElement, false);
});

if (window.iuOS && window.iuOS.onConversationText) {
    window.iuOS.onConversationText((text) => {
        const container = document.getElementById('transcript-container');
        const textElement = document.getElementById('transcript-text');

        if (container && textElement) {
            if (transcriptClearTimer) {
                clearTimeout(transcriptClearTimer);
                transcriptClearTimer = null;
            }
            const words = (text || '').split(/\s+/).filter(w => w.length > 0);
            const trailingSpace = /\s$/.test(text || '');
            if (words.length < transcriptSourceWords.length) {
                transcriptSourceWords = [];
                displayedWords = [];
                textElement.innerHTML = '';
            }
            transcriptSourceWords = words;

            container.classList.remove('hidden');
            renderTranscriptWindow(words, textElement, trailingSpace);

            if (transcriptHideTimer) {
                clearTimeout(transcriptHideTimer);
            }
            transcriptHideTimer = setTimeout(() => {
                container.classList.add('hidden');
                clearTranscriptTextAfterFade(textElement);
                transcriptHideTimer = null;
            }, 3200);
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

// ============================================
// Action System Listeners
// ============================================

let pendingActionPlan = null;


// Listen for action confirmation requests from main process
if (window.iuOS && window.iuOS.onActionConfirmRequest) {
    window.iuOS.onActionConfirmRequest((data) => {
        console.log('[App] Action confirmation requested:', data);
        pendingActionPlan = data;

        // ACTIVATE COMPACT ACTION MODE - Trigger transition
        const app = document.getElementById('app');
        if (app) app.classList.add('compact-action-mode');

        // Show popup with action description
        showCompactPopup(data.goal);

        // In compact mode: auto-confirm immediately (no button)
        // The transition happens, then action executes
        setTimeout(() => {
            if (window.iuOS && window.iuOS.confirmAction) {
                window.iuOS.confirmAction(data);
            }
        }, 800); // Wait for transition to settle
    });
}

// Listen for action status updates (phase changes during execution)
if (window.iuOS && window.iuOS.onActionStatus) {
    window.iuOS.onActionStatus((data) => {
        console.log('[App] Action status:', data.status);

        switch (data.status) {
            case 'executing':
                showCompactPopup(data.step || 'Ejecutando...');
                document.getElementById('loading-overlay').classList.remove('hidden');
                if (face) face.transitionTo('looking_at_screen', 600);
                break;
            case 'complete':
                document.getElementById('loading-overlay').classList.add('hidden');
                showCompactPopup('✓ Completado');

                // EXIT COMPACT ACTION MODE
                const app = document.getElementById('app');
                if (app) app.classList.remove('compact-action-mode');

                setTimeout(() => {
                    hideCompactPopup();
                    if (face) face.transitionTo('smile', 800);
                }, 2000);
                break;
            case 'incomplete':
                document.getElementById('loading-overlay').classList.add('hidden');
                showCompactPopup(`⚠ Incompleto`);
                const appIncomplete = document.getElementById('app');
                if (appIncomplete) appIncomplete.classList.remove('compact-action-mode');
                if (face) face.transitionTo('neutral', 600);
                setTimeout(hideCompactPopup, 3000);
                break;
            case 'error':
                document.getElementById('loading-overlay').classList.add('hidden');
                showCompactPopup(`✗ Error`);
                const appError = document.getElementById('app');
                if (appError) appError.classList.remove('compact-action-mode');
                if (face) face.transitionTo('neutral', 400);
                setTimeout(hideCompactPopup, 3000);
                break;
            case 'stopped':
                document.getElementById('loading-overlay').classList.add('hidden');
                showCompactPopup('Detenido');
                const appStopped = document.getElementById('app');
                if (appStopped) appStopped.classList.remove('compact-action-mode');
                if (face) face.transitionTo('neutral', 400);
                setTimeout(hideCompactPopup, 2000);
                break;
        }
    });
}

// 🎓 Listen for Learning Mode updates
if (window.iuOS && window.iuOS.onLearningStatus) {
    window.iuOS.onLearningStatus((data) => {
        console.log('[App] Learning status:', data);
        if (data.active) {
            if (face) face.transitionTo('thinking', 600);
            document.body.classList.add('learning-mode');
        } else {
            if (face) face.transitionTo('smile', 800);
            document.body.classList.remove('learning-mode');
        }
    });
}

// 🌐 Listen for Browser Agent status
if (window.iuOS && window.iuOS.onBrowserAgentStatus) {
    window.iuOS.onBrowserAgentStatus((data) => {
        console.log('[App] Browser Agent status:', data);
        if (data.message) {
            showCompactPopup(data.message);
            if (data.phase === 'ready') {
                if (face) {
                    face.transitionTo('smile', 600);
                    face.setEyeColor('#00ffcc'); // Color especial para modo browser/AgarIO
                }
            } else if (data.phase === 'active') {
                if (face) face.transitionTo('thinking', 600);
            }
            setTimeout(hideCompactPopup, 4000);
        }
    });
}

// Helper functions for compact popup
function showCompactPopup(message) {
    const popup = document.getElementById('compact-popup');
    if (popup) {
        popup.textContent = message;
        popup.classList.add('visible');
    }
}

function hideCompactPopup() {
    const popup = document.getElementById('compact-popup');
    if (popup) {
        popup.classList.remove('visible');
    }
}

function showActionConfirmation(plan) {
    // Remove existing confirmation if any
    const existing = document.getElementById('action-confirmation');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'action-confirmation';
    overlay.style.cssText = `
        position: fixed; bottom: 80px; left: 10px; right: 10px;
        background: rgba(0, 0, 0, 0.85); border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px; padding: 14px; z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        backdrop-filter: blur(10px);
        -webkit-app-region: no-drag; pointer-events: auto;
    `;

    overlay.innerHTML = `
        <div style="color: #aaa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
            ${plan.source === 'explicit' ? '🗣️ Acción detectada' : '🧠 Sugerencia confirmada'}
        </div>
        <div style="color: #fff; font-size: 13px; font-weight: 500; margin-bottom: 4px;">
            ${plan.goal}
        </div>
        <div style="color: #888; font-size: 11px; margin-bottom: 12px;">
            📱 ${plan.app}
        </div>
        <div style="display: flex; gap: 8px;">
            <button id="action-confirm-btn" style="
                flex: 1; padding: 8px; border: none; border-radius: 8px;
                background: #00d4ff; color: #000; font-weight: 600; font-size: 12px;
                cursor: pointer; -webkit-app-region: no-drag; pointer-events: auto;
            ">Ejecutar</button>
            <button id="action-cancel-btn" style="
                flex: 1; padding: 8px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px;
                background: transparent; color: #888; font-size: 12px;
                cursor: pointer; -webkit-app-region: no-drag; pointer-events: auto;
            ">Cancelar</button>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('action-confirm-btn').addEventListener('click', () => {
        overlay.remove();
        if (pendingActionPlan && window.iuOS && window.iuOS.confirmAction) {
            window.iuOS.confirmAction(pendingActionPlan);
            pendingActionPlan = null;
        }
    });

    document.getElementById('action-cancel-btn').addEventListener('click', () => {
        overlay.remove();
        pendingActionPlan = null;
        showToast('Acción cancelada');
    });

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        if (document.getElementById('action-confirmation')) {
            overlay.remove();
            pendingActionPlan = null;
        }
    }, 15000);
}

// ============================================
// Voice & Gaze Control Logic
// ============================================

let lastInteractionTime = Date.now();
const WAKE_FUSION_WINDOW_MS = 700;
let lastHeyAt = 0;
let lastWaveAt = 0;

function triggerWakeFusion(source) {
    if (conversationState === 'active') {
        lastInteractionTime = Date.now();
        return;
    }

    console.log(`🧩 [WakeFusion] Activated by ${source}`);
    if (face) {
        face.transitionTo('listening');
        setTimeout(() => {
            if (conversationState === 'idle') face.transitionTo('thinking');
        }, 900);
    }
    toggleConversation();
    showToast('🗣️ Escuchando...');
}

function evaluateWakeFusion(source) {
    const now = Date.now();
    const hasHey = now - lastHeyAt <= WAKE_FUSION_WINDOW_MS;
    const hasWave = now - lastWaveAt <= WAKE_FUSION_WINDOW_MS;
    if (hasHey && hasWave) {
        triggerWakeFusion(source);
        lastHeyAt = 0;
        lastWaveAt = 0;
    }
}

function handleWakeWord(type, text) {
    if (conversationState === 'active') {
        // If already active, just reset timer
        lastInteractionTime = Date.now();
        return;
    }

    console.log(`🎤 [App] Handle Wake Word: ${type} ("${text}")`);

    if (type === 'hey') {
        lastHeyAt = Date.now();
        evaluateWakeFusion('voice+gesture');
        return;
    }

    // 1. Global Activation
    if (type === 'global') {
        toggleConversation();
        showToast('🗣️ Escuchando...');
        return;
    }

    // 2. Gated Activation (Check Gaze)
    if (type === 'gated') {
        // Reuse VisionManager state
        if (visionManager && visionManager.state.isAttentive) {
            console.log('👁️ [App] Gaze Confirmation: PASS');
            if (face) {
                face.transitionTo('listening');
                setTimeout(() => face.transitionTo('thinking'), 1000);
            }
            toggleConversation();
            showToast('🗣️ Escuchando...');
        } else {
            console.log('👁️ [App] Gaze Confirmation: FAIL (Not looking)');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTURE STATE MACHINE
// Prevents gesture cross-contamination via exclusive state ownership.
//
//  States
//  ──────
//  IDLE      evaluating — no gesture locked in
//  PINCHING  pinch drag is active (highest priority — blocks all hold gestures)
//  FIST      strict fist held (exclusive vs PALM)
//  PALM      open palm held   (exclusive vs FIST)
//
//  Transition map
//  ──────────────
//  IDLE      → PINCHING   when pinchActive && !fistCooldown
//  IDLE      → FIST       when strictFist && !palmOpen && !pinchActive && !fistCooldown
//  IDLE      → PALM       when palmOpen && !strictFist && !pinchActive
//  PINCHING  → IDLE       when !pinchActive
//  FIST      → IDLE       when !strictFist || pinchActive  (cancels timers)
//  PALM      → IDLE       when !palmOpen   || pinchActive  (cancels timers)
//
//  FIST escalation (peldaños):
//    voice active  → hold 2 s → stop voice → reset to IDLE + cooldown 1.2 s
//    (after cooldown, re-closing fist for 0.8 s → sleep)
//    voice idle    → hold 0.8 s → sleep
//
//  PALM action:
//    voice idle    → hold 2 s → start voice
//
//  TRIPLE PINCH (new):
//    3 quick pinch taps (each < 400 ms) within 900 ms → activate voice
// ═══════════════════════════════════════════════════════════════════════════

const GM = Object.freeze({ IDLE: 'idle', PINCHING: 'pinching', FIST: 'fist', PALM: 'palm' });
let gestureMode = GM.IDLE;
let gm_fistTimer = null;
let gm_palmTimer = null;

// Cooldown flag: blocks FIST from re-engaging for 1.2 s after voice is stopped
// by fist — prevents accidental immediate sleep after ending a call.
let fistCooldown = false;
let fistCooldownTimer = null;

function gm_startFistCooldown() {
    fistCooldown = true;
    if (fistCooldownTimer) clearTimeout(fistCooldownTimer);
    fistCooldownTimer = setTimeout(() => {
        fistCooldown = false;
        fistCooldownTimer = null;
    }, 1200);
}
function gm_cancelFist() {
    if (gm_fistTimer) { clearTimeout(gm_fistTimer); gm_fistTimer = null; }
}
function gm_cancelPalm() {
    if (gm_palmTimer) { clearTimeout(gm_palmTimer); gm_palmTimer = null; }
}

async function doGestureSleep() {
    try { new Audio('assets/sleep.mp3').play().catch(() => { }); } catch (_) { }
    await new Promise(r => setTimeout(r, 80));
    window.iuOS?.gestureSleep?.();
}

// ── Triple-pinch tap detector ─────────────────────────────────────────────────
// 3 quick taps (pinch-on then off in < PINCH_TAP_MAX_MS each)
// within TRIPLE_PINCH_WINDOW ms → activate voice.
const PINCH_TAP_MAX_MS = 400;  // longer hold = drag, not a tap
const TRIPLE_PINCH_WINDOW = 900;  // window for 3 taps to count

let prevPinchActive = false;
let pinchHeldSince = null;   // timestamp when current pinch tap started
let pinchTapCount = 0;
let pinchTapTimer = null;
// ─────────────────────────────────────────────────────────────────────────────

if (window.iuOS && window.iuOS.onHandsFrame) {
    window.iuOS.onHandsFrame((payload) => {
        if (!payload) return;

        // 🛑 PREVENT CROSS-CONTAMINATION: Disable hand gestures (Electron window controls)
        // when the user is engaged in non-verbal facial conversation with Ü (Deep Attention).
        if (typeof visionManager !== 'undefined' && visionManager && visionManager.state.inDeepAttention) {
            // Reset hand states so it doesn't get stuck if they looked away mid-gesture
            prevPinchActive = false;
            gestureMode = GM.IDLE;
            return;
        }

        const pinchActive = !!payload.pinchActive;
        const strictFist = !!payload.strictFist;
        const palmOpen = !!payload.palmOpen;

        // ── Triple-pinch tap detection (runs before state machine) ────────
        if (pinchActive && !prevPinchActive) {
            // Rising edge: pinch just closed
            pinchHeldSince = Date.now();
        }
        if (!pinchActive && prevPinchActive) {
            // Falling edge: pinch just released — check if it was a tap
            const duration = Date.now() - (pinchHeldSince || 0);
            pinchHeldSince = null;

            if (duration < PINCH_TAP_MAX_MS) {
                // Quick tap detected
                pinchTapCount++;
                if (pinchTapTimer) clearTimeout(pinchTapTimer);

                if (pinchTapCount >= 3) {
                    // ✅ Triple pinch! — activate voice
                    pinchTapCount = 0;
                    console.log('🤏🤏🤏 [Triple Pinch] Activating voice');
                    if (conversationState === 'idle' && gestureMode === GM.IDLE) {
                        if (face) {
                            face.transitionTo('listening');
                            setTimeout(() => {
                                if (conversationState === 'idle') face.transitionTo('thinking');
                            }, 900);
                        }
                        toggleConversation();
                    }
                } else {
                    // Wait for more taps within the window
                    pinchTapTimer = setTimeout(() => {
                        pinchTapCount = 0;
                        pinchTapTimer = null;
                    }, TRIPLE_PINCH_WINDOW);
                }
            } else {
                // It was a hold/drag — reset tap count
                pinchTapCount = 0;
                if (pinchTapTimer) { clearTimeout(pinchTapTimer); pinchTapTimer = null; }
            }
        }
        prevPinchActive = pinchActive;
        // ─────────────────────────────────────────────────────────────────

        // Wake-fusion (HeyÜ): only natural in IDLE/PALM contexts
        if ((gestureMode === GM.IDLE || gestureMode === GM.PALM) &&
            (payload.waveGesture || palmOpen)) {
            lastWaveAt = Date.now();
            evaluateWakeFusion('gesture+voice');
        }

        // ── State machine ─────────────────────────────────────────────────
        switch (gestureMode) {

            // ──────────────────────────────────────────────────────────────
            case GM.IDLE: {
                if (pinchActive) {
                    // Pinch drag takes absolute priority
                    gestureMode = GM.PINCHING;

                } else if (strictFist && !palmOpen && !fistCooldown) {
                    // Begin FIST hold — start escalation ladder
                    gestureMode = GM.FIST;

                    if (conversationState === 'active') {
                        // Peldaño 1: stop voice after 2 s
                        gm_fistTimer = setTimeout(async () => {
                            gm_fistTimer = null;
                            if (gestureMode !== GM.FIST) return; // guard
                            await toggleConversation();           // stop voice

                            // After stopping voice: reset to IDLE and apply cooldown.
                            // The user must release + re-close fist for sleep.
                            // This prevents accidental immediate window hide after ending call.
                            gm_cancelFist();
                            gestureMode = GM.IDLE;
                            gm_startFistCooldown();
                        }, 2000);

                    } else {
                        // Voice idle → sleep after 0.8 s
                        gm_fistTimer = setTimeout(() => {
                            gm_fistTimer = null;
                            if (gestureMode === GM.FIST) doGestureSleep();
                        }, 800);
                    }

                } else if (palmOpen && !strictFist && conversationState === 'idle') {
                    // Begin PALM hold — but NO automatic voice activation
                    // Must be combined with 'hey' via WakeFusion to activate voice mode
                    gestureMode = GM.PALM;
                }
                break;
            }

            // ──────────────────────────────────────────────────────────────
            case GM.PINCHING: {
                // Pinch mode: ALL hold-gestures blocked.
                // Only exit back to IDLE when drag is released.
                if (!pinchActive) {
                    gestureMode = GM.IDLE;
                }
                break;
            }

            // ──────────────────────────────────────────────────────────────
            case GM.FIST: {
                // Exit FIST if fist breaks OR pinch starts
                if (!strictFist || pinchActive) {
                    gm_cancelFist();
                    gestureMode = GM.IDLE;
                }
                // PALM gestures are completely blocked here
                break;
            }

            // ──────────────────────────────────────────────────────────────
            case GM.PALM: {
                // Exit PALM if palm breaks OR pinch starts
                if (!palmOpen || pinchActive) {
                    gm_cancelPalm();
                    gestureMode = GM.IDLE;
                }
                // FIST gestures are completely blocked here
                break;
            }
        }
        // ─────────────────────────────────────────────────────────────────
    });
}

// ── Wake sound (triggered by main.js just before showing the window) ─────────
if (window.iuOS && window.iuOS.onGestureWakeSound) {
    window.iuOS.onGestureWakeSound(() => {
        try { new Audio('assets/wake.mp3').play().catch(() => { }); } catch (_) { }
    });
}
// ═══════════════════════════════════════════════════════════════════════════

// Inactivity Monitor (Auto-Stop)
// Inactivity Monitor (DISABLED by user request)
// setInterval(() => {
//     if (conversationState !== 'active') return;
//     const now = Date.now();
//     if (visionManager && visionManager.state.isAttentive) {
//         lastInteractionTime = now;
//         return;
//     }
//     // Timeout disabled.
// }, 1000);

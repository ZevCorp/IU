/**
 * Ü Phone Remote — phone.js
 *
 * Exact replica of the Electron app's Face renderer (app.js: PRESETS, bezier functions,
 * Face class, blink, transitionTo), plus the WebSocket bridge to the Mac.
 *
 * Interactions:
 *  - Long-press on face → voice recording (MediaRecorder) → phone_voice
 *  - Chat modal → text → phone_chat
 *  - Hablar button  → same as long-press (tap for toggle)
 *  - Menu toggle    → shows connection status panel
 */

console.log('📱 Ü Phone Remote starting...');

// =====================================================
// Bezier Utilities — EXACT copy from app.js
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
    const startY = baseY - height;
    const endY = baseY - height;
    const controlX = baseX;
    const controlY = baseY - height - (curve * 15);
    return quadraticBezier({ x: startX, y: startY }, { x: controlX, y: controlY }, { x: endX, y: endY });
}

function generateEyePaths(centerX, centerY, openness) {
    const lineHeight = 25 * openness;
    const verticalOffset = lineHeight / 2;
    const line = verticalLine({ x: centerX, y: centerY - verticalOffset }, Math.max(0, lineHeight));
    return { line };
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
// PRESETS — EXACT copy from app.js
// =====================================================
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
    listening: {
        eyeOpenness: 1.15, eyeSquint: -0.05, leftBrowHeight: 8, rightBrowHeight: 8, leftBrowCurve: 0.5, rightBrowCurve: 0.5,
        mouthCurve: 0.9, mouthWidth: 1.1, leftCornerHeight: 0.3, rightCornerHeight: 0.3, mouthOpenness: 0.05,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 0
    },
    happy: {
        eyeOpenness: 1.1, eyeSquint: -0.1, leftBrowHeight: 5, rightBrowHeight: 5, leftBrowCurve: 0.6, rightBrowCurve: 0.6,
        mouthCurve: 0.8, mouthWidth: 1.1, leftCornerHeight: 0.5, rightCornerHeight: 0.5, mouthOpenness: 0.1,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 5
    },
    action_complete: {
        eyeOpenness: 0.90, eyeSquint: 0.10, leftBrowHeight: 3, rightBrowHeight: 3, leftBrowCurve: 0.3, rightBrowCurve: 0.3,
        mouthCurve: 0.75, mouthWidth: 1.05, leftCornerHeight: 0.3, rightCornerHeight: 0.3, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 0
    },
    idle: {
        eyeOpenness: 0.88, eyeSquint: 0.12, leftBrowHeight: -0.5, rightBrowHeight: 3, leftBrowCurve: 0.15, rightBrowCurve: 0.45,
        mouthCurve: 0.55, mouthWidth: 0.95, leftCornerHeight: 0.05, rightCornerHeight: 0.45, mouthOpenness: 0,
        leftEyeOpenness: -1, rightEyeOpenness: -1, headTilt: 4
    }
};

// =====================================================
// Face Class — EXACT copy from app.js
// =====================================================
class Face {
    constructor() {
        this.leftEyebrow = document.getElementById('left-eyebrow');
        this.rightEyebrow = document.getElementById('right-eyebrow');
        this.leftEyeLine = document.getElementById('left-eye-line');
        this.rightEyeLine = document.getElementById('right-eye-line');
        this.mouth = document.getElementById('mouth');

        this.gazeX = 0;
        this.gazeY = 0;
        this.targetZone = 'center';
        this.currentState = { ...PRESETS.smile };
        this.render();
        this.startBlink();
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
        const carousel = document.getElementById('intent-carousel');
        if (preset === 'thinking') {
            if (carousel) carousel.classList.remove('hidden');
        } else {
            if (carousel) carousel.classList.add('hidden');
        }
    }

    render() {
        let s = { ...this.currentState };
        let rotationY = s.headTilt || 0;

        if (this.targetZone === 'center') {
            rotationY = 0;
            if (s.headTilt > 0) {
                s.leftBrowHeight = 12;
                s.rightBrowHeight = 12;
                s.leftBrowCurve = 0.7;
                s.rightBrowCurve = 0.7;
            }
        }

        const group = document.getElementById('face-group');
        if (group) {
            group.style.transform = `translate(200px, 250px) rotateY(${rotationY * 2.5}deg) rotateZ(${rotationY * 0.5}deg)`;
            group.style.transformOrigin = 'center';
            group.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
        }

        if (this.leftEyebrow)
            this.leftEyebrow.setAttribute('d', generateEyebrowPath(-55, -55, 35, s.leftBrowHeight, s.leftBrowCurve, false));
        if (this.rightEyebrow)
            this.rightEyebrow.setAttribute('d', generateEyebrowPath(55, -55, 35, s.rightBrowHeight, s.rightBrowCurve, true));

        const leftOpenness = s.leftEyeOpenness >= 0 ? s.leftEyeOpenness : s.eyeOpenness;
        const leftPaths = generateEyePaths(-55 + this.gazeX, -25 + this.gazeY, leftOpenness * (1 - s.eyeSquint * 0.4));
        if (this.leftEyeLine) this.leftEyeLine.setAttribute('d', leftPaths.line);

        const rightOpenness = s.rightEyeOpenness >= 0 ? s.rightEyeOpenness : s.eyeOpenness;
        const rightPaths = generateEyePaths(55 + this.gazeX, -25 + this.gazeY, rightOpenness * (1 - s.eyeSquint * 0.4));
        if (this.rightEyeLine) this.rightEyeLine.setAttribute('d', rightPaths.line);

        if (this.mouth)
            this.mouth.setAttribute('d', generateMouthPath(0, 50, 60 * s.mouthWidth, s.mouthCurve, s.leftCornerHeight, s.rightCornerHeight, s.mouthOpenness));
    }

    blink() {
        if (this.currentState.eyeOpenness === 0 && this.currentState.leftEyeOpenness === 0) return;
        const origLeft = this.currentState.leftEyeOpenness;
        const origRight = this.currentState.rightEyeOpenness;
        const origMain = this.currentState.eyeOpenness;
        this.currentState.eyeOpenness = 0;
        this.currentState.leftEyeOpenness = 0;
        this.currentState.rightEyeOpenness = 0;
        this.render();
        setTimeout(() => {
            this.currentState.eyeOpenness = origMain >= 0 ? origMain : 1;
            this.currentState.leftEyeOpenness = origLeft;
            this.currentState.rightEyeOpenness = origRight;
            this.render();
        }, 100);
    }

    startBlink() {
        setInterval(() => {
            if (this.currentState.eyeOpenness > 0.1 && Math.random() > 0.7) {
                this.blink();
            }
        }, 2500);
    }

    lookAt(x, y) {
        const range = 8;
        this.gazeX = (x - 0.5) * range;
        this.gazeY = (y - 0.5) * range;
        this.render();
    }
}

// =====================================================
// WebSocket Connection
// =====================================================
let ws = null;
let wsConnected = false;
let deviceId = 'phone-' + Date.now().toString(36);
let roomId = null;
let serverUrl = null;

function initConnection() {
    const params = new URLSearchParams(window.location.search);
    roomId = params.get('room');
    serverUrl = params.get('server') || 'wss://iu-rw9m.onrender.com';

    if (!roomId || !serverUrl) {
        updateConnectionStatus(false, 'Parámetros faltantes');
        return;
    }

    connectWS();
}

function connectWS() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;

    try {
        ws = new WebSocket(serverUrl);
    } catch (e) {
        console.error('[Phone] WS error:', e);
        setTimeout(connectWS, 5000);
        return;
    }

    ws.onopen = () => {
        console.log('[Phone] ✅ Connected');
        wsConnected = true;
        updateConnectionStatus(true);

        // Register & join room
        send({ type: 'register', deviceId, payload: { deviceType: 'phone', roomId } });
        send({ type: 'join_room', deviceId, payload: { roomId } });

        // Request context
        send({ type: 'context_request', deviceId });

        // Face: smile on connect
        face.transitionTo('smile', 600);
    };

    ws.onmessage = (event) => {
        try {
            handleWsMessage(JSON.parse(event.data));
        } catch (e) {
            console.error('[Phone] Parse error:', e);
        }
    };

    ws.onclose = () => {
        console.log('[Phone] Disconnected. Reconnecting...');
        wsConnected = false;
        updateConnectionStatus(false, 'Reconectando...');
        setTimeout(connectWS, 4000);
    };

    ws.onerror = () => {
        // close event handles reconnect
    };
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...msg, timestamp: Date.now() }));
    }
}

// =====================================================
// WS Message Handler
// =====================================================
function handleWsMessage(msg) {
    if (msg.deviceId === deviceId) return;

    switch (msg.type) {
        case 'phone_reply':
            handlePhoneReply(msg.payload);
            break;

        case 'face_state':
            if (msg.payload?.state) setFaceState(msg.payload.state);
            break;

        case 'context_sync':
            if (msg.payload?.history) loadHistory(msg.payload.history);
            break;

        case 'pong':
            break;
    }
}

function handlePhoneReply(payload) {
    stopTyping();
    setFaceState('idle');

    if (payload?.error) {
        addMessage('system', `Error: ${payload.error}`);
        return;
    }

    if (payload?.reply) {
        addMessage('assistant', payload.reply);
        showTranscript(payload.reply);
    }

    if (payload?.action) {
        const a = payload.action;
        addMessage('system', `⚡ ${a.goal}${a.app ? ` en ${a.app}` : ''}`);
    }
}

function loadHistory(history) {
    if (!Array.isArray(history) || history.length === 0) return;
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';

    history.slice(-30).forEach(h => {
        if (h.role === 'user' || h.role === 'assistant') {
            addMessage(h.role, h.content, false);
        }
    });
}

// =====================================================
// Face State — maps to PRESETS
// =====================================================
let currentFaceState = 'idle';

function setFaceState(state) {
    if (currentFaceState === state) return;
    currentFaceState = state;

    const container = document.getElementById('face-container');

    // Remove old state classes
    container.classList.remove('listening', 'thinking', 'executing');

    const voiceBtn = document.getElementById('btn-voice');
    const voiceLabel = document.getElementById('voice-label');

    switch (state) {
        case 'listening':
            face.transitionTo('listening', 500);
            container.classList.add('listening');
            if (voiceBtn) voiceBtn.classList.add('active-conversation');
            if (voiceLabel) voiceLabel.textContent = 'Escuchando...';
            break;

        case 'thinking':
            face.transitionTo('thinking', 400);
            container.classList.add('thinking');
            if (voiceBtn) voiceBtn.classList.remove('active-conversation', 'recording');
            if (voiceLabel) voiceLabel.textContent = 'Pensando...';
            break;

        case 'executing':
            face.transitionTo('mild_attention', 400);
            container.classList.add('executing');
            if (voiceBtn) voiceBtn.classList.remove('active-conversation', 'recording');
            if (voiceLabel) voiceLabel.textContent = 'Ejecutando...';
            break;

        case 'idle':
        default:
            face.transitionTo('smile', 500);
            if (voiceBtn) {
                voiceBtn.classList.remove('active-conversation', 'recording');
            }
            if (voiceLabel) voiceLabel.textContent = 'Hablar';
            break;
    }
}

// =====================================================
// Transcript display (same as Electron)
// =====================================================
let transcriptTimeout = null;

function showTranscript(text) {
    const container = document.getElementById('transcript-container');
    const el = document.getElementById('transcript-text');
    if (!container || !el) return;

    // Word-by-word fade, same as Electron
    const words = text.split(' ');
    el.innerHTML = words.map((w, i) =>
        `<span class="word-fade" style="animation-delay:${i * 0.06}s">${w}</span>`
    ).join(' ');

    container.classList.remove('hidden');

    if (transcriptTimeout) clearTimeout(transcriptTimeout);
    transcriptTimeout = setTimeout(() => {
        container.classList.add('hidden');
    }, Math.max(3000, text.length * 50));
}

// =====================================================
// Long-press on face → Voice Recording
// =====================================================
let pressTimer = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

const LONG_PRESS_MS = 500;

function setupFaceLongPress() {
    const container = document.getElementById('face-container');
    if (!container) return;

    // Touch
    container.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startPressTimer();
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
        e.preventDefault();
        clearPressTimer();
        if (isRecording) stopVoiceRecording();
    }, { passive: false });

    container.addEventListener('touchcancel', (e) => {
        clearPressTimer();
        if (isRecording) stopVoiceRecording();
    }, { passive: false });

    // Mouse (desktop testing)
    container.addEventListener('mousedown', () => startPressTimer());
    container.addEventListener('mouseup', () => { clearPressTimer(); if (isRecording) stopVoiceRecording(); });
    container.addEventListener('mouseleave', () => { clearPressTimer(); if (isRecording) stopVoiceRecording(); });
}

function startPressTimer() {
    if (pressTimer) clearTimeout(pressTimer);
    const container = document.getElementById('face-container');
    if (container) container.classList.add('press-active');

    pressTimer = setTimeout(() => {
        if (container) container.classList.remove('press-active');
        startVoiceRecording();
    }, LONG_PRESS_MS);
}

function clearPressTimer() {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
    const container = document.getElementById('face-container');
    if (container) container.classList.remove('press-active');
}

async function startVoiceRecording() {
    if (isRecording) return;

    if (!wsConnected) {
        showTranscript('Sin conexión al Mac');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            sendVoiceBlob(blob);
        };

        mediaRecorder.start();
        isRecording = true;

        setFaceState('listening');

        const voiceBtn = document.getElementById('btn-voice');
        if (voiceBtn) voiceBtn.classList.add('recording');

        const voiceLabel = document.getElementById('voice-label');
        if (voiceLabel) voiceLabel.textContent = 'Soltá para enviar';

    } catch (e) {
        console.error('[Phone] Mic error:', e);
        showTranscript('No se pudo acceder al micrófono');
    }
}

function stopVoiceRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;

    const voiceBtn = document.getElementById('btn-voice');
    if (voiceBtn) voiceBtn.classList.remove('recording');

    setFaceState('thinking');

    try {
        mediaRecorder.stop();
    } catch (e) { /* ignore */ }
    mediaRecorder = null;
}

function sendVoiceBlob(blob) {
    const reader = new FileReader();
    reader.onloadend = () => {
        send({
            type: 'phone_voice',
            deviceId,
            payload: { audio: reader.result }
        });
        startTyping();
    };
    reader.readAsDataURL(blob);
}

// =====================================================
// "Hablar" button (transfer-btn-top) — tap toggle
// =====================================================
function setupVoiceButton() {
    const btn = document.getElementById('btn-voice');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (isRecording) {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    });
}

// =====================================================
// Chat
// =====================================================
function setupChat() {
    const toggleBtn = document.getElementById('btn-chat-toggle');
    const overlay = document.getElementById('chat-overlay');
    const closeBtn = document.getElementById('chat-close');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');

    if (!toggleBtn || !overlay) return;

    toggleBtn.addEventListener('click', () => {
        overlay.classList.toggle('hidden');
        if (!overlay.classList.contains('hidden')) {
            setTimeout(() => input && input.focus(), 350);
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    }

    // Close on overlay backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });

    if (input) {
        input.addEventListener('input', () => {
            if (sendBtn) sendBtn.disabled = !input.value.trim();
            // Auto-grow
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendChat());
    }
}

function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;

    const text = input.value.trim();
    if (!text || !wsConnected) return;

    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';

    const sendBtn = document.getElementById('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    // Close transcript if open
    const transcript = document.getElementById('transcript-container');
    if (transcript) transcript.classList.add('hidden');

    startTyping();
    setFaceState('thinking');

    send({ type: 'phone_chat', deviceId, payload: { text } });
}

function addMessage(role, text, scroll = true) {
    const container = document.getElementById('messages');
    if (!container) return;

    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';

    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    container.appendChild(div);

    if (scroll) {
        setTimeout(() => container.scrollTop = container.scrollHeight, 50);
    }
}

function startTyping() {
    const t = document.getElementById('typing');
    if (t) t.classList.add('visible');
}

function stopTyping() {
    const t = document.getElementById('typing');
    if (t) t.classList.remove('visible');
}

// =====================================================
// Menu Toggle — shows controls panel
// =====================================================
function setupMenu() {
    const menuBtn = document.getElementById('menu-toggle');
    const panel = document.getElementById('controls-panel');
    if (!menuBtn || !panel) return;

    menuBtn.addEventListener('click', () => {
        const isOpen = !panel.classList.contains('collapsed');
        panel.classList.toggle('collapsed', isOpen);
        menuBtn.classList.toggle('active', !isOpen);
    });
}

// =====================================================
// Connection Status UI
// =====================================================
function updateConnectionStatus(connected, label) {
    const indicator = document.getElementById('sync-indicator');
    const text = document.getElementById('sync-status-text');

    if (indicator) indicator.classList.toggle('active', connected);
    if (text) text.textContent = connected ? 'Conectado' : (label || 'Desconectado');
}

// =====================================================
// Init
// =====================================================
let face;

document.addEventListener('DOMContentLoaded', () => {
    face = new Face();

    setupFaceLongPress();
    setupVoiceButton();
    setupChat();
    setupMenu();
    initConnection();

    // Start with smile
    face.transitionTo('smile', 600);
});

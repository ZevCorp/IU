/**
 * Phone Remote Client – WebSocket bridge to Mac's Ü
 * Handles: chat, long-press voice, face state sync, context sync
 */

(function () {
    'use strict';

    // ══════════════════════════════════════════
    // 1. Parse connection params from URL
    // ══════════════════════════════════════════
    const params = new URLSearchParams(window.location.search);
    const serverUrl = params.get('server') || `ws://${window.location.hostname}:3001`;
    const roomId = params.get('room') || 'default';
    const deviceId = 'phone_' + Math.random().toString(36).substr(2, 8);

    // ══════════════════════════════════════════
    // 2. DOM references
    // ══════════════════════════════════════════
    const faceContainer = document.getElementById('face-container');
    const faceStatus = document.getElementById('face-status');
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');
    const messagesEl = document.getElementById('messages');
    const welcomeEl = document.getElementById('welcome');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const typingEl = document.getElementById('typing');
    const voiceToggle = document.getElementById('voice-toggle');

    // ══════════════════════════════════════════
    // 3. WebSocket connection
    // ══════════════════════════════════════════
    let ws = null;
    let reconnectTimer = null;
    let isConnected = false;

    function connect() {
        if (ws && ws.readyState <= 1) return;
        console.log('[Phone] Connecting to', serverUrl);
        setConnectionStatus(false, 'Connecting...');

        try {
            ws = new WebSocket(serverUrl);
        } catch (e) {
            console.error('[Phone] WebSocket error:', e);
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            console.log('[Phone] Connected!');
            isConnected = true;
            setConnectionStatus(true, 'Connected to Mac');

            // Register device
            send({
                type: 'register',
                deviceId,
                payload: { deviceType: 'phone', roomId }
            });

            // Join room
            send({
                type: 'join_room',
                deviceId,
                payload: { roomId }
            });

            // Request conversation context
            setTimeout(() => {
                send({ type: 'context_request', deviceId, payload: {} });
            }, 500);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('[Phone] Parse error:', e);
            }
        };

        ws.onclose = () => {
            isConnected = false;
            setConnectionStatus(false, 'Disconnected');
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.error('[Phone] WS error:', err);
        };
    }

    function send(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ...msg, timestamp: Date.now() }));
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, 3000);
    }

    function setConnectionStatus(connected, text) {
        connectionDot.classList.toggle('connected', connected);
        connectionText.textContent = text;
    }

    // ══════════════════════════════════════════
    // 4. Message handling
    // ══════════════════════════════════════════
    function handleMessage(msg) {
        if (msg.deviceId === deviceId) return; // Ignore own

        switch (msg.type) {
            case 'phone_reply':
                typingEl.classList.remove('visible');
                if (msg.payload.reply) {
                    addMessage(msg.payload.reply, 'assistant');
                }
                if (msg.payload.action) {
                    addMessage(`⚡ Ejecutando: ${msg.payload.action.goal} → ${msg.payload.action.app}`, 'action');
                    setFaceState('executing');
                }
                if (msg.payload.error) {
                    addMessage(`Error: ${msg.payload.error}`, 'system');
                }
                // Return to idle after reply
                if (!msg.payload.action) {
                    setFaceState('idle');
                }
                break;

            case 'face_state':
                if (msg.payload && msg.payload.state) {
                    setFaceState(msg.payload.state);
                }
                break;

            case 'context_sync':
                // Load conversation history
                if (msg.payload && msg.payload.history) {
                    loadContextHistory(msg.payload.history);
                }
                break;

            case 'action_status':
                if (msg.payload) {
                    if (msg.payload.status === 'executing') {
                        setFaceState('executing');
                    } else if (msg.payload.status === 'done') {
                        setFaceState('idle');
                        if (msg.payload.summary) {
                            addMessage(`✓ ${msg.payload.summary}`, 'system');
                        }
                    }
                }
                break;

            case 'registered':
            case 'register':
            case 'pong':
                // Ignore silently
                break;

            default:
                console.log('[Phone] Unhandled:', msg.type);
        }
    }

    // ══════════════════════════════════════════
    // 5. Chat
    // ══════════════════════════════════════════
    function sendChat() {
        const text = inputEl.value.trim();
        if (!text || !isConnected) return;

        if (welcomeEl) welcomeEl.style.display = 'none';
        addMessage(text, 'user');

        // Send to Mac via WebSocket
        send({
            type: 'phone_chat',
            deviceId,
            payload: { text }
        });

        inputEl.value = '';
        inputEl.style.height = 'auto';
        sendBtn.disabled = true;
        typingEl.classList.add('visible');
        setFaceState('thinking');
    }

    sendBtn.addEventListener('click', sendChat);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
        sendBtn.disabled = !inputEl.value.trim();
    });

    function addMessage(text, role) {
        const msg = document.createElement('div');
        msg.className = `message ${role}`;
        msg.textContent = text;
        messagesEl.appendChild(msg);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function loadContextHistory(history) {
        if (!history || !history.length) return;
        if (welcomeEl) welcomeEl.style.display = 'none';

        // Clear existing messages
        while (messagesEl.firstChild) {
            if (messagesEl.firstChild === welcomeEl) {
                messagesEl.firstChild.style.display = 'none';
                break;
            }
            messagesEl.removeChild(messagesEl.firstChild);
        }

        history.forEach(msg => {
            if (msg.text) {
                addMessage(msg.text, msg.role);
            }
        });
    }

    // ══════════════════════════════════════════
    // 6. Long-press voice recording
    // ══════════════════════════════════════════
    let longPressTimer = null;
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];

    function startLongPress() {
        longPressTimer = setTimeout(() => {
            startVoiceRecording();
        }, 500);
    }

    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        if (isRecording) {
            stopVoiceRecording();
        }
    }

    async function startVoiceRecording() {
        if (isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(t => t.stop());

                if (blob.size > 1000) {
                    sendVoiceMessage(blob);
                }
            };

            mediaRecorder.start();
            isRecording = true;
            faceContainer.classList.add('listening');
            setFaceState('listening');

            // Haptic feedback if available
            if (navigator.vibrate) navigator.vibrate(30);
        } catch (e) {
            console.error('[Phone] Mic error:', e);
            addMessage('No se pudo acceder al micrófono', 'system');
        }
    }

    function stopVoiceRecording() {
        if (!isRecording || !mediaRecorder) return;
        isRecording = false;
        faceContainer.classList.remove('listening');

        if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        setFaceState('thinking');
        typingEl.classList.add('visible');
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
    }

    async function sendVoiceMessage(blob) {
        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result;
            addMessage('🎤 Mensaje de voz', 'user');

            send({
                type: 'phone_voice',
                deviceId,
                payload: { audio: base64Audio }
            });
        };
        reader.readAsDataURL(blob);
    }

    // Touch events for long-press on face
    faceContainer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startLongPress();
    }, { passive: false });

    faceContainer.addEventListener('touchend', cancelLongPress);
    faceContainer.addEventListener('touchcancel', cancelLongPress);

    // Mouse fallback for testing
    faceContainer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startLongPress();
    });
    faceContainer.addEventListener('mouseup', cancelLongPress);
    faceContainer.addEventListener('mouseleave', cancelLongPress);

    // ══════════════════════════════════════════
    // 7. Voice toggle (activate Mac voice mode)
    // ══════════════════════════════════════════
    let macVoiceActive = false;

    voiceToggle.addEventListener('click', () => {
        macVoiceActive = !macVoiceActive;
        voiceToggle.classList.toggle('active', macVoiceActive);

        send({
            type: 'phone_voice_toggle',
            deviceId,
            payload: { action: macVoiceActive ? 'start' : 'stop' }
        });
    });

    // ══════════════════════════════════════════
    // 8. Face state management
    // ══════════════════════════════════════════
    const FACE = {
        leftEyeTop: document.getElementById('left-eye-top'),
        leftEyeLine: document.getElementById('left-eye-line'),
        leftEyeBottom: document.getElementById('left-eye-bottom'),
        rightEyeTop: document.getElementById('right-eye-top'),
        rightEyeLine: document.getElementById('right-eye-line'),
        rightEyeBottom: document.getElementById('right-eye-bottom'),
        leftEyebrow: document.getElementById('left-eyebrow'),
        rightEyebrow: document.getElementById('right-eyebrow'),
        mouth: document.getElementById('mouth')
    };

    const PRESETS = {
        idle: {
            leftEye: { top: 'M -62,-10 L -62,0', line: 'M -62,0 L -62,42', bottom: 'M -62,42 L -62,52' },
            rightEye: { top: 'M 62,-10 L 62,0', line: 'M 62,0 L 62,42', bottom: 'M 62,42 L 62,52' },
            leftBrow: 'M -82,-24 Q -62,-32 -42,-24',
            rightBrow: 'M 42,-24 Q 62,-32 82,-24',
            mouth: 'M -30,90 Q 0,110 30,90'
        },
        listening: {
            leftEye: { top: 'M -62,-14 L -62,0', line: 'M -62,0 L -62,48', bottom: 'M -62,48 L -62,58' },
            rightEye: { top: 'M 62,-14 L 62,0', line: 'M 62,0 L 62,48', bottom: 'M 62,48 L 62,58' },
            leftBrow: 'M -82,-28 Q -62,-38 -42,-28',
            rightBrow: 'M 42,-28 Q 62,-38 82,-28',
            mouth: 'M -24,88 Q 0,105 24,88'
        },
        thinking: {
            leftEye: { top: 'M -62,-6 L -62,0', line: 'M -62,0 L -62,30', bottom: 'M -62,30 L -62,36' },
            rightEye: { top: 'M 62,-6 L 62,0', line: 'M 62,0 L 62,30', bottom: 'M 62,30 L 62,36' },
            leftBrow: 'M -82,-22 Q -62,-26 -42,-22',
            rightBrow: 'M 42,-20 Q 62,-30 82,-20',
            mouth: 'M -22,92 Q 0,96 22,92'
        },
        executing: {
            leftEye: { top: 'M -62,-12 L -62,0', line: 'M -62,0 L -62,44', bottom: 'M -62,44 L -62,54' },
            rightEye: { top: 'M 62,-12 L 62,0', line: 'M 62,0 L 62,44', bottom: 'M 62,44 L 62,54' },
            leftBrow: 'M -82,-26 Q -62,-34 -42,-26',
            rightBrow: 'M 42,-26 Q 62,-34 82,-26',
            mouth: 'M -28,88 Q 0,114 28,88'
        }
    };

    let currentState = 'idle';

    function setFaceState(state) {
        const preset = PRESETS[state] || PRESETS.idle;
        currentState = state;

        // Apply paths with CSS transitions
        if (FACE.leftEyeTop) FACE.leftEyeTop.setAttribute('d', preset.leftEye.top);
        if (FACE.leftEyeLine) FACE.leftEyeLine.setAttribute('d', preset.leftEye.line);
        if (FACE.leftEyeBottom) FACE.leftEyeBottom.setAttribute('d', preset.leftEye.bottom);
        if (FACE.rightEyeTop) FACE.rightEyeTop.setAttribute('d', preset.rightEye.top);
        if (FACE.rightEyeLine) FACE.rightEyeLine.setAttribute('d', preset.rightEye.line);
        if (FACE.rightEyeBottom) FACE.rightEyeBottom.setAttribute('d', preset.rightEye.bottom);
        if (FACE.leftEyebrow) FACE.leftEyebrow.setAttribute('d', preset.leftBrow);
        if (FACE.rightEyebrow) FACE.rightEyebrow.setAttribute('d', preset.rightBrow);
        if (FACE.mouth) FACE.mouth.setAttribute('d', preset.mouth);

        // Update face container classes
        faceContainer.classList.remove('listening', 'thinking', 'executing');
        if (state !== 'idle') faceContainer.classList.add(state);

        // Update status text
        const labels = { idle: '', listening: 'Escuchando...', thinking: 'Pensando...', executing: 'Ejecutando...' };
        faceStatus.textContent = labels[state] || '';
        faceStatus.className = `face-status ${state}`;
    }

    // ══════════════════════════════════════════
    // 9. Micro-animation loop (organic breathing)
    // ══════════════════════════════════════════
    let breathPhase = 0;

    function breathLoop() {
        if (currentState !== 'idle') {
            requestAnimationFrame(breathLoop);
            return;
        }
        breathPhase += 0.015;
        const offset = Math.sin(breathPhase) * 2;

        if (FACE.leftEyeLine) {
            FACE.leftEyeLine.setAttribute('d', `M -62,0 L -62,${42 + offset}`);
        }
        if (FACE.rightEyeLine) {
            FACE.rightEyeLine.setAttribute('d', `M 62,0 L 62,${42 + offset}`);
        }

        requestAnimationFrame(breathLoop);
    }

    // ══════════════════════════════════════════
    // 10. Init
    // ══════════════════════════════════════════
    setFaceState('idle');
    breathLoop();
    connect();

    // Blinking
    setInterval(() => {
        if (currentState !== 'idle') return;
        const blink = () => {
            if (FACE.leftEyeLine) FACE.leftEyeLine.setAttribute('d', 'M -62,18 L -62,22');
            if (FACE.rightEyeLine) FACE.rightEyeLine.setAttribute('d', 'M 62,18 L 62,22');
            setTimeout(() => setFaceState('idle'), 120);
        };
        blink();
    }, 4000 + Math.random() * 3000);

    // Keep-alive ping
    setInterval(() => {
        send({ type: 'ping', deviceId, payload: {} });
    }, 25000);

    console.log('[Phone] Client initialized. Room:', roomId);
})();

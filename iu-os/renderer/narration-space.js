import { FilesetResolver, HandLandmarker, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const logContainer = document.getElementById('transcript-log');
const floatLabel = document.getElementById('floating-label');
const btnClose = document.getElementById('btn-close');
const btnEnd = document.getElementById('btn-end');

let handLandmarker = null;
let poseLandmarker = null;
let rafId = null;
let lastVideoTime = -1;

// State and Timeline
let startTime = Date.now();
let timeline = []; // { ts, type: 'voice'|'gesture', data }
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 3000; // ms

// --- Face Animation Base (Simple listening state) ---
const faceGroup = document.getElementById('face-group');
let faceAngle = 0;
setInterval(() => {
    // Subtle breathing / listening motion
    if (!faceGroup) return;
    faceAngle += 0.05;
    const tilt = Math.sin(faceAngle) * 2;
    faceGroup.style.transform = `translate(200px, 250px) rotate(${tilt}deg)`;
}, 50);

// --- Initialization ---
async function init() {
    btnClose.addEventListener('click', closeSpace);
    btnEnd.addEventListener('click', endSession);

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    try {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                delegate: "GPU"
            },
            runningMode: 'VIDEO',
            numPoses: 1
        });

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        logContainer.innerHTML = ''; // Clear waiting text
        loop();

    } catch (err) {
        console.error('❌ [NarrationSpace] Init failed:', err);
        addLogItem('System', 'No se pudo iniciar la cámara o los modelos AI.');
    }
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

// --- Render Loop ---
function loop() {
    if (!video.srcObject) return;

    let nowInMs = performance.now();
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        const handResults = handLandmarker.detectForVideo(video, nowInMs);
        const poseResults = poseLandmarker.detectForVideo(video, nowInMs);

        drawMesh(handResults, poseResults);
        detectGestures(handResults);
    }

    rafId = requestAnimationFrame(loop);
}

// --- 3D Mesh Rendering ---
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
];

// Pose connections (Torso & Arms)
const POSE_CONNECTIONS = [
    // Shoulders
    [11, 12],
    // Hips
    [23, 24],
    // Torso sides
    [11, 23], [12, 24],
    // Arms
    [11, 13], [13, 15],
    [12, 14], [14, 16]
];

function drawMesh(handResults, poseResults) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw Torso/Pose
    if (poseResults && poseResults.landmarks && poseResults.landmarks.length > 0) {
        const pose = poseResults.landmarks[0];
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';

        for (const [sIdx, eIdx] of POSE_CONNECTIONS) {
            const s = pose[sIdx];
            const e = pose[eIdx];
            if (!s || !e) continue;
            // Video is mirrored horizontally
            ctx.beginPath();
            ctx.moveTo((1 - s.x) * w, s.y * h);
            ctx.lineTo((1 - e.x) * w, e.y * h);
            ctx.stroke();
        }

        // Draw pose dots
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        for (let i = 11; i <= 24; i++) {
            if (!pose[i]) continue;
            ctx.beginPath();
            ctx.arc((1 - pose[i].x) * w, pose[i].y * h, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Draw Hands
    if (handResults && handResults.landmarks) {
        const hands = handResults.landmarks;
        const handednessList = handResults.handedness || [];

        for (let i = 0; i < hands.length; i++) {
            const hand = hands[i];
            const handLabel = handednessList[i]?.[0]?.categoryName || 'Hand';
            // Cyan for Left, Pink for Right
            const color = handLabel === 'Left' ? '#4ef0ff' : '#ff8fc7';

            ctx.lineWidth = 2;
            ctx.strokeStyle = color;

            // Bones
            for (const [sIdx, eIdx] of HAND_CONNECTIONS) {
                const s = hand[sIdx];
                const e = hand[eIdx];
                if (!s || !e) continue;

                // Depth illusion: scale opacity by Z (negative Z is closer)
                const depthZ = (s.z + e.z) / 2;
                ctx.globalAlpha = Math.min(1, Math.max(0.2, 1 - (depthZ * 2)));

                ctx.beginPath();
                ctx.moveTo((1 - s.x) * w, s.y * h);
                ctx.lineTo((1 - e.x) * w, e.y * h);
                ctx.stroke();
            }

            // Joints
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = color;
            for (let j = 0; j < hand.length; j++) {
                const p = hand[j];
                const depthZ = p.z;
                // Closer points -> larger radius
                let radius = 3;
                if (depthZ < -0.05) radius = 4.5;
                if (depthZ < -0.1) radius = 6;

                // Fingertips are white
                const isTip = [4, 8, 12, 16, 20].includes(j);
                ctx.fillStyle = isTip ? '#ffffff' : color;

                ctx.beginPath();
                ctx.arc((1 - p.x) * w, p.y * h, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }
}

// --- Gesture Detection / Semantics ---
function detectGestures(handResults) {
    if (!handResults || handResults.landmarks.length === 0) return;

    const now = Date.now();
    if (now - lastGestureTime < GESTURE_COOLDOWN) return; // Cooldown

    const hands = handResults.landmarks;
    let tag = null;
    let desc = null;
    let gx = 0, gy = 0; // Visual center for label

    if (hands.length === 2) {
        const h0 = hands[0][0]; // wrist 0
        const h1 = hands[1][0]; // wrist 1

        const dx = Math.abs(h0.x - h1.x);
        const dy = Math.abs(h0.y - h1.y);

        gx = (1 - ((h0.x + h1.x) / 2)) * canvas.width;
        gy = ((h0.y + h1.y) / 2) * canvas.height;

        // 1. Dos Entidades / Comparación (Separated widely horizontally)
        if (dx > 0.6) {
            tag = "Dos Entidades";
            desc = "manos separadas indicando dos opciones o extremos";
        }
        // 2. Jerarquía / Superioridad (Large vertical difference)
        else if (dy > 0.3 && dx < 0.4) {
            tag = "Jerarquía";
            desc = "una mano por encima de la otra, indicando superioridad o niveles";
        }
    }

    if (!tag && hands.length >= 1) {
        // Evaluate single-hand features
        for (let i = 0; i < hands.length; i++) {
            const hand = hands[i];
            const thumb = hand[4];
            const index = hand[8];
            const middleMcp = hand[9];
            const wrist = hand[0];

            // 3. Precisión / Pinza (Thumb and Index close together)
            const pinchDist = Math.hypot(index.x - thumb.x, index.y - thumb.y, index.z - thumb.z);
            const handScale = Math.max(0.01, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));
            const normalizedPinch = pinchDist / handScale;

            if (normalizedPinch < 0.25) {
                tag = "Precisión";
                desc = "efecto pinza pequeño, indicando control fino o detalle puntual";
                gx = (1 - ((thumb.x + index.x) / 2)) * canvas.width;
                gy = ((thumb.y + index.y) / 2) * canvas.height;
                break;
            }

            // 4. Expansión (All fingers open widely - approximate by distance of tips from wrist)
            const pinky = hand[20];
            const palmOpenness = Math.hypot(index.x - wrist.x, index.y - wrist.y) + Math.hypot(pinky.x - wrist.x, pinky.y - wrist.y);
            if (palmOpenness > 0.8 && !tag) {
                tag = "Expansión";
                desc = "mano totalmente abierta indicando crecimiento o magnitud";
                gx = (1 - wrist.x) * canvas.width;
                gy = wrist.y * canvas.height;
                break;
            }
        }
    }

    if (tag) {
        lastGestureTime = now;
        registerTimelineEvent('gesture', { tag, desc });
        showFloatingLabel(tag, gx, gy);
    }
}

function showFloatingLabel(text, x, y) {
    floatLabel.textContent = `✦ ${text}`;
    floatLabel.style.left = `${x}px`;
    floatLabel.style.top = `${y - 40}px`;
    floatLabel.style.opacity = '1';
    floatLabel.style.transform = 'translateY(0) scale(1.1)';

    setTimeout(() => {
        floatLabel.style.opacity = '0';
        floatLabel.style.transform = 'translateY(-20px) scale(0.9)';
    }, 2000);
}

// --- Timeline & Voice Logging ---

function registerTimelineEvent(type, data) {
    const ts = Date.now() - startTime;
    timeline.push({ ts, type, data });

    // Update UI
    const div = document.createElement('div');
    div.className = `timeline-item ${type}`;

    const tsStr = Math.floor(ts / 1000).toString().padStart(3, '0') + 's';

    if (type === 'voice') {
        div.innerHTML = `<div class="ts">T+${tsStr}</div><div>${data}</div>`;
    } else if (type === 'gesture') {
        div.innerHTML = `<div class="ts">T+${tsStr}</div><div><span class="tag">${data.tag}</span> <span style="font-size:12px;opacity:0.6">${data.desc}</span></div>`;
    }

    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
}

if (window.iuOS && window.iuOS.onVoiceText) {
    window.iuOS.onVoiceText((data) => {
        console.log('[Narration] Received voice:', data);
        if (data && data.text) {
            // Only capture user voice for the narrative timeline
            if (data.role === 'user') {
                registerTimelineEvent('voice', data.text);
            }
        }
    });
}

// --- Session Control ---

function closeSpace() {
    if (rafId) cancelAnimationFrame(rafId);
    if (window.iuOS && window.iuOS.closeNarrationSpace) {
        window.iuOS.closeNarrationSpace();
    }
}

async function endSession() {
    console.log('[Narration] Ending session, timeline items:', timeline.length);
    if (rafId) cancelAnimationFrame(rafId);

    const overlay = document.getElementById('synthesis-overlay');
    const textEl = document.getElementById('synthesis-text');
    const loader = document.getElementById('synthesis-loader');
    const btnDone = document.getElementById('btn-done');

    overlay.classList.add('visible');
    textEl.textContent = 'Analizando línea de tiempo y sintetizando narrativa final...';

    if (window.iuOS && window.iuOS.synthesizeNarration) {
        const result = await window.iuOS.synthesizeNarration(timeline);
        loader.style.display = 'none';

        if (result.success) {
            textEl.textContent = result.text;
        } else {
            textEl.textContent = '❌ Error al sintetizar: ' + (result.error || 'Desconocido');
        }

        btnDone.style.display = 'block';
        btnDone.onclick = closeSpace;
    }
}

// Start
init();

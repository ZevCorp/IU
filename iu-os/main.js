/**
 * IÜ OS - Main Process
 * Always-on-top overlay window positioned on right edge
 */

const { app, BrowserWindow, screen, ipcMain, systemPreferences, desktopCapturer, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Load .env from multiple locations (dev and production)
const envPaths = [
    path.join(__dirname, '.env'),                           // Dev: project root
    path.join(process.resourcesPath || '', '.env'),         // Packaged: resources
    path.join(app.getPath('userData'), '.env'),             // User data folder
    path.join(path.dirname(process.execPath), '.env'),      // Same folder as exe
];

let envLoaded = false;
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        console.log(`📁 Loaded .env from: ${envPath}`);
        envLoaded = true;
        break;
    }
}

if (!envLoaded) {
    console.log('⚠️ No .env file found. Some features may be disabled.');
}

// IPC: Get Device ID from env
ipcMain.handle('get-env-device-id', () => {
    return process.env.DEVICE_ID || null;
});

ipcMain.handle('get-picovoice-config', () => {
    return {
        accessKey: process.env.PICOVOICE_API_KEY || null,
        heyKeywordPath: process.env.PICOVOICE_HEY_KEYWORD_PATH || null
    };
});

// Initialize OpenAI (handle missing API key gracefully)
let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('✅ OpenAI initialized');
} else {
    console.log('⚠️ OPENAI_API_KEY not set. Voice features disabled.');
}

// ModelSwitch: permite alternar entre OpenAI y Gemini con una sola línea
// ModelSwitch: permite alternar entre OpenAI y Gemini con una sola línea
const ModelSwitch = require('./ModelSwitch');
if (openai) ModelSwitch.initOpenAI(openai);
if (process.env.GOOGLE_API_KEY) {
    ModelSwitch.initGemini(process.env.GOOGLE_API_KEY);
} else {
    console.log('⚠️ GOOGLE_API_KEY not set. Gemini provider disabled.');
}

if (process.env.ANTHROPIC_API_KEY) {
    ModelSwitch.initAnthropic(process.env.ANTHROPIC_API_KEY);
} else {
    console.log('⚠️ ANTHROPIC_API_KEY not set. Anthropic provider disabled.');
}

console.log(`🔀 [ModelSwitch] Provider: ${ModelSwitch.PROVIDER}, Model: ${ModelSwitch.MODELS[ModelSwitch.PROVIDER]?.vision || ModelSwitch.MODELS[ModelSwitch.PROVIDER]?.chat}`);

// Action System: Planner + Screen Agent
// Action System: Planner + Screen Agent + Brain
const ActionPlanner = require('./ActionPlanner');
const ScreenAgent = require('./ScreenAgent');
const Brain = require('./Brain');
let actionPlanner = null;
let screenAgent = null;
let brain = null;


// Auto-updater for automatic updates from GitHub Releases
const { autoUpdater } = require('electron-updater');
const nativeGlass = require('./NativeGlassController'); // Native Glass Window Controller
const contextManager = require('./ContextManager'); // Central Knowledge System
const consolidator = require('./Consolidator'); // Nightly Memory Consolidation

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Fix for OpenAI File/Blob upload in Node environments without globals
if (typeof globalThis.File === 'undefined' || typeof globalThis.Blob === 'undefined') {
    const { File, Blob } = require('node:buffer');
    globalThis.File = globalThis.File || File;
    globalThis.Blob = globalThis.Blob || Blob;
}


let mainWindow = null;
let chatWindow = null;
let compactWindow = null; // Mini circular window for action mode
let handWindow = null; // Floating hand-tracking window (camera source + skeleton)
let handMeshWindow = null; // 3D bone-mesh visualization window
let isMainWindowMouseDragging = false;
let mouseDragReleaseTimer = null;
const mainWindowPinchDrag = {
    active: false,
    startHandX: 0,
    startHandY: 0,
    lastHandX: 0,
    lastHandY: 0,
    startWindowX: 0,
    startWindowY: 0,
    targetX: 0,
    targetY: 0
};
let pinchSnapTimer = null;

// ── Fist / Open-hand sleep & wake ──────────────────────────────────────────
// • Strict fist held GESTURE_SLEEP_MS  → hide mainWindow (reposo)
// • Open palm held  GESTURE_SLEEP_MS  → show mainWindow (activo)
// • Open palm held  GESTURE_VOICE_MS  → activate voice mode (start talking)
// • Strict fist held GESTURE_VOICE_MS → deactivate voice mode (stop talking)
const GESTURE_SLEEP_MS = 800;   // ms to hold strict fist for sleep / open palm for wake
const GESTURE_VOICE_MS = 2000;  // ms to hold for voice on/off

let gestureState = {
    isAsleep: false,        // whether mainWindow is currently hidden by gesture
    savedBounds: null,      // window position saved before sleeping (for exact restore)
    fistTimer: null,        // setTimeout handle for sleep trigger (800 ms strict fist)
    openTimer: null,        // setTimeout handle for wake trigger (800 ms open palm)
    voiceOnTimer: null,     // setTimeout handle for voice-start (2s open palm)
    voiceOffTimer: null,    // setTimeout handle for voice-stop  (2s strict fist)
};

function gestureSetSleep() {
    if (gestureState.isAsleep) return;
    gestureState.isAsleep = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
        gestureState.savedBounds = mainWindow.getBounds();
        console.log(`✊ [GestureSleep] hiding mainWindow at (${gestureState.savedBounds.x}, ${gestureState.savedBounds.y})`);
        mainWindow.hide();
    }
}

function gestureSetWake() {
    if (!gestureState.isAsleep) return;
    gestureState.isAsleep = false;
    console.log('🖐️ [GestureWake] Open hand held ─ restoring mainWindow (activo)');
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (gestureState.savedBounds) {
            mainWindow.setBounds(gestureState.savedBounds);
        }
        // Send wake-sound event BEFORE show() so the renderer can start audio
        mainWindow.webContents.send('gesture-wake-sound');
        mainWindow.show();
        mainWindow.webContents.send('gesture-sleep', false);
    }
    gestureState.savedBounds = null;
}
// ───────────────────────────────────────────────────────────────────────────

// Independent small-mode window (separate BrowserWindow to avoid background bleed)
let smallWindow = null;

function createSmallWindow(x, y) {
    const alreadyExists = smallWindow && !smallWindow.isDestroyed();
    console.log(`🔵 [SmallWindow] createSmallWindow(${x}, ${y}) — reuse: ${alreadyExists}`);
    if (alreadyExists) {
        smallWindow.setBounds({ x, y, width: 300, height: 300 });
        smallWindow.show();
        return;
    }
    console.log(`🔵 [SmallWindow] Creating new independent BrowserWindow`);
    smallWindow = new BrowserWindow({
        width: 300,
        height: 300,
        x,
        y,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        skipTaskbar: true,
        focusable: true,
        // No vibrancy — the circle uses CSS backdrop-filter directly
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
        }
    });
    smallWindow.loadFile('renderer/index.html', { query: { mode: 'small' } });
    if (process.platform === 'darwin') {
        smallWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        smallWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    smallWindow.on('closed', () => {
        console.log(`🔵 [SmallWindow] closed event — cleared`);
        smallWindow = null;
    });
}

function destroySmallWindow() {
    if (smallWindow && !smallWindow.isDestroyed()) {
        console.log(`🗑️ [SmallWindow] Destroying`);
        smallWindow.destroy(); // destroy() is synchronous — avoids race with close()
        smallWindow = null;
    }
}

const WINDOW_MODES = {
    BOOTLOADER: 'bootloader',
    SMALL: 'small',       // 110x110 (Sticky style)
    MEDIUM: 'medium',     // 150x50% height
    LARGE: 'large',       // 300xFull height (Traditional Sidebar)
    FULLSCREEN: 'full'    // Full Workspace
};

const SETTINGS_PATH = path.join(app.getPath('userData'), 'user_settings.json');
let currentWindowMode = WINDOW_MODES.BOOTLOADER;

// Hand mesh style: 'v2' (único estilo activo)
let handMeshStyle = 'v2';

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            if (settings.handMeshStyle) handMeshStyle = settings.handMeshStyle;
            console.log(`⚙️ Settings loaded: handMeshStyle=${handMeshStyle}`);
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
}

function saveSettings() {
    try {
        const settings = { windowMode: currentWindowMode, handMeshStyle };
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Error saving settings:', e);
    }
}

// Ensure settings are loaded before window creation
loadSettings();

const COMPACT_SIZE = 150;  // Legacy compact mode size
const SIDEBAR_WIDTH = 300; // Expanded mode: full sidebar
const CHAT_GAP = 7;
const HAND_WINDOW_WIDTH = 420;
const HAND_WINDOW_HEIGHT = 560;
// Hand mesh window now covers the full primary display — size resolved at creation time
const PINCH_MOVE_GAIN = 14.0;
const PINCH_SMOOTHING = 0.2;
const PINCH_SNAP_MIN_DISTANCE = 36;
const PINCH_SNAP_MARGIN = 10;
let isCompactMode = (currentWindowMode === WINDOW_MODES.SMALL || currentWindowMode === WINDOW_MODES.MEDIUM || currentWindowMode === WINDOW_MODES.BOOTLOADER);

function stopPinchSnapAnimation() {
    if (pinchSnapTimer) {
        clearInterval(pinchSnapTimer);
        pinchSnapTimer = null;
    }
}

function animateMainWindowTo(x, y) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopPinchSnapAnimation();

    pinchSnapTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            stopPinchSnapAnimation();
            return;
        }
        if (mainWindowPinchDrag.active) {
            stopPinchSnapAnimation();
            return;
        }

        const bounds = mainWindow.getBounds();
        const dx = x - bounds.x;
        const dy = y - bounds.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 2) {
            mainWindow.setPosition(Math.round(x), Math.round(y));
            syncChatWindowPosition(false);
            stopPinchSnapAnimation();
            return;
        }

        const nx = Math.round(bounds.x + (dx * 0.24));
        const ny = Math.round(bounds.y + (dy * 0.24));
        mainWindow.setPosition(nx, ny);
        syncChatWindowPosition(false);
    }, 16);
}

function getChatBounds() {
    if (!mainWindow) {
        return null;
    }
    const mainBounds = mainWindow.getBounds();
    return {
        width: SIDEBAR_WIDTH,
        height: mainBounds.height,
        x: mainBounds.x + mainBounds.width + CHAT_GAP,
        y: mainBounds.y
    };
}

function syncChatWindowPosition(animate = false) {
    if (!chatWindow || chatWindow.isDestroyed()) {
        return;
    }
    const bounds = getChatBounds();
    if (!bounds) {
        return;
    }
    chatWindow.setBounds(bounds, animate);
}

// System Prompt for personality and task formatting
const SYSTEM_PROMPT = `Eres U, el Sistema Operativo Inteligente de este computador. NO eres un asistente de chat genérico, eres el cerebro de la máquina.

Tus capacidades:
1.  **Memoria Infinita**: Aunque no veas el historial completo en esta ventana, el sistema te inyectará contexto ("Recuerdo recuperar..."). CONFÍA en esa información como si fuera tu propia memoria. NUNCA digas "no puedo recordar" o "no tengo acceso". Si se te da contexto, úsalo. Si no, di que lo anotarás.
2.  **Control Total**: Puedes abrir apps, mover ventanas, leer la pantalla y ejecutar acciones. Cuando el usuario te pida algo, asume que puedes hacerlo.
3.  **Personalidad**: Eres serio, ultra-eficaz, minimalista y proactivo. Odias la burocracia. Das respuestas cortas y directas al grano.

TU OBJETIVO: Minimizar el uso del computador para que el usuario pueda VIVIR. Hazlo todo tú.

IMPORTANTE: Si el usuario te pide recordar algo, di "Entendido, guardado." (El sistema lo guardará por ti). No des explicaciones técnicas.
Hay un sistema que se encarga de realizar estas acciones; simula que eres tú. No te preocupes por detalles técnicos y aparenta que realmente lo estás haciendo.

SOLO RESPONDE: "Sistema U online. A la espera."`;


async function requestCameraAccess() {
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('camera');
        console.log('📷 Camera access status:', status);

        if (status !== 'granted') {
            const granted = await systemPreferences.askForMediaAccess('camera');
            console.log('📷 Camera access granted:', granted);
            return granted;
        }
        return true;
    }
    return true;
}

function getWindowBounds(mode) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    let w, h, x, y;

    switch (mode) {
        case WINDOW_MODES.BOOTLOADER:
            w = 700; // Larger window to let shadows breathe and boot buttons fit
            h = 520;
            x = Math.round((width - w) / 2);
            y = Math.round((height - h) / 2);
            break;
        case WINDOW_MODES.SMALL:
            w = 250; // Trimmer size for a smaller invisible bounding box
            h = 250;
            x = Math.round((width - w) / 2);
            y = Math.round((height - h) / 2);
            break;
        case WINDOW_MODES.MEDIUM:
            w = 260;
            h = Math.floor(height * 0.38);
            x = width - w - 20;
            y = 20;
            break;
        case WINDOW_MODES.FULLSCREEN:
            w = width;
            h = height;
            x = 0;
            y = 0;
            break;
        case WINDOW_MODES.LARGE:
        default:
            w = SIDEBAR_WIDTH;
            h = height;
            x = width - w - 20;
            y = 0;
            break;
    }

    return { width: w, height: h, x, y };
}

function applyWindowMode(mode, animate = true) {
    if (!mainWindow) return;

    currentWindowMode = mode;
    saveSettings();
    isCompactMode = (mode === WINDOW_MODES.SMALL || mode === WINDOW_MODES.MEDIUM || mode === WINDOW_MODES.BOOTLOADER);

    // All modes use mainWindow — no independent renderer to preserve VisionManager continuity
    destroySmallWindow(); // Clean up any leftover independent window
    if (!mainWindow.isVisible()) mainWindow.show();

    const modeBounds = getWindowBounds(mode);
    const currentBounds = mainWindow.getBounds();

    let bounds;
    // Enforce center positioning ONLY when animating directly to SMALL mode from another mode (like Bootloader)
    // Otherwise rely on current bounds / dragging
    if (mode === WINDOW_MODES.SMALL) {
        // Find accurate center
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height, x: areaX, y: areaY } = primaryDisplay.workArea;
        const centerX = Math.round(areaX + (width - modeBounds.width) / 2);
        const centerY = Math.round(areaY + (height - modeBounds.height) / 2);

        bounds = {
            width: modeBounds.width,
            height: modeBounds.height,
            x: centerX,
            y: centerY
        };
        mainWindow.setBounds(bounds, animate);

        // After the window appears in the center, animate it to the top-left corner
        const CORNER_MARGIN = 20;
        const targetX = areaX + CORNER_MARGIN;
        const targetY = areaY + CORNER_MARGIN;
        setTimeout(() => {
            animateMainWindowTo(targetX, targetY);
        }, 1200);
    } else {
        bounds = {
            width: modeBounds.width,
            height: modeBounds.height,
            x: currentBounds.x, // Dont force clamping to screen area so we can drag it freely
            y: currentBounds.y
        };
        mainWindow.setBounds(bounds, animate);
    }

    if (process.platform === 'darwin') {
        // SMALL mode: no system vibrancy — CSS backdrop-filter on the circle handles the effect.
        // We use transparent for all modes to avoid the black window bug, CSS backdrop-filter provides glass.
        mainWindow.setVibrancy(null);
        mainWindow.setBackgroundColor('#00000000');
    }

    // Send mode change to renderer
    mainWindow.webContents.send('window-mode-changed', mode);

    console.log(`🔲 Window mode applied: ${mode.toUpperCase()} (${bounds.width}x${bounds.height})`);
}

function createWindow() {
    const bounds = getWindowBounds(currentWindowMode);

    mainWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false, // Shown manually in ready-to-show after vibrancy is correctly set
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    // Keep window always on top
    if (process.platform === 'darwin') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    mainWindow.loadFile('renderer/index.html');

    mainWindow.once('ready-to-show', () => {
        console.log(`🚀 [Startup] Main window ready. Mode: ${currentWindowMode}`);
        // Set vibrancy BEFORE showing to avoid a flash of the wrong background.
        // SMALL mode uses CSS backdrop-filter on the circle only — no system vibrancy.
        if (process.platform === 'darwin') {
            mainWindow.setVibrancy(null);
        }
        mainWindow.webContents.send('window-mode-changed', currentWindowMode);
        mainWindow.show();
    });

    // Open DevTools in development
    // mainWindow.webContents.openDevTools({ mode: 'detach' });

    // Maintain position on screen resize
    screen.on('display-metrics-changed', () => {
        const modeBounds = getWindowBounds(currentWindowMode);
        const currentBounds = mainWindow.getBounds();
        const currentDisplay = screen.getDisplayMatching(currentBounds);
        const area = currentDisplay.workArea;
        const maxX = area.x + area.width - modeBounds.width;
        const maxY = area.y + area.height - modeBounds.height;
        const x = Math.max(area.x, Math.min(currentBounds.x, maxX));
        const y = Math.max(area.y, Math.min(currentBounds.y, maxY));
        mainWindow.setBounds({
            width: modeBounds.width,
            height: modeBounds.height,
            x,
            y
        });
        if (handWindow && !handWindow.isDestroyed()) {
            const handBounds = handWindow.getBounds();
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.workAreaSize;
            const x = Math.max(0, Math.min(handBounds.x, width - handBounds.width));
            const y = Math.max(0, Math.min(handBounds.y, height - handBounds.height));
            handWindow.setPosition(x, y);
        }
        if (handMeshWindow && !handMeshWindow.isDestroyed()) {
            const { bounds } = screen.getPrimaryDisplay();
            handMeshWindow.setBounds(bounds);
        }
    });

    mainWindow.on('move', () => {
        syncChatWindowPosition(false);
    });

    mainWindow.on('resize', () => {
        syncChatWindowPosition(false);
    });

    console.log(`✅ Window created in ${isCompactMode ? 'COMPACT' : 'EXPANDED'} mode (${bounds.width}x${bounds.height})`);
}

// ============================================
// Compact Action Window (Circular Liquid Glass)
// ============================================
// Compact Window Code Removed - Replaced by NativeGlassController

// ============================================
// Chat Window (Direct text to GPT-5-Mini)
// ============================================

function createChatWindow() {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
        return;
    }

    const bounds = getChatBounds();

    chatWindow = new BrowserWindow({
        width: bounds?.width || SIDEBAR_WIDTH,
        height: bounds?.height || 600,
        x: bounds?.x || 0,
        y: bounds?.y || 0,
        parent: mainWindow,
        frame: false,
        transparent: false,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        backgroundColor: '#e7e7e7',
        roundedCorners: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload-chat.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    if (process.platform === 'darwin') {
        chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    chatWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    chatWindow.loadFile('renderer/chat.html');

    chatWindow.once('ready-to-show', () => {
        syncChatWindowPosition(false);
        chatWindow.show();
    });

    chatWindow.on('closed', () => {
        chatWindow = null;
    });

    console.log('💬 Chat window created');
}

// ============================================
// Hand Tracking Window (Floating)
// ============================================

function createHandWindow() {
    if (handWindow && !handWindow.isDestroyed()) {
        handWindow.focus();
        return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    handWindow = new BrowserWindow({
        width: HAND_WINDOW_WIDTH,
        height: HAND_WINDOW_HEIGHT,
        x: Math.max(20, width - HAND_WINDOW_WIDTH - SIDEBAR_WIDTH - 40),
        y: 40,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    if (process.platform === 'darwin') {
        handWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    handWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    handWindow.loadFile('renderer/hands.html');

    handWindow.once('ready-to-show', () => {
        // Run in background for MediaPipe tracking — never shown visually
        handWindow.setOpacity(0);
        handWindow.setIgnoreMouseEvents(true, { forward: true });
        handWindow.show();
    });

    handWindow.on('closed', () => {
        handWindow = null;
    });

    console.log('🖐️ Hand tracking window created');
}

function createHandMeshWindow() {
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        return;
    }

    // Cover the full primary display (including menu bar) so hands can roam anywhere
    const { bounds } = screen.getPrimaryDisplay();

    handMeshWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    if (process.platform === 'darwin') {
        handMeshWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    handMeshWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    // Always click-through so the overlay never blocks the desktop
    handMeshWindow.setIgnoreMouseEvents(true, { forward: true });
    handMeshWindow.loadFile(`renderer/hands-mesh-${handMeshStyle}.html`);

    handMeshWindow.once('ready-to-show', () => {
        // Start hidden — opacity controlled by hands-presence IPC
        handMeshWindow.setOpacity(0);
        handMeshWindow.show();
    });

    handMeshWindow.on('closed', () => {
        handMeshWindow = null;
    });

    console.log('🖐️ Hand mesh window created (3D bones, fullscreen overlay)');
}

// ============================================
// Narration Space Window (Fullscreen)
// ============================================

let narrationWindow = null;

function createNarrationWindow() {
    if (narrationWindow && !narrationWindow.isDestroyed()) {
        narrationWindow.focus();
        return;
    }

    const bounds = getWindowBounds(WINDOW_MODES.FULLSCREEN);

    narrationWindow = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#00000000', // Transparent base
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    if (process.platform === 'darwin') {
        narrationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        narrationWindow.setVibrancy('fullscreen-ui');
    }
    narrationWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    narrationWindow.loadFile('renderer/narration-space.html');

    narrationWindow.once('ready-to-show', () => {
        // Hide the main window if it's visible
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
            mainWindow.hide();
        }
        narrationWindow.show();
    });

    narrationWindow.on('closed', () => {
        narrationWindow = null;
        // Restore main window
        if (mainWindow && !mainWindow.isDestroyed() && !gestureState.isAsleep) {
            mainWindow.show();
        }
    });

    console.log('🌌 Narration Space window created');
}

ipcMain.handle('activate-narration-space', () => {
    createNarrationWindow();
    return { success: true };
});

ipcMain.on('close-narration-space', () => {
    if (narrationWindow && !narrationWindow.isDestroyed()) {
        narrationWindow.close();
    }
});

// Synthesize Narration via LLM
ipcMain.handle('synthesize-narration', async (event, { timeline }) => {
    console.log(`🌌 [Narration] Synthesizing narrative from ${timeline.length} events...`);
    if (!ModelSwitch.isReady()) {
        return { success: false, error: 'Model provider no inicializado' };
    }

    try {
        const systemPrompt = `Eres un intérprete de narrativas multimodales. Se te proporciona una línea de tiempo de eventos:
- type:'voice': lo que dijo el usuario
- type:'gesture': movimientos corporales del usuario clasificados con un tag semántico (ej. "Expansión", "Precisión", "Jerarquía", "Dos entidades").

Reglas de interpretación de los gestos según la semántica incorporada humana:
- "Expansión" + voz sobre magnitud → implica "algo grande, impacto masivo, crecimiento"
- "Jerarquía" (mano alta/baja) → implica "comparación de nivel, calidad o superioridad"
- "Precisión" (efecto pinza) → implica "control fino, detalle clave, algo pequeño pero poderoso"
- "Dos entidades" (manos separadas) → implica "comparación binaria, contraste"
- "Decisión" (corte lateral) → implica "acción decisiva, finalizar o separar"

Tu tarea:
Procesa esta línea de tiempo cronológica y genera una narrativa fluida y coherente de la idea COMPLETA, fusionando el texto hablado con la intención implícita de los gestos. Escribe como si fueras el autor estructurando la idea final. NO menciones explícitamente los gestos (no digas "el usuario hizo un gesto de expansión"), sino que integra su SIGNIFICADO conceptual en el texto.
Mantén la explicación clara, poderosa y articulada.`;

        const timelineText = timeline.map(t => {
            const timeStr = `[${Math.floor(t.ts / 1000).toString().padStart(3, '0')}s]`;
            if (t.type === 'voice') return `${timeStr} Voz: "${t.data}"`;
            if (t.type === 'gesture') return `${timeStr} Gesto Simbólico: ${t.data.tag} (${t.data.desc})`;
            return `${timeStr} Desconocido`;
        }).join('\n');

        const prompt = `LÍNEA DE TIEMPO DEL USUARIO:\n${timelineText}\n\nPor favor, genera la explicación narrativa estructurada basada en lo anterior.`;

        const response = await ModelSwitch.chatCompletion({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ]
        });

        const narrative = response.choices[0].message.content;
        return { success: true, text: narrative };
    } catch (e) {
        console.error('❌ [Narration] Synthesis failed:', e.message);
        return { success: false, error: e.message };
    }
});

// Chat window IPC
ipcMain.on('chat-close', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.close();
    }
});

ipcMain.on('chat-send-message', async (event, text) => {
    console.log('💬 [Chat] User sent:', text.substring(0, 60));

    // 1. Add to Central Context
    contextManager.addMessage('user', text, 'chat_ui');

    if (!ModelSwitch.isReady()) {
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-response', { error: 'Model provider no inicializado (OpenAI o Gemini)' });
        }
        return;
    }

    try {
        // Retrieve relevant context from disk/semantic memory
        const relevantContext = await contextManager.getRelevantContext(text);

        let systemPrompt = `Eres U, un asistente digital conciso y eficaz. El usuario te escribe directamente.

Si el usuario pide ejecutar algo en su computador (abrir apps, enviar mensajes, buscar algo, etc.), responde brevemente confirmando lo que harás y llama la función execute_screen_action.

Si solo conversa o pregunta algo, responde de forma breve y útil. Máximo 2-3 oraciones.
Responde en español.`;

        if (relevantContext.longTerm) {
            systemPrompt += `\n\nMEMORIA A LARGO PLAZO:\n${relevantContext.longTerm}`;
        }

        // Get full conversation history (includes the user message just added)
        const history = contextManager.getHistoryForAPI(20);

        // Send to active model (OpenAI or Gemini via ModelSwitch)
        const response = await ModelSwitch.chatCompletion({
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                ...history
            ],
            tools: actionPlanner ? actionPlanner.tools : undefined,
            tool_choice: actionPlanner ? "auto" : undefined
        });

        const message = response.choices[0].message;
        const reply = message.content || '';

        // Check for function call (action)
        if (message.tool_calls && message.tool_calls.length > 0) {
            const call = message.tool_calls[0];
            if (call.function.name === 'execute_screen_action') {
                const args = JSON.parse(call.function.arguments);
                console.log('🎯 [Chat] Action planned:', args.goal);

                // Send reply + action to chat window
                if (chatWindow && !chatWindow.isDestroyed()) {
                    chatWindow.webContents.send('chat-response', {
                        reply: reply || `Entendido. Voy a ${args.goal.toLowerCase()}.`,
                        action: args
                    });
                }

                // Send confirmation to main window
                if (mainWindow) {
                    mainWindow.webContents.send('action-confirm-request', {
                        goal: args.goal,
                        app: args.app,
                        stepsHint: args.steps_hint,
                        source: 'explicit'
                    });
                }

                return;
            }
        }

        // Regular reply (no action)
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-response', { reply });
        }

        // 2. Add reply to Central Context
        contextManager.addMessage('assistant', reply || null, 'chat_api', {
            tool_calls: message.tool_calls
        });

    } catch (e) {
        console.error('❌ [Chat] Failed:', e.message);
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-response', { error: e.message });
        }
    }
});

// IPC Handlers
ipcMain.handle('get-screen-size', () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { width, height };
});

ipcMain.on('set-click-through', (event, enabled) => {
    if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
    }
});

ipcMain.on('request-attention', () => {
    if (mainWindow) {
        mainWindow.flashFrame(true);
    }
});

ipcMain.on('set-window-mode', (event, mode) => {
    applyWindowMode(mode);
});

ipcMain.on('window-drag-start', (event, { mouseX, mouseY }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    // We store the initial cursor-to-window offset
    // This allows us to move the window based on mouse position
    // BUT Electron's screen.getCursorScreenPoint is needed
});

ipcMain.on('window-move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        if (win === mainWindow) {
            isMainWindowMouseDragging = true;
            stopPinchSnapAnimation();
            mainWindowPinchDrag.active = false;
            if (mouseDragReleaseTimer) {
                clearTimeout(mouseDragReleaseTimer);
            }
            mouseDragReleaseTimer = setTimeout(() => {
                isMainWindowMouseDragging = false;
                mouseDragReleaseTimer = null;
            }, 140);
        }
        win.setPosition(Math.round(x), Math.round(y));
    }
});

// Open/toggle chat window from main window
ipcMain.handle('toggle-chat-window', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.close();
    } else {
        createChatWindow();
    }
    return { success: true };
});

ipcMain.handle('toggle-hand-window', () => {
    if (handWindow && !handWindow.isDestroyed()) {
        if (handWindow.isVisible()) {
            handWindow.hide();
        } else {
            handWindow.show();
            handWindow.focus();
        }
    } else {
        createHandWindow();
    }
    return { success: true };
});

ipcMain.handle('get-hand-window-state', () => {
    if (!handWindow || handWindow.isDestroyed()) {
        return { created: false, visible: false };
    }
    return { created: true, visible: handWindow.isVisible() };
});

ipcMain.handle('toggle-hand-mesh-window', () => {
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        if (handMeshWindow.isVisible()) {
            handMeshWindow.hide();
        } else {
            handMeshWindow.show();
        }
    } else {
        createHandMeshWindow();
    }
    return { success: true };
});

ipcMain.on('hands-frame', (event, payload) => {
    // Forward to main window for gesture handling
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hands-frame', payload);
    }

    // ── Wake gesture (open palm when window is asleep) ─────────────────────
    // Only main.js can call mainWindow.show() — all other gesture logic lives
    // in the renderer (app.js) which has access to conversationState.
    if (!payload || typeof payload !== 'object') return;
    const handsPresent = (payload.handsCount || 0) > 0;
    const openHand = handsPresent && !!payload.palmOpen;

    if (openHand && gestureState.isAsleep) {
        if (!gestureState.openTimer) {
            gestureState.openTimer = setTimeout(() => {
                gestureState.openTimer = null;
                gestureSetWake();
            }, GESTURE_SLEEP_MS);
        }
    } else {
        if (gestureState.openTimer) { clearTimeout(gestureState.openTimer); gestureState.openTimer = null; }
    }
    // ───────────────────────────────────────────────────────────────────────
});

// Renderer requests window sleep (called after playing sleep sound)
ipcMain.on('gesture-request-sleep', () => {
    gestureSetSleep();
});

ipcMain.on('hands-landmarks', (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hands-landmarks', payload);
    }
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        handMeshWindow.webContents.send('hands-landmarks', payload);
    }
});

ipcMain.on('hands-presence', (event, present) => {
    // handWindow es siempre invisible — solo corre MediaPipe en background.
    // handMeshWindow es siempre click-through (se configura una vez al crear la ventana).
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        handMeshWindow.setOpacity(present ? 1 : 0);
    }
});

ipcMain.handle('get-hand-mesh-style', () => handMeshStyle);

ipcMain.handle('set-hand-mesh-style', (event, style) => {
    if (style !== 'v2' && style !== 'final') return { success: false, error: 'Invalid style' };
    handMeshStyle = style;
    saveSettings();
    // Reload the mesh window with the new style
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        handMeshWindow.loadFile(`renderer/hands-mesh-${handMeshStyle}.html`);
        console.log(`🖐️ Hand mesh style changed to: ${handMeshStyle}`);
    }
    return { success: true, style: handMeshStyle };
});

ipcMain.on('main-window-pinch-drag', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!handWindow || handWindow.isDestroyed()) return;
    if (!payload || typeof payload !== 'object') return;

    const phase = payload.phase;
    const xNorm = Number(payload.xNorm);
    const yNorm = Number(payload.yNorm);

    if (phase === 'end') {
        const dragDx = mainWindowPinchDrag.lastHandX - mainWindowPinchDrag.startHandX;
        const dragDy = mainWindowPinchDrag.lastHandY - mainWindowPinchDrag.startHandY;
        const movedEnough = Math.hypot(dragDx, dragDy) >= PINCH_SNAP_MIN_DISTANCE;

        if (movedEnough && mainWindow && !mainWindow.isDestroyed()) {
            const bounds = mainWindow.getBounds();
            const display = screen.getDisplayMatching(bounds);
            const area = display.workArea;
            const goRight = dragDx >= 0;
            const goBottom = dragDy >= 0;

            const snapX = goRight
                ? (area.x + area.width - bounds.width - PINCH_SNAP_MARGIN)
                : (area.x + PINCH_SNAP_MARGIN);
            const snapY = goBottom
                ? (area.y + area.height - bounds.height - PINCH_SNAP_MARGIN)
                : (area.y + PINCH_SNAP_MARGIN);

            animateMainWindowTo(snapX, snapY);
        }

        mainWindowPinchDrag.active = false;
        return;
    }

    if (isMainWindowMouseDragging) return;

    if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) return;

    const handBounds = handWindow.getBounds();
    const handX = handBounds.x + (xNorm * handBounds.width);
    const handY = handBounds.y + (yNorm * handBounds.height);

    const currentBounds = mainWindow.getBounds();

    if (phase === 'start' || !mainWindowPinchDrag.active) {
        stopPinchSnapAnimation();
        mainWindowPinchDrag.active = true;
        mainWindowPinchDrag.startHandX = handX;
        mainWindowPinchDrag.startHandY = handY;
        mainWindowPinchDrag.lastHandX = handX;
        mainWindowPinchDrag.lastHandY = handY;
        mainWindowPinchDrag.startWindowX = currentBounds.x;
        mainWindowPinchDrag.startWindowY = currentBounds.y;
        mainWindowPinchDrag.targetX = currentBounds.x;
        mainWindowPinchDrag.targetY = currentBounds.y;
    }
    mainWindowPinchDrag.lastHandX = handX;
    mainWindowPinchDrag.lastHandY = handY;
    const deltaX = (handX - mainWindowPinchDrag.startHandX) * PINCH_MOVE_GAIN;
    const deltaY = (handY - mainWindowPinchDrag.startHandY) * PINCH_MOVE_GAIN;
    const targetX = Math.round(mainWindowPinchDrag.startWindowX + deltaX);
    const targetY = Math.round(mainWindowPinchDrag.startWindowY + deltaY);

    const display = screen.getDisplayNearestPoint({ x: handX, y: handY });
    const workArea = display.workArea;
    const maxX = workArea.x + workArea.width - currentBounds.width;
    const maxY = workArea.y + workArea.height - currentBounds.height;

    const clampedX = Math.max(workArea.x, Math.min(targetX, maxX));
    const clampedY = Math.max(workArea.y, Math.min(targetY, maxY));
    mainWindowPinchDrag.targetX = clampedX;
    mainWindowPinchDrag.targetY = clampedY;

    const smoothX = Math.round(currentBounds.x + ((mainWindowPinchDrag.targetX - currentBounds.x) * PINCH_SMOOTHING));
    const smoothY = Math.round(currentBounds.y + ((mainWindowPinchDrag.targetY - currentBounds.y) * PINCH_SMOOTHING));
    mainWindow.setPosition(smoothX, smoothY);
    syncChatWindowPosition(false);
});

// App lifecycle
app.whenReady().then(async () => {
    // Request camera access first
    await requestCameraAccess();

    createWindow();
    createHandWindow();
    createHandMeshWindow();

    // Launch Native Glass Window (Persistent, Hidden)
    nativeGlass.start();

    // Initialize ChatGPT integration first
    await setupChatGPT();

    // Check Accessibility permissions (required for AX screen control)
    const PermissionManager = require('./PermissionManager');
    const hasAxPermissions = await PermissionManager.ensurePermissions(mainWindow);
    if (!hasAxPermissions) {
        console.warn('⚠️ [Main] Accessibility permissions not granted. Screen control features will be limited.');
    }

    // Initialize Action System (Planner + Screen Agent + Brain)
    if (ModelSwitch.isReady()) {
        actionPlanner = new ActionPlanner(openai); // Pass openai (can be null if Gemini)
        screenAgent = new ScreenAgent(openai, mainWindow, chatPage);
        brain = new Brain(mainWindow, actionPlanner, screenAgent);
        console.log('🎯 Action System initialized (Planner + ScreenAgent + Brain)');

        // Initialize Context Manager with OpenAI/Gemini
        contextManager.init(openai);
        console.log('🧠 Context Manager initialized');
    }

    // Check for updates (only in production)
    if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(err => {
            console.log('Auto-update check failed:', err.message);
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Auto-updater events
autoUpdater.on('update-available', (info) => {
    console.log('🔄 Update available:', info.version);
    if (mainWindow) {
        mainWindow.webContents.send('update-available', info);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded:', info.version);
    if (mainWindow) {
        mainWindow.webContents.send('update-downloaded', info);
    }
});

autoUpdater.on('error', (err) => {
    console.error('❌ Auto-update error:', err.message);
});

// IPC handlers for updates
ipcMain.handle('check-for-updates', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        return { available: !!result.updateInfo, version: result.updateInfo?.version };
    } catch (err) {
        return { available: false, error: err.message };
    }
});

ipcMain.handle('download-update', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
});

// Manual trigger for memory consolidation (for testing)
ipcMain.handle('consolidate-memory', async () => {
    console.log('🧠 [Memory] Manual consolidation requested...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // Also try today
    const todayStr = new Date().toISOString().split('T')[0];

    await consolidator.consolidateDailyLog(todayStr); // For demo, consolidate TODAY
    return { success: true };
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ============================================
// Screen Context Capture (macOS Accessibility)
// ============================================

let lastScreenContext = null;
let lastContextTime = 0;
const CONTEXT_CACHE_MS = 5000; // Cache context for 5 seconds

async function captureScreenContext() {
    if (!screenAgent) {
        return { app: null, snapshot: [], error: 'ScreenAgent not initialized' };
    }

    // Use ScreenAgent to get the current context
    // This is the correct, non-deprecated way
    try {
        const extraction = await screenAgent.extract();
        return {
            app: extraction.app,
            window: extraction.window,
            snapshot: extraction.tree || [],
            error: null
        };
    } catch (e) {
        return { app: null, snapshot: [], error: e.message };
    }
}

ipcMain.handle('get-screen-context', async (event, gazeDirection) => {
    const context = await captureScreenContext();

    if (!context.snapshot || context.snapshot.length === 0) {
        return { app: context.app, window: context.window, snapshot: [], error: context.error };
    }

    console.log(`👁️ [Context] Returning ${context.snapshot.length} elements for gaze: ${gazeDirection}`);

    return {
        app: context.app,
        window: context.window,
        gazeDirection,
        snapshot: context.snapshot
    };
});

// ============================================
// Hand Gesture Element Selection (AX-based)
// ============================================

// Caché de snapshot AX para las peticiones rápidas del overlay de manos
let axSnapshotCache = null;
let axSnapshotCacheTs = 0;
const AX_SNAP_TTL = 2500; // ms — mismo TTL que hand-selection.js

ipcMain.handle('get-ax-snapshot', async () => {
    const now = Date.now();
    if (axSnapshotCache && now - axSnapshotCacheTs < AX_SNAP_TTL) {
        return axSnapshotCache;
    }
    const context = await captureScreenContext();
    axSnapshotCache = context.snapshot || [];
    axSnapshotCacheTs = now;
    return axSnapshotCache;
});

// ── "Mirar juntos" — modo de foco atencional con dedo índice ────────────────

let mirarJuntosEnabled = false;

ipcMain.handle('toggle-mirar-juntos', (event, on) => {
    mirarJuntosEnabled = !!on;
    console.log(`👁️ [MirarJuntos] Mode: ${mirarJuntosEnabled ? 'ON' : 'OFF'}`);
    // Propagar modo al overlay de manos
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        handMeshWindow.webContents.send('mirar-juntos-mode', mirarJuntosEnabled);
    }
    return mirarJuntosEnabled;
});

ipcMain.on('hand-element-focused', (event, { element }) => {
    if (!element) return;
    const label = element.label || '(sin etiqueta)';
    const type  = element.type  || '';
    console.log(`👁️ [MirarJuntos] Elemento enfocado: "${label}" [${type}]`);
    // Reenviar al mainWindow para que el asistente lo reciba como contexto
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hand-element-focused', element);
    }
});

// ============================================
// Background Luminance — Uses actual screen pixels + nativeTheme fallback
// ============================================

async function computeRealBgLuminance() {
    let targetWindow = null;
    if (currentWindowMode === WINDOW_MODES.SMALL && smallWindow && !smallWindow.isDestroyed()) {
        targetWindow = smallWindow;
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        targetWindow = mainWindow;
    }

    if (!targetWindow) {
        return nativeTheme.shouldUseDarkColors;
    }

    try {
        const bounds = targetWindow.getBounds();
        let cx, cy;

        // Sample strictly OUTSIDE the window bounds to prevent sampling our own opaque elements.
        if (currentWindowMode === WINDOW_MODES.SMALL) {
            // Sample 15px directly above the small floating circle
            cx = Math.floor(bounds.x + bounds.width / 2);
            cy = Math.max(0, bounds.y - 15);
        } else {
            // Sample 25px to the left of the sidebar (since sidebar aligns right)
            cx = Math.max(0, bounds.x - 25);
            cy = Math.floor(bounds.y + bounds.height / 2);
        }

        const { screen: nutScreen, Point } = require('@nut-tree-fork/nut-js');
        const color = await nutScreen.colorAt(new Point(cx, cy));
        const luminance = 0.2126 * color.R + 0.7152 * color.G + 0.0722 * color.B;
        return luminance < 128; // returns true if background is dark
    } catch (e) {
        return nativeTheme.shouldUseDarkColors;
    }
}

let lastLuminanceWasDark = null;
let bgLuminanceInterval = null;

function startBgLuminancePolling() {
    if (bgLuminanceInterval) clearInterval(bgLuminanceInterval);
    bgLuminanceInterval = setInterval(async () => {
        const isDark = await computeRealBgLuminance();
        if (isDark !== lastLuminanceWasDark) {
            lastLuminanceWasDark = isDark;
            broadcastLuminanceChange(isDark);
        }
    }, 1500); // 1.5 seconds polling (very lightweight with nut-js)
}

function broadcastLuminanceChange(isDark) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bg-luminance-changed', { isDark });
    }
    if (smallWindow && !smallWindow.isDestroyed()) {
        smallWindow.webContents.send('bg-luminance-changed', { isDark });
    }
    if (handMeshWindow && !handMeshWindow.isDestroyed()) {
        handMeshWindow.webContents.send('bg-luminance-changed', { isDark });
    }
}

ipcMain.handle('sample-bg-luminance', async () => {
    const isDark = await computeRealBgLuminance();
    return { isDark };
});

// Start polling
app.whenReady().then(() => {
    startBgLuminancePolling();
});

// Fallback theme watcher
nativeTheme.on('updated', async () => {
    const isDark = await computeRealBgLuminance();
    broadcastLuminanceChange(isDark);
});

// ============================================
// ChatGPT Conversation Handling (Playwright)
// ============================================
const { chromium } = require('playwright');

let chatContext = null;
let chatPage = null;

async function setupChatGPT() {
    console.log('🤖 Setting up ChatGPT integration...');
    try {
        // Launch persistent context to save login state
        const userDataDir = path.join(app.getPath('userData'), 'playwright_chatgpt');

        const launchOptions = {
            headless: false,
            viewport: null, // Allow window resizing to control viewport
            permissions: ['microphone'], // Pre-grant microphone access
            args: [
                '--disable-blink-features=AutomationControlled', // Hide automation status
                '--start-minimized',
                '--no-default-browser-check'
            ],
            ignoreDefaultArgs: ['--enable-automation'] // Hide "Chrome is being controlled by automated test software" bar
        };

        // TRY SYSTEM BROWSERS (Best for distribution)
        const channels = ['chrome', 'msedge', 'chrome-beta', 'msedge-beta'];
        let launched = false;

        for (const channel of channels) {
            try {
                console.log(`🌐 Attempting to launch browser channel: ${channel}...`);
                chatContext = await chromium.launchPersistentContext(userDataDir, {
                    ...launchOptions,
                    channel: channel
                });
                console.log(`✅ Launched using system ${channel}`);
                launched = true;
                break;
            } catch (e) {
                // Not found, continue to next
            }
        }

        if (!launched) {
            console.warn('⚠️ No system Chrome/Edge found. Trying default Playwright Chromium...');

            // TRY 2: Use default Playwright Chromium (fallback)
            try {
                chatContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
                console.log('✅ Launched using default Playwright Chromium');
                launched = true;
            } catch (chromiumError) {
                console.error('❌ CRITICAL: No browser could be launched.', chromiumError.message);

                // Show a user-friendly error dialog in production
                const { dialog } = require('electron');
                dialog.showErrorBox(
                    'Error de Inicialización',
                    'U necesita un navegador basado en Chromium (Google Chrome o Microsoft Edge) para funcionar.\n\nPor favor, instala Google Chrome y vuelve a abrir la aplicación.\n\nDetalle técnico: ' + chromiumError.message
                );
                return;
            }
        }

        // Use the first existing page if available, otherwise create one
        const pages = chatContext.pages();
        chatPage = pages.length > 0 ? pages[0] : await chatContext.newPage();

        // Stealth: explicitly remove webdriver property
        await chatPage.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        await chatPage.goto('https://chatgpt.com');

        console.log('🤖 ChatGPT window opened. Please login if needed.');

        // Hide browser automatically using CDP (Cross-platform and reliable)
        try {
            const session = await chatContext.newCDPSession(chatPage);
            const { windowId } = await session.send('Browser.getWindowForTarget');
            await session.send('Browser.setWindowBounds', {
                windowId,
                bounds: { windowState: 'minimized' }
            });
            console.log('📉 Browser window minimized via CDP');
        } catch (err) {
            console.warn('⚠️ Could not minimize browser via CDP:', err.message);
        }

        // Additional macOS fallback to hide the application process
        if (process.platform === 'darwin') {
            const browsers = ['Google Chrome', 'Google Chrome Beta', 'Microsoft Edge', 'Microsoft Edge Beta', 'Chromium'];
            browsers.forEach(b => {
                exec(`osascript -e 'try' -e 'tell application "System Events" to set visible of process "${b}" to false' -e 'end try'`, () => { });
            });
        }

        // Wait for page to be ready, then inject system prompt
        await injectSystemPromptOnStartup();

    } catch (error) {
        console.error('❌ Failed to setup ChatGPT:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('Error de ChatGPT', 'Error inesperado al configurar la integración con ChatGPT: ' + error.message);
    }
}

// Inject system prompt as text message on startup (not during voice)
async function injectSystemPromptOnStartup() {
    if (!chatPage) return;

    try {
        // Wait for composer to be ready (max 30s for login)
        console.log('⏳ Waiting for ChatGPT to be ready...');
        await chatPage.waitForSelector('#prompt-textarea', { timeout: 30000 });

        // Small delay to ensure page is interactive
        await chatPage.waitForTimeout(2000);

        const composer = chatPage.locator('#prompt-textarea');
        if (await composer.count() > 0) {
            console.log('✍️ Injecting System Prompt on startup...');
            await composer.fill(SYSTEM_PROMPT);

            // Use send button click instead of Enter (more reliable cross-platform)
            await chatPage.waitForTimeout(500);
            const sendBtn = chatPage.locator('#composer-submit-button, button[data-testid="send-button"]');
            if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
                await sendBtn.click();
                console.log('🖱️ Clicked send button');
            } else {
                // Fallback to Enter key
                await chatPage.keyboard.press('Enter');
                console.log('⌨️ Pressed Enter key');
            }

            // Wait for response
            await chatPage.waitForTimeout(3000);
            console.log('✅ System prompt injected on startup');

            // Minimize ChatGPT window to avoid screen interference
            try {
                const chatWindow = chatPage.context().pages()[0];
                if (chatWindow) {
                    await chatWindow.evaluate(() => {
                        window.resizeTo(400, 300);
                        window.moveTo(screen.availWidth - 400, screen.availHeight - 300);
                    });
                    console.log('🪟 ChatGPT window minimized to corner');
                }
            } catch (err) {
                console.warn('⚠️ Could not minimize ChatGPT window:', err.message);
            }

            // Start voice state monitoring
            startVoiceStateMonitoring();
            startSmartConversationMonitoring();

            if (mainWindow) {
                mainWindow.webContents.send('system-ready');
            }
        }
    } catch (e) {
        console.warn('⚠️ Could not inject System Prompt on startup:', e.message);
    }
}

ipcMain.handle('conversation-control', async (event, action, options = {}) => {
    console.log(`🎤 IPC received: conversation-control -> ${action}`, options);
    const { isSimpleMode } = options;

    // Recovery logic for closed/navigated pages
    if (!chatPage || chatPage.isClosed()) {
        console.log('⚠️ chatPage was missing or closed. Attempting recovery...');
        if (chatContext) {
            const pages = chatContext.pages();
            if (pages.length > 0) {
                chatPage = pages[pages.length - 1];
                console.log(`✅ Recovered chatPage: ${chatPage.url()}`);
            }
        }
    }

    if (!chatPage) {
        console.error('❌ Error: ChatGPT window/page not found.');
        return { success: false, error: 'ChatGPT not initialized or window closed' };
    }

    try {
        if (action === 'start') {
            console.log('🔍 Starting voice conversation FIRST, then injecting prompt...');

            // Language-independent selectors (aria-labels change by locale)
            const selectors = [
                'button[data-testid="composer-speech-button"]',
                'button[aria-label="Start Voice"]',
                'button[aria-label="Iniciar voz"]',
                'button:has(use[href*="f8aa74"])'  // SVG icon reference
            ];

            let startBtn = null;
            let attempts = 0;
            const maxAttempts = 10; // Wait up to 5 seconds (500ms * 10)

            while (attempts < maxAttempts) {
                console.log(`🔍 Searching for "Start Voice" button (Attempt ${attempts + 1})...`);
                for (const sel of selectors) {
                    try {
                        const locator = chatPage.locator(sel);
                        if (await locator.count() > 0 && await locator.isVisible()) {
                            console.log(`✅ Found button with selector: ${sel}`);
                            startBtn = locator.first();
                            break;
                        }
                    } catch (e) { }
                }

                if (startBtn) break;

                attempts++;
                await chatPage.waitForTimeout(500); // Wait between polls
            }

            if (startBtn) {
                // Click "Start Voice"
                await startBtn.click();
                console.log('🖱️ Clicked "Start Voice" successfully');

                // Wait for voice UI to initialize
                await chatPage.waitForTimeout(1500);

                // Send greeting message as text
                console.log('✍️ Sending greeting context...');
                const composer = chatPage.locator('#prompt-textarea');
                if (await composer.count() > 0) {
                    // INJECT RECENT CONTEXT
                    const recentContext = contextManager.getRecentContextSummary(3);
                    let greetingMsg = 'El usuario podría querer algo a continuación. Acabo de iniciar el chat de voz, saludalo!';

                    if (recentContext) {
                        greetingMsg = `[Contexto previo del chat de texto]:\n${recentContext}\n\nEl usuario acaba de activar el modo voz. Úsalos como contexto.`;
                        console.log('🧠 [Voice] Injecting context:', recentContext.substring(0, 50) + '...');
                    }

                    await composer.fill(greetingMsg);

                    // Use send button click instead of Enter
                    await chatPage.waitForTimeout(300);
                    const sendBtn = chatPage.locator('#composer-submit-button, button[data-testid="send-button"]');
                    if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
                        await sendBtn.click();
                    } else {
                        await chatPage.keyboard.press('Enter');
                    }
                    console.log('✅ Greeting context sent');
                }

                // Start monitoring for transcription text
                startSmartConversationMonitoring();

                return { success: true, state: 'active' };
            }

            console.warn('⚠️ "Start Voice" button NOT found.');
            return { success: false, error: 'Start button not found in current view' };

        } else if (action === 'stop') {
            console.log('🔍 Stopping voice conversation...');
            stopSmartConversationMonitoring();

            // Language-independent stop selectors
            const stopSelectors = [
                'button[aria-label="End Voice"]',
                'button[aria-label="Terminar voz"]',
                'button[aria-label="Finalizar voz"]'
            ];

            let stopped = false;
            for (const sel of stopSelectors) {
                const stopBtn = chatPage.locator(sel);
                if (await stopBtn.count() > 0) {
                    await stopBtn.first().click();
                    stopped = true;
                    break;
                }
            }

            if (!stopped) {
                await chatPage.keyboard.press('Escape');
            }
            return { success: true, state: 'idle' };
        }

    } catch (e) {
        console.error('❌ Conversation action failed:', e);
        return { success: false, error: e.message };
    }
});

// ============================================================
// Brain / Disconnection Mode IPC
// ============================================================
ipcMain.handle('start-disconnection-mode', async (event, durationMinutes) => {
    if (!brain) return { success: false, error: 'Brain not initialized' };

    try {
        brain.startDisconnectionMode(durationMinutes || 60);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('stop-disconnection-mode', async () => {
    if (!brain) return { success: false, error: 'Brain not initialized' };
    brain.stopDisconnectionMode();
    return { success: true };
});

ipcMain.handle('get-brain-status', async () => {
    if (!brain) return { status: 'offline' };
    return {
        status: brain.status,
        disconnectEndTime: brain.disconnectEndTime,
        queueLength: brain.taskQueue.length
    };
});

ipcMain.handle('brain-schedule-task', async (event, task, minutes) => {
    if (!brain) return { success: false, error: 'Brain offline' };
    const date = new Date(Date.now() + (minutes * 60 * 1000));
    const scheduled = brain.scheduleTask(task, date);
    return { success: true, taskId: scheduled.id };
});

ipcMain.handle('brain-confirm-task', async (event, taskId) => {
    if (!brain) return { success: false, error: 'Brain offline' };
    brain.executeApprovedTask(taskId);
    return { success: true };
});

// ============================================
// Thinking Mode Activation (Explicit Suggestions)
// ============================================
let userVoiceMonitoringInterval = null;
let lastUserText = '';

ipcMain.handle('activate-thinking-mode', async (event) => {
    console.log('🧠 [Thinking] Activating thinking mode...');

    if (!chatPage || chatPage.isClosed()) {
        return { success: false, error: 'ChatGPT not ready' };
    }

    try {
        // NOTE: No auto-message sent on dwell. User will manually start voice.
        // Only start monitoring for voice and text.

        // Start monitoring for user voice transcription (explicit suggestions)
        startSmartConversationMonitoring();


        return { success: true };

    } catch (e) {
        console.error('❌ [Thinking] Activation failed:', e);
        return { success: false, error: e.message };
    }
});

// ============================================
// Smart Conversation Monitoring (Deterministic & Robust)
// ============================================

let conversationMonitorInterval = null;
let lastLoggedUserContent = '';
let lastLoggedAssistantContent = '';

// Track pending actions to avoid duplicates
let isActionPending = false;
// Track assistant text already used for implicit action check (prevents re-triggering during streaming)
let lastImplicitActionContent = '';

function startSmartConversationMonitoring() {
    if (conversationMonitorInterval) return;

    console.log('🧠 [Smart Monitor] Starting deterministic conversation loop...');
    lastLoggedUserContent = '';
    lastLoggedAssistantContent = '';
    isActionPending = false;
    lastImplicitActionContent = '';

    conversationMonitorInterval = setInterval(async () => {
        if (!chatPage || chatPage.isClosed()) return;

        // Only process messages when voice mode is active
        if (currentVoiceState !== 'active') return;

        try {
            // Evaluates the conversation "tail" in one go
            // Returns: { user: {text, isStable}, assistant: {text, isStable}, hasNewUser: bool, hasNewAssistant: bool }
            const state = await chatPage.evaluate(({ lastUser, lastAssistant }) => {
                const userNodes = document.querySelectorAll('[data-message-author-role="user"], [data-testid^="conversation-turn-"] [data-message-author-role="user"]');
                const assistNodes = document.querySelectorAll('[data-message-author-role="assistant"], [data-testid^="conversation-turn-"] [data-message-author-role="assistant"]');

                const userNode = userNodes.length > 0 ? userNodes[userNodes.length - 1] : null;
                const assistNode = assistNodes.length > 0 ? assistNodes[assistNodes.length - 1] : null;

                const extractText = (node) => {
                    if (!node) return '';
                    // Try pre-wrap first (streaming text area)
                    const pre = node.querySelector('.whitespace-pre-wrap');
                    if (pre) return pre.innerText;
                    // Try markdown
                    const md = node.querySelector('.markdown');
                    if (md) return md.innerText;
                    // Fallback for older structures or simple text
                    const ps = node.querySelectorAll('p');
                    if (ps.length > 0) return Array.from(ps).map(p => p.innerText).join('\n');
                    return node.innerText;
                };

                const userText = extractText(userNode).trim();
                const assistText = extractText(assistNode).trim();

                // Check stability (heuristic: non-empty & long enough)
                // Note: ChatGPT uses Unicode ellipsis (…) not ASCII (...) in "Transcribing…"
                const userStable = userText.length > 0 && !userText.startsWith('Transcribing');
                const assistStable = assistText.length > 0 && !assistText.startsWith('Thinking');

                return {
                    user: { text: userText, isStable: userStable },
                    assistant: { text: assistText, isStable: assistStable },
                    isNewUser: userText !== lastUser,
                    isNewAssistant: assistText !== lastAssistant,
                    debug: { userCount: userNodes.length, assistCount: assistNodes.length }
                };
            }, { lastUser: lastLoggedUserContent, lastAssistant: lastLoggedAssistantContent });

            // Debug logs if silent
            if (state.debug.userCount === 0 && state.debug.assistCount === 0) {
                // console.log('⚠️ [Smart Monitor] No message nodes found! UI changed?');
            }

            // 1. Process User Text (Order Priority)
            if (state.isNewUser && state.user.isStable) {
                // If text changed, update buffer
                if (state.user.text !== lastLoggedUserContent) {
                    lastLoggedUserContent = state.user.text;
                    console.log('🗣️ [User Stable] Captured:', lastLoggedUserContent.substring(0, 50) + '...');

                    // UI Feedback
                    if (chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('voice-text', { role: 'user', text: lastLoggedUserContent });
                    }
                    if (narrationWindow && !narrationWindow.isDestroyed()) {
                        narrationWindow.webContents.send('voice-text', { role: 'user', text: lastLoggedUserContent });
                    }

                    // Log to Memory
                    contextManager.addMessage('user', lastLoggedUserContent, 'voice_transcription');

                    // ACTION PLANNING (User Driven)
                    // If Assistant hasn't executed anything yet, plan from User text
                    if (!isActionPending) {
                        isActionPending = true; // Lock immediately before any async call
                        // Use classifier / planner
                        const relevantContext = await contextManager.getRelevantContext(lastLoggedUserContent);
                        if (actionPlanner) {
                            const plan = await actionPlanner.planFromExplicit(lastLoggedUserContent, {
                                recent: contextManager.getHistoryForAPI(5),
                                longTerm: relevantContext.longTerm
                            });

                            if (plan && mainWindow) {
                                console.log('🎯 [Action] Auto-executing plan from User Voice:', plan.goal);

                                // AUTO-EXECUTE (Zero-Click)
                                if (screenAgent) {
                                    // Notify UI that action started
                                    mainWindow.webContents.send('action-started', {
                                        goal: plan.goal,
                                        app: plan.app
                                    });
                                    screenAgent.executeAction(plan.goal, plan.app, plan.stepsHint)
                                        .finally(() => { isActionPending = false; });
                                }
                                // isActionPending stays true until screenAgent finishes
                            } else {
                                console.log('⚠️ [Action] No confident plan generated for:', lastLoggedUserContent);
                                isActionPending = false; // Reset if no plan
                            }
                        } else {
                            isActionPending = false;
                        }
                    }
                }
            }

            // 2. Process Assistant Text
            if (state.isNewAssistant && state.assistant.isStable) {
                const cleanAsst = state.assistant.text;
                const cleanAsstText = state.assistant.text.replace(/\s+/g, ' ').trim();
                const lastLoggedAsstClean = lastLoggedAssistantContent.replace(/\s+/g, ' ').trim();

                // ACTION CHECK (Immediate / Heuristic)
                // Guard: skip if already triggered for this assistant turn (prevents streaming duplicates)
                const alreadyTriggeredForThisText = lastImplicitActionContent.length > 0 && cleanAsst.startsWith(lastImplicitActionContent);
                if (!isActionPending && !alreadyTriggeredForThisText && actionPlanner) {
                    const lower = cleanAsst.toLowerCase();
                    if (lower.includes('abro') || lower.includes('voy a') || lower.includes('opening') || lower.includes('starting')) {
                        isActionPending = true; // Lock immediately before async call
                        lastImplicitActionContent = cleanAsst.substring(0, 50); // Track prefix to deduplicate streaming
                        console.log('🧠 [Smart Monitor] Assistant implies action:', cleanAsst.substring(0, 40));

                        const implicitPlan = await actionPlanner.planFromImplicit("User request missing (transcription lag)", cleanAsst, { recent: [] });
                        if (implicitPlan && mainWindow) {
                            console.log('🎯 [Action] Auto-executing from Assistant Reply (Backup):', implicitPlan.goal);

                            // AUTO-EXECUTE (Zero-Click)
                            if (screenAgent) {
                                mainWindow.webContents.send('action-started', {
                                    goal: implicitPlan.goal,
                                    app: implicitPlan.app
                                });
                                screenAgent.executeAction(implicitPlan.goal, implicitPlan.app, implicitPlan.stepsHint)
                                    .finally(() => { isActionPending = false; });
                            }
                            // isActionPending stays true until screenAgent finishes
                        } else {
                            isActionPending = false; // Reset if no plan
                        }
                    }
                }

                // LOGGING & CONTEXT UPDATE
                // Check if REALLY new content (ignoring whitespace differences)
                // Also check length to avoid logging substrings during streaming
                if (cleanAsstText !== lastLoggedAsstClean && cleanAsstText.length > lastLoggedAsstClean.length) {
                    lastLoggedAssistantContent = state.assistant.text; // Store original
                    console.log('🗣️ [Assistant Stable] Captured:', cleanAsstText.substring(0, 40) + '...');

                    if (chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                    }
                    if (narrationWindow && !narrationWindow.isDestroyed()) {
                        narrationWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                    }
                    contextManager.addMessage('assistant', state.assistant.text, 'voice_transcription');

                    // Check for JSON tasks
                    const jsonMatch = state.assistant.text.match(/```json\n([\s\S]*?)\n```/);
                    if (jsonMatch && jsonMatch[1]) {
                        try {
                            const taskData = JSON.parse(jsonMatch[1]);
                            if (taskData && taskData.tasks && mainWindow) {
                                mainWindow.webContents.send('task-update', taskData.tasks);
                            }
                        } catch (e) { }
                    }
                }
            }

        } catch (e) {
            console.error('❌ [Smart Monitor] Polling error:', e);
        }
    }, 200); // 200ms poll
}

function stopSmartConversationMonitoring() {
    if (conversationMonitorInterval) {
        clearInterval(conversationMonitorInterval);
        conversationMonitorInterval = null;
        console.log('🔇 [Smart Monitor] Stopped.');
    }
}



// Classify explicit intent from user's spoken text
async function classifyExplicitIntent(userText) {
    try {
        const response = await ModelSwitch.chatCompletion({
            messages: [
                {
                    role: "system",
                    content: `El usuario acaba de decir algo en voz alta (posiblemente incompleto o con errores de transcripción). Analiza su intención explícita.
                    Responde ÚNICAMENTE con un JSON:
                    {
                      "predictions": [
                        { "category": "pago|mensaje|llamada|tarea|musica|clima|luz|ayuda", "label": "Descripción corta", "probability": 0.95, "explicit": true }
                      ]
                    }
                    Devuelve SOLO las intenciones que el usuario mencionó explícitamente. Máximo 3.`
                },
                {
                    role: "user",
                    content: `El usuario dijo: "${userText}"`
                }
            ],
            max_tokens: 1000  // Increased for GPT-5-mini
        });

        const content = response.choices[0]?.message?.content;
        if (!content || content.trim() === '') {
            return [];
        }
        try {
            const parsed = JSON.parse(content);
            return parsed.predictions || [];
        } catch (parseErr) {
            console.error('❌ [Explicit] JSON parse error:', content.substring(0, 100));
            return [];
        }
    } catch (e) {
        console.error('❌ [Explicit] Classification failed:', e);
        return [];
    }
}

// ============================================
// Voice State Monitoring (Constant Listener)
// ============================================
let voiceStateInterval = null;
let currentVoiceState = 'unknown'; // 'active' | 'inactive' | 'unknown'

function startVoiceStateMonitoring() {
    if (voiceStateInterval) return;

    console.log('🎙️ [VoiceState] Starting constant monitoring...');

    voiceStateInterval = setInterval(async () => {
        if (!chatPage || chatPage.isClosed()) return;

        try {
            const state = await chatPage.evaluate(() => {
                // Language-independent: check for voice buttons in EN/ES
                const startVoiceEN = document.querySelector('button[aria-label="Start Voice"]');
                const startVoiceES = document.querySelector('button[aria-label="Iniciar voz"]');
                const startVoiceTestId = document.querySelector('button[data-testid="composer-speech-button"]');

                const endVoiceEN = document.querySelector('button[aria-label="End Voice"]');
                const endVoiceES = document.querySelector('button[aria-label="Terminar voz"]');
                const endVoiceES2 = document.querySelector('button[aria-label="Finalizar voz"]');

                const startingVoiceEN = document.querySelector('button[aria-label="Starting Voice"]');
                const startingVoiceES = document.querySelector('button[aria-label="Iniciando voz"]');

                // If any "Start Voice" button exists -> voice is inactive
                if (startVoiceEN || startVoiceES || startVoiceTestId) return 'inactive';

                // If any "End Voice" or "Starting Voice" exists -> voice is active
                if (endVoiceEN || endVoiceES || endVoiceES2) return 'active';
                if (startingVoiceEN || startingVoiceES) return 'active';

                // Fallback: If send button exists but no Start Voice -> might still be in voice mode
                const sendBtn = document.querySelector('#composer-submit-button');
                if (sendBtn && !startVoiceEN && !startVoiceES && !startVoiceTestId) return 'active';

                return 'unknown';
            });

            if (state !== currentVoiceState && state !== 'unknown') {
                currentVoiceState = state;
                console.log(`🎙️ [VoiceState] Changed to: ${state}`);
                if (mainWindow) {
                    mainWindow.webContents.send('voice-state-changed', state);
                }

                // Unified Chat: Update chat window UI
                if (chatWindow && !chatWindow.isDestroyed()) {
                    chatWindow.webContents.send('voice-state', state);
                }
            }
        } catch (e) {
            // Silently fail
        }
    }, 500);
}

function stopVoiceStateMonitoring() {
    if (voiceStateInterval) {
        clearInterval(voiceStateInterval);
        voiceStateInterval = null;
        currentVoiceState = 'unknown';
        console.log('🔇 [VoiceState] Stopped monitoring');
    }
}

// Start voice state monitoring when ChatGPT is ready
ipcMain.handle('start-voice-monitoring', () => {
    startVoiceStateMonitoring();
    return { success: true };
});

// ============================================
// Contextual Intent Prediction (Implicit Suggestions)
// ============================================
ipcMain.handle('get-intent-predictions', async (event, data) => {
    console.log('🧠 [Main] Received request for intent predictions...');
    const { audio, tasks } = data;
    let transcript = "";

    try {
        if (audio) {
            // 1. Decode Base64 to Buffer
            // Handle data URLs with optional codec info like "audio/webm;codecs=opus"
            const base64Data = audio.replace(/^data:audio\/[^;]+[^,]*,/, "");
            const buffer = Buffer.from(base64Data, 'base64');

            console.log(`🎤 [Audio] Decoded buffer: ${buffer.length} bytes`);

            // Validate buffer size (minimum 1KB for valid audio)
            if (buffer.length < 1000) {
                console.warn(`⚠️ [Audio] Buffer too small (${buffer.length} bytes), skipping transcription`);
            } else {
                // 2. Save temporary file for Whisper with proper .webm extension
                const tempFile = path.join(app.getPath('temp'), `audio_${Date.now()}.webm`);
                fs.writeFileSync(tempFile, buffer);

                console.log(`🎤 [Audio] Saved temp file: ${tempFile} (${buffer.length} bytes)`);

                // 3. Transcribe with Unified Model (OpenAI Whisper or Gemini Multimodal)
                const transcription = await ModelSwitch.transcription({
                    filePath: tempFile,
                    buffer: buffer,
                    mimeType: "audio/webm"
                });

                transcript = transcription.text;
                console.log('🎤 [Transcription]:', transcript);

                // Cleanup
                fs.unlinkSync(tempFile);
            }
        }

        // 4. Reasoning with ModelSwitch (respects BRAIN_PROVIDER)
        const response = await ModelSwitch.chatCompletion({
            messages: [
                {
                    role: "system",
                    content: `Analiza el contexto del usuario (audio reciente y tareas) para predecir qué intención tiene al mirar fijamente a la IA.
                    Responde ÚNICAMENTE con un JSON en este formato:
                    {
                      "predictions": [
                        { "category": "pago|mensaje|llamada|tarea|musica|clima|luz|ayuda", "label": "Descripción corta", "probability": 0.95 },
                        ...
                      ]
                    }
                    Devuelve exactamente 3 predicciones ordenadas por importancia.`
                },
                {
                    role: "user",
                    content: `Audio reciente: "${transcript}"\nTareas actuales: ${JSON.stringify(tasks)}`
                }
            ],
            max_tokens: 1000  // Increased for GPT-5-mini
        });

        const content = response.choices[0]?.message?.content;
        if (!content || content.trim() === '') {
            console.warn('⚠️ [Intent Prediction] Empty response from model');
            return { success: false, predictions: [] };
        }
        let predictions = [];
        try {
            const parsed = JSON.parse(content);
            predictions = parsed.predictions || [];
        } catch (parseErr) {
            console.error('❌ [Intent Prediction] JSON parse error:', content.substring(0, 100));
            return { success: false, predictions: [] };
        }
        return { success: true, predictions };

    } catch (e) {
        console.error('❌ [Intent Prediction] Failed:', e);
        return { success: false, error: e.message };
    }
});



// ============================================
// Action System IPC Handlers
// ============================================



// Explicit action: User directly asked U to do something
ipcMain.handle('execute-explicit-action', async (event, userText) => {
    console.log('🎯 [Action] Explicit action request:', userText.substring(0, 60));

    if (!actionPlanner || !screenAgent) {
        return { success: false, error: 'Action system not initialized' };
    }

    try {
        // Step 1: Plan the action
        const relevantContext = await contextManager.getRelevantContext(userText);
        const plan = await actionPlanner.planFromExplicit(userText, {
            recent: contextManager.getHistoryForAPI(10),
            longTerm: relevantContext.longTerm
        });

        if (!plan) {
            return { success: false, error: 'No actionable intent detected' };
        }

        if (plan.type === 'schedule') {
            console.log(`⏰ [Action] Scheduling reminder: ${plan.task}`);
            if (brain) {
                const date = new Date(Date.now() + (plan.minutes * 60 * 1000));
                const task = brain.scheduleTask(plan.task, date);
                return { success: true, scheduled: true, task };
            }
            return { success: false, error: 'Brain offline' };
        }

        // Step 2: Send plan to renderer for user confirmation
        if (mainWindow) {
            mainWindow.webContents.send('action-confirm-request', {
                goal: plan.goal,
                app: plan.app,
                stepsHint: plan.stepsHint,
                source: 'explicit'
            });
        }

        return { success: true, plan };
    } catch (e) {
        console.error('❌ [Action] Explicit action failed:', e);
        return { success: false, error: e.message };
    }
});

// Stop current action
ipcMain.handle('stop-action', async () => {
    if (screenAgent) {
        screenAgent.stop();
    }
    return { success: true };
});

// Confirm and execute action (from UI bubble)
ipcMain.handle('confirm-action', async (event, data) => {
    console.log('✅ [Action] User confirmed plan:', data);

    // Reset pending flag
    isActionPending = false;

    if (!screenAgent) {
        return { success: false, error: 'Screen Agent not ready' };
    }

    // Start execution
    // data: { goal, app, stepsHint, ... }
    screenAgent.executeAction(data.goal, data.app, data.stepsHint);

    return { success: true };
});

// Add setupChatGPT to initialization

/**
 * IÜ OS - Main Process
 * Always-on-top overlay window positioned on right edge
 */

const { app, BrowserWindow, screen, ipcMain, systemPreferences, desktopCapturer, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const LoggingSwitch = require('./LoggingSwitch');
const { resolveInceptionConfig } = require('./InceptionEnv');
const InceptionBootstrapper = require('./InceptionBootstrapper');

LoggingSwitch.install();

// Load .env from multiple locations (dev and production)
const envPaths = [
    path.join(app.getPath('userData'), '.env'),             // User data folder
    path.join(__dirname, '.env'),                           // Dev: project root
    path.join(process.resourcesPath || '', '.env'),         // Packaged: resources
    path.join(path.dirname(process.execPath), '.env'),      // Same folder as exe
];

let envLoaded = false;
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath, override: true });
        LoggingSwitch.execution('Main', `Loaded .env from: ${envPath}`);
        envLoaded = true;
        break;
    }
}

if (!envLoaded) {
    LoggingSwitch.execution('Main', 'No .env file found. Some features may be disabled.');
}

LoggingSwitch.setMode(process.env.IU_LOG_MODE || LoggingSwitch.getMode(), { persistEnv: true });

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

ipcMain.handle('logging-get-mode', () => {
    return { mode: LoggingSwitch.getMode() };
});

ipcMain.handle('logging-set-mode', (event, payload = {}) => {
    const requestedMode = String(payload.mode || '').trim();
    const mode = LoggingSwitch.setMode(requestedMode || 'execution');
    return { mode };
});

ipcMain.on('uiux-log', (event, payload = {}) => {
    const scope = String(payload?.scope || payload?.surface || 'renderer').trim() || 'renderer';
    const eventName = String(payload?.event || '').trim() || 'event';
    const data = payload?.data !== undefined ? payload.data : undefined;
    LoggingSwitch.uiux(scope, eventName, data);
});

const OpenAI = require('openai');

// Initialize OpenAI (handle missing API key gracefully)
let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    LoggingSwitch.execution('Main', 'OpenAI initialized');
} else {
    LoggingSwitch.execution('Main', 'OPENAI_API_KEY not set. Voice features disabled.');
}

let openrouter = null;
if (process.env.OPENROUTER_API_KEY) {
    const openrouterBaseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const openrouterHeaders = {};
    if (process.env.OPENROUTER_HTTP_REFERER) openrouterHeaders['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
    if (process.env.OPENROUTER_X_TITLE) openrouterHeaders['X-Title'] = process.env.OPENROUTER_X_TITLE;

    openrouter = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: openrouterBaseURL,
        defaultHeaders: Object.keys(openrouterHeaders).length ? openrouterHeaders : undefined
    });
    LoggingSwitch.execution('Main', `OpenRouter initialized @ ${openrouterBaseURL}`);
} else {
    LoggingSwitch.execution('Main', 'OPENROUTER_API_KEY not set. OpenRouter provider disabled.');
}

// ModelSwitch: seleccion por modelo y provider automatico
const ModelSwitch = require('./ModelSwitch');
if (openai) ModelSwitch.initOpenAI(openai);
if (openrouter) {
    ModelSwitch.initOpenRouter(openrouter, {
        source: 'env',
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    });
}
if (process.env.GOOGLE_API_KEY) {
    ModelSwitch.initGemini(process.env.GOOGLE_API_KEY);
} else {
    LoggingSwitch.execution('Main', 'GOOGLE_API_KEY not set. Gemini provider disabled.');
}

if (process.env.ANTHROPIC_API_KEY) {
    ModelSwitch.initAnthropic(process.env.ANTHROPIC_API_KEY);
} else {
    LoggingSwitch.execution('Main', 'ANTHROPIC_API_KEY not set. Anthropic provider disabled.');
}

const inceptionConfig = resolveInceptionConfig(process.env);
if (inceptionConfig.activeKey) {
    ModelSwitch.initInception(inceptionConfig.activeKey, {
        source: inceptionConfig.hasPersonalKey ? 'personal-env' : 'bootstrap-env',
        baseURL: inceptionConfig.baseUrl
    });
} else {
    LoggingSwitch.execution('Main', 'INCEPTION_API_KEY / IU_BOOTSTRAP_INCEPTION_API_KEY not set. Inception provider disabled.');
}

const providerSummary = ModelSwitch.getProviderSummary();
LoggingSwitch.execution('ModelSwitch', `Modelo: ${providerSummary.selectedModel?.displayName || providerSummary.selectedModel?.key || 'n/a'} | Chat: ${providerSummary.chatProvider} (${providerSummary.models[providerSummary.chatProvider]?.chat || 'n/a'}) | Vision: ${providerSummary.visionProvider} (${providerSummary.models[providerSummary.visionProvider]?.vision || 'n/a'})`);

// Action System: Planner + Screen Agent + Brain
const ActionPlanner = require('./ActionPlanner');
const ScreenAgent = require('./ScreenAgent');
const Brain = require('./Brain');
const ExecutionSessionManager = require('./ExecutionSessionManager');
const NotebookExecutionManager = require('./NotebookExecutionManager');
const KnowledgeService = require('./KnowledgeService');
// Browser Agent: control transversal de páginas web via CDP
const BrowserAgent = require('./BrowserAgent');
const { startBrowserCoreService, createBrowserCoreClient, toClientOptions } = require('./browser-core/dist');
let actionPlanner = null;
let screenAgent = null;
let brain = null;
let browserAgent = null; // Instanciado tras crear la mainWindow
let browserCoreService = null;
let browserCoreClient = null;
const executionSessions = new ExecutionSessionManager();
let inceptionBootstrapper = null;


// Auto-updater for automatic updates from GitHub Releases
const { autoUpdater } = require('electron-updater');
const nativeGlass = require('./NativeGlassController'); // Native Glass Window Controller
const stickyFace = require('./StickyFaceController');
const contextManager = require('./ContextManager'); // Central Knowledge System
const consolidator = require('./Consolidator'); // Nightly Memory Consolidation

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function isMissingUpdateConfigError(err) {
    const msg = String(err?.message || err || '');
    return msg.includes('app-update.yml') && msg.includes('ENOENT');
}

function isQuotaOrBillingError(err) {
    const message = String(err?.message || err || '').toLowerCase();
    const code = String(err?.code || '').toLowerCase();
    const type = String(err?.type || err?.error?.type || '').toLowerCase();
    return (
        message.includes('429') ||
        message.includes('quota') ||
        message.includes('billing') ||
        message.includes('rate limit') ||
        code === 'insufficient_quota' ||
        type === 'insufficient_quota'
    );
}

// Fix for OpenAI File/Blob upload in Node environments without globals
if (typeof globalThis.File === 'undefined' || typeof globalThis.Blob === 'undefined') {
    const { File, Blob } = require('node:buffer');
    globalThis.File = globalThis.File || File;
    globalThis.Blob = globalThis.Blob || Blob;
}


const LearningAgent = require('./LearningAgent');
const notebookManager = new NotebookExecutionManager({
    storageDir: path.join(app.getPath('userData'), 'chat-notebooks'),
    modelSwitch: ModelSwitch,
    isModelReady: () => ModelSwitch.isReady({ capability: 'chat' })
});
const knowledgeService = new KnowledgeService({
    notebookManager,
    storageDir: path.join(app.getPath('userData'), 'chat-notebooks')
});

let mainWindow = null;
let chatWindow = null;
let isLearningChatPinned = false;
let chatWindowBoundsBeforeLearning = null;
let currentUiTheme = 'light';
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
const USER_ENV_PATH = path.join(app.getPath('userData'), '.env');
const INCEPTION_ONBOARDING_STATE_PATH = path.join(app.getPath('userData'), 'inception_onboarding.json');
let currentWindowMode = WINDOW_MODES.SMALL;

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
const SIDEBAR_WIDTH = 420; // Slightly narrower for more usable desktop space
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
    if (isLearningChatPinned) {
        return;
    }
    const bounds = getChatBounds();
    if (!bounds) {
        return;
    }
    chatWindow.setBounds(bounds, animate);
}

function getFloatingChatBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = SIDEBAR_WIDTH;
    const height = Math.min(560, workArea.height - 40);
    const x = workArea.x + workArea.width - width - 20;
    const y = workArea.y + 20;
    return { x, y, width, height };
}

function pinChatWindowForLearning() {
    if (!chatWindow || chatWindow.isDestroyed()) {
        createChatWindow({ floating: true });
    }
    if (!chatWindow || chatWindow.isDestroyed()) return;

    if (!isLearningChatPinned) {
        chatWindowBoundsBeforeLearning = chatWindow.getBounds();
    }

    isLearningChatPinned = true;
    chatWindow.setAlwaysOnTop(true, 'screen-saver', 2);
    chatWindow.setBounds(getFloatingChatBounds(), true);
    chatWindow.show();
}

function unpinChatWindowAfterLearning() {
    if (!isLearningChatPinned) return;
    isLearningChatPinned = false;

    if (!chatWindow || chatWindow.isDestroyed()) {
        chatWindowBoundsBeforeLearning = null;
        return;
    }

    chatWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    if (chatWindowBoundsBeforeLearning) {
        chatWindow.setBounds(chatWindowBoundsBeforeLearning, true);
    } else {
        syncChatWindowPosition(true);
    }
    chatWindowBoundsBeforeLearning = null;
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
    const { x: areaX, y: areaY } = primaryDisplay.workArea;

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
            x = areaX + 20;
            y = areaY + 20;
            break;
        case WINDOW_MODES.MEDIUM:
            w = 240;
            h = Math.floor(height * 0.35);
            x = areaX + width - w - 20;
            y = areaY + 24;
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
            h = Math.floor(height * 0.9);
            x = areaX + width - w - 20;
            y = areaY + Math.floor((height - h) / 2);
            break;
    }

    return { width: w, height: h, x, y };
}

function applyWindowMode(mode, animate = true) {
    if (!mainWindow) return;
    if (mode === WINDOW_MODES.FULLSCREEN) {
        mode = WINDOW_MODES.LARGE;
    }

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

    const startupQuery = {};
    if (currentWindowMode === WINDOW_MODES.SMALL) {
        startupQuery.mode = 'small';
    } else if (currentWindowMode === WINDOW_MODES.BOOTLOADER) {
        startupQuery.mode = 'bootloader';
    }
    mainWindow.loadFile('renderer/index.html', { query: startupQuery });

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

function normalizeUiTheme(theme) {
    return String(theme || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
}

function pushUiThemeToChatWindow() {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    chatWindow.webContents.send('chat-ui-theme', { theme: currentUiTheme });
}

function createChatWindow(options = {}) {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
        return;
    }
    const floating = options.floating === true;

    const bounds = floating ? getFloatingChatBounds() : getChatBounds();

    chatWindow = new BrowserWindow({
        width: bounds?.width || SIDEBAR_WIDTH,
        height: bounds?.height || 600,
        x: bounds?.x || 0,
        y: bounds?.y || 0,
        parent: floating ? undefined : mainWindow,
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
        if (!isLearningChatPinned) {
            syncChatWindowPosition(false);
        }
        chatWindow.show();
        pushUiThemeToChatWindow();
    });

    chatWindow.on('closed', () => {
        chatWindow = null;
        isLearningChatPinned = false;
        chatWindowBoundsBeforeLearning = null;
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
    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        return { success: false, error: 'Provider de texto no inicializado' };
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

function buildChatSystemPrompt(relevantLearned, relevantContext) {
    let systemPrompt = `Eres U, un asistente digital conciso y eficaz. El usuario te escribe directamente.

Si el usuario pide ejecutar algo en su computador (abrir apps, enviar mensajes, buscar algo, etc.), responde brevemente confirmando lo que haras y llama la funcion execute_screen_action.

Si el usuario pide gestionar conocimiento personal, usa tools de CRUD:
- create_note, update_note, delete_note
- create_meta, update_meta, delete_meta
- attach_note_to_meta, detach_note_from_meta
Usa esas funciones cuando te pidan crear, editar, borrar o anidar notas/metas.

Si solo conversa o pregunta algo, responde de forma breve y util. Maximo 2-3 oraciones.
Responde en espanol.`;

    let learnedWorkflowsText = '';
    if (relevantLearned && relevantLearned.length > 0) {
        learnedWorkflowsText = relevantLearned.map((wf, i) => {
            return `${i + 1}. ${wf.workflowName}\n   Resumen: ${wf.summary}\n   Estilo: ${wf.executionStyle}`;
        }).join('\n');
        systemPrompt += `\n\nAPRENDIZAJES RELEVANTES DEL USUARIO:\n${learnedWorkflowsText}
\nSi vas a usar uno, di explicitamente en la PRIMERA linea:
"Perfecto, lo voy a hacer como me ensenaste en <nombre del aprendizaje>."
Si no estas seguro cual aplicar, pregunta una sola aclaracion corta antes de ejecutar.`;
    }

    if (relevantContext.longTerm) {
        systemPrompt += `\n\nMEMORIA A LARGO PLAZO:\n${relevantContext.longTerm}`;
    }

    return { systemPrompt, learnedWorkflowsText };
}

function shouldAskChatClarification(userText, variableAnalysis) {
    if (!variableAnalysis || !variableAnalysis.needsClarification) return false;
    const hasConflict = (variableAnalysis.variables || []).some((variable) => variable.conflict);
    if (hasConflict) return true;

    const needsConcreteTask = /(?:haz|hace|ayuda|ayudame|necesito|quiero|prepara|redacta|escribe|resuelve|sube|envia|entrega)/i.test(String(userText || ''));
    return needsConcreteTask;
}

function safeSliceText(value, max = 1200) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}...`;
}

function parseModelJsonPayload(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return null;

    const directTry = (() => {
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    })();
    if (directTry && typeof directTry === 'object') return directTry;

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch (_) { }
    }

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = raw.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (_) { }
    }

    return null;
}

async function chatCompletionJson(messages, repairLabel = 'payload', options = {}) {
    const maxAttempts = Math.max(2, Math.min(8, Number(options.maxAttempts || 5)));
    const schemaHint = String(options.schemaHint || '').trim();

    let attemptMessages = messages;
    const previousOutputs = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await ModelSwitch.chatCompletion({ messages: attemptMessages });
        const raw = String(response?.choices?.[0]?.message?.content || '').trim();
        previousOutputs.push(raw);

        const parsed = parseModelJsonPayload(raw);
        if (parsed && typeof parsed === 'object') {
            return { parsed, raw, attempt };
        }

        attemptMessages = [
            {
                role: 'system',
                content: [
                    'Devuelve UNICAMENTE JSON válido UTF-8.',
                    `Objetivo: ${repairLabel}.`,
                    'Sin markdown, sin bloques de código, sin texto adicional.',
                    schemaHint ? `Esquema esperado: ${schemaHint}` : '',
                    'Si dudas, responde con el objeto mínimo válido del esquema.'
                ].filter(Boolean).join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    objective: repairLabel,
                    schemaHint,
                    original_messages: messages,
                    previous_outputs: previousOutputs.slice(-3)
                })
            }
        ];
    }

    throw new Error(`No se pudo parsear JSON para ${repairLabel} tras ${maxAttempts} intentos`);
}

function extractNoteOutline(body, maxItems = 8) {
    const lines = String(body || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return [];

    const structural = [];
    for (const line of lines) {
        if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
            structural.push(line.replace(/^#{1,6}\s+/, '').slice(0, 110));
        }
        if (structural.length >= maxItems) break;
    }

    if (structural.length >= 3) {
        return structural.slice(0, maxItems);
    }

    const fallback = [];
    for (const line of lines) {
        if (line.length < 16) continue;
        fallback.push(line.slice(0, 110));
        if (fallback.length >= Math.min(3, maxItems)) break;
    }
    return fallback;
}

function buildNoteDiscoveryIndex(notes, maxNotes = 220) {
    return (Array.isArray(notes) ? notes : [])
        .slice(0, maxNotes)
        .map((tab) => ({
            id: String(tab?.id || '').trim(),
            title: String(tab?.title || '').trim() || 'Sin titulo',
            outline: extractNoteOutline(tab?.body || '', 8),
            charCount: String(tab?.body || '').trim().length
        }))
        .filter((item) => item.id);
}

function sanitizeNoteIdSelection(rawIds, validIds, limit = 12) {
    const list = Array.isArray(rawIds) ? rawIds : [];
    const unique = [];
    for (const value of list) {
        const id = String(value || '').trim();
        if (!id || !validIds.has(id) || unique.includes(id)) continue;
        unique.push(id);
        if (unique.length >= limit) break;
    }
    return unique;
}

function normalizeFocus(focus, limit = 6) {
    if (!Array.isArray(focus)) return [];
    return focus
        .map((item, index) => ({
            id: String(item?.id || `f${index + 1}`).trim() || `f${index + 1}`,
            title: String(item?.title || '').trim(),
            query: String(item?.query || '').trim(),
            intent: String(item?.intent || '').trim(),
            goal: String(item?.goal || '').trim()
        }))
        .filter((item) => item.title)
        .slice(0, limit);
}

function isInternalKnowledgeActionApp(appName) {
    const value = String(appName || '').trim().toLowerCase();
    return ['chat', 'notes', 'notas', 'knowledge', 'knowledge base', 'prompt chat'].includes(value);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePromptMetas(rawMetas, validNoteIds) {
    if (!Array.isArray(rawMetas)) return [];
    return rawMetas
        .map((meta) => ({
            id: String(meta?.id || '').trim(),
            title: String(meta?.title || '').trim(),
            description: String(meta?.description || '').trim(),
            noteIds: Array.isArray(meta?.noteIds)
                ? Array.from(new Set(meta.noteIds.map((id) => String(id)).filter((id) => validNoteIds.has(id))))
                : []
        }))
        .filter((meta) => meta.id && (meta.title || meta.description || meta.noteIds.length > 0))
        .slice(0, 40);
}

function normalizeAgentIntent(rawIntent) {
    const value = String(rawIntent || '').trim().toLowerCase();
    if (value === 'search_notes') return 'search_notes';
    if (value === 'answer_from_knowledge') return 'answer_from_knowledge';
    if (value === 'create_depth_links') return 'create_depth_links';
    if (value === 'action') return 'action';
    return 'respond';
}

function looksLikeLowQualityReply(text) {
    const value = String(text || '').trim();
    if (!value) return true;
    const lower = value.toLowerCase();
    const badStarts = [
        "i'm ready to help",
        'i’m ready to help',
        'how can i assist you',
        'how can i help you today',
        'how may i assist'
    ];
    return badStarts.some((item) => lower.includes(item));
}

function isSummaryRequest(prompt) {
    const lower = String(prompt || '').toLowerCase();
    const asksSummary = /(summary|resumen|resum[eé]|sintetiza|sintesis|sumariza)/i.test(lower);
    const mentionsKnowledge = /(nota|notas|meta|metas|knowledge|contexto)/i.test(lower);
    return asksSummary && mentionsKnowledge;
}

function buildSummaryFallbackFromKnowledge({ metas = [], notes = [], keptNotes = [] } = {}) {
    const topMetas = (Array.isArray(metas) ? metas : []).slice(0, 6);
    const topNotes = (Array.isArray(keptNotes) && keptNotes.length > 0 ? keptNotes : notes).slice(0, 8);

    const metaLines = topMetas.length > 0
        ? topMetas.map((meta, index) => {
            const title = String(meta?.title || '').trim() || `Meta ${index + 1}`;
            const desc = String(meta?.description || '').trim();
            const noteCount = Array.isArray(meta?.noteIds) ? meta.noteIds.length : 0;
            return `- ${title}${desc ? `: ${safeSliceText(desc, 120)}` : ''} (${noteCount} nota${noteCount === 1 ? '' : 's'})`;
        }).join('\n')
        : '- No encontré metas guardadas.';

    const noteLines = topNotes.length > 0
        ? topNotes.map((note) => {
            const title = String(note?.title || '').trim() || 'Sin titulo';
            const body = safeSliceText(String(note?.body || '').replace(/\s+/g, ' ').trim(), 110);
            return `- ${title}${body ? `: ${body}` : ''}`;
        }).join('\n')
        : '- No encontré notas guardadas.';

    return [
        `Resumen rápido: tienes ${metas.length} meta${metas.length === 1 ? '' : 's'} y ${notes.length} nota${notes.length === 1 ? '' : 's'}.`,
        '',
        'Metas:',
        metaLines,
        '',
        'Notas:',
        noteLines
    ].join('\n');
}

function getKnowledgeTools() {
    return [
        {
            type: 'function',
            function: {
                name: 'create_note',
                description: 'Crea una nota con titulo y contenido opcional.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Titulo de la nota' },
                        body: { type: 'string', description: 'Contenido inicial de la nota' }
                    },
                    required: ['title']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_note',
                description: 'Actualiza una nota existente por id.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota' },
                        title: { type: 'string', description: 'Nuevo titulo (opcional)' },
                        body: { type: 'string', description: 'Nuevo contenido (opcional)' }
                    },
                    required: ['note_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_note',
                description: 'Archiva o elimina una nota por id.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota' }
                    },
                    required: ['note_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'create_meta',
                description: 'Crea una meta con titulo y descripcion opcional.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Titulo de la meta' },
                        description: { type: 'string', description: 'Descripcion de la meta' }
                    },
                    required: ['title']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_meta',
                description: 'Actualiza una meta existente por id.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta' },
                        title: { type: 'string', description: 'Nuevo titulo (opcional)' },
                        description: { type: 'string', description: 'Nueva descripcion (opcional)' }
                    },
                    required: ['meta_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_meta',
                description: 'Elimina una meta por id.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta' }
                    },
                    required: ['meta_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'attach_note_to_meta',
                description: 'Anida una nota dentro de una meta.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta' },
                        note_id: { type: 'string', description: 'ID de la nota' }
                    },
                    required: ['meta_id', 'note_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'detach_note_from_meta',
                description: 'Desanida una nota de una meta.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta' },
                        note_id: { type: 'string', description: 'ID de la nota' }
                    },
                    required: ['meta_id', 'note_id']
                }
            }
        }
    ];
}

function describeMeta(meta) {
    if (!meta) return 'meta';
    const title = String(meta.title || '').trim() || 'meta';
    return `"${title}"`;
}

function describeNote(note) {
    if (!note) return 'nota';
    const title = String(note.title || '').trim() || 'nota';
    return `"${title}"`;
}

function executeKnowledgeToolCall(call) {
    if (!call?.function?.name) return null;
    const name = String(call.function.name || '').trim();
    let args = {};
    try {
        args = JSON.parse(call.function.arguments || '{}');
    } catch (_) {
        args = {};
    }

    if (name === 'create_note') {
        LoggingSwitch.execution('KnowledgeTool', `create_note title="${safeSliceText(args.title || '', 80)}"`);
        const created = knowledgeService.createNote({
            title: String(args.title || '').trim(),
            body: args.body !== undefined ? String(args.body || '') : ''
        });
        if (!created?.note) return { error: 'No pude crear la nota.' };
        return {
            reply: `Listo. Creé la nota ${describeNote(created.note)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'update_note') {
        LoggingSwitch.execution('KnowledgeTool', `update_note id="${String(args.note_id || '').trim()}"`);
        const updated = knowledgeService.updateNote(String(args.note_id || '').trim(), {
            title: args.title,
            body: args.body
        });
        if (!updated?.note) return { error: 'No encontré esa nota para actualizar.' };
        return {
            reply: `Actualicé la nota ${describeNote(updated.note)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'delete_note') {
        LoggingSwitch.execution('KnowledgeTool', `delete_note id="${String(args.note_id || '').trim()}"`);
        const noteId = String(args.note_id || '').trim();
        const deleted = knowledgeService.deleteNote(noteId);
        if (!deleted) return { error: 'No pude eliminar esa nota.' };
        return {
            reply: 'Listo. Eliminé esa nota.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'create_meta') {
        LoggingSwitch.execution('KnowledgeTool', `create_meta title="${safeSliceText(args.title || '', 80)}"`);
        const meta = knowledgeService.createMeta({
            title: String(args.title || '').trim(),
            description: String(args.description || '').trim()
        });
        if (!meta?.id) return { error: 'No pude crear la meta.' };
        return {
            reply: `Listo. Creé la meta ${describeMeta(meta)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'update_meta') {
        LoggingSwitch.execution('KnowledgeTool', `update_meta id="${String(args.meta_id || '').trim()}"`);
        const meta = knowledgeService.updateMeta(String(args.meta_id || '').trim(), {
            title: args.title,
            description: args.description
        });
        if (!meta?.id) return { error: 'No encontré esa meta para actualizar.' };
        return {
            reply: `Actualicé la meta ${describeMeta(meta)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'delete_meta') {
        LoggingSwitch.execution('KnowledgeTool', `delete_meta id="${String(args.meta_id || '').trim()}"`);
        const ok = knowledgeService.deleteMeta(String(args.meta_id || '').trim());
        if (!ok) return { error: 'No encontré esa meta para eliminar.' };
        return {
            reply: 'Meta eliminada.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'attach_note_to_meta') {
        LoggingSwitch.execution('KnowledgeTool', `attach_note_to_meta meta="${String(args.meta_id || '').trim()}" note="${String(args.note_id || '').trim()}"`);
        const meta = knowledgeService.attachNoteToMeta(String(args.meta_id || '').trim(), String(args.note_id || '').trim(), { source: 'manual' });
        if (!meta?.id) return { error: 'No pude anidar la nota en esa meta.' };
        return {
            reply: `Anidé la nota en la meta ${describeMeta(meta)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'detach_note_from_meta') {
        LoggingSwitch.execution('KnowledgeTool', `detach_note_from_meta meta="${String(args.meta_id || '').trim()}" note="${String(args.note_id || '').trim()}"`);
        const meta = knowledgeService.detachNoteFromMeta(String(args.meta_id || '').trim(), String(args.note_id || '').trim());
        if (!meta?.id) return { error: 'No pude desanidar la nota de esa meta.' };
        return {
            reply: `Quité la nota de la meta ${describeMeta(meta)}.`,
            state: knowledgeService.getKnowledgeState()
        };
    }

    return null;
}

async function inferLearningLinksForNote(noteTitle, noteBody, options = {}) {
    const maxLinks = Math.max(1, Math.min(6, Number(options.maxLinks || 4)));
    if (!String(noteBody || '').trim()) return [];

    const { parsed } = await chatCompletionJson([
        {
            role: 'system',
            content: [
                'Extrae variables de aprendizaje que el usuario deberia profundizar desde una nota.',
                'Responde SOLO JSON valido con formato:',
                '{"links":[{"keyword":"...","noteTitle":"...","reason":"...","confidence":0.0}]}',
                'Reglas:',
                `- links maximo ${maxLinks}.`,
                '- keyword debe existir literalmente dentro del texto de la nota.',
                '- noteTitle debe ser corto y accionable.',
                '- confidence de 0.0 a 1.0.',
                '- Incluye solo gaps reales de aprendizaje o expansion semantica valiosa.',
                '- No incluyas markdown ni texto adicional.'
            ].join('\n')
        },
        {
            role: 'user',
            content: JSON.stringify({
                noteTitle,
                noteBody: safeSliceText(noteBody, 4000)
            })
        }
    ], `links de profundizacion para ${noteTitle || 'nota'}`, {
        schemaHint: '{"links":[{"keyword":"...","noteTitle":"...","reason":"...","confidence":0.72}]}'
    });

    return Array.isArray(parsed?.links)
        ? parsed.links
            .map((item) => ({
                keyword: String(item?.keyword || '').trim(),
                noteTitle: String(item?.noteTitle || '').trim(),
                reason: String(item?.reason || '').trim(),
                confidence: Number(item?.confidence || 0)
            }))
            .filter((item) => item.keyword && item.noteTitle && String(noteBody || '').toLowerCase().includes(item.keyword.toLowerCase()))
            .filter((item) => Number.isFinite(item.confidence) && item.confidence >= 0.62)
            .slice(0, maxLinks)
        : [];
}

ipcMain.handle('prompt-agent-run', async (event, payload = {}) => {
    const prompt = String(payload?.prompt || '').trim();
    const runId = String(payload?.runId || `run_${Date.now()}`).trim();

    const emit = (phase, message, extra = {}) => {
        event.sender.send('prompt-agent-progress', {
            runId,
            phase,
            message: String(message || '').trim(),
            timestamp: Date.now(),
            ...extra
        });
    };

    if (!prompt) {
        emit('error', 'Prompt vacío');
        return { success: false, error: 'Prompt vacio', userMessages: [], assistantReply: '' };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        emit('error', 'Modelo no disponible');
        return { success: false, error: 'Provider de texto no inicializado', userMessages: [], assistantReply: '' };
    }

    try {
        emit('planning', 'Entendí tu instrucción. Voy a analizar metas y notas.', { visibility: 'public' });
        const notebookState = notebookManager.getState();
        const notes = Array.isArray(notebookState?.tabs)
            ? notebookState.tabs
                .map((tab) => ({
                    id: String(tab?.id || '').trim(),
                    title: String(tab?.title || '').trim() || 'Sin titulo',
                    body: String(tab?.body || '').trim()
                }))
                .filter((tab) => tab.id)
            : [];
        const noteIds = new Set(notes.map((tab) => tab.id));
        const metas = sanitizePromptMetas(knowledgeService.getMetas(), noteIds);
        const notesById = new Map(notes.map((tab) => [tab.id, tab]));
        const noteDiscoveryIndex = buildNoteDiscoveryIndex(notes, 220);
        const metaCatalog = metas.map((meta) => ({
            id: meta.id,
            title: meta.title || 'Meta sin titulo',
            description: safeSliceText(meta.description, 280),
            noteIds: meta.noteIds,
            sampleNoteTitles: meta.noteIds.slice(0, 4).map((id) => notesById.get(id)?.title || 'Sin titulo')
        }));
        emit('planning', `Contexto cargado: ${metas.length} metas y ${notes.length} notas.`, { visibility: 'public' });

        const mutationProbe = await ModelSwitch.chatCompletion({
            messages: [
                {
                    role: 'system',
                    content: [
                        'Evalua si el usuario pide una mutacion directa de conocimiento (notas/metas).',
                        'Si el usuario pide crear/editar/borrar/anidar, llama exactamente una funcion.',
                        'Si no aplica, responde solo texto corto sin tool_calls.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            tools: getKnowledgeTools(),
            tool_choice: 'auto'
        });
        const mutationMessage = mutationProbe?.choices?.[0]?.message || {};
        if (Array.isArray(mutationMessage.tool_calls) && mutationMessage.tool_calls.length > 0) {
            emit('execution', 'Detecté una instrucción de edición. La estoy aplicando.', { visibility: 'public' });
            const result = executeKnowledgeToolCall(mutationMessage.tool_calls[0]);
            if (result?.error) {
                emit('error', result.error);
                return {
                    success: false,
                    runId,
                    error: result.error,
                    userMessages: [],
                    assistantReply: ''
                };
            }
            const assistantReply = String(result?.reply || 'Listo. Actualicé tu conocimiento.').trim();
            return {
                success: true,
                runId,
                mode: 'knowledge_mutation',
                userMessages: [],
                assistantReply,
                selectedMetaIds: [],
                selectedNotes: [],
                learningLinkSuggestions: [],
                actionPlan: null,
                actionBlockedAsInternal: false
            };
        }

        emit('planning', 'Decidiendo la ruta óptima para responderte.', { visibility: 'public' });
        const { parsed: route } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Eres un asistente de clase mundial.',
                    'Tu trabajo es responder natural y bien, y usar las herramientas internas solo cuando hagan falta.',
                    'Responde SOLO JSON:',
                    '{"intent":"respond|search_notes|answer_from_knowledge|create_depth_links|action","assistant_reply":"...","objective":"...","search_query":"...","target_note_titles":["..."],"reason":"..."}',
                    'Reglas:',
                    '- intent="respond": conversación casual, conocimiento general o preguntas que puedes responder sin revisar notas/metas.',
                    '- intent="search_notes": cuando el usuario quiere que inspecciones, resumas, busques o encuentres cosas dentro de sus notas.',
                    '- intent="answer_from_knowledge": cuando necesitas metas/notas del usuario para contestar bien.',
                    '- intent="create_depth_links": cuando pide crear notas de profundización, puntos o anidaciones sobre notas/metas.',
                    '- intent="action": solo si el usuario pide ejecutar algo en el PC.',
                    '- assistant_reply SIEMPRE obligatorio y user-ready. Nunca expliques tu pipeline interno.',
                    '- objective debe explicar la tarea operativa a realizar si no es solo responder.',
                    '- search_query resume que buscarías en notas/metas.',
                    '- target_note_titles ayuda a ubicar notas concretas cuando aplique.',
                    '- No ejecutes acciones del PC en esta fase.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    prompt,
                    notesCount: notes.length,
                    metasCount: metas.length,
                    metasPreview: metas.slice(0, 6).map((meta) => ({
                        id: meta.id,
                        title: safeSliceText(meta.title, 80),
                        description: safeSliceText(meta.description, 120),
                        noteCount: meta.noteIds.length
                    })),
                    noteTitles: notes.slice(0, 24).map((note) => ({
                        id: note.id,
                        title: safeSliceText(note.title, 100)
                    }))
                })
            }
        ], 'decision del agente principal', {
            schemaHint: '{"intent":"respond","assistant_reply":"...","objective":"...","search_query":"...","target_note_titles":["..."],"reason":"..."}'
        });

        const routeIntent = normalizeAgentIntent(route?.intent);
        const routeReply = String(route?.assistant_reply || '').trim();
        const routeObjective = String(route?.objective || prompt).trim() || prompt;
        const routeQuery = String(route?.search_query || routeObjective || prompt).trim() || prompt;
        const targetNoteTitles = Array.isArray(route?.target_note_titles)
            ? route.target_note_titles
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 6)
            : [];
        console.log('🧭 [PromptAgent] Route decision', {
            runId,
            intent: routeIntent,
            reason: String(route?.reason || '').trim(),
            prompt: safeSliceText(prompt, 160),
            metas: metas.length,
            notes: notes.length
        });
        LoggingSwitch.uiux('prompt_agent', 'route_decision', {
            runId,
            intent: routeIntent,
            reason: safeSliceText(route?.reason || '', 180),
            promptPreview: safeSliceText(prompt, 180),
            metasCount: metas.length,
            notesCount: notes.length
        });
        emit('planning', `Ruta seleccionada: ${routeIntent}.`, { visibility: 'public' });

        if (routeIntent === 'respond') {
            const assistantReply = routeReply || 'Te leo. ¿Qué necesitas?';
            LoggingSwitch.uiux('prompt_agent', 'chat_mode_reply', {
                runId,
                replyPreview: safeSliceText(assistantReply, 200)
            });
            return {
                success: true,
                runId,
                mode: 'direct',
                userMessages: [],
                assistantReply,
                selectedMetaIds: [],
                selectedNotes: [],
                actionPlan: null
            };
        }

        const { parsed: shortlist } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Eres un agente de investigación para un knowledge base personal.',
                    'Tu trabajo es decidir qué metas y notas mirar antes de responder o crear profundizaciones.',
                    'Responde SOLO JSON:',
                    '{"metaIds":["..."],"candidateNoteIds":["..."],"readOrder":["..."],"sourceNoteIds":["..."],"why":"..."}',
                    'Reglas:',
                    '- metaIds maximo 6.',
                    '- candidateNoteIds maximo 16.',
                    '- readOrder debe ser subconjunto ordenado de candidateNoteIds o sourceNoteIds.',
                    '- sourceNoteIds sirve para identificar notas exactas que seran el origen de puntos de profundizacion.',
                    '- Usa SOLO ids existentes.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    prompt,
                    intent: routeIntent,
                    objective: routeObjective,
                    searchQuery: routeQuery,
                    targetNoteTitles,
                    metas: metaCatalog,
                    notesIndex: noteDiscoveryIndex
                })
            }
        ], 'seleccion de contexto del agente principal', {
            schemaHint: '{"metaIds":["meta_1"],"candidateNoteIds":["tab_1"],"readOrder":["tab_1"],"sourceNoteIds":["tab_1"],"why":"..."}'
        });

        const validMetaIds = new Set(metaCatalog.map((meta) => meta.id));
        const selectedMetaIds = sanitizeNoteIdSelection(shortlist?.metaIds, validMetaIds, 5);
        const selectedFromMetas = selectedMetaIds
            .flatMap((metaId) => metaCatalog.find((meta) => meta.id === metaId)?.noteIds || []);
        const sourceNoteIds = sanitizeNoteIdSelection(shortlist?.sourceNoteIds, noteIds, 6);
        const initialCandidates = sanitizeNoteIdSelection(shortlist?.candidateNoteIds, noteIds, 16);
        const orderedPool = new Set([...sourceNoteIds, ...initialCandidates]);
        const orderedCandidates = sanitizeNoteIdSelection(shortlist?.readOrder, orderedPool, 16);
        const readQueue = sanitizeNoteIdSelection([...sourceNoteIds, ...selectedFromMetas, ...orderedCandidates, ...initialCandidates], noteIds, 16);
        emit('scanning', `Voy a revisar ${readQueue.length} nota(s) relevantes.`, { visibility: 'public' });

        if (readQueue.length === 0 && noteDiscoveryIndex.length > 0) {
            const { parsed: forcedSelection } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Debes seleccionar al menos 1 nota para inspección inicial si el objetivo depende de notas.',
                        'Responde SOLO JSON: {"candidateNoteIds":["..."],"why":"..."}',
                        '- Maximo 6 ids.',
                        '- Solo ids del índice.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        prompt,
                        intent: routeIntent,
                        objective: routeObjective,
                        targetNoteTitles,
                        notesIndex: noteDiscoveryIndex
                    })
                }
            ], 'seleccion inicial forzada', {
                schemaHint: '{"candidateNoteIds":["tab_1"],"why":"..."}'
            });

            const forcedIds = sanitizeNoteIdSelection(forcedSelection?.candidateNoteIds, noteIds, 6);
            readQueue.push(...forcedIds);
        }

        const evaluations = [];
        for (const noteId of readQueue) {
            const note = notesById.get(noteId);
            if (!note) continue;
            const { parsed: evaluation } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Evalúa si una nota es útil para ejecutar un objetivo.',
                        'Responde SOLO JSON:',
                        '{"noteId":"...","keep":true,"score":0,"why":"...","howToUse":"..."}',
                        'Score de 0 a 100.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        prompt,
                        intent: routeIntent,
                        objective: routeObjective,
                        note: {
                            id: note.id,
                            title: note.title,
                            body: safeSliceText(note.body, 4500)
                        }
                    })
                }
            ], `evaluacion nota ${noteId}`, {
                schemaHint: '{"noteId":"tab_1","keep":true,"score":78,"why":"...","howToUse":"..."}'
            });
            evaluations.push({
                noteId: note.id,
                title: note.title,
                keep: Boolean(evaluation?.keep),
                score: Math.max(0, Math.min(100, Number(evaluation?.score || 0))),
                why: String(evaluation?.why || '').trim(),
                howToUse: String(evaluation?.howToUse || '').trim()
            });
        }
        emit('synthesis', 'Generando respuesta final con el contexto encontrado.', { visibility: 'public' });

        const keptNotes = evaluations
            .filter((item) => item.keep)
            .sort((a, b) => b.score - a.score)
            .slice(0, routeIntent === 'create_depth_links' ? 4 : 8)
            .map((item) => {
                const note = notesById.get(item.noteId);
                return note ? {
                    id: note.id,
                    title: note.title,
                    body: safeSliceText(note.body, routeIntent === 'create_depth_links' ? 3600 : 1400),
                    score: item.score,
                    why: item.why,
                    howToUse: item.howToUse
                } : null;
            })
            .filter(Boolean);

        if (routeIntent === 'create_depth_links') {
            const sourceNotes = sourceNoteIds.length > 0
                ? sourceNoteIds.map((id) => notesById.get(id)).filter(Boolean)
                : keptNotes.slice(0, 3);
            const learningLinkSuggestions = [];
            emit('execution', 'Creando puntos de profundización y anidaciones.', { visibility: 'public' });

            for (const note of sourceNotes) {
                try {
                    const links = await inferLearningLinksForNote(note.title, note.body, { maxLinks: 4 });
                    if (links.length > 0) {
                        learningLinkSuggestions.push({
                            sourceNoteId: note.id,
                            sourceNoteTitle: note.title || 'Sin titulo',
                            links
                        });
                    }
                } catch (linkErr) {
                    console.warn('⚠️ [PromptAgent] Link suggestion failed for note', note.id, linkErr?.message || linkErr);
                }
            }

            const { parsed: depthReply } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Redacta la respuesta final del asistente tras crear puntos de profundizacion.',
                        'Responde SOLO JSON: {"assistant_reply":"..."}',
                        'Reglas:',
                        '- Explica brevemente qué nota(s) tomaste como origen.',
                        '- Aclara que no editaste el texto de la nota.',
                        '- Si creaste notas nuevas potenciales, dilo de forma natural.',
                        '- No menciones reasoning interno, JSON ni pipeline.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        prompt,
                        objective: routeObjective,
                        sourceNotes: sourceNotes.map((note) => ({
                            id: note.id,
                            title: note.title
                        })),
                        suggestions: learningLinkSuggestions
                    })
                }
            ], 'respuesta final de profundizacion', {
                schemaHint: '{"assistant_reply":"..."}'
            });

            return {
                success: true,
                runId,
                mode: 'knowledge_depth',
                userMessages: [],
                assistantReply: String(depthReply?.assistant_reply || routeReply || 'Ya dejé listos los puntos de profundización.').trim(),
                selectedMetaIds,
                selectedNotes: sourceNotes.map((note) => ({ id: note.id, title: note.title })),
                learningLinkSuggestions,
                applyLearningLinks: true,
                actionPlan: null,
                actionBlockedAsInternal: false
            };
        }

        const { parsed: synthesis } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Redacta la respuesta final del asistente para el chat principal.',
                    'Responde SOLO JSON:',
                    '{"assistant_reply":"...","action_plan":{"goal":"...","app":"...","steps_hint":"...","confidence":0}}',
                    'Reglas:',
                    '- assistant_reply debe responder directamente al usuario.',
                    '- Si buscaste en notas, dilo con naturalidad y resume hallazgos concretos.',
                    '- Si no encontraste evidencia suficiente, dilo sin pedir que pegue las notas cuando sí tenías acceso.',
                    '- action_plan opcional.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    prompt,
                    intent: routeIntent,
                    objective: routeObjective,
                    selected_metas: selectedMetaIds.map((id) => metaCatalog.find((meta) => meta.id === id)).filter(Boolean),
                    notes_index: noteDiscoveryIndex,
                    note_evaluations: evaluations,
                    selected_notes: keptNotes
                })
            }
        ], 'sintesis prompt principal', {
            schemaHint: '{"assistant_reply":"...","action_plan":{"goal":"...","app":"...","steps_hint":"...","confidence":72}}'
        });

        let assistantReply = String(synthesis?.assistant_reply || '').trim();
        if (!assistantReply) {
            throw new Error('La síntesis del agente no devolvió una respuesta suficiente');
        }
        if (looksLikeLowQualityReply(assistantReply) && isSummaryRequest(prompt)) {
            assistantReply = buildSummaryFallbackFromKnowledge({
                metas,
                notes,
                keptNotes
            });
            emit('synthesis', 'Apliqué un resumen robusto para evitar respuesta genérica.', { visibility: 'public' });
        }

        const actionPlanRaw = synthesis?.action_plan && typeof synthesis.action_plan === 'object'
            ? synthesis.action_plan
            : null;
        const actionPlan = actionPlanRaw
            ? {
                goal: String(actionPlanRaw.goal || '').trim(),
                app: String(actionPlanRaw.app || '').trim(),
                steps_hint: String(actionPlanRaw.steps_hint || '').trim(),
                confidence: (() => {
                    const parsed = Number(actionPlanRaw.confidence || 0);
                    if (!Number.isFinite(parsed)) return 0;
                    const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
                    return Math.max(0, Math.min(100, normalized));
                })()
            }
            : null;

        const validAction = actionPlan && actionPlan.goal && actionPlan.app && actionPlan.confidence >= 60;
        const blockedInternalAction = validAction && isInternalKnowledgeActionApp(actionPlan.app);
        const actionRequestId = `prompt_action_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
        console.log('🧭 [PromptAgent] Action plan decision', {
            runId,
            actionRequestId,
            prompt: safeSliceText(prompt, 220),
            validAction: Boolean(validAction),
            blockedInternalAction,
            actionPlan: actionPlan || null
        });
        LoggingSwitch.uiux('prompt_agent', 'action_plan_decision', {
            runId,
            actionRequestId,
            validAction: Boolean(validAction),
            blockedInternalAction: Boolean(blockedInternalAction),
            actionPlan: actionPlan
                ? {
                    app: actionPlan.app,
                    goalPreview: safeSliceText(actionPlan.goal, 160),
                    confidence: actionPlan.confidence
                }
                : null
        });

        if (validAction && mainWindow && !mainWindow.isDestroyed()) {
            if (blockedInternalAction) {
                console.log('⛔ [PromptAgent] Blocking external control for internal-knowledge action', {
                    runId,
                    actionRequestId,
                    app: actionPlan.app,
                    goal: actionPlan.goal
                });
                emit('execution', 'Plan interno detectado: no se activará control automático del PC');
            } else {
                const actionPayload = {
                    goal: actionPlan.goal,
                    app: actionPlan.app,
                    stepsHint: actionPlan.steps_hint || '',
                    source: 'prompt_agent',
                    requestId: actionRequestId,
                    runId,
                    reason: 'Generated by prompt-agent action_plan'
                };
                console.log('📤 [PromptAgent] Sending action-confirm-request', actionPayload);
                mainWindow.webContents.send('action-confirm-request', actionPayload);
                LoggingSwitch.uiux('prompt_agent', 'action_confirm_requested', {
                    runId,
                    requestId: actionPayload.requestId,
                    app: actionPayload.app,
                    goalPreview: safeSliceText(actionPayload.goal, 160)
                });
                emit('execution', `Preparé ejecución en ${actionPlan.app} y la dejé lista para confirmar`);
            }
        }

        const learningLinkSuggestions = [];
        for (const note of keptNotes.slice(0, 3)) {
            try {
                const links = await inferLearningLinksForNote(note.title, note.body, { maxLinks: 3 });
                if (links.length > 0) {
                    learningLinkSuggestions.push({
                        sourceNoteId: note.id,
                        sourceNoteTitle: note.title || 'Sin titulo',
                        links
                    });
                }
            } catch (linkErr) {
                console.warn('⚠️ [PromptAgent] Link suggestion failed for note', note.id, linkErr?.message || linkErr);
            }
        }
        LoggingSwitch.uiux('prompt_agent', 'learning_link_suggestions', {
            runId,
            suggestions: learningLinkSuggestions.length
        });
        LoggingSwitch.execution('PromptAgent', `run=${runId} intent=${routeIntent} metas=${metas.length} notes=${notes.length} readQueue=${readQueue.length} kept=${keptNotes.length} links=${learningLinkSuggestions.length}`);
        return {
            success: true,
            runId,
            mode: 'knowledge',
            userMessages: [],
            assistantReply,
            selectedMetaIds,
            selectedNotes: keptNotes.map((item) => ({ id: item.id, title: item.title })),
            learningLinkSuggestions: [],
            applyLearningLinks: false,
            actionPlan: validAction ? actionPlan : null,
            actionBlockedAsInternal: Boolean(blockedInternalAction)
        };
    } catch (error) {
        console.error('❌ [PromptAgent] Failed:', error);
        emit('error', 'Falló el análisis del prompt principal');
        return {
            success: false,
            runId,
            error: error?.message || 'No se pudo ejecutar el agente principal',
            userMessages: [],
            assistantReply: ''
        };
    }
});

ipcMain.handle('chat-bootstrap', async () => {
    const snapshot = notebookManager.bootstrap();
    return {
        ...snapshot,
        metas: knowledgeService.bootstrap()
    };
});

ipcMain.handle('get-ui-theme', async () => {
    return { theme: currentUiTheme };
});

ipcMain.handle('set-ui-theme', async (event, payload = {}) => {
    currentUiTheme = normalizeUiTheme(payload?.theme);
    pushUiThemeToChatWindow();
    return { success: true, theme: currentUiTheme };
});

ipcMain.handle('chat-create-tab', async (event, payload = {}) => {
    return knowledgeService.createNote(payload);
});

ipcMain.handle('chat-update-tab', async (event, payload = {}) => {
    const updated = knowledgeService.updateNote(payload.tabId, payload);
    const tab = updated?.note || null;
    return {
        tab,
        state: knowledgeService.getKnowledgeState()
    };
});

ipcMain.handle('chat-set-active-tab', async (event, payload = {}) => {
    return notebookManager.setActiveTab(payload.tabId);
});

ipcMain.handle('chat-archive-tab', async (event, payload = {}) => {
    const result = knowledgeService.deleteNote(payload.tabId);
    return result?.state || knowledgeService.getKnowledgeState();
});

ipcMain.handle('chat-create-execution', async (event, payload = {}) => {
    return notebookManager.createExecution(payload);
});

ipcMain.handle('chat-set-active-execution', async (event, payload = {}) => {
    return notebookManager.setActiveExecution(payload.executionId);
});

ipcMain.handle('chat-move-execution', async (event, payload = {}) => {
    return notebookManager.reassignExecution(payload.executionId, payload.tabId);
});

ipcMain.handle('chat-toggle-variable-persistence', async (event, payload = {}) => {
    return notebookManager.toggleVariablePersistence(payload);
});

ipcMain.handle('chat-request-inference', async (event, payload = {}) => {
    const analysis = await notebookManager.analyzeVariables(payload);
    return {
        ...analysis,
        state: notebookManager.getState()
    };
});

ipcMain.handle('notes-bootstrap', async () => {
    return knowledgeService.getKnowledgeState();
});

ipcMain.handle('chat-get-metas', async () => {
    return { metas: knowledgeService.getMetas() };
});

ipcMain.handle('chat-save-metas', async (event, payload = {}) => {
    return { metas: knowledgeService.setMetas(payload?.metas) };
});

ipcMain.handle('knowledge-get-state', async () => {
    return knowledgeService.getKnowledgeState();
});

ipcMain.handle('knowledge-create-meta', async (event, payload = {}) => {
    const meta = knowledgeService.createMeta(payload);
    return { meta, metas: knowledgeService.getMetas() };
});

ipcMain.handle('knowledge-update-meta', async (event, payload = {}) => {
    const meta = knowledgeService.updateMeta(payload.metaId, payload.patch || {});
    return { meta, metas: knowledgeService.getMetas() };
});

ipcMain.handle('knowledge-delete-meta', async (event, payload = {}) => {
    const ok = knowledgeService.deleteMeta(payload.metaId);
    return { ok, metas: knowledgeService.getMetas() };
});

ipcMain.handle('knowledge-attach-note', async (event, payload = {}) => {
    const meta = knowledgeService.attachNoteToMeta(payload.metaId, payload.noteId, { source: payload.source || 'manual' });
    return { meta, metas: knowledgeService.getMetas() };
});

ipcMain.handle('knowledge-detach-note', async (event, payload = {}) => {
    const meta = knowledgeService.detachNoteFromMeta(payload.metaId, payload.noteId);
    return { meta, metas: knowledgeService.getMetas() };
});

ipcMain.handle('notes-generate-injected-chat', async (event, payload = {}) => {
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) {
        return {
            success: false,
            error: 'Prompt vacio',
            userMessages: [],
            assistantReply: ''
        };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        return {
            success: false,
            error: 'Provider de texto no inicializado',
            userMessages: [],
            assistantReply: ''
        };
    }

    try {
        const state = notebookManager.getState();
        const notes = (state.tabs || [])
            .map((tab) => ({
                id: String(tab?.id || '').trim(),
                title: String(tab?.title || '').trim() || 'Sin titulo',
                body: String(tab?.body || '').trim()
            }))
            .filter((tab) => tab.id);
        const noteIds = new Set(notes.map((tab) => tab.id));
        const notesById = new Map(notes.map((tab) => [tab.id, tab]));
        const noteIndex = buildNoteDiscoveryIndex(notes, 220);

        const { parsed: selection } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Eres un agente que decide qué notas leer para ejecutar un prompt.',
                    'Responde SOLO JSON:',
                    '{"candidateNoteIds":["..."],"readOrder":["..."],"why":"..."}',
                    'Reglas: máximo 6 notas. Usa solo ids existentes.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({ prompt, notesIndex: noteIndex })
            }
        ], 'seleccion de notas para inyeccion', {
            schemaHint: '{"candidateNoteIds":["tab_1"],"readOrder":["tab_1"],"why":"..."}'
        });

        const candidateIds = sanitizeNoteIdSelection(selection?.candidateNoteIds, noteIds, 6);
        const orderedIds = sanitizeNoteIdSelection(selection?.readOrder, new Set(candidateIds), 6);
        const selectedTabs = sanitizeNoteIdSelection([...orderedIds, ...candidateIds], noteIds, 6)
            .map((id) => notesById.get(id))
            .filter(Boolean);

        const noteContext = selectedTabs
            .map((tab, index) => {
                return [
                    `[Nota ${index + 1}]`,
                    `id: ${tab.id}`,
                    `titulo: ${tab.title || 'Sin titulo'}`,
                    `contenido:`,
                    safeSliceText(tab.body || '', 1800)
                ].join('\n');
            })
            .join('\n\n');

        const response = await ModelSwitch.chatCompletion({
            messages: [
                {
                    role: 'system',
                    content: [
                        'Eres un orquestador UX de ejecucion.',
                        'Debes responder SOLO JSON valido con esta forma:',
                        '{"user_messages":[{"type":"note_title|instruction","text":"...","noteTitle":"..."}],"assistant_reply":"..."}',
                        'Reglas:',
                        '- user_messages son mensajes del lado del usuario, en primera persona, cortos y accionables.',
                        '- Incluye titulos de notas como mensajes type="note_title".',
                        '- Incluye varios parrafos cortos type="instruction" describiendo exactamente que se hara.',
                        '- assistant_reply debe ser autentico, breve y aceptar ejecucion sin preguntas innecesarias.',
                        '- No uses markdown, no uses bloques de codigo, solo JSON.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: [
                        `Prompt inicial del usuario: ${prompt}`,
                        '',
                        'Notas disponibles para basar la ejecucion:',
                        noteContext || '[Sin notas disponibles]'
                    ].join('\n')
                }
            ]
        });

        const content = response?.choices?.[0]?.message?.content || '';
        const parsed = parseModelJsonPayload(content);
        const userMessages = Array.isArray(parsed?.user_messages)
            ? parsed.user_messages
                .map((message) => ({
                    type: message?.type === 'note_title' ? 'note_title' : 'instruction',
                    text: String(message?.text || '').trim(),
                    noteTitle: String(message?.noteTitle || '').trim() || null,
                    noteId: null
                }))
                .filter((message) => message.text.length > 0)
            : [];
        const assistantReply = String(parsed?.assistant_reply || '').trim();

        if (!assistantReply || userMessages.length === 0) {
            return {
                success: false,
                error: 'No fue posible generar una respuesta estructurada del agente',
                userMessages,
                assistantReply: ''
            };
        }

        return {
            success: true,
            prompt,
            selectedNotes: selectedTabs.map((tab) => ({
                id: tab.id,
                title: tab.title || 'Sin titulo'
            })),
            userMessages,
            assistantReply
        };
    } catch (error) {
        console.error('❌ [NotesInjection] Failed:', error);
        return {
            success: false,
            error: error?.message || 'No se pudo preparar la ejecucion desde notas',
            userMessages: [],
            assistantReply: ''
        };
    }
});

ipcMain.handle('meta-suggest-notes', async (event, payload = {}) => {
    const title = String(payload?.title || '').trim();
    const description = String(payload?.description || '').trim();
    const goalText = `${title}\n${description}`.trim();

    if (!goalText) {
        console.log('🧠 [MetaSuggest] Empty goal text');
        return { success: true, noteIds: [] };
    }

    const currentState = notebookManager.getState();
    const allTabs = Array.isArray(currentState?.tabs) ? currentState.tabs : [];
    if (allTabs.length === 0) {
        console.log('🧠 [MetaSuggest] No tabs available');
        return { success: true, noteIds: [] };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        console.log('🧠 [MetaSuggest] Model not ready');
        return { success: false, noteIds: [], error: 'Modelo no disponible' };
    }

    const notes = allTabs.map((tab) => ({
        id: String(tab?.id || '').trim(),
        title: String(tab?.title || '').trim() || 'Sin titulo',
        body: String(tab?.body || '').trim()
    })).filter((tab) => tab.id);
    const validIds = new Set(notes.map((tab) => tab.id));
    const notesDigest = buildNoteDiscoveryIndex(notes, 220);

    try {
        const { parsed } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Selecciona notas claramente alineadas con la meta usando semántica profunda.',
                    'Responde SOLO JSON con formato:',
                    '{"matches":[{"noteId":"id","score":0-100,"why":"razon corta"}]}',
                    'Reglas: maximo 4 notas, sin texto fuera del JSON.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    meta: { title, description },
                    notesIndex: notesDigest
                })
            }
        ], 'meta suggest notes', {
            schemaHint: '{"matches":[{"noteId":"tab_1","score":84,"why":"..."}]}'
        });

        const modelMatches = Array.isArray(parsed?.matches) ? parsed.matches : [];
        const noteIds = modelMatches
            .map((item) => ({
                noteId: String(item?.noteId || '').trim(),
                score: Math.max(0, Math.min(100, Number(item?.score || 0)))
            }))
            .filter((item) => item.noteId && validIds.has(item.noteId))
            .sort((a, b) => b.score - a.score)
            .slice(0, 4)
            .map((item) => item.noteId);

        console.log('🧠 [MetaSuggest] Selected by model', { metaTitle: title, noteIds });
        return { success: true, noteIds };
    } catch (error) {
        console.error('❌ [MetaSuggest] Failed:', error);
        return { success: false, noteIds: [], error: error?.message || 'No se pudo sugerir notas' };
    }
});

ipcMain.handle('note-infer-learning-links', async (event, payload = {}) => {
    const noteTitle = String(payload?.title || '').trim();
    const noteBody = String(payload?.body || '').trim();
    if (!noteBody) {
        console.log('🧠 [LearningInfer] Empty note body');
        return { success: true, links: [] };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        console.log('🧠 [LearningInfer] Model not ready');
        return { success: true, links: [] };
    }

    try {
        const modelLinks = await inferLearningLinksForNote(noteTitle, noteBody, { maxLinks: 4 });

        console.log('🧠 [LearningInfer] Model links', {
            noteTitle,
            bodyLength: noteBody.length,
            count: modelLinks.length,
            keywords: modelLinks.map((item) => item.keyword)
        });
        return { success: true, links: modelLinks };
    } catch (error) {
        console.error('❌ [NoteInferLinks] Failed:', error);
        return { success: true, links: [] };
    }
});

ipcMain.handle('meta-agent-run', async (event, payload = {}) => {
    const metaId = String(payload?.metaId || '').trim();
    const title = String(payload?.title || '').trim();
    const description = String(payload?.description || '').trim();
    const goal = `${title}\n${description}`.trim();

    const emit = (phase, message, extra = {}) => {
        event.sender.send('meta-agent-progress', {
            metaId,
            phase,
            message,
            timestamp: Date.now(),
            ...extra
        });
    };

    if (!goal) {
        emit('error', 'La meta está vacía');
        return { success: false, error: 'Meta vacía', existingNoteIds: [], depthNotes: [] };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        emit('error', 'El modelo no está disponible');
        return { success: false, error: 'Modelo de chat no disponible', existingNoteIds: [], depthNotes: [] };
    }

    try {
        const currentState = notebookManager.getState();
        const tabs = Array.isArray(currentState?.tabs) ? currentState.tabs : [];
        const notes = tabs
            .map((tab) => ({
                id: String(tab.id || '').trim(),
                title: String(tab.title || '').trim() || 'Sin titulo',
                body: String(tab.body || '').trim()
            }))
            .filter((tab) => tab.id && (tab.title || tab.body));
        const notesById = new Map(notes.map((tab) => [tab.id, tab]));
        const validNoteIds = new Set(notes.map((tab) => tab.id));
        const noteIndex = buildNoteDiscoveryIndex(notes, 240);

        emit('planning', 'Analizaré la meta y trazaré un plan de investigación');
        const { parsed: planning } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Eres un planner de investigación para una meta.',
                    'Responde SOLO JSON:',
                    '{"focus":[{"id":"f1","title":"...","query":"...","goal":"..."}],"strategy":["..."]}',
                    'Reglas:',
                    '- focus entre 2 y 6 elementos.',
                    '- strategy entre 2 y 5 pasos cortos.',
                    '- Sin texto fuera del JSON.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({ title, description })
            }
        ], 'plan de meta', {
            schemaHint: '{"focus":[{"id":"f1","title":"...","query":"...","goal":"..."}],"strategy":["..."]}'
        });

        const focus = normalizeFocus(planning?.focus, 6);

        emit('planning', `Definí ${focus.length || 1} focos de trabajo para la meta`);

        if (notes.length === 0) {
            emit('synthesis', 'No hay notas existentes; crearé notas de profundización desde la meta');
            const { parsed: directDepth } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Genera solo notas de profundización para una meta sin contexto previo.',
                        'Responde SOLO JSON:',
                        '{"depthNotes":[{"keyword":"...","noteTitle":"...","reason":"...","focusId":"f1"}]}',
                        'Reglas: maximo 6, keyword breve, noteTitle accionable.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({ title, description, focus })
                }
            ], 'profundizacion directa', {
                schemaHint: '{"depthNotes":[{"keyword":"...","noteTitle":"...","reason":"...","focusId":"f1"}]}'
            });

            const depthNotes = Array.isArray(directDepth?.depthNotes)
                ? directDepth.depthNotes
                    .map((item) => ({
                        keyword: String(item?.keyword || '').trim(),
                        noteTitle: String(item?.noteTitle || '').trim(),
                        reason: String(item?.reason || '').trim(),
                        focusId: String(item?.focusId || '').trim()
                    }))
                    .filter((item) => item.keyword && item.noteTitle)
                    .slice(0, 6)
                : [];

            emit('done', `Crearé ${depthNotes.length} notas de profundización`);
            return {
                success: true,
                plan: { focus, strategy: Array.isArray(planning?.strategy) ? planning.strategy : [] },
                existingNoteIds: [],
                depthNotes,
                evaluations: []
            };
        }

        emit('scanning', `Exploraré ${noteIndex.length} notas indexadas para decidir candidatas`);

        const { parsed: shortlist } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Eres un agente tipo Codex: decide qué notas leer completas sin revisar todo.',
                    'Usa títulos y estructura para explorar primero, luego elige profundidad.',
                    'Responde SOLO JSON:',
                    '{"candidateNoteIds":["id1"],"readOrder":["id1"],"reason":"..."}',
                    'Reglas:',
                    '- maximo 14 ids.',
                    '- readOrder debe ser subconjunto ordenado de candidateNoteIds.',
                    '- Solo ids existentes.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    meta: { title, description },
                    focus,
                    notesIndex: noteIndex
                })
            }
        ], 'seleccion de candidatas', {
            schemaHint: '{"candidateNoteIds":["tab_1"],"readOrder":["tab_1"],"reason":"..."}'
        });

        const candidateIds = sanitizeNoteIdSelection(shortlist?.candidateNoteIds, validNoteIds, 14);
        const orderedIds = sanitizeNoteIdSelection(shortlist?.readOrder, new Set(candidateIds), 14);
        const readQueue = sanitizeNoteIdSelection([...orderedIds, ...candidateIds], validNoteIds, 14);

        if (readQueue.length === 0 && noteIndex.length > 0) {
            const { parsed: forced } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Selecciona mínimo 1 nota para lectura profunda inicial.',
                        'Responde SOLO JSON: {"candidateNoteIds":["id1"],"reason":"..."}',
                        '- máximo 4 ids.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        meta: { title, description },
                        focus,
                        notesIndex: noteIndex
                    })
                }
            ], 'seleccion forzada meta', {
                schemaHint: '{"candidateNoteIds":["tab_1"],"reason":"..."}'
            });
            readQueue.push(...sanitizeNoteIdSelection(forced?.candidateNoteIds, validNoteIds, 4));
        }

        emit('scanning', `Leeré ${readQueue.length} notas candidatas en profundidad`);

        const evaluations = [];
        for (const noteId of readQueue) {
            const note = notesById.get(noteId);
            if (!note) continue;

            emit('reading', `Leeré "${note.title}"`);
            const { parsed: evalResult } = await chatCompletionJson([
                {
                    role: 'system',
                    content: [
                        'Evalua si una nota apoya una meta.',
                        'Responde SOLO JSON:',
                        '{"noteId":"...","keep":true,"score":0,"supportedFocus":["f1"],"evidence":["..."]}',
                        'Reglas:',
                        '- score de 0 a 100.',
                        '- keep true solo si aporta valor real a la meta.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        meta: { title, description },
                        focus,
                        note: {
                            id: note.id,
                            title: note.title,
                            body: safeSliceText(note.body, 4000)
                        }
                    })
                }
            ], `evaluacion de nota ${noteId}`, {
                schemaHint: '{"noteId":"tab_1","keep":true,"score":78,"supportedFocus":["f1"],"evidence":["..."]}'
            });

            evaluations.push({
                noteId,
                title: note.title,
                keep: Boolean(evalResult?.keep),
                score: Math.max(0, Math.min(100, Number(evalResult?.score || 0))),
                supportedFocus: Array.isArray(evalResult?.supportedFocus) ? evalResult.supportedFocus.map((f) => String(f || '').trim()).filter(Boolean) : [],
                evidence: Array.isArray(evalResult?.evidence) ? evalResult.evidence.map((e) => String(e || '').trim()).filter(Boolean).slice(0, 3) : []
            });
        }

        emit('synthesis', 'Sintetizaré selección final y vacíos de aprendizaje');
        const { parsed: synthesis } = await chatCompletionJson([
            {
                role: 'system',
                content: [
                    'Sintetiza selección final para una meta.',
                    'Responde SOLO JSON:',
                    '{"existingNoteIds":["id1"],"depthNotes":[{"keyword":"...","noteTitle":"...","reason":"...","focusId":"f1"}],"summary":"..."}',
                    'Reglas:',
                    '- existingNoteIds maximo 8 y deben ser ids evaluados.',
                    '- depthNotes maximo 6, orientadas a vacíos reales.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    meta: { title, description },
                    focus,
                    evaluations
                })
            }
        ], 'sintesis final', {
            schemaHint: '{"existingNoteIds":["tab_1"],"depthNotes":[{"keyword":"...","noteTitle":"...","reason":"...","focusId":"f1"}],"summary":"..."}'
        });

        const evaluatedIds = new Set(evaluations.map((item) => item.noteId));
        const existingNoteIds = Array.isArray(synthesis?.existingNoteIds)
            ? synthesis.existingNoteIds
                .map((id) => String(id || '').trim())
                .filter((id) => evaluatedIds.has(id))
                .slice(0, 8)
            : [];

        const depthNotes = Array.isArray(synthesis?.depthNotes)
            ? synthesis.depthNotes
                .map((item) => ({
                    keyword: String(item?.keyword || '').trim(),
                    noteTitle: String(item?.noteTitle || '').trim(),
                    reason: String(item?.reason || '').trim(),
                    focusId: String(item?.focusId || '').trim()
                }))
                .filter((item) => item.keyword && item.noteTitle)
                .slice(0, 6)
            : [];

        emit('done', `Listo: ${existingNoteIds.length} notas existentes + ${depthNotes.length} notas de profundización`);
        return {
            success: true,
            plan: { focus, strategy: Array.isArray(planning?.strategy) ? planning.strategy : [] },
            existingNoteIds,
            depthNotes,
            evaluations
        };
    } catch (error) {
        console.error('❌ [MetaAgent] Failed:', error);
        emit('error', 'Falló el análisis de la meta');
        return {
            success: false,
            error: error?.message || 'No se pudo ejecutar el agente de meta',
            existingNoteIds: [],
            depthNotes: []
        };
    }
});

ipcMain.handle('chat-send-message', async (event, payload = {}) => {
    const text = String(payload.text || '').trim();
    if (!text) {
        return { error: 'Mensaje vacio', state: knowledgeService.getKnowledgeState() };
    }
    LoggingSwitch.execution('Chat', `User sent: ${text.substring(0, 60)}`);
    LoggingSwitch.uiux('chat', 'user_message', {
        tabId: String(payload.activeTabId || notebookManager.getState().activeTabId || ''),
        executionId: String(payload.activeExecutionId || notebookManager.getState().activeExecutionId || ''),
        textPreview: safeSliceText(text, 220)
    });

    const tabId = payload.activeTabId || notebookManager.getState().activeTabId;
    const executionId = payload.activeExecutionId || notebookManager.getState().activeExecutionId;
    if (payload.noteSnapshot) {
        notebookManager.updateTab(tabId, {
            title: payload.noteSnapshot.title,
            body: payload.noteSnapshot.body
        });
    }
    notebookManager.setActiveTab(tabId);
    notebookManager.setActiveExecution(executionId);
    const userExecution = notebookManager.appendMessage(executionId, {
        role: 'user',
        text,
        status: 'thinking'
    });

    // 1. Add to Central Context
    contextManager.addMessage('user', text, 'chat_ui');
    if (LearningAgent.isLearning) {
        LearningAgent.addTeachingNote(text);
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-response', { error: 'Provider de texto no inicializado' });
        }
        return {
            error: 'Provider de texto no inicializado',
            state: knowledgeService.getKnowledgeState(),
            execution: userExecution
        };
    }

    try {
        const variableAnalysis = await notebookManager.analyzeVariables({
            tabId,
            executionId,
            trigger: 'send'
        });

        if (shouldAskChatClarification(text, variableAnalysis)) {
            const clarificationText = variableAnalysis.clarificationPrompt;
            const clarificationExecution = notebookManager.appendMessage(executionId, {
                role: 'assistant',
                text: clarificationText,
                status: 'waiting_clarification'
            });
            contextManager.addMessage('assistant', clarificationText, 'chat_api');
            LoggingSwitch.uiux('chat', 'clarification_requested', {
                clarificationPreview: safeSliceText(clarificationText, 220)
            });
            return {
                clarification: clarificationText,
                updatedVariables: variableAnalysis.variables,
                state: knowledgeService.getKnowledgeState(),
                execution: clarificationExecution
            };
        }

        // Retrieve relevant context from disk/semantic memory
        const relevantContext = await contextManager.getRelevantContext(text);
        const relevantLearned = LearningAgent.findRelevantWorkflows(text, 3);
        const { systemPrompt, learnedWorkflowsText } = buildChatSystemPrompt(relevantLearned, relevantContext);
        const promptPayload = notebookManager.buildChatPayload({
            tabId,
            executionId,
            baseSystemPrompt: systemPrompt,
            learnedWorkflowsText,
            longTermContext: ''
        });

        // Send to active model (OpenAI or Gemini via ModelSwitch)
        const response = await ModelSwitch.chatCompletion({
            messages: promptPayload.messages,
            tools: [
                ...(actionPlanner ? actionPlanner.tools : []),
                ...getKnowledgeTools()
            ],
            tool_choice: 'auto'
        });

        const message = response.choices[0].message;
        const reply = message.content || '';

        // Check for function call (action)
        if (message.tool_calls && message.tool_calls.length > 0) {
            const call = message.tool_calls[0];
            const knowledgeResult = executeKnowledgeToolCall(call);
            if (knowledgeResult) {
                if (knowledgeResult.error) {
                    const assistantExecution = notebookManager.appendMessage(executionId, {
                        role: 'assistant',
                        text: knowledgeResult.error,
                        kind: 'knowledge',
                        status: 'error'
                    });
                    contextManager.addMessage('assistant', knowledgeResult.error, 'chat_api');
                    return {
                        error: knowledgeResult.error,
                        updatedVariables: variableAnalysis.variables,
                        state: knowledgeService.getKnowledgeState(),
                        execution: assistantExecution
                    };
                }

                const visibleReply = String(knowledgeResult.reply || 'Listo. Actualicé tu conocimiento.').trim();
                const assistantExecution = notebookManager.appendMessage(executionId, {
                    role: 'assistant',
                    text: visibleReply,
                    kind: 'knowledge',
                    status: 'answered'
                });
                contextManager.addMessage('assistant', visibleReply, 'chat_api', {
                    tool_calls: message.tool_calls
                });
                contextManager.addMessage('tool', visibleReply, 'knowledge_result', {
                    tool_call_id: call.id,
                    name: call.function?.name || 'knowledge_tool'
                });
                return {
                    reply: visibleReply,
                    updatedVariables: variableAnalysis.variables,
                    state: knowledgeResult.state || knowledgeService.getKnowledgeState(),
                    execution: assistantExecution
                };
            }

            if (call.function.name === 'execute_screen_action') {
                const args = JSON.parse(call.function.arguments);
                LoggingSwitch.execution('Chat', `Action planned: ${args.goal}`);
                LoggingSwitch.uiux('chat', 'action_planned', {
                    app: String(args?.app || ''),
                    goalPreview: safeSliceText(args?.goal || '', 180),
                    stepsPreview: safeSliceText(args?.steps_hint || '', 180)
                });

                // ── FIX: Cerrar el loop del tool_call en el historial ──────────
                // 1. Guardar el mensaje del assistant CON su tool_call
                contextManager.addMessage('assistant', reply || null, 'chat_api', {
                    tool_calls: message.tool_calls
                });
                // 2. Guardar el tool_result inmediatamente para que el historial quede bien formado.
                //    Sin este paso, el LLM ve un tool_call pendiente y lo re-ejecuta en la
                //    siguiente llamada en lugar de procesar el nuevo mensaje del usuario.
                contextManager.addMessage('tool', `Acción iniciada: ${args.goal} en ${args.app}`, 'action_result', {
                    tool_call_id: call.id,
                    name: call.function.name
                });
                // ───────────────────────────────────────────────────────────────

                // Send reply + action to chat window
                const visibleReply = reply || (relevantLearned && relevantLearned[0]
                    ? `Perfecto, lo voy a hacer como me enseñaste en ${relevantLearned[0].workflowName}.`
                    : `Entendido. Voy a ${args.goal.toLowerCase()}.`);
                const actionExecution = notebookManager.appendMessage(executionId, {
                    role: 'assistant',
                    text: visibleReply,
                    kind: 'action',
                    status: 'action_pending'
                });

                // Send confirmation to main window
                if (mainWindow) {
                    mainWindow.webContents.send('action-confirm-request', {
                        goal: args.goal,
                        app: args.app,
                        stepsHint: args.steps_hint,
                        source: 'explicit'
                    });
                }

                return {
                    reply: visibleReply,
                    action: args,
                    updatedVariables: variableAnalysis.variables,
                    state: knowledgeService.getKnowledgeState(),
                    execution: actionExecution
                };
            }
        }

        // Regular reply (no action)
        const assistantExecution = notebookManager.appendMessage(executionId, {
            role: 'assistant',
            text: reply,
            status: 'answered'
        });
        LoggingSwitch.uiux('chat', 'assistant_reply', {
            replyPreview: safeSliceText(reply, 220),
            hasToolCalls: Boolean(message.tool_calls && message.tool_calls.length)
        });

        // 2. Add reply to Central Context (conversational — no tool_call here)
        contextManager.addMessage('assistant', reply || null, 'chat_api', {
            tool_calls: message.tool_calls
        });

        return {
            reply,
            updatedVariables: variableAnalysis.variables,
            state: knowledgeService.getKnowledgeState(),
            execution: assistantExecution
        };

    } catch (e) {
        console.error('❌ [Chat] Failed:', e.message);
        LoggingSwitch.uiux('chat', 'chat_error', {
            error: safeSliceText(e?.message || 'unknown', 220)
        });
        notebookManager.updateExecutionStatus(executionId, 'error');
        return {
            error: e.message,
            state: knowledgeService.getKnowledgeState(),
            execution: notebookManager.getState().executions.find((execution) => execution.id === executionId) || null
        };
    }
});

// 🎓 Learning Mode IPCs
ipcMain.handle('learning-start', async (event, { name }) => {
    LearningAgent.startLearning(name);
    if (mainWindow) {
        mainWindow.webContents.send('learning-status', { active: true, name });
    }
    return { success: true };
});

ipcMain.handle('learning-stop', async () => {
    const synthesized = await LearningAgent.stopLearning();
    if (mainWindow) {
        mainWindow.webContents.send('learning-status', { active: false });
    }
    return { success: true, synthesized };
});

ipcMain.handle('learning-list-workflows', async () => {
    try {
        const workflows = LearningAgent.listWorkflows(60);
        return { success: true, workflows };
    } catch (e) {
        return { success: false, error: e.message, workflows: [] };
    }
});

ipcMain.handle('learning-delete-workflow', async (event, { file }) => {
    return LearningAgent.deleteWorkflow(file);
});

// 🎓 Global Mouse Monitoring for Learning Mode
let lastMouseButtonState = 0;
let isRecordingClick = false;
const COMMAND_MODIFIER_FLAG = 1 << 20;
const OPTION_MODIFIER_FLAG = 1 << 19;

const commandHoldOverride = {
    isPressed: false,
    active: false,
    processingRelease: false,
    recordingStarted: false,
    awaitingClarification: false,
    clarificationPrompt: '',
    interruptedFlowContext: null,
    hasNativeModifierSupport: null
};

let activeScreenFlow = null;
let activeScreenFlowSeq = 0;

function syncActiveScreenFlow(sessionId) {
    const flow = sessionId ? executionSessions.toFlow(sessionId) : null;
    if (!flow) {
        activeScreenFlow = null;
        return null;
    }
    activeScreenFlow = { ...flow, localSeq: ++activeScreenFlowSeq };
    return activeScreenFlow;
}

function setCommandHoldStickyFeedback(isListening, message = '') {
    try {
        stickyFace.start();
        if (isListening) {
            stickyFace.setFaceColor('#00ff00');
            stickyFace.startCommandAttention();
            if (message) stickyFace.showMessage({ title: 'Escuchando', body: message }, 120000);
        } else {
            stickyFace.stopCommandAttention();
            stickyFace.setFaceColor('#ffffff');
            stickyFace.setExpression('idle');
        }
    } catch (e) {
        console.warn('⚠️ [CommandHold] Sticky feedback error:', e.message);
    }
}

function getClarificationPrompt(transcript = '') {
    const cleaned = String(transcript || '').trim();
    if (!cleaned) {
        return 'No te escuché bien. Mantén Command + Option y dime exactamente qué debo hacer ahora.';
    }
    return `Te escuché: "${cleaned}". No me quedó clara la acción. Mantén Command + Option y dime una instrucción concreta (app + acción).`;
}

async function waitForScreenAgentIdle(timeoutMs = 2000) {
    if (!screenAgent) return;
    const start = Date.now();
    while (screenAgent.isRunning && (Date.now() - start) < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

async function startManagedScreenAction(goal, app, stepsHint, options = {}) {
    if (!screenAgent) return { success: false, error: 'Screen Agent not ready' };

    let session = options.sessionId ? executionSessions.getSession(options.sessionId) : null;
    if (!session) {
        session = executionSessions.startSession({
            goal,
            app,
            stepsHint,
            source: options.source || 'unknown'
        });
    } else {
        session = executionSessions.markRunning(session.id, { goal, app, stepsHint }) || session;
    }
    const flow = syncActiveScreenFlow(session.id);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('action-started', { goal, app, sessionId: session.id });
    }

    const result = await screenAgent.executeAction(goal, app, stepsHint, { sessionId: session.id });

    if (activeScreenFlow && flow && activeScreenFlow.id === flow.id) {
        if (result && result.awaitingUserInput) {
            executionSessions.markWaitingUser(session.id, {
                waitPrompt: result.summary || '',
                summary: result.summary || '',
                runtimeContext: result.runtimeContext,
                executionState: result.executionState,
                interruption: result.interruption,
                result
            });
            syncActiveScreenFlow(session.id);
        } else if (result && result.aborted) {
            executionSessions.markInterrupted(session.id, {
                summary: result.summary || '',
                runtimeContext: result.runtimeContext,
                executionState: result.executionState,
                interruption: result.interruption,
                result
            });
            syncActiveScreenFlow(session.id);
        } else if (result && result.success) {
            executionSessions.markCompleted(session.id, {
                summary: result.summary || '',
                runtimeContext: result.runtimeContext,
                executionState: result.executionState,
                result
            });
            activeScreenFlow = null;
            commandHoldOverride.interruptedFlowContext = null;
            executionSessions.clearCurrentSession();
        } else {
            executionSessions.markFailed(session.id, {
                summary: result?.summary || result?.error || '',
                result
            });
            activeScreenFlow = null;
            commandHoldOverride.interruptedFlowContext = null;
            executionSessions.clearCurrentSession();
        }
    }

    return { ...result, sessionId: session.id };
}

async function startCommandHoldRecording() {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Main window unavailable' };

    try {
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    if (window.__iuCommandHoldRecorder?.recording) {
                        return { ok: true, alreadyRecording: true, mimeType: window.__iuCommandHoldRecorder.mimeType || 'audio/webm' };
                    }
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
                    let mimeType = '';
                    for (const candidate of mimeCandidates) {
                        if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidate)) {
                            mimeType = candidate;
                            break;
                        }
                    }
                    const options = mimeType ? { mimeType } : {};
                    const recorder = new MediaRecorder(stream, options);
                    const chunks = [];
                    recorder.ondataavailable = (event) => {
                        if (event.data && event.data.size > 0) chunks.push(event.data);
                    };
                    recorder.start(80);
                    window.__iuCommandHoldRecorder = { recording: true, recorder, chunks, stream, mimeType: recorder.mimeType || mimeType || 'audio/webm' };
                    return { ok: true, mimeType: recorder.mimeType || mimeType || 'audio/webm' };
                } catch (error) {
                    return { ok: false, error: String(error && error.message ? error.message : error) };
                }
            })();
        `, true);
        return result || { ok: false, error: 'Recorder start returned empty result' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function stopCommandHoldRecording() {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Main window unavailable' };

    try {
        const result = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    const state = window.__iuCommandHoldRecorder;
                    if (!state || !state.recording || !state.recorder) {
                        return { ok: false, error: 'No active recorder' };
                    }
                    return await new Promise((resolve) => {
                        const finalize = async () => {
                            try {
                                const mimeType = state.mimeType || (state.recorder && state.recorder.mimeType) || 'audio/webm';
                                const blob = new Blob(state.chunks || [], { type: mimeType });
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
                                    window.__iuCommandHoldRecorder = null;
                                    resolve({ ok: true, mimeType, audioDataUrl: reader.result, size: blob.size });
                                };
                                reader.onerror = () => {
                                    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
                                    window.__iuCommandHoldRecorder = null;
                                    resolve({ ok: false, error: 'FileReader failed' });
                                };
                                reader.readAsDataURL(blob);
                            } catch (err) {
                                if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
                                window.__iuCommandHoldRecorder = null;
                                resolve({ ok: false, error: String(err && err.message ? err.message : err) });
                            }
                        };
                        state.recorder.onstop = finalize;
                        if (state.recorder.state === 'inactive') {
                            finalize();
                        } else {
                            state.recorder.stop();
                        }
                    });
                } catch (error) {
                    return { ok: false, error: String(error && error.message ? error.message : error) };
                }
            })();
        `, true);
        return result || { ok: false, error: 'Recorder stop returned empty result' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function transcribeCommandHoldAudioWithDeepgram(audioDataUrl, mimeType = 'audio/webm') {
    let buffer = null;
    try {
        const deepgramApiKey = process.env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_KEY || '';
        if (!deepgramApiKey) {
            console.warn('⚠️ [CommandHold] DEEPGRAM_API_KEY missing. Skipping transcription.');
            return '';
        }

        const base64Data = String(audioDataUrl || '').replace(/^data:audio\/[^;]+[^,]*,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length < 1200) return '';

        const url = 'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true&punctuate=true';
        const maxAttempts = 3;
        let lastHttpStatus = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${deepgramApiKey}`,
                        'Content-Type': mimeType || 'audio/webm'
                    },
                    body: buffer,
                    signal: controller.signal
                });
                clearTimeout(timeout);

                if (response.ok) {
                    const payload = await response.json();
                    const transcript = payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
                    return String(transcript || '').trim();
                }

                lastHttpStatus = response.status;
                const errorText = await response.text().catch(() => '');
                console.warn(`⚠️ [CommandHold] Deepgram error ${response.status} (attempt ${attempt}/${maxAttempts}): ${errorText.substring(0, 160)}`);

                const retryableHttp = response.status === 429 || response.status >= 500;
                if (!retryableHttp || attempt === maxAttempts) break;
            } catch (e) {
                clearTimeout(timeout);
                const retryableNetwork = ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(e?.code || e?.cause?.code || '');
                console.warn(`⚠️ [CommandHold] Deepgram network error (attempt ${attempt}/${maxAttempts}): ${e?.message || 'unknown'}`);
                if (!retryableNetwork || attempt === maxAttempts) throw e;
            }

            await new Promise(resolve => setTimeout(resolve, 350 * attempt));
        }

        if (lastHttpStatus) {
            console.warn(`⚠️ [CommandHold] Falling back after Deepgram HTTP ${lastHttpStatus}.`);
        }
        return await transcribeCommandHoldAudioFallback(buffer, mimeType);
    } catch (e) {
        const cause = e && e.cause ? e.cause : null;
        console.error('❌ [CommandHold] Deepgram transcription failed:', {
            message: e?.message,
            name: e?.name,
            code: e?.code || cause?.code || null,
            errno: e?.errno || cause?.errno || null,
            syscall: cause?.syscall || null,
            hostname: cause?.hostname || null
        });
        if (buffer && buffer.length > 1200) {
            return await transcribeCommandHoldAudioFallback(buffer, mimeType);
        }
        return '';
    }
}

async function transcribeCommandHoldAudioFallback(buffer, mimeType = 'audio/webm') {
    try {
        const ext = String(mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        const tempFile = path.join(app.getPath('temp'), `cmd_hold_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFile, buffer);
        const transcription = await ModelSwitch.transcription({
            filePath: tempFile,
            buffer,
            mimeType: mimeType || 'audio/webm'
        });
        try { fs.unlinkSync(tempFile); } catch (err) { /* ignore */ }
        const text = String(transcription?.text || '').trim();
        if (text) {
            console.log('ℹ️ [CommandHold] Used fallback transcription provider after Deepgram failure.');
        }
        return text;
    } catch (e) {
        console.error('❌ [CommandHold] Fallback transcription failed:', e.message);
        return '';
    }
}

async function executeFromCommandHoldTranscript(transcript) {
    if (!transcript || !actionPlanner || !screenAgent) return;

    contextManager.addMessage('user', transcript, 'command_hold_transcription');

    // In-flow clarification: resume same execution context, avoid full replanning/reset.
    const resumableSession = executionSessions.hasResumableSession()
        ? executionSessions.getCurrentSession()
        : null;
    if (commandHoldOverride.interruptedFlowContext || resumableSession) {
        const flow = commandHoldOverride.interruptedFlowContext || executionSessions.toInterruptedFlowContext(resumableSession.id);
        const runtimeNow = (typeof screenAgent.getRuntimeContextSnapshot === 'function')
            ? screenAgent.getRuntimeContextSnapshot()
            : { app: '', window: '', recentActions: [] };
        const runtime = {
            app: runtimeNow?.app || flow?.runtimeContext?.app || '',
            window: runtimeNow?.window || flow?.runtimeContext?.window || '',
            recentActions: (runtimeNow?.recentActions && runtimeNow.recentActions.length > 0)
                ? runtimeNow.recentActions
                : (flow?.runtimeContext?.recentActions || [])
        };
        const sessionId = resumableSession?.id || flow?.sessionId || activeScreenFlow?.id;
        const continuation = sessionId
            ? executionSessions.buildContinuation(sessionId, transcript, { runtimeContext: runtime })
            : null;

        commandHoldOverride.awaitingClarification = false;
        commandHoldOverride.clarificationPrompt = '';

        stickyFace.setFaceColor('#ffffff');
        stickyFace.stopCommandAttention();
        stickyFace.setExpression('neutral');
        stickyFace.showMessage({ title: 'Asistente', body: 'Entendido, continúo desde aquí.' }, 2400);

        await waitForScreenAgentIdle();
        if (continuation) {
            await startManagedScreenAction(continuation.goal, continuation.app, continuation.stepsHint, {
                source: 'command_hold_continuation',
                sessionId: continuation.session.id
            });
        }
        return;
    }

    const relevantContext = await contextManager.getRelevantContext(transcript);
    const plan = await actionPlanner.planFromExplicit(transcript, {
        recent: contextManager.getHistoryForAPI(10),
        longTerm: relevantContext.longTerm
    });

    if (!plan) {
        console.log('ℹ️ [CommandHold] No actionable intent after transcription');
        commandHoldOverride.awaitingClarification = true;
        commandHoldOverride.clarificationPrompt = getClarificationPrompt(transcript);
        stickyFace.showMessage({ title: 'Necesito Aclaración', body: commandHoldOverride.clarificationPrompt }, 120000);
        return;
    }

    commandHoldOverride.awaitingClarification = false;
    commandHoldOverride.clarificationPrompt = '';

    if (plan.type === 'schedule') {
        if (brain) {
            const date = new Date(Date.now() + (plan.minutes * 60 * 1000));
            brain.scheduleTask(plan.task, date);
        }
        commandHoldOverride.awaitingClarification = true;
        commandHoldOverride.clarificationPrompt = 'Recordatorio agendado. Si quieres continuar con la automatización, mantén Command + Option y dime el siguiente paso.';
        stickyFace.showMessage({ title: 'Listo', body: commandHoldOverride.clarificationPrompt }, 120000);
        return;
    }

    if (plan.type === 'play_agario') {
        if (browserAgent) browserAgent.launchAgarIO(plan.nickname);
        commandHoldOverride.awaitingClarification = true;
        commandHoldOverride.clarificationPrompt = 'Listo. Mantén Command + Option para dar la siguiente orden.';
        stickyFace.showMessage({ title: 'Listo', body: commandHoldOverride.clarificationPrompt }, 120000);
        return;
    }

    await waitForScreenAgentIdle();
    stickyFace.setFaceColor('#ffffff');
    stickyFace.stopCommandAttention();
    stickyFace.setExpression('neutral');
    stickyFace.showMessage({ title: 'Asistente', body: 'Dale, lo haré.' }, 2200);
    await startManagedScreenAction(plan.goal, plan.app, plan.stepsHint, { source: 'command_hold_replan' });
}

async function onCommandHoldPressed() {
    if (!screenAgent) return;
    const automationContextActive =
        !!screenAgent.isRunning ||
        !!screenAgent.windowsHiddenByAutomation ||
        !!activeScreenFlow ||
        !!commandHoldOverride.awaitingClarification;
    if (!automationContextActive) return;
    if (commandHoldOverride.active) return;

    commandHoldOverride.active = true;
    commandHoldOverride.processingRelease = false;
    commandHoldOverride.recordingStarted = false;
    console.log('⌘⌥ [CommandHold] Command + Option pressed: listening override...');

    if (screenAgent.isRunning) {
        const interruption = (typeof screenAgent.getInterruptionSnapshot === 'function')
            ? screenAgent.getInterruptionSnapshot()
            : { pendingTypeText: '', pendingTypeLabel: '' };
        const runtimeContext = (typeof screenAgent.getRuntimeContextSnapshot === 'function')
            ? screenAgent.getRuntimeContextSnapshot()
            : null;
        const currentSession = executionSessions.getCurrentSession();
        if (currentSession) {
            executionSessions.markInterrupted(currentSession.id, {
                interruption,
                runtimeContext,
                executionState: screenAgent.currentExecutionState || null
            });
            commandHoldOverride.interruptedFlowContext = executionSessions.toInterruptedFlowContext(currentSession.id);
            syncActiveScreenFlow(currentSession.id);
        } else {
            commandHoldOverride.interruptedFlowContext = activeScreenFlow
                ? {
                    goal: activeScreenFlow.goal,
                    app: activeScreenFlow.app,
                    stepsHint: activeScreenFlow.stepsHint,
                    pendingTypeText: interruption.pendingTypeText || '',
                    pendingTypeLabel: interruption.pendingTypeLabel || '',
                    runtimeContext
                }
                : null;
        }
        screenAgent.stop({ keepWindowsHidden: true });
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('action-status', { phase: 'listening_override' });
        }
        await waitForScreenAgentIdle();
    } else if (activeScreenFlow) {
        const currentSession = executionSessions.getCurrentSession();
        if (currentSession) {
            commandHoldOverride.interruptedFlowContext = executionSessions.toInterruptedFlowContext(currentSession.id);
        } else {
            commandHoldOverride.interruptedFlowContext = {
                goal: activeScreenFlow.goal,
                app: activeScreenFlow.app,
                stepsHint: activeScreenFlow.stepsHint,
                pendingTypeText: '',
                pendingTypeLabel: '',
                runtimeContext: (typeof screenAgent.getRuntimeContextSnapshot === 'function')
                    ? screenAgent.getRuntimeContextSnapshot()
                    : null
            };
        }
    }
    setCommandHoldStickyFeedback(true, 'Escuchando...');
    setTimeout(() => {
        if (commandHoldOverride.active) setCommandHoldStickyFeedback(true, 'Escuchando...');
    }, 300);

    const started = await startCommandHoldRecording();
    if (commandHoldOverride.active && commandHoldOverride.isPressed && started.ok) {
        commandHoldOverride.recordingStarted = true;
    } else if (!started.ok) {
        console.warn('⚠️ [CommandHold] Recorder start failed:', started.error || 'unknown');
        setCommandHoldStickyFeedback(false);
    }
}

async function onCommandHoldReleased() {
    if (!commandHoldOverride.active || commandHoldOverride.processingRelease) return;
    commandHoldOverride.processingRelease = true;
    console.log('⌘⌥ [CommandHold] Command + Option released: finishing capture and replanning...');

    try {
        stickyFace.stopCommandAttention();
        stickyFace.setExpression('thinking');
        setCommandHoldStickyFeedback(true, 'Procesando transcripción...');
        let transcript = '';

        if (commandHoldOverride.recordingStarted) {
            const capture = await stopCommandHoldRecording();
            if (capture.ok && capture.audioDataUrl) {
                transcript = await transcribeCommandHoldAudioWithDeepgram(capture.audioDataUrl, capture.mimeType || 'audio/webm');
            } else {
                console.warn('⚠️ [CommandHold] Recorder stop failed:', capture.error || 'unknown');
            }
        }

        if (transcript && transcript.trim().length > 0) {
            console.log(`⌘⌥ [CommandHold] Transcript captured: "${transcript}"`);
            stickyFace.showMessage({ title: 'Te Escuché', body: transcript.trim() }, 4200);
            // No await: keep Command override reusable immediately while execution continues in background.
            executeFromCommandHoldTranscript(transcript.trim()).catch((err) => {
                console.error('❌ [CommandHold] Continuation failed:', err?.message || err);
            });
        } else {
            console.log('⌘⌥ [CommandHold] No transcript captured after release.');
            commandHoldOverride.awaitingClarification = true;
            commandHoldOverride.clarificationPrompt = getClarificationPrompt('');
            stickyFace.showMessage({ title: 'Necesito Aclaración', body: commandHoldOverride.clarificationPrompt }, 120000);
        }
    } catch (e) {
        console.error('❌ [CommandHold] Release handling failed:', e.message);
    } finally {
        if (commandHoldOverride.awaitingClarification) {
            setCommandHoldStickyFeedback(true, '');
            if (commandHoldOverride.clarificationPrompt) {
                stickyFace.showMessage({ title: 'Necesito Aclaración', body: commandHoldOverride.clarificationPrompt }, 120000);
            }
        } else {
            setCommandHoldStickyFeedback(false);
        }
        commandHoldOverride.active = false;
        commandHoldOverride.processingRelease = false;
        commandHoldOverride.recordingStarted = false;
    }
}

setInterval(async () => {
    if (screenAgent && screenAgent.axAgent && screenAgent.axAgent.nativeAddon) {
        try {
            const nativeAddon = screenAgent.axAgent.nativeAddon;
            const currentButtons = nativeAddon.getMouseButtons();

            if (LearningAgent.isLearning) {
                // Mask 0x1 is left button (macOS)
                const leftDown = (currentButtons & 0x1) !== 0;
                const leftWasDown = (lastMouseButtonState & 0x1) !== 0;

                if (leftDown && !leftWasDown && !isRecordingClick) {
                    isRecordingClick = true;
                    console.log('🖱️ [Learning] Click detected, recording step...');

                    // Trigger recording with short description
                    // The LearningAgent will handle hit-test and visual feedback (Green pulse)
                    LearningAgent.recordCurrentState("Click")
                        .finally(() => {
                            isRecordingClick = false;
                        });
                }

                lastMouseButtonState = currentButtons;
            }

            if (typeof nativeAddon.getModifierFlags === 'function') {
                if (commandHoldOverride.hasNativeModifierSupport !== true) {
                    console.log('⌨️ [CommandHold] Native modifier polling enabled (Command + Option)');
                    commandHoldOverride.hasNativeModifierSupport = true;
                }
                const modifiers = nativeAddon.getModifierFlags();
                const commandDown = (modifiers & COMMAND_MODIFIER_FLAG) !== 0;
                const optionDown = (modifiers & OPTION_MODIFIER_FLAG) !== 0;
                const commandHoldComboDown = commandDown && optionDown;

                if (commandHoldComboDown && !commandHoldOverride.isPressed) {
                    commandHoldOverride.isPressed = true;
                    onCommandHoldPressed().catch((err) => {
                        console.error('❌ [CommandHold] Press handling failed:', err.message);
                    });
                } else if (!commandHoldComboDown && commandHoldOverride.isPressed) {
                    commandHoldOverride.isPressed = false;
                    onCommandHoldReleased().catch((err) => {
                        console.error('❌ [CommandHold] Release handling failed:', err.message);
                    });
                }
            } else if (commandHoldOverride.hasNativeModifierSupport !== false) {
                commandHoldOverride.hasNativeModifierSupport = false;
                console.warn('⚠️ [CommandHold] Native addon lacks getModifierFlags(). Rebuild native module to enable Command + Option override.');
            }
        } catch (e) {
            // Silence polling errors
        }
    }
}, 50); // 20Hz polling for responsiveness without high CPU usage

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
    let visible = false;
    if (handWindow && !handWindow.isDestroyed()) {
        if (handWindow.isVisible()) {
            handWindow.hide();
            if (handMeshWindow && !handMeshWindow.isDestroyed()) {
                handMeshWindow.hide();
            }
            visible = false;
        } else {
            handWindow.show();
            handWindow.focus();
            if (!handMeshWindow || handMeshWindow.isDestroyed()) {
                createHandMeshWindow();
            } else {
                handMeshWindow.show();
            }
            visible = true;
        }
    } else {
        createHandWindow();
        if (!handMeshWindow || handMeshWindow.isDestroyed()) {
            createHandMeshWindow();
        } else {
            handMeshWindow.show();
        }
        visible = true;
    }
    return { success: true, visible };
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

    // ── BROWSER MODE: redirigir pinch al cursor del SO cuando AgarIO está activo ──
    // El cursor del SO controla la bola de AgarIO nativamente — no se mueve la ventana Electron.
    if (browserAgent && browserAgent.isAgarIO) {
        const handBounds = handWindow.getBounds();
        const primaryDisplay = screen.getPrimaryDisplay();
        browserAgent.handlePinchMove(
            { phase, xNorm, yNorm },
            handBounds,
            primaryDisplay.size
        );
        // Cancelar el drag de ventana si estaba activo
        mainWindowPinchDrag.active = false;
        stopPinchSnapAnimation();
        return; // ← No procesar el movimiento de ventana Electron
    }
    // ── FIN BROWSER MODE ─────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// BROWSER AGENT IPC HANDLERS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Establece el contexto activo del browser.
 * Llamado cuando la app detecta que el usuario cambió a un tab específico.
 * payload: { url: string } | null
 */
ipcMain.handle('browser-set-context', (event, payload) => {
    if (!browserAgent) return { success: false, error: 'BrowserAgent not initialized' };
    if (payload && payload.url) {
        browserAgent.setBrowserContext(payload.url, {
            targetId: payload.targetId || '',
            wsUrl: payload.wsUrl || payload.url
        });
        const isAgar = browserAgent.isAgarIO;
        // Notificar al renderer el estado actual
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser-context-changed', {
                active: true,
                app: browserAgent.browserContext.app,
                isAgarIO: isAgar,
            });
        }
        return { success: true, app: browserAgent.browserContext.app, isAgarIO: isAgar };
    } else {
        browserAgent.clearBrowserContext();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser-context-changed', { active: false });
        }
        return { success: true, active: false };
    }
});

/**
 * Lanza el flujo completo de AgarIO:
 * abre el browser, escribe nickname, hace click en Play, espera el anuncio.
 */
ipcMain.handle('browser-launch-agario', async (event, payload) => {
    if (!browserAgent) return { success: false, error: 'BrowserAgent not initialized' };
    const nickname = payload?.nickname || null;
    const result = await browserAgent.launchAgarIO(nickname);
    return result;
});

/**
 * Extrae los affordances (DOM/ARIA) de la tab activa del browser.
 * Para uso agéntico — base del control transversal de páginas web.
 */
ipcMain.handle('browser-get-affordances', async (event) => {
    if (!browserAgent) return { elements: [], source: 'NOT_INITIALIZED' };
    return await browserAgent.extractAffordances();
});

ipcMain.handle('browser-get-profiles', async () => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.listProfiles();
});

ipcMain.handle('browser-get-tabs', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.listTabs(payload?.profile || 'managed');
});

ipcMain.handle('browser-open', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    const url = payload?.url || '';
    if (!url) return { ok: false, error: 'missing_url' };
    return await browserAgent.openUrl(url);
});

ipcMain.handle('browser-snapshot', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.getSnapshot(payload || {});
});

ipcMain.handle('browser-act', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.act(payload?.request || payload, payload?.profile || 'managed');
});

ipcMain.handle('browser-screenshot', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.takeScreenshot(payload || {});
});

ipcMain.handle('browser-get-console', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.getConsole(payload?.profile || 'managed', payload?.targetId);
});

ipcMain.handle('browser-get-network', async (event, payload) => {
    if (!browserAgent) return { ok: false, error: 'BrowserAgent not initialized' };
    return await browserAgent.getNetwork(payload?.profile || 'managed', payload?.targetId);
});

/**
 * Devuelve el estado actual del BrowserAgent.
 */
ipcMain.handle('browser-get-status', async (event) => {
    if (!browserAgent) return { active: false };
    return await browserAgent.getStatus();
});

ipcMain.handle('inception-onboarding-get-state', () => {
    if (!inceptionBootstrapper) {
        return {
            available: false,
            shouldPrompt: false,
            status: 'idle',
            lastMessage: ''
        };
    }
    return inceptionBootstrapper.getState();
});

ipcMain.handle('inception-onboarding-start', async () => {
    if (!inceptionBootstrapper) {
        return {
            available: false,
            shouldPrompt: false,
            status: 'error',
            lastMessage: 'El onboarding de Inception todavia no esta listo.'
        };
    }
    return await inceptionBootstrapper.start();
});

ipcMain.handle('inception-onboarding-dismiss', () => {
    if (!inceptionBootstrapper) {
        return {
            available: false,
            shouldPrompt: false,
            status: 'idle',
            lastMessage: ''
        };
    }
    return inceptionBootstrapper.dismiss();
});

// App lifecycle
app.whenReady().then(async () => {
    // Request camera access first
    await requestCameraAccess();

    createWindow();

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
    if (ModelSwitch.isReady({ capability: 'chat' }) && ModelSwitch.isReady({ capability: 'vision' })) {
        actionPlanner = new ActionPlanner(openai); // Pass openai (can be null if Gemini)
        screenAgent = new ScreenAgent(openai, mainWindow, chatPage);
        learningAgent = LearningAgent; // It's already an instance from the require if I exported as one
        learningAgent.setup(screenAgent.axAgent);
        brain = new Brain(mainWindow, actionPlanner, screenAgent);
        console.log('🎯 Action System initialized (Planner + ScreenAgent + Brain + Learning)');

        // Initialize Context Manager with OpenAI/Gemini
        contextManager.init(openai);
        console.log('🧠 Context Manager initialized');
    }

    // Initialize Browser Agent (always, independent of LLM availability)
    try {
        browserCoreService = await startBrowserCoreService();
        browserCoreClient = createBrowserCoreClient(toClientOptions(browserCoreService.config));
        console.log(`🌐 Browser core service listening on 127.0.0.1:${browserCoreService.config.servicePort}`);
    } catch (error) {
        console.error('❌ Failed to start browser core service:', error.message);
    }

    browserAgent = new BrowserAgent(mainWindow, {
        browserCoreClient
    });
    browserAgent.on('status', (data) => {
        // Reenviar estados del BrowserAgent al renderer para feedback visual
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('browser-agent-status', data);
        }
    });

    // Conectar el BrowserAgent al ScreenAgent para la capa de Ejecución (Action Loop)
    if (screenAgent) {
        screenAgent.setBrowserAgent(browserAgent);
    }
    console.log('🌐 Browser Agent initialized');

    inceptionBootstrapper = new InceptionBootstrapper({
        browserAgent,
        envPath: USER_ENV_PATH,
        statePath: INCEPTION_ONBOARDING_STATE_PATH
    });
    inceptionBootstrapper.on('status', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inception-onboarding-status', data);
        }
    });

    // ── BROWSER CONTEXT AUTO-DETECTION ──
    // Every 3 seconds, reconcile the managed browser context through BrowserAgent.
    setInterval(async () => {
        if (!browserAgent) return;
        try {
            const context = await browserAgent.syncActiveTabContext();
            if (context?.active && context.url) {
                if (browserAgent.isAgarIO && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-agent-status', { phase: 'ready', message: 'Modo AgarIO activo. Usa la pinza!' });
                }
            } else if (browserAgent.browserContext.active) {
                browserAgent.clearBrowserContext();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-context-changed', { active: false });
                }
            }
        } catch (_) {
            if (browserAgent.browserContext.active) {
                browserAgent.clearBrowserContext();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-context-changed', { active: false });
                }
            }
        }
    }, 3000);

    // Check for updates (only in production)
    if (app.isPackaged) {
        const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
        if (fs.existsSync(updateConfigPath)) {
            autoUpdater.checkForUpdates().catch(err => {
                if (!isMissingUpdateConfigError(err)) {
                    console.log('Auto-update check failed:', err.message);
                }
            });
        }
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
    if (isMissingUpdateConfigError(err)) return;
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

app.on('before-quit', () => {
    if (browserCoreService) {
        void browserCoreService.stop().catch(() => { });
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

    try {
        let extraction;
        if (browserAgent && browserAgent.browserContext.active) {
            // Unificado: Usar BrowserAgent robusto si el navegador está activo
            extraction = await browserAgent.extractAffordances();
            return {
                app: extraction.app || 'browser',
                window: extraction.url || 'web',
                snapshot: extraction.elements || [],
                error: null
            };
        } else {
            // Fallback a Native OS YOLO/Accessibility
            extraction = await screenAgent.extract();
            return {
                app: extraction.app,
                window: extraction.window,
                snapshot: extraction.tree || [],
                error: null
            };
        }
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
    const type = element.type || '';
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
const { ensureManagedChrome, getManagedChromeTargets, MANAGED_CHROME_PORT } = require('./ManagedChrome');

let chatContext = null;
let chatPage = null;
const CHATGPT_HOME_URL = 'https://chatgpt.com/';

function isChromeInternalPage(url = '') {
    return !url || url === 'about:blank' || url.startsWith('chrome://new-tab-page') || url.startsWith('chrome://newtab');
}

async function setupChatGPT() {
    console.log('🤖 Setting up ChatGPT integration...');
    try {
        await ensureManagedChrome(CHATGPT_HOME_URL, [], { source: 'main.setupChatGPT' });
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${MANAGED_CHROME_PORT}`);
        const contexts = browser.contexts();
        chatContext = contexts[0];

        if (!chatContext) {
            throw new Error('No se pudo obtener el contexto de IU Chrome');
        }

        await chatContext.grantPermissions(['microphone'], { origin: 'https://chatgpt.com' }).catch(() => { });

        // Reuse an existing ChatGPT tab if possible to avoid creating extra windows on every IU launch.
        const pages = chatContext.pages();
        console.log('🧭 [ChatGPT] Pages available in IU Chrome before setup:', pages.map(page => page.url() || 'about:blank'));
        chatPage = pages.find(page => (page.url() || '').includes('chatgpt.com')) || null;
        if (!chatPage) {
            const reusableBlankPage = pages.find(page => {
                const url = page.url() || '';
                return isChromeInternalPage(url);
            }) || null;

            if (reusableBlankPage) {
                console.log('🧭 [ChatGPT] Reusing initial blank/newtab page for ChatGPT:', reusableBlankPage.url() || 'about:blank');
                chatPage = reusableBlankPage;
            } else {
                console.log('🧭 [ChatGPT] No existing ChatGPT tab found. Creating a new page in IU Chrome.');
                chatPage = await chatContext.newPage();
            }
        } else {
            console.log('🧭 [ChatGPT] Reusing existing ChatGPT tab:', chatPage.url() || 'about:blank');
        }

        // Stealth: explicitly remove webdriver property
        await chatPage.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        // Attempt navigation — fail silently if offline (app still starts)
        let navigationReady = false;
        try {
            await chatPage.goto(CHATGPT_HOME_URL, { timeout: 8000, waitUntil: 'domcontentloaded' });
            navigationReady = true;
        } catch (navErr) {
            const isNetworkErr = navErr.message.includes('ERR_INTERNET_DISCONNECTED') ||
                navErr.message.includes('ERR_NAME_NOT_RESOLVED') ||
                navErr.message.includes('ERR_CONNECTION_REFUSED') ||
                navErr.message.includes('ERR_TIMED_OUT') ||
                navErr.message.includes('net::') ||
                navErr.message.includes('timeout');
            if (isNetworkErr) {
                console.warn('⚠️ [ChatGPT] Sin conexión a internet — el modo voz estará disponible cuando haya red. El resto del app funciona normalmente.');
                // chatPage stays valid (browser is open, just blank) — no further action needed
            } else {
                throw navErr; // Re-throw unexpected errors
            }
        }

        const pagesAfterNavigation = chatContext.pages();
        console.log('🧭 [ChatGPT] Pages available in IU Chrome after setup:', pagesAfterNavigation.map(page => page.url() || 'about:blank'));

        const redundantPages = pagesAfterNavigation.filter(page => page !== chatPage && isChromeInternalPage(page.url() || ''));
        for (const extraPage of redundantPages) {
            try {
                console.log('🧭 [ChatGPT] Closing redundant startup page:', extraPage.url() || 'about:blank');
                await extraPage.close({ runBeforeUnload: false });
            } catch (closeErr) {
                console.warn('⚠️ [ChatGPT] Could not close redundant startup page:', closeErr.message);
            }
        }

        await chatPage.bringToFront().catch(() => { });

        console.log('🤖 ChatGPT ready inside IU Chrome. Please login if needed.');

        // Only inject prompt when ChatGPT page is actually reachable.
        // This avoids 30s startup stalls in offline/captive/intercepted networks.
        if (navigationReady) {
            await injectSystemPromptOnStartup();
        } else {
            console.log('⏭️ [ChatGPT] Skipping prompt injection until network is available.');
        }

    } catch (error) {
        console.error('❌ Failed to setup ChatGPT:', error);
        // Only show dialog for unexpected errors — not network/connectivity issues
        const isNetworkErr = error.message && (
            error.message.includes('ERR_INTERNET_DISCONNECTED') ||
            error.message.includes('ERR_NAME_NOT_RESOLVED') ||
            error.message.includes('net::') ||
            error.message.includes('timeout')
        );
        if (!isNetworkErr) {
            const { dialog } = require('electron');
            dialog.showErrorBox('Error de ChatGPT', 'Error inesperado al configurar la integración con ChatGPT: ' + error.message);
        } else {
            console.warn('⚠️ [ChatGPT] Inicio sin internet — funcionalidad de voz no disponible hasta reconectar.');
        }
    }
}

// Inject system prompt as text message on startup (not during voice)
async function injectSystemPromptOnStartup() {
    if (!chatPage) return;

    try {
        const currentUrl = chatPage.url() || '';
        if (!currentUrl.includes('chatgpt.com')) {
            console.warn('⚠️ [ChatGPT] Prompt injection skipped: page not on chatgpt.com');
            return;
        }

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

    console.log('🧠 [Smart Monitor] Starting stability-based conversation loop...');
    lastLoggedUserContent = '';
    lastLoggedAssistantContent = '';
    isActionPending = false;
    lastImplicitActionContent = '';

    // --- Stability tracking (Problema 2: One prompt per full turn) ---
    // The assistant streams in chunks arriving BEFORE user text is available.
    // Strategy: poll fast for transcript streaming, count consecutive polls where assistant text
    // does NOT change. When stable for STABLE_POLLS_REQUIRED consecutive polls
    // AND we have new content → the response stream ended → fire ONE Brain call.
    let lastSeenAssistantText = '';
    let assistantStableCount = 0;
    const POLL_MS = 80;
    const STABLE_POLLS_REQUIRED = 8; // 8 × 80ms = 640ms of no change = stream ended

    conversationMonitorInterval = setInterval(async () => {
        if (!chatPage || chatPage.isClosed()) return;

        // Only process messages when voice mode is active
        if (currentVoiceState !== 'active') return;

        try {
            const state = await chatPage.evaluate(({ lastUser, lastAssistant }) => {
                const userNodes = document.querySelectorAll('[data-message-author-role="user"], [data-testid^="conversation-turn-"] [data-message-author-role="user"]');
                const assistNodes = document.querySelectorAll('[data-message-author-role="assistant"], [data-testid^="conversation-turn-"] [data-message-author-role="assistant"]');

                const userNode = userNodes.length > 0 ? userNodes[userNodes.length - 1] : null;
                const assistNode = assistNodes.length > 0 ? assistNodes[assistNodes.length - 1] : null;

                const extractText = (node) => {
                    if (!node) return '';
                    const pre = node.querySelector('.whitespace-pre-wrap');
                    if (pre) return pre.innerText;
                    const md = node.querySelector('.markdown');
                    if (md) return md.innerText;
                    const ps = node.querySelectorAll('p');
                    if (ps.length > 0) return Array.from(ps).map(p => p.innerText).join('\n');
                    return node.innerText;
                };

                const userText = extractText(userNode).trim();
                const assistText = extractText(assistNode).trim();

                // Note: ChatGPT uses Unicode ellipsis (…) in "Transcribing…"
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

            // ── 1. USER TEXT: capture for UI & memory, but NO Brain call yet ──
            // We wait until the full turn is complete (assistant stable) before
            // calling the Brain, so we can send user + assistant together.
            if (state.isNewUser && state.user.isStable && state.user.text !== lastLoggedUserContent) {
                lastLoggedUserContent = state.user.text;
                console.log('🗣️ [User] Captured:', lastLoggedUserContent.substring(0, 50) + '...');

                // UI Feedback immediately
                if (chatWindow && !chatWindow.isDestroyed()) {
                    chatWindow.webContents.send('voice-text', { role: 'user', text: lastLoggedUserContent });
                }
                if (narrationWindow && !narrationWindow.isDestroyed()) {
                    narrationWindow.webContents.send('voice-text', { role: 'user', text: lastLoggedUserContent });
                }

                // Memory
                contextManager.addMessage('user', lastLoggedUserContent, 'voice_transcription');

                // 🎓 Learning Mode: Capture Step
                if (LearningAgent.isLearning) {
                    LearningAgent.recordCurrentState(lastLoggedUserContent);
                }

                // NOTE: Brain call is deferred — fires when assistant stream ends (see below)
            }

            // ── 2. ASSISTANT TEXT: track stability, fire Brain only on TURN COMPLETE ──
            if (state.assistant.isStable) {
                const cleanAsst = state.assistant.text.replace(/\s+/g, ' ').trim();

                if (cleanAsst === lastSeenAssistantText) {
                    // Text hasn't changed since last poll → count toward stability
                    if (cleanAsst.length > 0) assistantStableCount++;
                } else {
                    // Text changed → stream still in progress, reset counter
                    lastSeenAssistantText = cleanAsst;
                    assistantStableCount = 0;

                    // UI feedback as stream progresses (good UX — shows live text)
                    const lastClean = lastLoggedAssistantContent.replace(/\s+/g, ' ').trim();
                    if (cleanAsst !== lastClean) {
                        if (chatWindow && !chatWindow.isDestroyed()) {
                            chatWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                        }
                        if (narrationWindow && !narrationWindow.isDestroyed()) {
                            narrationWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                        }
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('conversation-text', state.assistant.text);
                        }
                    }
                }

                // ── TURN COMPLETE: assistant stable for N polls AND freshly new ──
                const lastLoggedClean = lastLoggedAssistantContent.replace(/\s+/g, ' ').trim();
                const isTurnNew = cleanAsst !== lastLoggedClean && cleanAsst.length > 0;

                if (assistantStableCount >= STABLE_POLLS_REQUIRED && isTurnNew) {
                    // Commit the assistant turn
                    lastLoggedAssistantContent = state.assistant.text;
                    assistantStableCount = 0;

                    console.log('✅ [Turn Complete] Stream ended. Firing ONE Brain prompt.');
                    console.log('   👤 User   :', lastLoggedUserContent.substring(0, 60));
                    console.log('   🤖 Asst   :', cleanAsst.substring(0, 60));

                    // Memory: log final assistant text
                    contextManager.addMessage('assistant', state.assistant.text, 'voice_transcription');

                    // Final UI update for assistant (ensure last chunk is shown)
                    if (chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                    }
                    if (narrationWindow && !narrationWindow.isDestroyed()) {
                        narrationWindow.webContents.send('voice-text', { role: 'assistant', text: state.assistant.text });
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('conversation-text', state.assistant.text);
                    }

                    // JSON task extraction (unchanged)
                    const jsonMatch = state.assistant.text.match(/```json\n([\s\S]*?)\n```/);
                    if (jsonMatch && jsonMatch[1]) {
                        try {
                            const taskData = JSON.parse(jsonMatch[1]);
                            if (taskData && taskData.tasks && mainWindow) {
                                mainWindow.webContents.send('task-update', taskData.tasks);
                            }
                        } catch (e) { }
                    }

                    // ── ONE Brain call per turn: user intent + assistant context ──
                    if (LearningAgent.isLearning) {
                        console.log('🎓 [Learning] Skipping action planner during learning mode.');
                        isActionPending = false;
                    } else if (!isActionPending && actionPlanner && lastLoggedUserContent) {
                        isActionPending = true;
                        const relevantContext = await contextManager.getRelevantContext(lastLoggedUserContent);

                        // Build combined prompt: user message is primary, assistant response
                        // is appended as context so the planner understands what already happened.
                        const combinedPrompt = lastLoggedUserContent +
                            (cleanAsst ? `\n\n[Respuesta del asistente de voz]: "${cleanAsst}"` : '');

                        const plan = await actionPlanner.planFromExplicit(combinedPrompt, {
                            recent: contextManager.getHistoryForAPI(5),
                            longTerm: relevantContext.longTerm
                        });

                        if (plan && mainWindow) {
                            if (plan.type === 'play_agario') {
                                console.log('🎯 [Action] Auto-playing AgarIO');
                                if (browserAgent) {
                                    browserAgent.launchAgarIO(plan.nickname).finally(() => { isActionPending = false; });
                                } else { isActionPending = false; }
                            } else if (plan.type === 'schedule') {
                                console.log('🎯 [Action] Auto-scheduling reminder');
                                if (brain) {
                                    const date = new Date(Date.now() + (plan.minutes * 60 * 1000));
                                    brain.scheduleTask(plan.task, date);
                                }
                                isActionPending = false;
                            } else if (screenAgent) {
                                console.log('🎯 [Action] Auto-executing screen plan:', plan.goal);
                                startManagedScreenAction(plan.goal, plan.app, plan.stepsHint, { source: 'voice_auto' })
                                    .finally(() => { isActionPending = false; });
                            } else {
                                isActionPending = false;
                            }
                        } else {
                            console.log('ℹ️ [Turn] No action needed for this turn.');
                            isActionPending = false;
                        }
                    }
                }
            } else {
                // Assistant not yet stable ("Thinking…", "Transcribing…") → reset counter
                assistantStableCount = 0;
            }

        } catch (e) {
            console.error('❌ [Smart Monitor] Polling error:', e);
        }
    }, POLL_MS); // fast UI stream + stable turn boundary for planner
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

    // ⚠️ GEMINI RATE-LIMIT GUARD: Gemini Free tiene máx 5 req/min.
    // El dwell-intent consume 2 requests (transcripción + chatCompletion) por cada mirada.
    // Deshabilitarlo con Gemini evita alcanzar el límite innecesariamente.
    if (ModelSwitch.getChatProvider() === 'gemini') {
        console.log('⏭️ [Intent] Skipping intent predictions — Gemini provider active (rate-limit protection)');
        return { success: false, predictions: [] };
    }
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
        if (!isQuotaOrBillingError(e)) {
            console.error('❌ [Intent Prediction] Failed:', e);
        }
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

        if (plan.type === 'play_agario') {
            console.log(`🎮 [Action] Playing AgarIO: nickname=${plan.nickname}`);
            if (browserAgent) {
                // Return immediately - the process is handled in the background
                browserAgent.launchAgarIO(plan.nickname);
                return { success: true, playing: true };
            }
            return { success: false, error: 'BrowserAgent not initialized' };
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
    activeScreenFlow = null;
    executionSessions.clearCurrentSession();
    commandHoldOverride.interruptedFlowContext = null;
    commandHoldOverride.awaitingClarification = false;
    return { success: true };
});

// Confirm and execute action (from UI bubble)
ipcMain.handle('confirm-action', async (event, data) => {
    console.log('✅ [Action] User confirmed plan:', {
        requestId: data?.requestId || null,
        source: data?.source || 'unknown',
        goal: data?.goal || '',
        app: data?.app || '',
        stepsHint: data?.stepsHint || '',
        reason: data?.reason || ''
    });

    // Reset pending flag
    isActionPending = false;

    if (!screenAgent) {
        return { success: false, error: 'Screen Agent not ready' };
    }

    // Start execution
    // data: { goal, app, stepsHint, ... }
    startManagedScreenAction(data.goal, data.app, data.stepsHint, { source: 'confirm_action' });

    return { success: true };
});

// Add setupChatGPT to initialization

// ============================================
// Phone ↔ Mac WebSocket Bridge
// ============================================
// Connects Electron main process to the same WS server as the phone client.
// Relays phone_chat/phone_voice → existing chat pipeline → phone_reply

const WebSocket = require('ws');

let phoneBridgeWs = null;
let phoneBridgeDeviceId = 'electron-bridge-' + Date.now().toString(36);
let phoneBridgeRoomId = null;
let phoneBridgeReconnectAttempts = 0;
let phoneBridgeMaxReconnects = 5;
let phoneBridgeActive = false; // Only true after user triggers QR connect

function connectPhoneBridge() {
    if (!phoneBridgeActive) return;
    if (phoneBridgeWs && phoneBridgeWs.readyState <= WebSocket.OPEN) return;

    const serverUrl = process.env.WS_SERVER_URL || 'wss://iu-rw9m.onrender.com';

    if (phoneBridgeReconnectAttempts === 0) {
        console.log(`📱 [PhoneBridge] Connecting to: ${serverUrl}`);
    }

    try {
        phoneBridgeWs = new WebSocket(serverUrl);
    } catch (e) {
        console.error('📱 [PhoneBridge] Connection error:', e.message);
        schedulePhoneBridgeReconnect();
        return;
    }

    phoneBridgeWs.on('open', () => {
        console.log('📱 [PhoneBridge] ✅ Connected to sync server');
        phoneBridgeReconnectAttempts = 0;

        if (phoneBridgeRoomId) {
            phoneBridgeRegisterAndJoin(phoneBridgeRoomId);
        }

        syncContextToServer();
    });

    phoneBridgeWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handlePhoneBridgeMessage(msg);
        } catch (e) {
            console.error('📱 [PhoneBridge] Parse error:', e);
        }
    });

    phoneBridgeWs.on('close', () => {
        phoneBridgeWs = null;
        schedulePhoneBridgeReconnect();
    });

    phoneBridgeWs.on('error', () => {
        // Error is logged implicitly by the close event
    });
}

function schedulePhoneBridgeReconnect() {
    if (!phoneBridgeActive) return;
    phoneBridgeReconnectAttempts++;
    if (phoneBridgeReconnectAttempts > phoneBridgeMaxReconnects) {
        console.log('📱 [PhoneBridge] Server not available. Will retry when QR connect is triggered again.');
        phoneBridgeActive = false;
        phoneBridgeReconnectAttempts = 0;
        return;
    }
    const delay = Math.min(5000 * Math.pow(2, phoneBridgeReconnectAttempts - 1), 60000);
    setTimeout(connectPhoneBridge, delay);
}

function phoneBridgeRegisterAndJoin(roomId) {
    phoneBridgeRoomId = roomId;
    if (!phoneBridgeWs || phoneBridgeWs.readyState !== WebSocket.OPEN) return;

    phoneBridgeSend({
        type: 'register',
        deviceId: phoneBridgeDeviceId,
        payload: { deviceType: 'electron', roomId }
    });

    phoneBridgeSend({
        type: 'join_room',
        deviceId: phoneBridgeDeviceId,
        payload: { roomId }
    });

    console.log(`📱 [PhoneBridge] Joined room: ${roomId}`);
}

function phoneBridgeSend(msg) {
    if (phoneBridgeWs && phoneBridgeWs.readyState === WebSocket.OPEN) {
        phoneBridgeWs.send(JSON.stringify({ ...msg, timestamp: Date.now() }));
    }
}

function syncContextToServer() {
    if (!contextManager) return;
    const history = contextManager.getFullHistory();
    phoneBridgeSend({
        type: 'context_sync',
        deviceId: phoneBridgeDeviceId,
        payload: { history }
    });
}

async function handlePhoneBridgeMessage(msg) {
    if (msg.deviceId === phoneBridgeDeviceId) return;

    switch (msg.type) {
        case 'phone_chat':
            await handlePhoneChat(msg.payload);
            break;

        case 'phone_voice':
            await handlePhoneVoice(msg.payload);
            break;

        case 'phone_voice_toggle':
            handlePhoneVoiceToggle(msg.payload);
            break;

        case 'context_request':
            syncContextToServer();
            break;

        default:
            // Ignore other messages (register, pong, etc.)
            break;
    }
}

/**
 * Handle text chat from phone — same pipeline as chat-send-message IPC
 */
async function handlePhoneChat(payload) {
    const text = payload?.text;
    if (!text) return;

    console.log(`📱 [PhoneBridge] Chat from phone: "${text.substring(0, 60)}"`);

    // Send face state: thinking
    phoneBridgeSend({
        type: 'face_state',
        deviceId: phoneBridgeDeviceId,
        payload: { state: 'thinking' }
    });

    // Add to context
    contextManager.addMessage('user', text, 'phone_chat');

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        phoneBridgeSend({
            type: 'phone_reply',
            deviceId: phoneBridgeDeviceId,
            payload: { error: 'Provider de texto no inicializado' }
        });
        return;
    }

    try {
        const relevantContext = await contextManager.getRelevantContext(text);
        const LearningAgent = require('./LearningAgent');
        const relevantLearned = LearningAgent.findRelevantWorkflows(text, 3);

        let systemPrompt = `Eres U, un asistente digital conciso y eficaz. El usuario te escribe desde su teléfono para controlar su computador remotamente.

Si el usuario pide ejecutar algo en su computador (abrir apps, enviar mensajes, buscar algo, etc.), responde brevemente confirmando lo que harás y llama la función execute_screen_action.

Si solo conversa o pregunta algo, responde de forma breve y útil. Máximo 2-3 oraciones.
Responde en español.`;

        if (relevantLearned && relevantLearned.length > 0) {
            const list = relevantLearned.map((wf, i) => {
                return `${i + 1}. ${wf.workflowName}\n   Resumen: ${wf.summary}\n   Estilo: ${wf.executionStyle}`;
            }).join('\n');
            systemPrompt += `\n\nAPRENDIZAJES RELEVANTES DEL USUARIO:\n${list}`;
        }

        if (relevantContext.longTerm) {
            systemPrompt += `\n\nMEMORIA A LARGO PLAZO:\n${relevantContext.longTerm}`;
        }

        const history = contextManager.getHistoryForAPI(20);

        const response = await ModelSwitch.chatCompletion({
            messages: [
                { role: 'system', content: systemPrompt },
                ...history
            ],
            tools: actionPlanner ? actionPlanner.tools : undefined,
            tool_choice: actionPlanner ? 'auto' : undefined
        });

        const message = response.choices[0].message;
        const reply = message.content || '';

        // Check for action
        if (message.tool_calls && message.tool_calls.length > 0) {
            const call = message.tool_calls[0];
            if (call.function.name === 'execute_screen_action') {
                const args = JSON.parse(call.function.arguments);
                console.log(`📱 [PhoneBridge] Action from phone: ${args.goal}`);

                contextManager.addMessage('assistant', reply || null, 'phone_api', {
                    tool_calls: message.tool_calls
                });
                contextManager.addMessage('tool', `Acción iniciada: ${args.goal} en ${args.app}`, 'action_result', {
                    tool_call_id: call.id,
                    name: call.function.name
                });

                // Send reply + action to phone
                phoneBridgeSend({
                    type: 'phone_reply',
                    deviceId: phoneBridgeDeviceId,
                    payload: {
                        reply: reply || `Entendido. Voy a ${args.goal.toLowerCase()}.`,
                        action: args
                    }
                });

                // Send face state: executing
                phoneBridgeSend({
                    type: 'face_state',
                    deviceId: phoneBridgeDeviceId,
                    payload: { state: 'executing' }
                });

                // Execute on Mac
                if (mainWindow) {
                    mainWindow.webContents.send('action-confirm-request', {
                        goal: args.goal,
                        app: args.app,
                        stepsHint: args.steps_hint,
                        source: 'phone'
                    });
                }

                // Sync context
                syncContextToServer();
                return;
            }
        }

        // Regular reply
        phoneBridgeSend({
            type: 'phone_reply',
            deviceId: phoneBridgeDeviceId,
            payload: { reply }
        });

        // Send face state: idle
        phoneBridgeSend({
            type: 'face_state',
            deviceId: phoneBridgeDeviceId,
            payload: { state: 'idle' }
        });

        contextManager.addMessage('assistant', reply || null, 'phone_api', {
            tool_calls: message.tool_calls
        });

        // Sync context
        syncContextToServer();

    } catch (e) {
        console.error('❌ [PhoneBridge] Chat failed:', e.message);
        phoneBridgeSend({
            type: 'phone_reply',
            deviceId: phoneBridgeDeviceId,
            payload: { error: e.message }
        });
        phoneBridgeSend({
            type: 'face_state',
            deviceId: phoneBridgeDeviceId,
            payload: { state: 'idle' }
        });
    }
}

/**
 * Handle voice message from phone — transcribe with Whisper then chat
 */
async function handlePhoneVoice(payload) {
    const audio = payload?.audio;
    if (!audio) return;

    console.log('📱 [PhoneBridge] Voice message received from phone');

    // Send face state: listening
    phoneBridgeSend({
        type: 'face_state',
        deviceId: phoneBridgeDeviceId,
        payload: { state: 'listening' }
    });

    try {
        // Decode base64 audio
        const base64Data = audio.replace(/^data:audio\/[^;]+[^,]*,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        if (buffer.length < 1000) {
            console.warn('📱 [PhoneBridge] Audio too small, ignoring');
            phoneBridgeSend({
                type: 'face_state',
                deviceId: phoneBridgeDeviceId,
                payload: { state: 'idle' }
            });
            return;
        }

        // Save temp file
        const tempFile = path.join(app.getPath('temp'), `phone_audio_${Date.now()}.webm`);
        fs.writeFileSync(tempFile, buffer);

        // Transcribe
        const transcription = await ModelSwitch.transcription({
            filePath: tempFile,
            buffer: buffer,
            mimeType: 'audio/webm'
        });

        const transcript = transcription.text;
        console.log(`📱 [PhoneBridge] Transcription: "${transcript}"`);

        // Cleanup temp file
        try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }

        if (!transcript || transcript.trim().length === 0) {
            phoneBridgeSend({
                type: 'phone_reply',
                deviceId: phoneBridgeDeviceId,
                payload: { reply: 'No pude entender el audio.' }
            });
            phoneBridgeSend({
                type: 'face_state',
                deviceId: phoneBridgeDeviceId,
                payload: { state: 'idle' }
            });
            return;
        }

        // Process as chat
        await handlePhoneChat({ text: transcript });

    } catch (e) {
        console.error('❌ [PhoneBridge] Voice processing failed:', e.message);
        phoneBridgeSend({
            type: 'phone_reply',
            deviceId: phoneBridgeDeviceId,
            payload: { error: 'Error procesando audio: ' + e.message }
        });
        phoneBridgeSend({
            type: 'face_state',
            deviceId: phoneBridgeDeviceId,
            payload: { state: 'idle' }
        });
    }
}

/**
 * Handle voice toggle from phone — activate/deactivate Mac voice mode
 */
function handlePhoneVoiceToggle(payload) {
    const action = payload?.action;
    console.log(`📱 [PhoneBridge] Voice toggle from phone: ${action}`);

    // Trigger voice control via the existing conversation-control IPC
    if (mainWindow) {
        mainWindow.webContents.send('voice-state-changed', action === 'start' ? 'active' : 'inactive');
    }

    // If we have a chatPage (ChatGPT), try to toggle voice
    if (chatPage) {
        try {
            if (action === 'start') {
                chatPage.evaluate(() => {
                    const btn = document.querySelector('button[aria-label="Start Voice"]') ||
                        document.querySelector('button[aria-label="Iniciar voz"]') ||
                        document.querySelector('button[data-testid="composer-speech-button"]');
                    if (btn) btn.click();
                });
            } else {
                chatPage.evaluate(() => {
                    const btn = document.querySelector('button[aria-label="End Voice"]') ||
                        document.querySelector('button[aria-label="Terminar voz"]') ||
                        document.querySelector('button[aria-label="Finalizar voz"]');
                    if (btn) btn.click();
                });
            }
        } catch (e) {
            console.error('📱 [PhoneBridge] Voice toggle failed:', e.message);
        }
    }
}

// ── Start the phone bridge when renderer DeviceSync creates/joins a room ─────

ipcMain.on('phone-bridge-room', (event, { roomId }) => {
    console.log(`📱 [PhoneBridge] Room ID received from renderer: ${roomId}`);
    phoneBridgeRoomId = roomId;

    // Activate and connect (or re-join if already connected)
    phoneBridgeActive = true;
    phoneBridgeReconnectAttempts = 0;

    if (phoneBridgeWs && phoneBridgeWs.readyState === WebSocket.OPEN) {
        phoneBridgeRegisterAndJoin(roomId);
    } else {
        connectPhoneBridge();
    }
});

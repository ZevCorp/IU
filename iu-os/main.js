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
const TURN_TAKING_LOGS_ENABLED = process.env.IU_TURN_TAKING_LOGS === '1';

function logTurnTakingUiux(eventName, data) {
    if (!TURN_TAKING_LOGS_ENABLED) return;
    LoggingSwitch.uiux('turn_taking', eventName, data);
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
const AgentRuntime = require('./AgentRuntime');
const GPTActionBridge = require('./GPTActionBridge');
const ExecutionSessionManager = require('./ExecutionSessionManager');
const NotebookExecutionManager = require('./NotebookExecutionManager');
const KnowledgeService = require('./KnowledgeService');
const TimeManagerRuntime = require('./time-manager/TimeManagerRuntime');
const TimeManagerStore = require('./time-manager/TimeManagerStore');
// Browser Agent: control transversal de páginas web via CDP
const BrowserAgent = require('./BrowserAgent');
const { startBrowserCoreService, createBrowserCoreClient, toClientOptions } = require('./browser-core/dist');
let actionPlanner = null;
let screenAgent = null;
let brain = null;
let browserAgent = null; // Instanciado tras crear la mainWindow
let browserCoreService = null;
let browserCoreClient = null;
let gptActionBridge = null;
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
    storageDir: path.join(app.getPath('userData'), 'chat-notebooks'),
    onChange: (change) => {
        pushKnowledgeStateToChatWindow(change);
    }
});
const timeManagerStore = new TimeManagerStore();

let mainWindow = null;
let chatWindow = null;
let isLearningChatPinned = false;
let chatWindowBoundsBeforeLearning = null;
let chatWindowAnimationTimer = null;
let isChatWindowAnimatingClose = false;
let isChatWindowBooting = false;
let pendingAutoCloseChatWindow = false;
const pendingChatWindowEvents = [];
const promptRunChatWindowState = new Map();
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
const CHAT_WINDOW_TRANSITION_MS = 170;

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
let preferredCompactWindowMode = WINDOW_MODES.SMALL;
const rememberedWindowBounds = {
    [WINDOW_MODES.SMALL]: null,
    [WINDOW_MODES.MEDIUM]: null,
    [WINDOW_MODES.LARGE]: null
};
let windowBoundsSaveTimer = null;

// Hand mesh style: 'v2' (único estilo activo)
let handMeshStyle = 'v2';

function isCompactWindowMode(mode) {
    return mode === WINDOW_MODES.SMALL || mode === WINDOW_MODES.MEDIUM;
}

function isRememberedWindowMode(mode) {
    return mode === WINDOW_MODES.SMALL || mode === WINDOW_MODES.MEDIUM || mode === WINDOW_MODES.LARGE;
}

function sanitizeStoredBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;

    const x = Number(bounds.x);
    const y = Number(bounds.y);
    const width = Number(bounds.width);
    const height = Number(bounds.height);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function scheduleWindowSettingsSave() {
    if (windowBoundsSaveTimer) {
        clearTimeout(windowBoundsSaveTimer);
    }
    windowBoundsSaveTimer = setTimeout(() => {
        windowBoundsSaveTimer = null;
        saveSettings();
    }, 120);
}

function clampBoundsToDisplay(bounds) {
    const sanitized = sanitizeStoredBounds(bounds);
    if (!sanitized) return null;

    const display = screen.getDisplayMatching({
        x: sanitized.x,
        y: sanitized.y,
        width: sanitized.width,
        height: sanitized.height
    });
    const area = display.workArea;
    const maxX = area.x + area.width - sanitized.width;
    const maxY = area.y + area.height - sanitized.height;

    return {
        ...sanitized,
        x: Math.max(area.x, Math.min(sanitized.x, maxX)),
        y: Math.max(area.y, Math.min(sanitized.y, maxY))
    };
}

function rememberBoundsForMode(mode, bounds = null, options = {}) {
    if (!isRememberedWindowMode(mode)) return;

    const sourceBounds = bounds || ((mainWindow && !mainWindow.isDestroyed()) ? mainWindow.getBounds() : null);
    const sanitized = sanitizeStoredBounds(sourceBounds);
    if (!sanitized) return;

    rememberedWindowBounds[mode] = sanitized;
    if (isCompactWindowMode(mode)) {
        preferredCompactWindowMode = mode;
    }

    if (options.persist !== false) {
        scheduleWindowSettingsSave();
    }
}

function getPreferredCompactMode() {
    return preferredCompactWindowMode === WINDOW_MODES.MEDIUM ? WINDOW_MODES.MEDIUM : WINDOW_MODES.SMALL;
}

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            if (settings.handMeshStyle) handMeshStyle = settings.handMeshStyle;
            if (settings.preferredCompactWindowMode === WINDOW_MODES.SMALL || settings.preferredCompactWindowMode === WINDOW_MODES.MEDIUM) {
                preferredCompactWindowMode = settings.preferredCompactWindowMode;
            }
            const storedBounds = settings.windowBoundsByMode || {};
            for (const mode of [WINDOW_MODES.SMALL, WINDOW_MODES.MEDIUM, WINDOW_MODES.LARGE]) {
                rememberedWindowBounds[mode] = sanitizeStoredBounds(storedBounds[mode]);
            }
            console.log(`⚙️ Settings loaded: handMeshStyle=${handMeshStyle}`);
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
}

function saveSettings() {
    try {
        const settings = {
            windowMode: currentWindowMode,
            handMeshStyle,
            preferredCompactWindowMode,
            windowBoundsByMode: rememberedWindowBounds
        };
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

function clearChatWindowAnimationTimer() {
    if (!chatWindowAnimationTimer) return;
    clearTimeout(chatWindowAnimationTimer);
    chatWindowAnimationTimer = null;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function getChatWindowTransitionBounds(bounds) {
    return {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x + 12,
        y: bounds.y + 6
    };
}

function interpolateNumber(from, to, progress) {
    return from + (to - from) * progress;
}

function animateChatWindow(win, options = {}) {
    if (!win || win.isDestroyed()) return;

    const {
        fromBounds,
        toBounds,
        fromOpacity = 1,
        toOpacity = 1,
        duration = CHAT_WINDOW_TRANSITION_MS,
        onDone
    } = options;

    clearChatWindowAnimationTimer();
    const start = Date.now();

    const tick = () => {
        if (!win || win.isDestroyed()) return;
        const elapsed = Date.now() - start;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeOutCubic(progress);

        if (fromBounds && toBounds) {
            win.setBounds({
                x: Math.round(interpolateNumber(fromBounds.x, toBounds.x, eased)),
                y: Math.round(interpolateNumber(fromBounds.y, toBounds.y, eased)),
                width: Math.round(interpolateNumber(fromBounds.width, toBounds.width, eased)),
                height: Math.round(interpolateNumber(fromBounds.height, toBounds.height, eased))
            }, false);
        }

        if (typeof win.setOpacity === 'function') {
            win.setOpacity(interpolateNumber(fromOpacity, toOpacity, eased));
        }

        if (progress >= 1) {
            clearChatWindowAnimationTimer();
            onDone?.();
            return;
        }

        chatWindowAnimationTimer = setTimeout(tick, 16);
    };

    tick();
}

function showChatWindowWithTransition() {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    const targetBounds = chatWindow.getBounds();
    const startBounds = getChatWindowTransitionBounds(targetBounds);
    if (typeof chatWindow.setOpacity === 'function') {
        chatWindow.setOpacity(0);
    }
    chatWindow.setBounds(startBounds, false);
    chatWindow.show();
    animateChatWindow(chatWindow, {
        fromBounds: startBounds,
        toBounds: targetBounds,
        fromOpacity: 0,
        toOpacity: 1
    });
}

function closeChatWindowWithTransition() {
    if (!chatWindow || chatWindow.isDestroyed() || isChatWindowAnimatingClose) return;
    isChatWindowAnimatingClose = true;
    const win = chatWindow;
    const startBounds = win.getBounds();
    const endBounds = getChatWindowTransitionBounds(startBounds);
    const fromOpacity = typeof win.getOpacity === 'function' ? win.getOpacity() : 1;

    animateChatWindow(win, {
        fromBounds: startBounds,
        toBounds: endBounds,
        fromOpacity,
        toOpacity: 0,
        onDone: () => {
            isChatWindowAnimatingClose = false;
            if (!win.isDestroyed()) {
                win.destroy();
            }
        }
    });
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

function getRememberedBoundsForMode(mode) {
    const fallbackBounds = getWindowBounds(mode);
    const stored = rememberedWindowBounds[mode];
    if (!stored) {
        return fallbackBounds;
    }

    return clampBoundsToDisplay({
        ...fallbackBounds,
        x: stored.x,
        y: stored.y
    }) || fallbackBounds;
}

function moveWindowToBounds(bounds, animate = true) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const clampedBounds = clampBoundsToDisplay(bounds);
    if (!clampedBounds) return;
    mainWindow.setBounds(clampedBounds, animate);
}

function applyWindowMode(mode, animate = true) {
    if (!mainWindow) return;
    if (mode === WINDOW_MODES.FULLSCREEN) {
        mode = WINDOW_MODES.LARGE;
    }

    const previousMode = currentWindowMode;
    if (previousMode !== mode && mainWindow && !mainWindow.isDestroyed()) {
        rememberBoundsForMode(previousMode, mainWindow.getBounds(), { persist: false });
    }

    currentWindowMode = mode;
    if (isCompactWindowMode(mode)) {
        preferredCompactWindowMode = mode;
    }
    saveSettings();
    isCompactMode = (mode === WINDOW_MODES.SMALL || mode === WINDOW_MODES.MEDIUM || mode === WINDOW_MODES.BOOTLOADER);

    // All modes use mainWindow — no independent renderer to preserve VisionManager continuity
    destroySmallWindow(); // Clean up any leftover independent window
    if (!mainWindow.isVisible()) mainWindow.show();

    const bounds = getRememberedBoundsForMode(mode);
    moveWindowToBounds(bounds, animate);

    if (process.platform === 'darwin') {
        // SMALL mode: no system vibrancy — CSS backdrop-filter on the circle handles the effect.
        // We use transparent for all modes to avoid the black window bug, CSS backdrop-filter provides glass.
        mainWindow.setVibrancy(null);
        mainWindow.setBackgroundColor('#00000000');
    }

    // Send mode change to renderer
    mainWindow.webContents.send('window-mode-changed', mode);
    rememberBoundsForMode(mode, mainWindow.getBounds(), { persist: false });

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
        rememberBoundsForMode(currentWindowMode, mainWindow.getBounds(), { persist: false });
    });

    mainWindow.on('resize', () => {
        syncChatWindowPosition(false);
        rememberBoundsForMode(currentWindowMode, mainWindow.getBounds(), { persist: false });
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

function queueChatWindowEvent(channel, payload) {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(channel, payload);
        return true;
    }
    if (!isChatWindowBooting) {
        return false;
    }
    pendingChatWindowEvents.push({ channel, payload });
    if (pendingChatWindowEvents.length > 80) {
        pendingChatWindowEvents.shift();
    }
    return true;
}

function flushPendingChatWindowEvents() {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    while (pendingChatWindowEvents.length > 0) {
        const next = pendingChatWindowEvents.shift();
        chatWindow.webContents.send(next.channel, next.payload);
    }
}

function pushKnowledgeStateToChatWindow(change = {}) {
    queueChatWindowEvent('chat-knowledge-state', {
        timestamp: Date.now(),
        state: change?.state || knowledgeService.getKnowledgeState(),
        change
    });
}

function pushPromptAgentProgressToChatWindow(entry = {}, runId = '') {
    queueChatWindowEvent('chat-agent-progress', {
        runId,
        timestamp: Date.now(),
        ...entry
    });
}

function isKnowledgeEditingTool(toolName = '') {
    return [
        'create_note',
        'update_note',
        'append_to_note',
        'replace_in_note',
        'delete_note',
        'create_meta',
        'update_meta',
        'delete_meta',
        'attach_note_to_meta',
        'detach_note_from_meta'
    ].includes(String(toolName || '').trim());
}

function ensurePromptRunChatWindow(runId = '') {
    const key = String(runId || '').trim();
    if (!key) return null;
    if (!promptRunChatWindowState.has(key)) {
        promptRunChatWindowState.set(key, {
            sawKnowledgeEdit: false,
            autoOpened: false
        });
    }
    return promptRunChatWindowState.get(key);
}

function maybeAutoOpenChatWindowForPromptRun(runId = '', entry = {}) {
    const state = ensurePromptRunChatWindow(runId);
    if (!state) return;
    if (String(entry?.type || '').trim() !== 'tool_call' || String(entry?.phase || '').trim() !== 'start') return;
    if (!isKnowledgeEditingTool(entry?.toolName)) return;
    state.sawKnowledgeEdit = true;
    if (chatWindow && !chatWindow.isDestroyed()) return;
    if (isChatWindowBooting) return;
    state.autoOpened = true;
    createChatWindow();
}

function finalizePromptRunChatWindow(runId = '') {
    const key = String(runId || '').trim();
    const state = promptRunChatWindowState.get(key);
    promptRunChatWindowState.delete(key);
    if (!state?.autoOpened) return;
    if (!chatWindow || chatWindow.isDestroyed()) {
        pendingAutoCloseChatWindow = true;
        return;
    }
    closeChatWindowWithTransition();
}

function createChatWindow(options = {}) {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
        return;
    }
    isChatWindowBooting = true;
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
        isChatWindowBooting = false;
        if (!isLearningChatPinned) {
            syncChatWindowPosition(false);
        }
        showChatWindowWithTransition();
        pushUiThemeToChatWindow();
        flushPendingChatWindowEvents();
        pushKnowledgeStateToChatWindow({
            entity: 'knowledge',
            action: 'bootstrap_sync',
            source: 'main_process',
            state: knowledgeService.getKnowledgeState()
        });
        if (pendingAutoCloseChatWindow) {
            pendingAutoCloseChatWindow = false;
            setTimeout(() => {
                if (chatWindow && !chatWindow.isDestroyed()) {
                    closeChatWindowWithTransition();
                }
            }, 180);
        }
    });

    chatWindow.on('closed', () => {
        clearChatWindowAnimationTimer();
        chatWindow = null;
        isLearningChatPinned = false;
        chatWindowBoundsBeforeLearning = null;
        isChatWindowAnimatingClose = false;
        isChatWindowBooting = false;
        pendingAutoCloseChatWindow = false;
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

function safeSliceText(value, max = 1200) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}...`;
}

function buildTimeManagerState() {
    return {
        notifications: timeManagerStore.getRecentNotifications(20),
        decisions: timeManagerStore.getRecentDecisions(20)
    };
}

async function answerTimeManagerQuestion(question, notification) {
    const prompt = String(question || '').trim();
    if (!prompt) {
        return {
            ok: false,
            error: 'Pregunta vacía para el agente principal'
        };
    }

    if (!ModelSwitch.isReady({ capability: 'chat' })) {
        return {
            ok: false,
            error: 'Modelo no disponible'
        };
    }

    const relevantContext = await contextManager.getRelevantContext(prompt);
    const workspace = knowledgeService.getKnowledgeState();
    const notes = Array.isArray(workspace?.tabs) ? workspace.tabs.slice(0, 5) : [];
    const metas = Array.isArray(workspace?.metas) ? workspace.metas.slice(0, 5) : [];

    const response = await ModelSwitch.chatCompletion({
        messages: [
            {
                role: 'system',
                content: [
                    'Eres el asistente principal de IÜ OS respondiendo a un agente hermano llamado Time Manager.',
                    'Tu trabajo es dar contexto útil, corto y accionable para decidir si una notificación debe interrumpir al usuario.',
                    'No menciones tool calls ni pipeline interno.',
                    'Responde en español y en máximo 6 líneas.',
                    `Fecha y hora actual: ${new Date().toLocaleString('es-ES')}`
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    question: prompt,
                    notification: notification || null,
                    relevantLongTermContext: relevantContext?.longTerm || '',
                    notes: notes.map((note) => ({
                        id: String(note?.id || ''),
                        title: String(note?.title || '').trim() || 'Sin titulo',
                        preview: safeSliceText(note?.body || '', 160)
                    })),
                    metas: metas.map((meta) => ({
                        id: String(meta?.id || ''),
                        title: String(meta?.title || '').trim() || 'Meta sin titulo',
                        description: safeSliceText(meta?.description || '', 160)
                    }))
                })
            }
        ]
    });

    const answer = String(response?.choices?.[0]?.message?.content || '').trim();
    return {
        ok: true,
        answer,
        summary: safeSliceText(answer, 220)
    };
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
        },
        {
            type: 'function',
            function: {
                name: 'update_finance_instructions',
                description: 'Actualiza el texto libre de la meta fija Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        instructions: { type: 'string', description: 'Instrucciones operativas completas del agente financiero' }
                    },
                    required: ['meta_id', 'instructions']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'create_finance_pocket',
                description: 'Crea un bolsillo dentro de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        name: { type: 'string', description: 'Nombre del bolsillo' },
                        bank: { type: 'string', description: 'Banco o app bancaria' },
                        purpose: { type: 'string', description: 'Uso o propósito del bolsillo' },
                        balance: { type: 'number', description: 'Saldo inicial' }
                    },
                    required: ['meta_id', 'name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_finance_pocket',
                description: 'Edita un bolsillo existente dentro de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo' },
                        name: { type: 'string', description: 'Nuevo nombre' },
                        bank: { type: 'string', description: 'Nuevo banco o app bancaria' },
                        purpose: { type: 'string', description: 'Nuevo propósito' },
                        balance: { type: 'number', description: 'Nuevo saldo absoluto' }
                    },
                    required: ['meta_id', 'pocket_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_finance_pocket',
                description: 'Elimina un bolsillo de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo' }
                    },
                    required: ['meta_id', 'pocket_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'deposit_finance_pocket',
                description: 'Carga dinero en un bolsillo.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo' },
                        amount: { type: 'number', description: 'Monto a cargar' }
                    },
                    required: ['meta_id', 'pocket_id', 'amount']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'withdraw_finance_pocket',
                description: 'Descarga dinero de un bolsillo.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo' },
                        amount: { type: 'number', description: 'Monto a descargar' }
                    },
                    required: ['meta_id', 'pocket_id', 'amount']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'move_money_between_finance_pockets',
                description: 'Mueve dinero entre dos bolsillos de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        from_pocket_id: { type: 'string', description: 'Bolsillo origen' },
                        to_pocket_id: { type: 'string', description: 'Bolsillo destino' },
                        amount: { type: 'number', description: 'Monto a mover' }
                    },
                    required: ['meta_id', 'from_pocket_id', 'to_pocket_id', 'amount']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_finance_projection',
                description: 'Actualiza ingresos, gastos y horizonte temporal de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas' },
                        expected_income: { type: 'number', description: 'Ingreso previsto para el horizonte' },
                        expected_expenses: { type: 'number', description: 'Gasto previsto para el horizonte' },
                        horizon_weeks: { type: 'integer', description: 'Horizonte en semanas' },
                        current_label: { type: 'string', description: 'Etiqueta del tiempo actual' },
                        future_label: { type: 'string', description: 'Etiqueta del tiempo futuro' }
                    },
                    required: ['meta_id']
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

    if (name === 'update_finance_instructions') {
        LoggingSwitch.execution('KnowledgeTool', `update_finance_instructions meta="${String(args.meta_id || '').trim()}"`);
        const meta = knowledgeService.updateFinanceInstructions(String(args.meta_id || '').trim(), String(args.instructions || ''), { source: 'manual' });
        if (!meta?.id) return { error: 'No pude actualizar las instrucciones de Finanzas.' };
        return {
            reply: 'Actualicé las instrucciones operativas de Finanzas.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'create_finance_pocket') {
        LoggingSwitch.execution('KnowledgeTool', `create_finance_pocket meta="${String(args.meta_id || '').trim()}"`);
        const meta = knowledgeService.createFinancePocket(String(args.meta_id || '').trim(), {
            name: String(args.name || '').trim(),
            bank: String(args.bank || '').trim(),
            purpose: String(args.purpose || '').trim(),
            balance: Number(args.balance || 0)
        }, { source: 'manual' });
        if (!meta?.id) return { error: 'No pude crear ese bolsillo.' };
        return {
            reply: 'Creé un bolsillo nuevo dentro de Finanzas.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'update_finance_pocket') {
        LoggingSwitch.execution('KnowledgeTool', `update_finance_pocket meta="${String(args.meta_id || '').trim()}" pocket="${String(args.pocket_id || '').trim()}"`);
        const meta = knowledgeService.updateFinancePocket(String(args.meta_id || '').trim(), String(args.pocket_id || '').trim(), {
            name: args.name,
            bank: args.bank,
            purpose: args.purpose,
            balance: args.balance
        }, { source: 'manual' });
        if (!meta?.id) return { error: 'No pude actualizar ese bolsillo.' };
        return {
            reply: 'Actualicé ese bolsillo de Finanzas.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'delete_finance_pocket') {
        LoggingSwitch.execution('KnowledgeTool', `delete_finance_pocket meta="${String(args.meta_id || '').trim()}" pocket="${String(args.pocket_id || '').trim()}"`);
        const meta = knowledgeService.deleteFinancePocket(String(args.meta_id || '').trim(), String(args.pocket_id || '').trim(), { source: 'manual' });
        if (!meta?.id) return { error: 'No pude eliminar ese bolsillo.' };
        return {
            reply: 'Eliminé ese bolsillo de Finanzas.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'deposit_finance_pocket' || name === 'withdraw_finance_pocket') {
        LoggingSwitch.execution('KnowledgeTool', `${name} meta="${String(args.meta_id || '').trim()}" pocket="${String(args.pocket_id || '').trim()}"`);
        const meta = knowledgeService.adjustFinancePocket(
            String(args.meta_id || '').trim(),
            String(args.pocket_id || '').trim(),
            Number(args.amount || 0),
            name === 'withdraw_finance_pocket' ? 'withdraw' : 'deposit',
            { source: 'manual' }
        );
        if (!meta?.id) return { error: 'No pude mover ese saldo.' };
        return {
            reply: name === 'withdraw_finance_pocket'
                ? 'Descargué dinero de ese bolsillo.'
                : 'Cargué dinero en ese bolsillo.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'move_money_between_finance_pockets') {
        LoggingSwitch.execution('KnowledgeTool', `move_money_between_finance_pockets meta="${String(args.meta_id || '').trim()}"`);
        const meta = knowledgeService.moveMoneyBetweenFinancePockets(
            String(args.meta_id || '').trim(),
            String(args.from_pocket_id || '').trim(),
            String(args.to_pocket_id || '').trim(),
            Number(args.amount || 0),
            { source: 'manual' }
        );
        if (!meta?.id) return { error: 'No pude mover dinero entre esos bolsillos.' };
        return {
            reply: 'Moví dinero entre bolsillos de Finanzas.',
            state: knowledgeService.getKnowledgeState()
        };
    }

    if (name === 'update_finance_projection') {
        LoggingSwitch.execution('KnowledgeTool', `update_finance_projection meta="${String(args.meta_id || '').trim()}"`);
        const meta = knowledgeService.updateFinanceProjection(String(args.meta_id || '').trim(), {
            expectedIncome: args.expected_income,
            expectedExpenses: args.expected_expenses,
            horizonWeeks: args.horizon_weeks,
            currentLabel: args.current_label,
            futureLabel: args.future_label
        }, { source: 'manual' });
        if (!meta?.id) return { error: 'No pude actualizar la proyección financiera.' };
        return {
            reply: 'Actualicé la proyección temporal de Finanzas.',
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

async function executePromptRuntimeActionTool({ name, args = {}, runId = '', source = 'prompt_agent_runtime', reason = 'Generated by AgentRuntime' } = {}) {
    if (name === 'execute_screen_action') {
        const goal = String(args.goal || '').trim();
        const app = String(args.app || '').trim();
        const stepsHint = String(args.steps_hint || '').trim();
        const requestId = `prompt_action_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
        const actionPayload = {
            goal,
            app,
            stepsHint,
            source,
            requestId,
            runId,
            reason
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('action-confirm-request', actionPayload);
        }

        LoggingSwitch.uiux('prompt_agent', 'runtime_action_confirm_requested', {
            runId,
            requestId,
            app,
            goalPreview: safeSliceText(goal, 160)
        });

        return {
            ok: true,
            summary: `Prepared action in ${app || 'computer'}`,
            detail: safeSliceText(goal || stepsHint || 'Acción lista para confirmar', 180),
            action: {
                type: 'screen_action',
                requestId,
                app,
                goal
            }
        };
    }

    if (name === 'schedule_reminder') {
        const task = String(args.task || '').trim();
        const minutes = Math.max(1, Math.min(60 * 24 * 30, Number(args.minutes || 0)));
        if (!task || !Number.isFinite(minutes) || !brain) {
            return { ok: false, error: 'No pude programar ese recordatorio.' };
        }
        const date = new Date(Date.now() + (minutes * 60 * 1000));
        const scheduled = brain.scheduleTask(task, date);
        return {
            ok: true,
            summary: `Scheduled reminder in ${minutes} min`,
            detail: task,
            action: {
                type: 'reminder',
                taskId: scheduled?.id || '',
                task
            }
        };
    }

    if (name === 'play_agario') {
        const nickname = String(args.nickname || '').trim();
        const requestId = `prompt_agario_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
        const actionPayload = {
            goal: nickname ? `Jugar Agar.io como ${nickname}` : 'Jugar Agar.io',
            app: 'Browser',
            stepsHint: nickname ? `Abrir Agar.io y usar nickname ${nickname}` : 'Abrir Agar.io y dejarlo listo para jugar',
            source,
            requestId,
            runId,
            reason
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('action-confirm-request', actionPayload);
        }

        return {
            ok: true,
            summary: 'Prepared Agar.io session',
            detail: nickname || 'Nickname automático',
            action: {
                type: 'play_agario',
                requestId,
                nickname
            }
        };
    }

    return { ok: false, error: `Tool de acción no soportada: ${name}` };
}

const promptAgentRuntime = new AgentRuntime({
    modelSwitch: ModelSwitch,
    knowledgeService,
    logging: LoggingSwitch,
    safeSliceText,
    getActionTools: () => (actionPlanner ? actionPlanner.tools : []),
    executeActionTool: executePromptRuntimeActionTool
});

const timeManagerRuntime = new TimeManagerRuntime({
    modelSwitch: ModelSwitch,
    store: timeManagerStore,
    safeSliceText,
    askMainAssistant: async ({ question, notification }) => {
        return answerTimeManagerQuestion(question, notification);
    },
    onDecision: async (decision, context = {}) => {
        const payload = {
            runId: context.runId || '',
            notification: context.notification || null,
            decision
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('time-manager-decision', payload);
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('time-manager-decision', payload);
        }

        return { ok: true };
    }
});

function getKnowledgeBridgeState() {
    return knowledgeService.getKnowledgeState() || { tabs: [], metas: [] };
}

function summarizeBridgeNote(note) {
    return {
        id: String(note?.id || '').trim(),
        title: String(note?.title || '').trim() || 'Sin titulo',
        preview: safeSliceText(note?.body || '', 220),
        updatedAt: note?.updatedAt || null
    };
}

function summarizeBridgeMeta(meta, notes = []) {
    const noteMap = new Map((Array.isArray(notes) ? notes : []).map((note) => [String(note?.id || '').trim(), note]));
    const linkedTitles = (Array.isArray(meta?.noteIds) ? meta.noteIds : [])
        .map((noteId) => noteMap.get(String(noteId || '').trim()))
        .filter(Boolean)
        .slice(0, 6)
        .map((note) => ({ id: note.id, title: note.title || 'Sin titulo' }));
    const financePockets = Array.isArray(meta?.finance?.pockets) ? meta.finance.pockets : [];
    const financeTotal = financePockets.reduce((sum, pocket) => sum + Number(pocket?.balance || 0), 0);

    return {
        id: String(meta?.id || '').trim(),
        kind: String(meta?.kind || 'generic').trim(),
        isFixed: Boolean(meta?.isFixed),
        title: String(meta?.title || '').trim() || 'Meta sin titulo',
        description: safeSliceText(meta?.description || '', 220),
        noteIds: Array.isArray(meta?.noteIds) ? meta.noteIds.slice(0, 30) : [],
        noteCount: Array.isArray(meta?.noteIds) ? meta.noteIds.length : 0,
        noteTitles: linkedTitles,
        finance: meta?.kind === 'finance'
            ? {
                pocketCount: financePockets.length,
                totalBalance: Math.round(financeTotal * 100) / 100,
                expectedIncome: Number(meta?.finance?.forecast?.expectedIncome || 0),
                expectedExpenses: Number(meta?.finance?.forecast?.expectedExpenses || 0),
                horizonWeeks: Number(meta?.finance?.forecast?.horizonWeeks || 0)
            }
            : null
    };
}

function searchBridgeNotes(query, limit = 8) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    const state = getKnowledgeBridgeState();
    const notes = Array.isArray(state.tabs) ? state.tabs : [];

    return notes
        .map((note) => {
            const title = String(note?.title || '').toLowerCase();
            const body = String(note?.body || '').toLowerCase();
            let score = 0;
            for (const term of terms) {
                if (title.includes(term)) score += 5;
                if (body.includes(term)) score += 2;
            }
            if (!score) return null;
            return {
                ...summarizeBridgeNote(note),
                score
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(24, Number(limit || 8))));
}

function searchBridgeMetas(query, limit = 8) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    const state = getKnowledgeBridgeState();
    const metas = Array.isArray(state.metas) ? state.metas : [];

    return metas
        .map((meta) => {
            const title = String(meta?.title || '').toLowerCase();
            const description = String(meta?.description || '').toLowerCase();
            let score = 0;
            for (const term of terms) {
                if (title.includes(term)) score += 5;
                if (description.includes(term)) score += 2;
            }
            if (!score) return null;
            return {
                ...summarizeBridgeMeta(meta, state.tabs || []),
                score
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(24, Number(limit || 8))));
}

function findBridgeNoteById(noteId) {
    const id = String(noteId || '').trim();
    const notes = Array.isArray(getKnowledgeBridgeState().tabs) ? getKnowledgeBridgeState().tabs : [];
    return notes.find((note) => String(note?.id || '').trim() === id) || null;
}

function buildVoiceSummaryMemoryEntry(payload = {}) {
    const summary = String(payload.summary || '').trim();
    const userText = String(payload.user_text || payload.userText || '').trim();
    const assistantText = String(payload.assistant_text || payload.assistantText || '').trim();
    const bullets = [];
    if (summary) bullets.push(`Resumen: ${summary}`);
    if (userText) bullets.push(`Usuario: ${safeSliceText(userText, 280)}`);
    if (assistantText) bullets.push(`Asistente de voz: ${safeSliceText(assistantText, 280)}`);
    return bullets.join('\n');
}

async function ingestVoiceSummaryToBrain(payload = {}) {
    const memoryEntry = buildVoiceSummaryMemoryEntry(payload);
    if (!memoryEntry) {
        return { ok: false, error: 'No summary payload provided' };
    }

    contextManager.addMessage('assistant', `[Resumen voz]\n${memoryEntry}`, 'voice_summary');
    return {
        ok: true,
        recorded: true,
        summaryPreview: safeSliceText(memoryEntry, 220)
    };
}

function buildGptActionBridgeOperations() {
    return [
        {
            name: 'list_notes',
            summary: 'List notes',
            description: 'Lista notas disponibles con titulo, preview y metadata basica.',
            inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
            handler: async (body = {}) => {
                const limit = Math.max(1, Math.min(60, Number(body.limit || 12)));
                const notes = (getKnowledgeBridgeState().tabs || []).slice(0, limit).map(summarizeBridgeNote);
                return { ok: true, count: notes.length, notes };
            }
        },
        {
            name: 'search_notes',
            summary: 'Search notes',
            description: 'Busca notas por titulo o contenido.',
            inputSchema: {
                type: 'object',
                properties: { query: { type: 'string' }, limit: { type: 'integer' } },
                required: ['query']
            },
            handler: async (body = {}) => {
                const matches = searchBridgeNotes(body.query, body.limit);
                return {
                    ok: true,
                    query: String(body.query || '').trim(),
                    matches,
                    count: matches.length
                };
            }
        },
        {
            name: 'get_note',
            summary: 'Get note',
            description: 'Devuelve una nota completa por id.',
            inputSchema: {
                type: 'object',
                properties: { note_id: { type: 'string' }, max_chars: { type: 'integer' } },
                required: ['note_id']
            },
            handler: async (body = {}) => {
                const note = findBridgeNoteById(body.note_id);
                if (!note) return { ok: false, error: 'Note not found' };
                const maxChars = Math.max(200, Math.min(24000, Number(body.max_chars || 12000)));
                return {
                    ok: true,
                    note: {
                        id: note.id,
                        title: note.title || 'Sin titulo',
                        body: safeSliceText(note.body || '', maxChars),
                        updatedAt: note.updatedAt || null
                    }
                };
            }
        },
        {
            name: 'create_note',
            summary: 'Create note',
            description: 'Crea una nota nueva.',
            inputSchema: {
                type: 'object',
                properties: { title: { type: 'string' }, body: { type: 'string' } },
                required: ['title']
            },
            handler: async (body = {}) => {
                const created = knowledgeService.createNote({
                    title: String(body.title || '').trim(),
                    body: body.body !== undefined ? String(body.body || '') : ''
                });
                if (!created?.note) return { ok: false, error: 'Could not create note' };
                return { ok: true, note: summarizeBridgeNote(created.note), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'update_note',
            summary: 'Update note',
            description: 'Actualiza titulo o cuerpo completo de una nota.',
            inputSchema: {
                type: 'object',
                properties: {
                    note_id: { type: 'string' },
                    title: { type: 'string' },
                    body: { type: 'string' }
                },
                required: ['note_id']
            },
            handler: async (body = {}) => {
                const updated = knowledgeService.updateNote(String(body.note_id || '').trim(), {
                    title: body.title,
                    body: body.body
                });
                if (!updated?.note) return { ok: false, error: 'Could not update note' };
                return { ok: true, note: summarizeBridgeNote(updated.note), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'delete_note',
            summary: 'Delete note',
            description: 'Elimina una nota existente.',
            inputSchema: {
                type: 'object',
                properties: { note_id: { type: 'string' } },
                required: ['note_id']
            },
            handler: async (body = {}) => {
                const ok = knowledgeService.deleteNote(String(body.note_id || '').trim());
                return ok ? { ok: true, deleted: true, state: getKnowledgeBridgeState() } : { ok: false, error: 'Could not delete note' };
            }
        },
        {
            name: 'list_metas',
            summary: 'List metas',
            description: 'Lista metas disponibles.',
            inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
            handler: async (body = {}) => {
                const limit = Math.max(1, Math.min(40, Number(body.limit || 12)));
                const state = getKnowledgeBridgeState();
                const metas = (state.metas || []).slice(0, limit).map((meta) => summarizeBridgeMeta(meta, state.tabs || []));
                return { ok: true, count: metas.length, metas };
            }
        },
        {
            name: 'search_metas',
            summary: 'Search metas',
            description: 'Busca metas por titulo o descripcion.',
            inputSchema: {
                type: 'object',
                properties: { query: { type: 'string' }, limit: { type: 'integer' } },
                required: ['query']
            },
            handler: async (body = {}) => {
                const matches = searchBridgeMetas(body.query, body.limit);
                return {
                    ok: true,
                    query: String(body.query || '').trim(),
                    matches,
                    count: matches.length
                };
            }
        },
        {
            name: 'get_meta',
            summary: 'Get meta',
            description: 'Devuelve una meta por id con sus notas vinculadas.',
            inputSchema: {
                type: 'object',
                properties: { meta_id: { type: 'string' } },
                required: ['meta_id']
            },
            handler: async (body = {}) => {
                const state = getKnowledgeBridgeState();
                const meta = (state.metas || []).find((item) => String(item?.id || '').trim() === String(body.meta_id || '').trim());
                if (!meta) return { ok: false, error: 'Meta not found' };
                return { ok: true, meta: summarizeBridgeMeta(meta, state.tabs || []) };
            }
        },
        {
            name: 'create_meta',
            summary: 'Create meta',
            description: 'Crea una meta nueva.',
            inputSchema: {
                type: 'object',
                properties: { title: { type: 'string' }, description: { type: 'string' } },
                required: ['title']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.createMeta({
                    title: String(body.title || '').trim(),
                    description: String(body.description || '').trim()
                });
                if (!meta?.id) return { ok: false, error: 'Could not create meta' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'update_meta',
            summary: 'Update meta',
            description: 'Actualiza una meta existente.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' }
                },
                required: ['meta_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.updateMeta(String(body.meta_id || '').trim(), {
                    title: body.title,
                    description: body.description
                });
                if (!meta?.id) return { ok: false, error: 'Could not update meta' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'delete_meta',
            summary: 'Delete meta',
            description: 'Elimina una meta existente.',
            inputSchema: {
                type: 'object',
                properties: { meta_id: { type: 'string' } },
                required: ['meta_id']
            },
            handler: async (body = {}) => {
                const ok = knowledgeService.deleteMeta(String(body.meta_id || '').trim());
                return ok ? { ok: true, deleted: true, state: getKnowledgeBridgeState() } : { ok: false, error: 'Could not delete meta' };
            }
        },
        {
            name: 'attach_note_to_meta',
            summary: 'Attach note to meta',
            description: 'Vincula una nota a una meta.',
            inputSchema: {
                type: 'object',
                properties: { meta_id: { type: 'string' }, note_id: { type: 'string' } },
                required: ['meta_id', 'note_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.attachNoteToMeta(String(body.meta_id || '').trim(), String(body.note_id || '').trim(), { source: 'manual' });
                if (!meta?.id) return { ok: false, error: 'Could not attach note to meta' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'detach_note_from_meta',
            summary: 'Detach note from meta',
            description: 'Desvincula una nota de una meta.',
            inputSchema: {
                type: 'object',
                properties: { meta_id: { type: 'string' }, note_id: { type: 'string' } },
                required: ['meta_id', 'note_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.detachNoteFromMeta(String(body.meta_id || '').trim(), String(body.note_id || '').trim());
                if (!meta?.id) return { ok: false, error: 'Could not detach note from meta' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'update_finance_instructions',
            summary: 'Update finance instructions',
            description: 'Actualiza el texto libre de la meta fija Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    instructions: { type: 'string' }
                },
                required: ['meta_id', 'instructions']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.updateFinanceInstructions(String(body.meta_id || '').trim(), String(body.instructions || ''));
                if (!meta?.id) return { ok: false, error: 'Could not update finance instructions' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'create_finance_pocket',
            summary: 'Create finance pocket',
            description: 'Crea un bolsillo dentro de Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    name: { type: 'string' },
                    bank: { type: 'string' },
                    purpose: { type: 'string' },
                    balance: { type: 'number' }
                },
                required: ['meta_id', 'name']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.createFinancePocket(String(body.meta_id || '').trim(), body);
                if (!meta?.id) return { ok: false, error: 'Could not create finance pocket' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'update_finance_pocket',
            summary: 'Update finance pocket',
            description: 'Edita un bolsillo de Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    pocket_id: { type: 'string' },
                    name: { type: 'string' },
                    bank: { type: 'string' },
                    purpose: { type: 'string' },
                    balance: { type: 'number' }
                },
                required: ['meta_id', 'pocket_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.updateFinancePocket(String(body.meta_id || '').trim(), String(body.pocket_id || '').trim(), body);
                if (!meta?.id) return { ok: false, error: 'Could not update finance pocket' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'delete_finance_pocket',
            summary: 'Delete finance pocket',
            description: 'Elimina un bolsillo de Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    pocket_id: { type: 'string' }
                },
                required: ['meta_id', 'pocket_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.deleteFinancePocket(String(body.meta_id || '').trim(), String(body.pocket_id || '').trim());
                if (!meta?.id) return { ok: false, error: 'Could not delete finance pocket' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'deposit_finance_pocket',
            summary: 'Deposit finance pocket',
            description: 'Carga dinero en un bolsillo.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    pocket_id: { type: 'string' },
                    amount: { type: 'number' }
                },
                required: ['meta_id', 'pocket_id', 'amount']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.adjustFinancePocket(String(body.meta_id || '').trim(), String(body.pocket_id || '').trim(), Number(body.amount || 0), 'deposit');
                if (!meta?.id) return { ok: false, error: 'Could not deposit in finance pocket' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'withdraw_finance_pocket',
            summary: 'Withdraw finance pocket',
            description: 'Descarga dinero de un bolsillo.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    pocket_id: { type: 'string' },
                    amount: { type: 'number' }
                },
                required: ['meta_id', 'pocket_id', 'amount']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.adjustFinancePocket(String(body.meta_id || '').trim(), String(body.pocket_id || '').trim(), Number(body.amount || 0), 'withdraw');
                if (!meta?.id) return { ok: false, error: 'Could not withdraw from finance pocket' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'move_money_between_finance_pockets',
            summary: 'Move money between finance pockets',
            description: 'Mueve dinero entre bolsillos de Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    from_pocket_id: { type: 'string' },
                    to_pocket_id: { type: 'string' },
                    amount: { type: 'number' }
                },
                required: ['meta_id', 'from_pocket_id', 'to_pocket_id', 'amount']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.moveMoneyBetweenFinancePockets(
                    String(body.meta_id || '').trim(),
                    String(body.from_pocket_id || '').trim(),
                    String(body.to_pocket_id || '').trim(),
                    Number(body.amount || 0)
                );
                if (!meta?.id) return { ok: false, error: 'Could not move money between finance pockets' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'update_finance_projection',
            summary: 'Update finance projection',
            description: 'Actualiza ingresos, gastos y horizonte de Finanzas.',
            inputSchema: {
                type: 'object',
                properties: {
                    meta_id: { type: 'string' },
                    expected_income: { type: 'number' },
                    expected_expenses: { type: 'number' },
                    horizon_weeks: { type: 'integer' },
                    current_label: { type: 'string' },
                    future_label: { type: 'string' }
                },
                required: ['meta_id']
            },
            handler: async (body = {}) => {
                const meta = knowledgeService.updateFinanceProjection(String(body.meta_id || '').trim(), {
                    expectedIncome: body.expected_income,
                    expectedExpenses: body.expected_expenses,
                    horizonWeeks: body.horizon_weeks,
                    currentLabel: body.current_label,
                    futureLabel: body.future_label
                });
                if (!meta?.id) return { ok: false, error: 'Could not update finance projection' };
                return { ok: true, meta: summarizeBridgeMeta(meta, getKnowledgeBridgeState().tabs || []), state: getKnowledgeBridgeState() };
            }
        },
        {
            name: 'execute_screen_action',
            summary: 'Prepare computer action',
            description: 'Prepara una accion del computador usando goal, app y steps_hint.',
            inputSchema: {
                type: 'object',
                properties: {
                    goal: { type: 'string' },
                    app: { type: 'string' },
                    steps_hint: { type: 'string' }
                },
                required: ['goal', 'app', 'steps_hint']
            },
            handler: async (body = {}) => executePromptRuntimeActionTool({
                name: 'execute_screen_action',
                args: body,
                runId: `gpt_voice_${Date.now()}`,
                source: 'chatgpt_custom_gpt',
                reason: 'Generated by custom GPT action'
            })
        },
        {
            name: 'schedule_reminder',
            summary: 'Schedule reminder',
            description: 'Programa un recordatorio futuro.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string' },
                    minutes: { type: 'integer' }
                },
                required: ['task', 'minutes']
            },
            handler: async (body = {}) => executePromptRuntimeActionTool({
                name: 'schedule_reminder',
                args: body,
                runId: `gpt_voice_${Date.now()}`,
                source: 'chatgpt_custom_gpt',
                reason: 'Generated by custom GPT action'
            })
        },
        {
            name: 'play_agario',
            summary: 'Prepare Agar.io session',
            description: 'Prepara una sesion de Agar.io.',
            inputSchema: {
                type: 'object',
                properties: {
                    nickname: { type: 'string' }
                }
            },
            handler: async (body = {}) => executePromptRuntimeActionTool({
                name: 'play_agario',
                args: body,
                runId: `gpt_voice_${Date.now()}`,
                source: 'chatgpt_custom_gpt',
                reason: 'Generated by custom GPT action'
            })
        },
        {
            name: 'voice_turn_summary',
            summary: 'Send voice turn summary to main brain',
            description: 'Entrega un resumen de la conversacion de voz al cerebro principal.',
            inputSchema: {
                type: 'object',
                properties: {
                    summary: { type: 'string' },
                    user_text: { type: 'string' },
                    assistant_text: { type: 'string' }
                },
                required: ['summary']
            },
            handler: async (body = {}) => ingestVoiceSummaryToBrain(body)
        }
    ];
}

async function ensureGptActionBridge() {
    if (gptActionBridge) {
        return gptActionBridge.start();
    }

    gptActionBridge = new GPTActionBridge({
        host: process.env.IU_GPT_ACTION_BRIDGE_HOST || '127.0.0.1',
        port: Number(process.env.IU_GPT_ACTION_BRIDGE_PORT || 4318),
        authToken: process.env.IU_GPT_ACTION_BRIDGE_TOKEN || '',
        publicBaseUrl: process.env.IU_GPT_ACTION_PUBLIC_BASE_URL || '',
        operations: buildGptActionBridgeOperations()
    });

    const started = await gptActionBridge.start();
    LoggingSwitch.execution('GPTActionBridge', `Ready on ${gptActionBridge.getOpenApiUrl()}`);
    return started;
}

async function planUnifiedActionIntent(userText, options = {}) {
    const text = String(userText || '').trim();
    if (!text) return null;

    const recent = Array.isArray(options.recent)
        ? options.recent
        : contextManager.getHistoryForAPI(Number(options.recentLimit || 10));
    const relevantContext = options.relevantContext || await contextManager.getRelevantContext(text);
    const learnedWorkflows = Array.isArray(options.learnedWorkflows)
        ? options.learnedWorkflows
        : LearningAgent.findRelevantWorkflows(text, 3);

    const result = await promptAgentRuntime.planActionIntent({
        text,
        recent,
        longTerm: relevantContext?.longTerm || '',
        learnedWorkflows,
        allowReply: options.allowReply !== false,
        mode: options.mode || 'general'
    });

    return result?.ok ? result : null;
}

ipcMain.handle('prompt-agent-run', async (event, payload = {}) => {
    const prompt = String(payload?.prompt || '').trim();
    const runId = String(payload?.runId || `run_${Date.now()}`).trim();
    ensurePromptRunChatWindow(runId);

    try {
        const result = await promptAgentRuntime.runPromptChat({
            prompt,
            runId,
            emit: (entry = {}) => {
                maybeAutoOpenChatWindowForPromptRun(runId, entry);
                event.sender.send('prompt-agent-progress', {
                    runId,
                    timestamp: Date.now(),
                    ...entry
                });
                pushPromptAgentProgressToChatWindow(entry, runId);
            }
        });
        finalizePromptRunChatWindow(runId);
        return result;
    } catch (error) {
        console.error('❌ [PromptAgent] Failed:', error);
        event.sender.send('prompt-agent-progress', {
            runId,
            timestamp: Date.now(),
            type: 'status',
            phase: 'error',
            visibility: 'public',
            message: 'Falló el runtime del prompt principal'
        });
        pushPromptAgentProgressToChatWindow({
            type: 'status',
            phase: 'error',
            visibility: 'public',
            message: 'Falló el runtime del prompt principal'
        }, runId);
        finalizePromptRunChatWindow(runId);
        return {
            success: false,
            runId,
            error: error?.message || 'No se pudo ejecutar el agente principal',
            assistantReply: ''
        };
    }
});

ipcMain.handle('time-manager-decide', async (event, payload = {}) => {
    const notification = payload?.notification || payload;
    const runId = String(payload?.runId || `tm_run_${Date.now()}`).trim();

    try {
        return await timeManagerRuntime.decideInterruption({
            ...payload,
            notification,
            runId,
            emit: (entry = {}) => {
                event.sender.send('time-manager-progress', {
                    runId,
                    timestamp: Date.now(),
                    ...entry
                });
            }
        });
    } catch (error) {
        console.error('❌ [TimeManager] Failed:', error);
        event.sender.send('time-manager-progress', {
            runId,
            timestamp: Date.now(),
            type: 'status',
            phase: 'error',
            visibility: 'public',
            message: 'Falló el runtime de Time Manager'
        });
        return {
            success: false,
            runId,
            error: error?.message || 'No se pudo ejecutar Time Manager',
            decision: null
        };
    }
});

ipcMain.handle('time-manager-get-state', async () => {
    return buildTimeManagerState();
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
    const result = knowledgeService.deleteNote(payload.tabId, payload);
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
const COMMAND_TAP_MAX_MS = 260;
const COMMAND_DOUBLE_PRESS_WINDOW_MS = 360;
const WINDOW_SWIPE_MIN_DELTA = 45;
const WINDOW_EDGE_MARGIN = 20;

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
const commandDoubleTapState = {
    isDown: false,
    startedAt: 0,
    eligibleTap: false,
    lastTapAt: 0
};

let activeScreenFlow = null;
let activeScreenFlowSeq = 0;

function toggleWindowModeFromDoubleCommand() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (currentWindowMode === WINDOW_MODES.BOOTLOADER) return;

    const targetMode = currentWindowMode === WINDOW_MODES.LARGE
        ? getPreferredCompactMode()
        : WINDOW_MODES.LARGE;

    applyWindowMode(targetMode);
}

function registerCommandTap(now = Date.now()) {
    if ((now - commandDoubleTapState.lastTapAt) <= COMMAND_DOUBLE_PRESS_WINDOW_MS) {
        commandDoubleTapState.lastTapAt = 0;
        toggleWindowModeFromDoubleCommand();
        return;
    }

    commandDoubleTapState.lastTapAt = now;
}

function classifyWindowSwipe(deltaX, deltaY) {
    const normalizedDeltaX = -deltaX;
    const normalizedDeltaY = -deltaY;
    const absX = Math.abs(normalizedDeltaX);
    const absY = Math.abs(normalizedDeltaY);

    if (absX < WINDOW_SWIPE_MIN_DELTA && absY < WINDOW_SWIPE_MIN_DELTA) {
        return null;
    }

    const diagonalIntent = absX >= WINDOW_SWIPE_MIN_DELTA
        && absY >= WINDOW_SWIPE_MIN_DELTA
        && (Math.min(absX, absY) / Math.max(absX, absY)) >= 0.55;

    if (diagonalIntent) {
        return {
            kind: 'diagonal',
            horizontal: normalizedDeltaX >= 0 ? 'right' : 'left',
            vertical: normalizedDeltaY >= 0 ? 'down' : 'up'
        };
    }

    if (absX >= absY) {
        return {
            kind: 'horizontal',
            horizontal: normalizedDeltaX >= 0 ? 'right' : 'left',
            vertical: null
        };
    }

    return {
        kind: 'vertical',
        horizontal: null,
        vertical: normalizedDeltaY >= 0 ? 'down' : 'up'
    };
}

function getSnapEdgesForBounds(bounds, area) {
    return {
        left: area.x + WINDOW_EDGE_MARGIN,
        right: area.x + area.width - bounds.width - WINDOW_EDGE_MARGIN,
        top: area.y + WINDOW_EDGE_MARGIN,
        bottom: area.y + area.height - bounds.height - WINDOW_EDGE_MARGIN
    };
}

function moveCompactWindowForSwipe(direction, bounds, area) {
    const edges = getSnapEdgesForBounds(bounds, area);
    let targetX = bounds.x;
    let targetY = bounds.y;

    if (direction.kind === 'diagonal') {
        targetX = direction.horizontal === 'right' ? edges.right : edges.left;
        targetY = direction.vertical === 'down' ? edges.bottom : edges.top;
    } else if (direction.kind === 'horizontal') {
        targetX = direction.horizontal === 'right' ? edges.right : edges.left;
    } else if (direction.kind === 'vertical') {
        targetY = direction.vertical === 'down' ? edges.bottom : edges.top;
    }

    return { x: targetX, y: targetY };
}

function moveLargeWindowForSwipe(direction, bounds, area) {
    const edges = getSnapEdgesForBounds(bounds, area);
    const currentCenterX = bounds.x + (bounds.width / 2);
    const areaCenterX = area.x + (area.width / 2);
    const isCurrentlyOnLeft = currentCenterX < areaCenterX;
    let targetX = isCurrentlyOnLeft ? edges.right : edges.left;
    let targetY = bounds.y;

    if (direction.kind === 'horizontal' || direction.kind === 'diagonal') {
        targetX = direction.horizontal === 'right' ? edges.right : edges.left;
    }

    if (direction.kind === 'diagonal') {
        targetY = direction.vertical === 'down' ? edges.bottom : edges.top;
    }

    return { x: targetX, y: targetY };
}

function moveWindowViaTrackpadSwipe(payload = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const deltaX = Number(payload.deltaX);
    const deltaY = Number(payload.deltaY);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    const direction = classifyWindowSwipe(deltaX, deltaY);
    if (!direction) return;

    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const nextPoint = currentWindowMode === WINDOW_MODES.LARGE
        ? moveLargeWindowForSwipe(direction, bounds, area)
        : moveCompactWindowForSwipe(direction, bounds, area);

    const clamped = clampBoundsToDisplay({
        ...bounds,
        x: nextPoint.x,
        y: nextPoint.y
    });

    if (!clamped) return;
    animateMainWindowTo(clamped.x, clamped.y);
}

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
    if (!transcript || !screenAgent) return;

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

    const actionIntent = await planUnifiedActionIntent(transcript, {
        recentLimit: 10,
        allowReply: false,
        mode: 'command_hold'
    });
    const plan = actionIntent?.kind === 'action' ? actionIntent.action : null;

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
                const now = Date.now();
                const modifiers = nativeAddon.getModifierFlags();
                const commandDown = (modifiers & COMMAND_MODIFIER_FLAG) !== 0;
                const optionDown = (modifiers & OPTION_MODIFIER_FLAG) !== 0;
                const commandHoldComboDown = commandDown && optionDown;
                const commandOnlyDown = commandDown && !optionDown;

                if (commandOnlyDown && !commandDoubleTapState.isDown) {
                    commandDoubleTapState.isDown = true;
                    commandDoubleTapState.startedAt = now;
                    commandDoubleTapState.eligibleTap = true;
                } else if (commandDoubleTapState.isDown && !commandOnlyDown) {
                    const tapDuration = now - commandDoubleTapState.startedAt;
                    const eligibleTap = commandDoubleTapState.eligibleTap
                        && tapDuration <= COMMAND_TAP_MAX_MS
                        && !commandHoldComboDown
                        && !commandHoldOverride.isPressed;
                    commandDoubleTapState.isDown = false;
                    commandDoubleTapState.startedAt = 0;
                    commandDoubleTapState.eligibleTap = false;

                    if (eligibleTap) {
                        registerCommandTap(now);
                    }
                }

                if (optionDown && commandDoubleTapState.isDown) {
                    commandDoubleTapState.eligibleTap = false;
                }

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

ipcMain.on('move-window-via-trackpad-swipe', (event, payload) => {
    moveWindowViaTrackpadSwipe(payload);
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

ipcMain.handle('toggle-chat-window', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
        closeChatWindowWithTransition();
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
    if (windowBoundsSaveTimer) {
        clearTimeout(windowBoundsSaveTimer);
        windowBoundsSaveTimer = null;
    }
    saveSettings();
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
const CHATGPT_CUSTOM_GPT_URL = String(process.env.IU_CHATGPT_CUSTOM_GPT_URL || process.env.CHATGPT_CUSTOM_GPT_URL || '').trim();
const CHATGPT_HOME_URL = CHATGPT_CUSTOM_GPT_URL || 'https://chatgpt.com/';

function isCustomGptModeEnabled() {
    return Boolean(CHATGPT_CUSTOM_GPT_URL);
}

function startChatGptVoiceUiMonitoring() {
    startVoiceStateMonitoring();
    startSmartConversationMonitoring();
    if (mainWindow) {
        mainWindow.webContents.send('system-ready');
    }
}

function isChromeInternalPage(url = '') {
    return !url || url === 'about:blank' || url.startsWith('chrome://new-tab-page') || url.startsWith('chrome://newtab');
}

async function setupChatGPT() {
    console.log('🤖 Setting up ChatGPT integration...');
    try {
        await ensureGptActionBridge();
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

        // Only inject prompt when we are using the generic ChatGPT homepage.
        // Custom GPT mode should keep its own instructions and actions.
        if (navigationReady) {
            if (isCustomGptModeEnabled()) {
                console.log('🧠 [ChatGPT] Custom GPT mode enabled. Skipping startup prompt injection.');
                startChatGptVoiceUiMonitoring();
            } else {
                await injectSystemPromptOnStartup();
            }
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
            startChatGptVoiceUiMonitoring();
        }
    } catch (e) {
        console.warn('⚠️ Could not inject System Prompt on startup:', e.message);
    }
}

async function ensureChatGPTVoiceBridge() {
    if (!chatPage || chatPage.isClosed()) {
        throw new Error('ChatGPT page unavailable for voice bridge');
    }

    const bridgeInstaller = () => {
        if (window.__iuVoiceBridgeBootstrapInstalled && window.__iuInstallVoiceBridge) return;
        window.__iuVoiceBridgeBootstrapInstalled = true;

        const installBridge = async () => {
            if (window.__iuVoiceBridge?.installed) return window.__iuVoiceBridge;
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('getUserMedia unavailable');
            }

            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            const bridge = {
                installed: true,
                waitEnabled: false,
                originalGetUserMedia,
                currentStream: null,
                mixedStream: null,
                audioContext: null,
                destination: null,
                micGain: null,
                syntheticGain: null,
                speechGain: null,
                carrierNodes: [],
                carrierInterval: null,
                micSourceNodes: []
            };

            function buildNoiseBuffer(ctx) {
                const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i += 1) {
                    data[i] = (Math.random() * 2 - 1) * 0.18;
                }
                return buffer;
            }

            async function ensureAudioGraph() {
                if (bridge.audioContext && bridge.audioContext.state !== 'closed') {
                    if (bridge.audioContext.state === 'suspended') {
                        try { await bridge.audioContext.resume(); } catch (_) {}
                    }
                    return;
                }

                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) throw new Error('AudioContext unavailable');

                const ctx = new AudioCtx();
                bridge.audioContext = ctx;
                bridge.destination = ctx.createMediaStreamDestination();
                bridge.micGain = ctx.createGain();
                bridge.syntheticGain = ctx.createGain();
                bridge.speechGain = ctx.createGain();
                bridge.micGain.gain.value = 1;
                bridge.syntheticGain.gain.value = 0;
                bridge.speechGain.gain.value = 0;

                const carrier = ctx.createOscillator();
                carrier.type = 'sawtooth';
                carrier.frequency.value = 180;
                const carrierGain = ctx.createGain();
                carrierGain.gain.value = 0.16;

                const harmonic = ctx.createOscillator();
                harmonic.type = 'square';
                harmonic.frequency.value = 260;
                const harmonicGain = ctx.createGain();
                harmonicGain.gain.value = 0.12;

                const noise = ctx.createBufferSource();
                noise.buffer = buildNoiseBuffer(ctx);
                noise.loop = true;
                const noiseFilter = ctx.createBiquadFilter();
                noiseFilter.type = 'bandpass';
                noiseFilter.frequency.value = 1700;
                noiseFilter.Q.value = 0.6;
                const noiseGain = ctx.createGain();
                noiseGain.gain.value = 0.09;

                carrier.connect(carrierGain).connect(bridge.speechGain);
                harmonic.connect(harmonicGain).connect(bridge.speechGain);
                noise.connect(noiseFilter).connect(noiseGain).connect(bridge.speechGain);
                bridge.speechGain.connect(bridge.syntheticGain).connect(bridge.destination);
                bridge.micGain.connect(bridge.destination);

                carrier.start();
                harmonic.start();
                noise.start();

                bridge.carrierNodes = [carrier, harmonic, noise];

                const syllables = [
                    { start: 0.00, end: 0.13, gain: 1.25 },
                    { start: 0.17, end: 0.30, gain: 1.0 },
                    { start: 0.34, end: 0.46, gain: 0.88 },
                    { start: 0.50, end: 0.70, gain: 1.18 }
                ];

                const pulsePhrase = () => {
                    if (!bridge.audioContext || bridge.audioContext.state === 'closed') return;
                    const now = bridge.audioContext.currentTime + 0.01;
                    const gate = bridge.speechGain.gain;
                    gate.cancelScheduledValues(now);
                    gate.setValueAtTime(0.0001, now);

                    for (const syllable of syllables) {
                        const start = now + syllable.start;
                        const peak = start + 0.018;
                        const end = now + syllable.end;
                        gate.linearRampToValueAtTime(syllable.gain, peak);
                        gate.exponentialRampToValueAtTime(0.001, end);
                    }
                };

                pulsePhrase();
                bridge.carrierInterval = window.setInterval(pulsePhrase, 720);
            }

            async function getMixedStream(constraints) {
                const stream = await originalGetUserMedia(constraints);
                if (!constraints || !constraints.audio) return stream;

                await ensureAudioGraph();

                bridge.currentStream = stream;
                const micSource = bridge.audioContext.createMediaStreamSource(stream);
                micSource.connect(bridge.micGain);
                bridge.micSourceNodes.push(micSource);

                const tracks = [
                    ...bridge.destination.stream.getAudioTracks(),
                    ...stream.getVideoTracks()
                ];
                bridge.mixedStream = new MediaStream(tracks);
                return bridge.mixedStream;
            }

            navigator.mediaDevices.getUserMedia = async (constraints = {}) => {
                const wantsAudio = typeof constraints === 'object' && constraints !== null && !!constraints.audio;
                if (!wantsAudio) {
                    return originalGetUserMedia(constraints);
                }
                return getMixedStream(constraints);
            };

            bridge.setWaitEnabled = async (enabled, mode = 'hold') => {
                bridge.waitEnabled = !!enabled;
                await ensureAudioGraph();
                const now = bridge.audioContext.currentTime + 0.01;
                const interruptMode = mode === 'interrupt';
                const target = bridge.waitEnabled
                    ? (interruptMode ? 1.05 : 0.16)
                    : 0.0001;
                bridge.syntheticGain.gain.cancelScheduledValues(now);
                bridge.syntheticGain.gain.setTargetAtTime(target, now, interruptMode ? 0.01 : 0.035);
                bridge.micGain.gain.cancelScheduledValues(now);
                bridge.micGain.gain.setTargetAtTime(interruptMode ? 1.35 : 1.0, now, 0.02);
                return { waitEnabled: bridge.waitEnabled, mode };
            };

            bridge.teardown = async () => {
                bridge.waitEnabled = false;

                if (bridge.carrierInterval) {
                    clearInterval(bridge.carrierInterval);
                    bridge.carrierInterval = null;
                }

                for (const node of bridge.carrierNodes) {
                    try {
                        if (typeof node.stop === 'function') node.stop();
                    } catch (_) {
                        // ignored
                    }
                    try {
                        node.disconnect();
                    } catch (_) {
                        // ignored
                    }
                }
                bridge.carrierNodes = [];

                for (const node of bridge.micSourceNodes) {
                    try {
                        node.disconnect();
                    } catch (_) {
                        // ignored
                    }
                }
                bridge.micSourceNodes = [];

                if (bridge.currentStream) {
                    try {
                        bridge.currentStream.getTracks().forEach((track) => track.stop());
                    } catch (_) {
                        // ignored
                    }
                    bridge.currentStream = null;
                }

                navigator.mediaDevices.getUserMedia = bridge.originalGetUserMedia;

                if (bridge.audioContext && bridge.audioContext.state !== 'closed') {
                    try {
                        await bridge.audioContext.close();
                    } catch (_) {
                        // ignored
                    }
                }

                bridge.audioContext = null;
                bridge.destination = null;
                bridge.micGain = null;
                bridge.syntheticGain = null;
                bridge.speechGain = null;
                bridge.mixedStream = null;
                delete window.__iuVoiceBridge;
                return { restored: true };
            };

            bridge.getState = () => ({
                installed: true,
                waitEnabled: !!bridge.waitEnabled,
                hasMixedStream: !!bridge.mixedStream
            });

            window.__iuVoiceBridge = bridge;
            return bridge;
        };

        window.__iuInstallVoiceBridge = installBridge;
    };

    await chatPage.addInitScript(bridgeInstaller);
    await chatPage.evaluate(bridgeInstaller);

    return chatPage.evaluate(async () => {
        if (!window.__iuInstallVoiceBridge) {
            throw new Error('Voice bridge bootstrap missing');
        }
        const bridge = await window.__iuInstallVoiceBridge();
        return bridge.getState ? bridge.getState() : { installed: true };
    });
}

async function setChatGPTSyntheticWaitEnabled(payload = {}) {
    if (!chatPage || chatPage.isClosed()) {
        return { success: false, error: 'ChatGPT page unavailable' };
    }

    try {
        await ensureChatGPTVoiceBridge();
        const enabled = !!payload.enabled;
        const mode = String(payload.mode || 'hold').trim().toLowerCase() === 'interrupt' ? 'interrupt' : 'hold';
        const result = await chatPage.evaluate(async ({ enabled, mode }) => {
            const bridge = window.__iuVoiceBridge || await window.__iuInstallVoiceBridge?.();
            if (!bridge?.setWaitEnabled) {
                throw new Error('Voice bridge not ready');
            }
            return bridge.setWaitEnabled(enabled, mode);
        }, { enabled, mode });
        return { success: true, state: result };
    } catch (error) {
        console.error('❌ [ChatGPT VoiceBridge] Failed to set synthetic wait:', error);
        return { success: false, error: error.message };
    }
}

async function disableChatGPTVoiceBridge() {
    if (!chatPage || chatPage.isClosed()) return { success: false, error: 'ChatGPT page unavailable' };
    try {
        const result = await chatPage.evaluate(async () => {
            const bridge = window.__iuVoiceBridge;
            if (!bridge?.teardown) return { restored: false, skipped: true };
            return bridge.teardown();
        });
        return { success: true, state: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function recoverChatPageIfNeeded() {
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
        throw new Error('ChatGPT not initialized or window closed');
    }
}

async function startChatGPTVoiceConversation(options = {}) {
    const { isSimpleMode, skipGreeting = false } = options;
    void isSimpleMode;

    await recoverChatPageIfNeeded();

    console.log('🔍 Starting voice conversation FIRST, then injecting prompt...');

    const selectors = [
        'button[data-testid="composer-speech-button"]',
        'button[aria-label="Start Voice"]',
        'button[aria-label="Iniciar voz"]',
        'button:has(use[href*="f8aa74"])'
    ];

    let startBtn = null;
    let attempts = 0;
    const maxAttempts = 10;

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
        await chatPage.waitForTimeout(500);
    }

    if (!startBtn) {
        console.warn('⚠️ "Start Voice" button NOT found.');
        return { success: false, error: 'Start button not found in current view' };
    }

    await startBtn.click();
    console.log('🖱️ Clicked "Start Voice" successfully');
    await chatPage.waitForTimeout(1500);

    if (!skipGreeting) {
        console.log('✍️ Sending greeting context...');
        const composer = chatPage.locator('#prompt-textarea');
        if (await composer.count() > 0) {
            const recentContext = contextManager.getRecentContextSummary(3);
            let greetingMsg = 'El usuario podría querer algo a continuación. Acabo de iniciar el chat de voz, saludalo!';

            if (recentContext) {
                greetingMsg = `[Contexto previo del chat de texto]:\n${recentContext}\n\nEl usuario acaba de activar el modo voz. Úsalos como contexto.`;
                console.log('🧠 [Voice] Injecting context:', recentContext.substring(0, 50) + '...');
            }

            await composer.fill(greetingMsg);
            await chatPage.waitForTimeout(300);
            const sendBtn = chatPage.locator('#composer-submit-button, button[data-testid="send-button"]');
            if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
                await sendBtn.click();
            } else {
                await chatPage.keyboard.press('Enter');
            }
            console.log('✅ Greeting context sent');
        }
    }

    startSmartConversationMonitoring();
    return { success: true, state: 'active' };
}

async function stopChatGPTVoiceConversation() {
    await recoverChatPageIfNeeded();
    console.log('🔍 Stopping voice conversation...');
    stopSmartConversationMonitoring();

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

async function forceInterruptChatGPTVoice() {
    await recoverChatPageIfNeeded();

    logTurnTakingUiux('force_interrupt_attempt');

    const interruptSelectors = [
        'button[aria-label*="Interrupt" i]',
        'button[aria-label*="Pause" i]',
        'button[aria-label*="Stop speaking" i]',
        'button[aria-label*="Detener" i]',
        'button[aria-label*="Pausar" i]',
        'button[aria-label*="Interrump" i]'
    ];

    for (const sel of interruptSelectors) {
        try {
            const locator = chatPage.locator(sel);
            if (await locator.count() > 0 && await locator.first().isVisible()) {
                await locator.first().click();
                logTurnTakingUiux('force_interrupt_selector_clicked', { selector: sel });
                return { success: true, mode: 'selector', selector: sel };
            }
        } catch (_) {
            // ignored
        }
    }

    try {
        await chatPage.keyboard.press('Escape');
        logTurnTakingUiux('force_interrupt_escape_sent');
        await chatPage.waitForTimeout(220);
    } catch (_) {
        // ignored
    }

    const bridgeDisabled = await disableChatGPTVoiceBridge();
    logTurnTakingUiux('force_interrupt_bridge_disabled', {
        success: !!bridgeDisabled.success,
        error: bridgeDisabled.error || ''
    });

    const stopResult = await stopChatGPTVoiceConversation();
    if (!stopResult.success) {
        return { success: false, error: stopResult.error || 'Could not stop voice for interruption' };
    }

    await chatPage.waitForTimeout(280);
    const startResult = await startChatGPTVoiceConversation({ skipGreeting: true });
    logTurnTakingUiux('force_interrupt_restart_result', { success: !!startResult.success });
    return startResult.success
        ? { success: true, mode: 'restart' }
        : { success: false, error: startResult.error || 'Could not restart voice after interruption' };
}

ipcMain.handle('conversation-control', async (event, action, options = {}) => {
    console.log(`🎤 IPC received: conversation-control -> ${action}`, options);
    const { isSimpleMode } = options;

    try {
        if (action === 'start') {
            return startChatGPTVoiceConversation({ isSimpleMode });
        } else if (action === 'stop') {
            return stopChatGPTVoiceConversation();
        }

    } catch (e) {
        console.error('❌ Conversation action failed:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('chatgpt-force-interrupt', async () => {
    try {
        const result = await forceInterruptChatGPTVoice();
        return result;
    } catch (error) {
        logTurnTakingUiux('force_interrupt_error', { error: error.message || 'unknown' });
        return { success: false, error: error.message };
    }
});

ipcMain.handle('chatgpt-set-synthetic-wait', async (event, payload = {}) => {
    const enabled = !!payload.enabled;
    const mode = String(payload.mode || 'hold').trim().toLowerCase() === 'interrupt' ? 'interrupt' : 'hold';
    logTurnTakingUiux('bridge_toggle_requested', { enabled, mode });
    const result = await setChatGPTSyntheticWaitEnabled({ enabled, mode });
    logTurnTakingUiux('bridge_toggle_result', {
        enabled,
        mode,
        success: !!result.success,
        error: result.error || ''
    });
    return result;
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
let lastVoiceActivityHint = {
    userDetectedByChatGPT: false,
    assistantStreaming: false
};

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
    lastVoiceActivityHint = {
        userDetectedByChatGPT: false,
        assistantStreaming: false
    };

    // --- Stability tracking (One observed turn per stable completion) ---
    // The assistant streams in chunks arriving BEFORE user text is available.
    // Strategy: poll fast for transcript streaming, count consecutive polls where assistant text
    // does NOT change. When stable for STABLE_POLLS_REQUIRED consecutive polls
    // AND we have new content → the response stream ended → publish the final text to UI/context.
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
                const normalizedUser = userText.toLowerCase();
                const normalizedAssistant = assistText.toLowerCase();

                // Note: ChatGPT uses Unicode ellipsis (…) in "Transcribing…"
                const userStable = userText.length > 0 && !userText.startsWith('Transcribing');
                const assistStable = assistText.length > 0 && !assistText.startsWith('Thinking');
                const userDetectedByChatGPT = normalizedUser.startsWith('transcribing');
                const assistantStreaming = normalizedAssistant.startsWith('thinking') || (!assistStable && assistText.length > 0);

                return {
                    user: { text: userText, isStable: userStable },
                    assistant: { text: assistText, isStable: assistStable },
                    isNewUser: userText !== lastUser,
                    isNewAssistant: assistText !== lastAssistant,
                    activityHint: {
                        userDetectedByChatGPT,
                        assistantStreaming
                    },
                    debug: { userCount: userNodes.length, assistCount: assistNodes.length }
                };
            }, { lastUser: lastLoggedUserContent, lastAssistant: lastLoggedAssistantContent });

            if (
                state.activityHint.userDetectedByChatGPT !== lastVoiceActivityHint.userDetectedByChatGPT ||
                state.activityHint.assistantStreaming !== lastVoiceActivityHint.assistantStreaming
            ) {
                lastVoiceActivityHint = { ...state.activityHint };
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice-activity-hint', lastVoiceActivityHint);
                }
            }

            // ── 1. USER TEXT: capture for UI & memory, but NO Brain call yet ──
            // We wait until the full turn is complete (assistant stable) before
            // calling the Brain, so we can send user + assistant together.
            if (state.isNewUser && state.user.isStable && state.user.text !== lastLoggedUserContent) {
                lastLoggedUserContent = state.user.text;
                console.log('🗣️ [User] Captured:', lastLoggedUserContent.substring(0, 50) + '...');

                // UI Feedback immediately
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

                    console.log('✅ [Turn Complete] Stream ended. Publishing final voice text.');
                    console.log('   👤 User   :', lastLoggedUserContent.substring(0, 60));
                    console.log('   🤖 Asst   :', cleanAsst.substring(0, 60));

                    // Memory: log final assistant text
                    contextManager.addMessage('assistant', state.assistant.text, 'voice_transcription');

                    // Final UI update for assistant (ensure last chunk is shown)
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

                    // In custom GPT voice mode, polling is display-only:
                    // actions and summaries must come through direct GPT function calls.
                    if (LearningAgent.isLearning) {
                        console.log('🎓 [Learning] Voice polling completed a turn during learning mode.');
                    } else if (lastLoggedUserContent) {
                        console.log('🧠 [VoicePolling] Observed complete turn. No backend action is executed from polling.');
                    }
                    isActionPending = false;
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
    lastVoiceActivityHint = {
        userDetectedByChatGPT: false,
        assistantStreaming: false
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice-activity-hint', lastVoiceActivityHint);
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

    if (!screenAgent) {
        return { success: false, error: 'Action system not initialized' };
    }

    try {
        const actionIntent = await planUnifiedActionIntent(userText, {
            recentLimit: 10,
            allowReply: false,
            mode: 'explicit_action'
        });
        const plan = actionIntent?.kind === 'action' ? actionIntent.action : null;

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
 * Handle text chat from phone for remote control.
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
        const actionIntent = await planUnifiedActionIntent(text, {
            recentLimit: 20,
            allowReply: true,
            mode: 'phone_remote'
        });
        const reply = String(actionIntent?.reply || '').trim();

        // Check for action
        if (actionIntent?.kind === 'action' && actionIntent.action?.type === 'screen_action') {
            const action = actionIntent.action;
            console.log(`📱 [PhoneBridge] Action from phone: ${action.goal}`);

            contextManager.addMessage('assistant', reply || null, 'phone_api');
            contextManager.addMessage('tool', `Acción iniciada: ${action.goal} en ${action.app}`, 'action_result', {
                name: 'execute_screen_action'
            });

            phoneBridgeSend({
                type: 'phone_reply',
                deviceId: phoneBridgeDeviceId,
                payload: {
                    reply: reply || `Entendido. Voy a ${action.goal.toLowerCase()}.`,
                    action: {
                        goal: action.goal,
                        app: action.app,
                        steps_hint: action.stepsHint
                    }
                }
            });

            phoneBridgeSend({
                type: 'face_state',
                deviceId: phoneBridgeDeviceId,
                payload: { state: 'executing' }
            });

            if (mainWindow) {
                mainWindow.webContents.send('action-confirm-request', {
                    goal: action.goal,
                    app: action.app,
                    stepsHint: action.stepsHint,
                    source: 'phone'
                });
            }

            syncContextToServer();
            return;
        }

        if (actionIntent?.kind === 'action' && actionIntent.action?.type === 'schedule') {
            const action = actionIntent.action;
            if (!brain) {
                throw new Error('Brain offline');
            }
            const date = new Date(Date.now() + (action.minutes * 60 * 1000));
            brain.scheduleTask(action.task, date);

            phoneBridgeSend({
                type: 'phone_reply',
                deviceId: phoneBridgeDeviceId,
                payload: {
                    reply: reply || `Listo. Programé el recordatorio para ${action.task}.`
                }
            });
            phoneBridgeSend({
                type: 'face_state',
                deviceId: phoneBridgeDeviceId,
                payload: { state: 'idle' }
            });

            contextManager.addMessage('assistant', reply || null, 'phone_api');
            contextManager.addMessage('tool', `Recordatorio programado: ${action.task}`, 'action_result', {
                name: 'schedule_reminder'
            });

            syncContextToServer();
            return;
        }

        if (actionIntent?.kind === 'action' && actionIntent.action?.type === 'play_agario') {
            if (!browserAgent) {
                throw new Error('BrowserAgent not initialized');
            }
            const action = actionIntent.action;
            browserAgent.launchAgarIO(action.nickname);

            phoneBridgeSend({
                type: 'phone_reply',
                deviceId: phoneBridgeDeviceId,
                payload: {
                    reply: reply || 'Listo. Dejé Agar.io preparado.'
                }
            });
            phoneBridgeSend({
                type: 'face_state',
                deviceId: phoneBridgeDeviceId,
                payload: { state: 'executing' }
            });

            contextManager.addMessage('assistant', reply || null, 'phone_api');
            contextManager.addMessage('tool', 'Agar.io preparado desde el telefono', 'action_result', {
                name: 'play_agario'
            });

            syncContextToServer();
            return;
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

        contextManager.addMessage('assistant', reply || null, 'phone_api');

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

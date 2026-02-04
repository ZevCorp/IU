/**
 * IÜ OS - Main Process
 * Always-on-top overlay window positioned on right edge
 */

const { app, BrowserWindow, screen, ipcMain, systemPreferences } = require('electron');
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

// Initialize OpenAI (handle missing API key gracefully)
let openai = null;
if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('✅ OpenAI initialized');
} else {
    console.log('⚠️ OPENAI_API_KEY not set. Voice features disabled.');
}

// Auto-updater for automatic updates from GitHub Releases
const { autoUpdater } = require('electron-updater');

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

// Sidebar width
const SIDEBAR_WIDTH = 300;

// System Prompt for personality and task formatting
const SYSTEM_PROMPT = `Seras U, el asistente capaz de controlar dispositivos, Iphone, Android, Ipad, y hasta tu computador, una IA integrada enfocada en minimizar el uso de tus dispositivos. Yo los uso para que tu puedas dedicarte a Vivir de verdad. Se libre de la tecnologia. Tu personalidad: Serio, eficaz, Poderoso, Colaborador, Atento.

SOLO RESPONDE 'Hola! que tal?'.`;


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

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
        width: SIDEBAR_WIDTH,
        height: height,
        x: width - SIDEBAR_WIDTH,
        y: 0,
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

    // Open DevTools in development
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    // Maintain position on screen resize
    screen.on('display-metrics-changed', () => {
        const { width: newWidth, height: newHeight } = screen.getPrimaryDisplay().workAreaSize;
        mainWindow.setBounds({
            x: newWidth - SIDEBAR_WIDTH,
            y: 0,
            width: SIDEBAR_WIDTH,
            height: newHeight
        });
    });

    console.log('✅ Window created');
}

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

// App lifecycle
app.whenReady().then(async () => {
    // Request camera access first
    await requestCameraAccess();

    createWindow();

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
    // Windows: AX Tree not supported
    if (process.platform !== 'darwin') {
        return { app: null, snapshot: [], error: 'AX not supported on Windows' };
    }

    // Check cache
    const now = Date.now();
    if (lastScreenContext && (now - lastContextTime) < CONTEXT_CACHE_MS) {
        console.log('📄 [Context] Using cached context');
        return lastScreenContext;
    }

    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'ax-reader.sh');
        exec(`"${scriptPath}"`, { timeout: 5000 }, (err, stdout, stderr) => {
            if (err) {
                console.error('❌ [Context] AX capture failed:', err.message);
                return resolve({ app: null, snapshot: [], error: err.message });
            }
            try {
                const result = JSON.parse(stdout);
                console.log(`📄 [Context] Captured ${result.snapshot?.length || 0} elements from ${result.app || 'unknown'}`);
                lastScreenContext = result;
                lastContextTime = now;
                resolve(result);
            } catch (e) {
                console.error('❌ [Context] Parse error:', e.message);
                resolve({ app: null, snapshot: [], error: e.message });
            }
        });
    });
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
        chatContext = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            viewport: null, // Allow window resizing to control viewport
            // userAgent: removed to allow system default (avoids Intel/ARM mismatch)
            permissions: ['microphone'], // Pre-grant microphone access
            args: [
                '--disable-blink-features=AutomationControlled', // Hide automation status
                '--start-maximized',
                '--no-default-browser-check'
            ],
            ignoreDefaultArgs: ['--enable-automation'] // Hide "Chrome is being controlled by automated test software" bar
        });

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

        // Wait for page to be ready, then inject system prompt
        await injectSystemPromptOnStartup();

    } catch (error) {
        console.error('❌ Failed to setup ChatGPT:', error);
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

            // Start voice state monitoring
            startVoiceStateMonitoring();

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
                    await composer.fill('El usuario podría querer algo a continuación. Acabo de iniciar el chat de voz, saludalo!');

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
                startTextMonitoring();

                return { success: true, state: 'active' };
            }

            console.warn('⚠️ "Start Voice" button NOT found.');
            return { success: false, error: 'Start button not found in current view' };

        } else if (action === 'stop') {
            console.log('🔍 Stopping voice conversation...');
            stopTextMonitoring();

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
        startUserVoiceMonitoring();

        // Also start regular text monitoring for assistant responses
        startTextMonitoring();

        return { success: true };

    } catch (e) {
        console.error('❌ [Thinking] Activation failed:', e);
        return { success: false, error: e.message };
    }
});

// Monitor user's voice transcription (for explicit intent suggestions)
function startUserVoiceMonitoring() {
    if (userVoiceMonitoringInterval) return;

    console.log('👂 [Explicit] Starting user voice monitoring...');
    lastUserText = '';

    userVoiceMonitoringInterval = setInterval(async () => {
        if (!chatPage || chatPage.isClosed()) return;

        try {
            // Extract the latest user message transcription
            const userText = await chatPage.evaluate(() => {
                const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
                if (userMessages.length === 0) return '';

                const lastMessage = userMessages[userMessages.length - 1];
                // Look for transcription in whitespace-pre-wrap div or general text
                const preWrap = lastMessage.querySelector('.whitespace-pre-wrap');
                if (preWrap) return preWrap.innerText;

                const markdown = lastMessage.querySelector('.markdown');
                return markdown ? markdown.innerText : lastMessage.innerText;
            });

            const cleanText = userText.trim();

            // If we found new user text, send to classifier for explicit suggestions
            if (cleanText && cleanText !== lastUserText && cleanText.length > 5) {
                lastUserText = cleanText;
                console.log('🗣️ [Explicit] User said:', cleanText.substring(0, 50) + '...');

                // Use classifier to generate explicit suggestions
                const predictions = await classifyExplicitIntent(cleanText);

                if (predictions && predictions.length > 0 && mainWindow) {
                    console.log('🎯 [Explicit] Sending predictions to renderer');
                    mainWindow.webContents.send('explicit-predictions', predictions);
                }
            }
        } catch (e) {
            // Silently fail polling
        }
    }, 500);
}

function stopUserVoiceMonitoring() {
    if (userVoiceMonitoringInterval) {
        clearInterval(userVoiceMonitoringInterval);
        userVoiceMonitoringInterval = null;
        lastUserText = '';
        console.log('🔇 [Explicit] Stopped user voice monitoring');
    }
}

// Classify explicit intent from user's spoken text
async function classifyExplicitIntent(userText) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
                {
                    role: "system",
                    content: `El usuario acaba de decir algo en voz alta. Analiza su intención explícita.
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
            response_format: { type: "json_object" }
        });

        return JSON.parse(response.choices[0].message.content).predictions;
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

                // 3. Transcribe with Whisper
                const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(tempFile),
                    model: "whisper-1",
                });
                transcript = transcription.text;
                console.log('🎤 [Transcription]:', transcript);

                // Cleanup
                fs.unlinkSync(tempFile);
            }
        }

        // 4. Reasoning with GPT-5 Mini Classifier
        const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
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
            response_format: { type: "json_object" }
        });

        const predictions = JSON.parse(response.choices[0].message.content).predictions;
        return { success: true, predictions };

    } catch (e) {
        console.error('❌ [Intent Prediction] Failed:', e);
        return { success: false, error: e.message };
    }
});


let textMonitoringInterval = null;
let lastExtractedText = '';
let memoryComparisonBuffer = '';
let isMemoryInjecting = false;

async function injectMemoryContext(match) {
    if (isMemoryInjecting) return;
    isMemoryInjecting = true;

    console.log('🧠 [Memory] RELEVANT MEMORY FOUND. Initiating Injection Cycle...');

    try {
        // 1. Notify UI (Face should turn green/thinking)
        if (mainWindow) {
            mainWindow.webContents.send('memory-status', 'searching');
        }

        // 2. PAUSE Voice (Click "End Voice")
        console.log('🧠 [Memory] Pausing voice...');
        const stopBtn = chatPage.locator('button[aria-label="End Voice"]');
        if (await stopBtn.count() > 0) {
            await stopBtn.first().click();
        } else {
            await chatPage.keyboard.press('Escape');
        }

        // Wait for Voice UI to close
        await chatPage.waitForTimeout(1000);

        // 3. INJECT Context (Type text)
        const contextMsg = `[Contexto de memoria recuperada]: "${match.text}". Por favor, usa esta información para responder a lo que el usuario acaba de mencionar.`;
        console.log('🧠 [Memory] Injecting context into chat...');

        // Wait for composer to be visible
        const composer = chatPage.locator('#prompt-textarea');
        await composer.fill(contextMsg);

        // Use send button click instead of Enter
        await chatPage.waitForTimeout(300);
        const sendBtn = chatPage.locator('#composer-submit-button, button[data-testid="send-button"]');
        if (await sendBtn.count() > 0 && await sendBtn.isEnabled()) {
            await sendBtn.click();
        } else {
            await chatPage.keyboard.press('Enter');
        }

        // Wait for message to be sent
        await chatPage.waitForTimeout(2000);

        // 4. RESUME Voice
        console.log('🧠 [Memory] Resuming voice conversation...');
        const startBtn = chatPage.locator('button[data-testid="composer-speech-button"], button[aria-label="Start Voice"], button[aria-label="Iniciar voz"]').first();
        if (await startBtn.count() > 0) {
            await startBtn.click();
        }

        if (mainWindow) {
            mainWindow.webContents.send('memory-status', 'injected');
        }

    } catch (e) {
        console.error('❌ [Memory] Injection failed:', e);
    } finally {
        isMemoryInjecting = false;
    }
}

function startTextMonitoring() {
    if (textMonitoringInterval) return;

    console.log('👂 Starting transcription monitoring...');
    textMonitoringInterval = setInterval(async () => {
        if (!chatPage || chatPage.isClosed()) return;

        try {
            // Extract the latest assistant paragraph
            const assistantText = await chatPage.evaluate(() => {
                const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
                if (assistantMessages.length === 0) return '';

                const lastMessage = assistantMessages[assistantMessages.length - 1];
                // ChatGPT Voice Mode uses <p> with data-start attributes for transcription
                const paragraphs = lastMessage.querySelectorAll('p[data-start]');
                if (paragraphs.length > 0) {
                    return paragraphs[paragraphs.length - 1].innerText;
                }

                // Fallback to general markdown text
                const markdown = lastMessage.querySelector('.markdown');
                return markdown ? markdown.innerText : '';
            });

            const cleanText = assistantText.trim();
            if (cleanText && cleanText !== lastExtractedText) {
                lastExtractedText = cleanText;

                if (mainWindow) {
                    mainWindow.webContents.send('conversation-text', cleanText);
                }

                // Task Extraction (Regex for JSON blocks)
                const jsonMatch = cleanText.match(/```json\n([\s\S]*?)\n```/);
                if (jsonMatch && jsonMatch[1]) {
                    try {
                        const taskData = JSON.parse(jsonMatch[1]);
                        if (taskData && taskData.tasks && mainWindow) {
                            console.log('📋 [Tasks] Found new task list in transcription');
                            mainWindow.webContents.send('task-update', taskData.tasks);
                        }
                    } catch (e) { }
                }

                /* 
                // RAG Memory Analysis (Temporarily disabled - relying on ChatGPT default memory)
                if (!isMemoryInjecting && cleanText.length > 20) {
                    const matches = await memoryService.searchMemory(cleanText, 1);
                    if (matches && matches.length > 0 && matches[0].score > 0.85) { // Threshold for relevance
                        await injectMemoryContext(matches[0]);
                    } else {
                        // Heuristic: Save long enough responses as new knowledge
                        if (cleanText.length > 100) {
                            await memoryService.saveMemory(cleanText, { role: 'assistant', source: 'chatgpt' });
                        }
                    }
                }
                */
            }
        } catch (e) {
            // Silently fail polling
        }
    }, 400); // Poll every 400ms for responsiveness
}

function stopTextMonitoring() {
    if (textMonitoringInterval) {
        clearInterval(textMonitoringInterval);
        textMonitoringInterval = null;
        console.log('🔇 Stopped transcription monitoring.');
    }
}


// Add setupChatGPT to initialization
app.whenReady().then(() => {
    // ... existing init ...
    setupChatGPT();
});


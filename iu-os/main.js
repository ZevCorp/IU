/**
 * IÜ OS - Main Process
 * Always-on-top overlay window positioned on right edge
 */

const { app, BrowserWindow, screen, ipcMain, systemPreferences } = require('electron');
const path = require('path');
// const memoryService = require('./MemoryService'); // Temporarily disabled RAG memory system

let mainWindow = null;

// Sidebar width
const SIDEBAR_WIDTH = 300;

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
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
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

    } catch (error) {
        console.error('❌ Failed to setup ChatGPT:', error);
    }
}

ipcMain.handle('conversation-control', async (event, action) => {
    console.log(`🎤 IPC received: conversation-control -> ${action}`);

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
            console.log('🔍 Searching for "Start Voice" button...');

            // Exact selectors provided by the user
            const selectors = [
                'button[aria-label="Start Voice"]',
                'button[data-testid="composer-speech-button"]',
                'button:has-text("Use Voice")'
            ];

            let startBtn = null;
            for (const sel of selectors) {
                try {
                    const locator = chatPage.locator(sel);
                    if (await locator.count() > 0) {
                        console.log(`✅ Found button with selector: ${sel}`);
                        startBtn = locator.first();
                        break;
                    }
                } catch (e) {
                    console.log(`Selector ${sel} failed or not found.`);
                }
            }

            if (startBtn) {
                await startBtn.click();
                console.log('🖱️ Clicked "Start Voice" successfully');

                // Start monitoring for transcription text
                startTextMonitoring();

                return { success: true, state: 'active' };
            }

            console.warn('⚠️ "Start Voice" button NOT found.');
            return { success: false, error: 'Start button not found in current view' };

        } else if (action === 'stop') {
            console.log('🔍 Stopping voice conversation...');
            stopTextMonitoring();

            const stopBtn = chatPage.locator('button[aria-label="End Voice"]');
            if (await stopBtn.count() > 0) {
                await stopBtn.first().click();
            } else {
                await chatPage.keyboard.press('Escape');
            }
            return { success: true, state: 'idle' };
        }

    } catch (e) {
        console.error('❌ Conversation action failed:', e);
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
        await chatPage.keyboard.press('Enter');

        // Wait for message to be sent
        await chatPage.waitForTimeout(2000);

        // 4. RESUME Voice
        console.log('🧠 [Memory] Resuming voice conversation...');
        const startBtn = chatPage.locator('button[aria-label="Start Voice"], button[data-testid="composer-speech-button"]').first();
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


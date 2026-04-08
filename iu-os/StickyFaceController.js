const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class StickyFaceController {
    constructor() {
        this.window = null;
        this.followInterval = null;
        this.currentExpression = 'idle';
        this.isTracking = false;
        this.offset = { x: 30, y: 30 }; // Distance from cursor
        this.commandAttentionInterval = null;
    }

    runInWindow(script, label = 'script') {
        if (!this.window || this.window.isDestroyed()) {
            return Promise.resolve(false);
        }
        return this.window.webContents.executeJavaScript(script).then(() => true).catch((error) => {
            console.warn(`⚠️ [StickyFace] ${label} failed:`, error?.message || error);
            return false;
        });
    }

    start() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.show();
            this.startTracking();
            return;
        }

        this.createWindow();
    }

    stop() {
        this.stopTracking();
        if (this.window && !this.window.isDestroyed()) {
            this.window.hide();
        }
    }

    createWindow() {
        const { getCursorScreenPoint } = screen;
        const cursor = getCursorScreenPoint();

        this.window = new BrowserWindow({
            width: 350, // Increased to fit text
            height: 110,
            x: cursor.x + this.offset.x,
            y: cursor.y + this.offset.y,
            frame: false,
            transparent: true,
            hasShadow: false,
            alwaysOnTop: true,
            resizable: false,
            movable: false,
            focusable: false,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                backgroundThrottling: false
            }
        });

        // Make it ignore mouse events
        this.window.setIgnoreMouseEvents(true);

        if (process.platform === 'darwin') {
            this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            this.window.setAlwaysOnTop(true, 'screen-saver', 2);
        }

        // Load the MAIN application file to ensure exact same component/behavior
        this.window.loadURL(`file://${path.join(__dirname, 'renderer/index.html')}?mode=sticky`);

        this.window.once('ready-to-show', () => {
            // FORCE CSS OVERRIDE for Sticky Mode
            this.window.webContents.insertCSS(`
                body, #app {
                     background: transparent !important;
                     overflow: hidden !important;
                }
                #face-container {
                    background-color: rgba(0, 0, 0, 0.5) !important;
                    backdrop-filter: blur(20px) !important;
                    -webkit-backdrop-filter: blur(20px) !important;
                    border-radius: 50% !important;
                    width: 100px !important;
                    height: 100px !important;
                    position: absolute !important;
                    left: 5px !important;
                    top: 5px !important;
                }
                #floating-message {
                    position: absolute;
                    left: 115px;
                    top: 14px;
                    background: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(15px);
                    color: white;
                    padding: 10px 12px;
                    border-radius: 12px;
                    font-family: 'Outfit', sans-serif;
                    font-size: 13px;
                    width: 220px;
                    opacity: 0;
                    transform: translateX(-10px);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    pointer-events: none;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                    overflow: hidden;
                }
                #floating-message.visible {
                    opacity: 1;
                    transform: translateX(0);
                }
                #floating-message .sticky-title {
                    font-size: 11px;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    opacity: 0.75;
                    margin-bottom: 4px;
                    white-space: nowrap;
                }
                #floating-message .sticky-body {
                    line-height: 1.3;
                    max-height: 3.9em;
                    overflow: hidden;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    word-break: break-word;
                }
                #btn-chat-toggle, #btn-voice-icon, #btn-transfer-top,
                .transfer-btn-top, #menu-toggle, .menu-toggle,
                #controls-panel, #nav-hud, #intent-carousel,
                #transcript-container, #checklist-container, #neural-canvas,
                #prompt-chat-dock, #prompt-chat-voice-floating-btn,
                #compact-popup, #loading-overlay, #turn-taking-debug,
                #action-confirmation, #bootloader-overlay, #inception-onboarding-card {
                    display: none !important;
                }
            `).catch((error) => {
                console.warn('⚠️ [StickyFace] insertCSS failed:', error?.message || error);
            });

            // Inject message element and controller
            void this.runInWindow(`
                const msg = document.createElement('div');
                msg.id = 'floating-message';
                document.body.appendChild(msg);
                
                const MAX_STICKY_CHARS = 220;
                const escapeHtml = (value) => String(value || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                const truncate = (value) => {
                    const txt = String(value || '').replace(/\\s+/g, ' ').trim();
                    if (txt.length <= MAX_STICKY_CHARS) return txt;
                    return txt.slice(0, MAX_STICKY_CHARS - 1).trimEnd() + '…';
                };
                window.showStickyMessage = (payload) => {
                    let title = '';
                    let body = '';
                    if (payload && typeof payload === 'object') {
                        title = payload.title || '';
                        body = payload.body || '';
                    } else {
                        const text = String(payload || '');
                        const lines = text.split('\\n').map(v => v.trim()).filter(Boolean);
                        title = lines.length > 1 ? lines[0] : '';
                        body = lines.length > 1 ? lines.slice(1).join(' ') : text;
                    }
                    body = truncate(body);
                    msg.innerHTML = \`
                        \${title ? '<div class="sticky-title">' + escapeHtml(title) + '</div>' : ''}
                        <div class="sticky-body">\${escapeHtml(body)}</div>
                    \`;
                    msg.classList.add('visible');
                };
                window.hideStickyMessage = () => {
                    msg.classList.remove('visible');
                };
                if (window.face && window.face.setEyeColor) {
                    window.face.setEyeColor('#ffffff');
                }
            `, 'bootstrap sticky ui');

            this.window.show();
            this.startTracking();
        });
    }

    startTracking() {
        if (this.isTracking) return;
        this.isTracking = true;

        // High frequency update for smooth movement
        this.followInterval = setInterval(() => {
            if (!this.window || this.window.isDestroyed()) {
                this.stopTracking();
                return;
            }

            try {
                const { getCursorScreenPoint } = screen;
                const cursor = getCursorScreenPoint();

                // Calculate target position
                const targetX = cursor.x + this.offset.x;
                const targetY = cursor.y + this.offset.y;

                // Update window position directly
                // Using setBounds is usually fast enough for this size
                this.window.setPosition(targetX, targetY);

            } catch (e) {
                console.error('Error tracking cursor:', e);
            }
        }, 16); // ~60fps
    }

    stopTracking() {
        this.isTracking = false;
        if (this.followInterval) {
            clearInterval(this.followInterval);
            this.followInterval = null;
        }
    }

    setExpression(expression) {
        this.currentExpression = expression;
        void this.runInWindow(`if (window.setExpression) window.setExpression(${JSON.stringify(String(expression || 'idle'))})`, 'setExpression');
    }

    setFaceColor(color) {
        void this.runInWindow(`
            if (window.face && window.face.setEyeColor) {
                window.face.setEyeColor(${JSON.stringify(String(color || '#ffffff'))});
            }
        `, 'setFaceColor');
    }

    showMessage(text, duration = 3000) {
        if (this.window && !this.window.isDestroyed()) {
            const payload = (typeof text === 'object' && text !== null)
                ? text
                : { body: String(text || '') };
            const safePayload = JSON.stringify(payload);
            void this.runInWindow(`if (window.showStickyMessage) window.showStickyMessage(${safePayload})`, 'showMessage');
            if (this.messageTimeout) clearTimeout(this.messageTimeout);
            if (duration > 0) {
                this.messageTimeout = setTimeout(() => {
                    if (this.window && !this.window.isDestroyed()) {
                        void this.runInWindow(`if (window.hideStickyMessage) window.hideStickyMessage()`, 'hideMessage');
                    }
                }, duration);
            }
        }
    }

    startCommandAttention() {
        this.stopCommandAttention();
        this.setExpression('mild_attention');
        let tick = 0;
        this.commandAttentionInterval = setInterval(() => {
            if (!this.window || this.window.isDestroyed()) return;
            tick++;
            const useThinking = tick % 2 === 0;
            const preset = useThinking ? 'thinking' : 'mild_attention';
            void this.runInWindow(`
                if (window.setExpression) window.setExpression('${preset}');
                if (window.face && window.face.lookAt) {
                    window.face.lookAt(${useThinking ? 0.42 : 0.58}, 0.50);
                }
            `, 'commandAttentionTick');
        }, 520);
    }

    stopCommandAttention() {
        if (this.commandAttentionInterval) {
            clearInterval(this.commandAttentionInterval);
            this.commandAttentionInterval = null;
        }
    }
}

module.exports = new StickyFaceController();

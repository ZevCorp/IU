const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class StickyFaceController {
    constructor() {
        this.window = null;
        this.followInterval = null;
        this.currentExpression = 'idle';
        this.isTracking = false;
        this.offset = { x: 30, y: 30 }; // Distance from cursor
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
                    top: 25px;
                    background: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(15px);
                    color: white;
                    padding: 8px 14px;
                    border-radius: 12px;
                    font-family: 'Outfit', sans-serif;
                    font-size: 14px;
                    width: 200px;
                    opacity: 0;
                    transform: translateX(-10px);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    pointer-events: none;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                }
                #floating-message.visible {
                    opacity: 1;
                    transform: translateX(0);
                }
                #btn-chat-toggle, #btn-voice-icon, #btn-transfer-top,
                .transfer-btn-top, #menu-toggle, .menu-toggle,
                #controls-panel, #nav-hud, #intent-carousel,
                #transcript-container, #checklist-container, #neural-canvas {
                    display: none !important;
                }
            `);

            // Inject message element and controller
            this.window.webContents.executeJavaScript(`
                const msg = document.createElement('div');
                msg.id = 'floating-message';
                document.body.appendChild(msg);
                
                window.showStickyMessage = (text) => {
                    msg.textContent = text;
                    msg.classList.add('visible');
                };
                window.hideStickyMessage = () => {
                    msg.classList.remove('visible');
                };
                if (window.uFace) window.uFace.setEyeColor('#ffffff');
            `);

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
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.executeJavaScript(`if (window.setExpression) window.setExpression('${expression}')`);
        }
    }

    setFaceColor(color) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.executeJavaScript(`if (window.face) face.setEyeColor('${color}')`);
        }
    }

    showMessage(text, duration = 3000) {
        if (this.window && !this.window.isDestroyed()) {
            const safeText = JSON.stringify(String(text || ''));
            this.window.webContents.executeJavaScript(`window.showStickyMessage(${safeText})`);
            if (this.messageTimeout) clearTimeout(this.messageTimeout);
            this.messageTimeout = setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) {
                    this.window.webContents.executeJavaScript(`window.hideStickyMessage()`);
                }
            }, duration);
        }
    }
}

module.exports = new StickyFaceController();

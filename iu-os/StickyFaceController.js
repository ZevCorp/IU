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
            width: 110, // Increased size for more visual space
            height: 110,
            x: cursor.x + this.offset.x,
            y: cursor.y + this.offset.y,
            frame: false,
            transparent: true, // Required for circular shape
            // backgroundColor: '#000000', // Removed: handled by CSS
            hasShadow: false,
            alwaysOnTop: true,
            resizable: false,
            movable: false, // Moved programmatically
            focusable: false, // Don't steal focus
            skipTaskbar: true,
            // vibrancy: 'hud' REMOVED to avoid transparency issues
            // visualEffectState: 'active',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                backgroundThrottling: false // Keep animating in background
            }
        });

        // Make it ignore mouse events so clicks pass through
        this.window.setIgnoreMouseEvents(true);

        // macOS: Ensure it stays on top of everything including full screen apps
        if (process.platform === 'darwin') {
            this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            this.window.setAlwaysOnTop(true, 'screen-saver', 2);
        }

        // Load the MAIN application file to ensure exact same component/behavior
        this.window.loadURL(`file://${path.join(__dirname, 'renderer/index.html')}?mode=sticky`);

        this.window.once('ready-to-show', () => {
            // FORCE CSS OVERRIDE for Sticky Mode Background
            this.window.webContents.insertCSS(`
                body, #app {
                     background-color: rgba(0, 0, 0, 0.35) !important;
                     backdrop-filter: blur(20px) !important;
                     -webkit-backdrop-filter: blur(20px) !important;
                     border-radius: 20px !important;
                }
            `);
            // Inject styles for the specific look requested:
            // "rostro vectorial en blanco, el blur un poco opaco, medio oscuro"
            // We use the query param to trigger CSS/JS changes in value, but we can also inject specific overrides here if needed.

            // Set face color to WHITE because background is black
            this.window.webContents.executeJavaScript(`
                 if (window.uFace) {
                     window.uFace.setEyeColor('#ffffff');
                 }
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
            this.window.webContents.executeJavaScript(`window.setExpression('${expression}')`);
        }
    }
}

module.exports = new StickyFaceController();

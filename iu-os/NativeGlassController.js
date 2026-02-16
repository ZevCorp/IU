
const { spawn } = require('child_process');
const path = require('path');
const { app } = require('electron');

class NativeGlassController {
    constructor() {
        this.process = null;
        this.isVisible = false;

        if (app.isPackaged) {
            // In Production: resources/dist/GlassWindowApp
            // process.resourcesPath points to Contents/Resources
            this.binaryPath = path.join(process.resourcesPath, 'dist', 'GlassWindowApp');
        } else {
            // In Development: ./dist/GlassWindowApp
            this.binaryPath = path.join(__dirname, 'dist', 'GlassWindowApp');
        }
    }

    start() {
        if (this.process) return;

        console.log(`🔮 Launching Native Glass Window: ${this.binaryPath}`);

        try {
            this.process = spawn(this.binaryPath, [], {
                stdio: ['pipe', 'inherit', 'inherit'] // pipe stdin, inherit stdout/stderr for debug
            });

            this.process.on('error', (err) => {
                console.error('🔮 Native Glass Process Error:', err);
                this.process = null;
            });

            this.process.on('exit', (code, signal) => {
                console.log(`🔮 Native Glass Process Exited (code=${code}, signal=${signal})`);
                this.process = null;
            });

            // Keep it ready but hidden
            this.hide();

        } catch (e) {
            console.error('🔮 Failed to spawn Native Glass Window:', e);
        }
    }

    stop() {
        if (this.process) {
            this.sendCommand({ command: 'quit' });
            // Give it time to quit gracefully?
            setTimeout(() => {
                if (this.process) this.process.kill();
            }, 500);
        }
    }

    isActive() {
        return !!this.process;
    }

    sendCommand(cmd) {
        if (!this.process) {
            this.start();
        }

        if (this.process && this.process.stdin && !this.process.killed) {
            try {
                const json = JSON.stringify(cmd) + '\n';
                this.process.stdin.write(json);
            } catch (e) {
                console.error('🔮 Failed to send command:', e);
            }
        }
    }

    show() {
        this.sendCommand({ command: 'show' });
        this.isVisible = true;
    }

    hide() {
        this.sendCommand({ command: 'hide' });
        this.isVisible = false;
    }

    setExpression(state) {
        this.sendCommand({ command: 'expression', state });
    }

    lookAt(x, y) {
        this.sendCommand({ command: 'gaze', x, y });
    }
}

module.exports = new NativeGlassController();

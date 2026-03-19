const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

class WindowsCompanionClient {
    constructor(options = {}) {
        this.requestTimeoutMs = options.requestTimeoutMs || 10000;
        this.requestId = 1;
    }

    _resolveHostScriptPath() {
        const candidates = [
            path.join(__dirname, 'windows', 'windows-companion.ps1'),
            path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'windows', 'windows-companion.ps1'),
            path.join(process.resourcesPath || '', 'windows', 'windows-companion.ps1'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'windows', 'windows-companion.ps1')
        ];

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    async start() {
        if (process.platform !== 'win32') return false;
        await this._sendRequest('ping', {}, 5000);
        return true;
    }

    async _sendRequest(method, params = {}, timeoutMs = this.requestTimeoutMs) {
        const scriptPath = this._resolveHostScriptPath();
        if (!scriptPath) {
            throw new Error('Windows companion script not found');
        }

        const payload = {
            id: this.requestId++,
            method,
            params
        };

        const args = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-RequestJson',
            JSON.stringify(payload)
        ];

        const output = await new Promise((resolve, reject) => {
            execFile('powershell.exe', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
                const errText = String(stderr || '').trim();
                if (errText) {
                    console.warn(`[WindowsCompanion][stderr] ${errText}`);
                }

                if (err) {
                    reject(new Error(`Windows companion request failed (${method}): ${err.message}`));
                    return;
                }

                resolve(String(stdout || '').trim());
            });
        });

        if (!output) {
            throw new Error(`Windows companion empty response (${method})`);
        }

        let response;
        try {
            response = JSON.parse(output);
        } catch (e) {
            throw new Error(`Windows companion invalid JSON (${method}): ${output.slice(0, 500)}`);
        }

        if (!response.ok) {
            throw new Error(response.error || `Windows companion error (${method})`);
        }

        return response.result;
    }

    async extract(appName = null) {
        return this._sendRequest('extract', { appName }, 12000);
    }

    async openApp(appName) {
        return this._sendRequest('openApp', { appName }, 10000);
    }

    async focusApp(appName) {
        return this._sendRequest('focusApp', { appName }, 10000);
    }

    async performAction(payload) {
        return this._sendRequest('performAction', payload || {}, 12000);
    }

    async stop() {
        return true;
    }
}

module.exports = WindowsCompanionClient;

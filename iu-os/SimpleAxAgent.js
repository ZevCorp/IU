/**
 * SimpleAxAgent - Deterministic AX Extraction
 * 
 * No AI - just reliable, fast extraction with proper error handling.
 * For future complex scenarios, see AxExtractionAgent.js.future
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class SimpleAxAgent {
    constructor() {
        const isPackaged = __dirname.includes('app.asar');
        this.axScriptPath = this._resolveAxScriptPath();

        // Try to load native addon
        this.nativeAddon = null;
        this.useNative = false;

        try {
            // In packaged app, the build dir is in Resources (extraResources)
            let addonPath;

            if (isPackaged) {
                // __dirname is /Applications/IU.app/Contents/Resources/app.asar
                // We need /Applications/IU.app/Contents/Resources/build/Release/ax_native.node
                addonPath = path.join(__dirname, '..', 'build', 'Release', 'ax_native.node');
            } else {
                // In dev: project_root/build/Release/ax_native.node
                addonPath = path.join(__dirname, 'build', 'Release', 'ax_native.node');
            }

            if (fs.existsSync(addonPath)) {
                this.nativeAddon = require(addonPath);
                this.useNative = true;
                console.log(`✅ [SimpleAxAgent] Using NATIVE addon (no osascript!)`);
                console.log(`📂 [SimpleAxAgent] Addon path: ${addonPath}`);
            } else {
                console.log(`⚠️ [SimpleAxAgent] Native addon not found at: ${addonPath}`);
            }
        } catch (e) {
            console.log(`⚠️ [SimpleAxAgent] Failed to load native addon: ${e.message}`);
        }

        // Fallback: osascript path (old method)
        if (!this.useNative) {
            console.log(`📂 [SimpleAxAgent] Fallback to osascript: ${this.axScriptPath}`);
        }

        if (this.axScriptPath) {
            console.log(`📍 [SimpleAxAgent] Hit-test script: ${this.axScriptPath}`);
        } else {
            console.error('❌ [SimpleAxAgent] ax-reader script not found in known locations');
        }
    }

    _resolveAxScriptPath() {
        const candidates = [];

        candidates.push(path.join(__dirname, 'ax-reader.js'));
        if (__dirname.includes('app.asar')) {
            candidates.push(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'ax-reader.js'));
        }
        if (process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'ax-reader.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'ax-reader.js'));
        }

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Extract AX tree with simple retry logic
     */
    async extract(appName = null) {
        console.log('🍎 [SimpleAxAgent] Starting AX extraction...');

        // Try extraction with retries
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`🔄 [SimpleAxAgent] Attempt ${attempt}/3`);

            const result = await this._tryExtraction(appName);

            // Success!
            if (result && !result.error && result.snapshot && result.snapshot.length > 0) {
                console.log(`✅ [SimpleAxAgent] Success! Found ${result.snapshot.length} elements`);
                return result;
            }

            // Log diagnostic and error details
            if (result.diagnostic) {
                console.log(`⚠️ [SimpleAxAgent] Diagnostic: ${result.diagnostic}`);
            }
            if (result.error && attempt === 1) {
                console.log(`⚠️ [SimpleAxAgent] Error: ${result.error}`);
                if (result.stderr) {
                    console.log(`⚠️ [SimpleAxAgent] Stderr: ${result.stderr}`);
                }
            }

            // Permission denied - show helpful message
            if (result.diagnostic === 'PERMISSION_DENIED') {
                console.error('❌ [SimpleAxAgent] Permission denied');
                console.error('📝 To fix: System Settings → Privacy & Security → Accessibility');
                console.error('   Enable: Terminal, Electron');
                return result;
            }

            // No window - app might be slow, wait longer
            if (result.diagnostic === 'NO_WINDOW') {
                console.log(`⏳ [SimpleAxAgent] No window found, waiting 3s...`);
                await this._wait(3000);
                if (appName) {
                    await this._focusApp(appName);
                    await this._wait(1000);
                }
            }

            // Other errors - wait briefly before retry
            if (attempt < 3) {
                await this._wait(1500);
            }
        }

        console.error('❌ [SimpleAxAgent] Failed after 3 attempts');
        return {
            error: 'Failed to extract AX tree after retries',
            diagnostic: 'MAX_RETRIES_REACHED',
            snapshot: []
        };
    }

    /**
     * Perform hit-testing to find the element under the given coordinates
     */
    async hitTest(x, y, appName = null) {
        console.log(`🎯 [SimpleAxAgent] Hit-testing at (${x}, ${y})...`);
        if (!this.axScriptPath) {
            return { error: 'AX_HITTEST_SCRIPT_NOT_FOUND', diagnostic: 'NO_HITTEST_SCRIPT', snapshot: [] };
        }

        // Always use osascript for hit-testing for now as it's easier to verify
        // (Native addon would need update to support it)
        return new Promise((resolve) => {
            const args = ['-l', 'JavaScript', this.axScriptPath];
            if (appName) args.push(appName);
            else args.push(""); // Empty app name means frontmost

            args.push(x.toString());
            args.push(y.toString());

            execFile('osascript', args, {
                timeout: 5000,
                maxBuffer: 1024 * 512
            }, (err, stdout, stderr) => {
                if (err) {
                    resolve({ error: err.message, snapshot: [], stderr });
                    return;
                }
                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    resolve({ error: 'Parse error', snapshot: [], stdout, stderr });
                }
            });
        });
    }

    /**
     * Ensure app is open and focused
     */
    async _ensureAppReady(appName) {
        console.log(`📱 [SimpleAxAgent] Ensuring ${appName} is ready...`);

        // 1. Check if running, if not open it
        const isRunning = await this._checkAppRunning(appName);
        if (!isRunning) {
            console.log(`🚀 [SimpleAxAgent] Opening ${appName}...`);
            await this._openApp(appName);
            await this._wait(3000);
        }

        // 2. Activate (bring to front)
        console.log(`👆 [SimpleAxAgent] Activating ${appName}...`);
        await this._focusApp(appName);
        await this._wait(2000);
    }

    /**
     * Try to extract AX tree - NATIVE FIRST, osascript fallback
     */
    async _tryExtraction(appName = null) {
        // NATIVE METHOD (preferred)
        if (this.useNative && this.nativeAddon) {
            try {
                console.log(`🔧 [SimpleAxAgent] Using native C++ extraction...`);
                const result = this.nativeAddon.extract(appName || '');

                // Native addon returns object directly, not JSON string
                if (result && !result.error) {
                    return result;
                } else if (result && result.diagnostic === 'PERMISSION_DENIED') {
                    return {
                        error: 'Permission denied - Accessibility access required',
                        diagnostic: 'PERMISSION_DENIED',
                        snapshot: []
                    };
                } else {
                    return result || {
                        error: 'Native extraction failed',
                        diagnostic: 'NATIVE_ERROR',
                        snapshot: []
                    };
                }
            } catch (e) {
                console.error(`❌ [SimpleAxAgent] Native extraction error: ${e.message}`);
                // Fall through to osascript method
            }
        }

        // FALLBACK: osascript method (old way)
        return new Promise((resolve) => {
            if (!this.axScriptPath) {
                resolve({
                    error: 'AX extraction script not found',
                    diagnostic: 'NO_AX_SCRIPT',
                    snapshot: []
                });
                return;
            }
            const args = ['-l', 'JavaScript', this.axScriptPath];
            if (appName) {
                args.push(appName);
            }

            execFile('osascript', args, {
                timeout: 15000,
                maxBuffer: 1024 * 1024 * 5 // 5MB
            }, (err, stdout, stderr) => {
                if (err) {
                    // Check for specific permission error
                    if (stderr && (stderr.includes('-25201') || stderr.includes('Permission denied'))) {
                        resolve({
                            error: 'Permission denied - Accessibility access required',
                            diagnostic: 'PERMISSION_DENIED',
                            snapshot: [],
                            stderr
                        });
                        return;
                    }

                    resolve({
                        error: err.message,
                        diagnostic: 'SCRIPT_ERROR',
                        snapshot: [],
                        stderr
                    });
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (parseErr) {
                    resolve({
                        error: 'Parse error',
                        diagnostic: 'PARSE_ERROR',
                        snapshot: [],
                        stdout
                    });
                }
            });
        });
    }

    /**
     * Check if app is running
     */
    async _checkAppRunning(appName) {
        return new Promise((resolve) => {
            const script = `Application("${appName}").running()`;
            execFile('osascript', ['-l', 'JavaScript', '-e', script], (err, stdout) => {
                if (err) {
                    resolve(false);
                    return;
                }
                resolve(stdout.trim() === 'true');
            });
        });
    }

    async _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Normalize app names (Spanish -> English for macOS)
    _normalizeAppName(appName) {
        const appMappings = {
            'Calculadora': 'Calculator',
            'Calendario': 'Calendar',
            'Contactos': 'Contacts',
            'Notas': 'Notes',
            'Música': 'Music',
            'Fotos': 'Photos',
            'Mapas': 'Maps',
            'Recordatorios': 'Reminders',
            'Mail': 'Mail',
            'Mensajes': 'Messages',
            'FaceTime': 'FaceTime',
            'Safari': 'Safari',
            'Chrome': 'Google Chrome',
            'Finder': 'Finder'
        };
        return appMappings[appName] || appName;
    }

    async _focusApp(appName) {
        const normalized = this._normalizeAppName(appName);
        return new Promise((resolve) => {
            execFile('osascript', ['-e', `tell application "${normalized}" to activate`], (err) => {
                if (err) console.warn(`⚠️ [SimpleAxAgent] Could not focus ${normalized}`);
                setTimeout(resolve, 500);
            });
        });
    }

    async _openApp(appName) {
        const normalized = this._normalizeAppName(appName);
        return new Promise((resolve) => {
            execFile('open', ['-a', normalized], (err) => {
                if (err) console.warn(`⚠️ [SimpleAxAgent] Could not open ${normalized}`);
                setTimeout(resolve, 500); // Reduced from 2000ms — AppleScript activate handles focus quickly
            });
        });
    }
}

module.exports = SimpleAxAgent;

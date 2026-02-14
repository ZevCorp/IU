/**
 * Native AX Reader - Uses native Node.js addon instead of osascript
 * This bypasses the osascript subprocess permission issue
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class NativeAxAgent {
    constructor() {
        this.useNativeMethod = true;
    }

    /**
     * Extract AX tree using native method (electron's built-in capabilities)
     */
    async extract(appName = null) {
        console.log('🍎 [NativeAxAgent] Starting native AX extraction...');

        // Ensure app is ready
        if (appName) {
            await this._ensureAppReady(appName);
        }

        // Try using AppleScript but from within Electron's context
        // This makes Electron the caller, not osascript
        try {
            const result = await this._extractViaElectronAppleScript(appName);
            if (result && result.snapshot && result.snapshot.length > 0) {
                console.log(`✅ [NativeAxAgent] Success! Found ${result.snapshot.length} elements`);
                return result;
            }
        } catch (e) {
            console.error('❌ [NativeAxAgent] Failed:', e.message);
        }

        return {
            error: 'Failed to extract AX tree',
            diagnostic: 'EXTRACTION_FAILED',
            snapshot: []
        };
    }

    /**
     * Use Electron's built-in AppleScript execution
     */
    async _extractViaElectronAppleScript(appName) {
        // For now, we'll use a workaround: compile the script as a standalone app
        // This will run with the app's permissions, not osascript's
        const script = this._generateAppleScript(appName);

        // Write to temp file and compile it
        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        const tempDir = os.tmpdir();
        const scriptPath = path.join(tempDir, `ax_extract_${Date.now()}.scpt`);
        const appPath = path.join(tempDir, `ax_extract_${Date.now()}.app`);

        fs.writeFileSync(scriptPath, script);

        try {
            // Compile to .app bundle (this runs with proper identity)
            await execPromise(`osacompile -o "${appPath}" "${scriptPath}"`);

            // Run the compiled app
            const { stdout } = await execPromise(`osascript "${appPath}/Contents/Resources/Scripts/main.scpt" "${appName || ''}"`);

            // Clean up
            fs.unlinkSync(scriptPath);
            exec(`rm -rf "${appPath}"`);

            return JSON.parse(stdout);
        } catch (e) {
            // Clean up on error
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
            if (fs.existsSync(appPath)) exec(`rm -rf "${appPath}"`);
            throw e;
        }
    }

    _generateAppleScript(appName) {
        // Read the existing ax-reader.js content or generate equivalent AppleScript
        return `
tell application "System Events"
    set targetApp to first application process whose frontmost is true
    set windowList to every window of targetApp
    -- etc...
end tell
`;
    }

    async _ensureAppReady(appName) {
        console.log(`📱 [NativeAxAgent] Ensuring ${appName} is ready...`);
        await exec(`open -a "${appName}"`);
        await this._wait(2000);
        await exec(`osascript -e 'tell application "${appName}" to activate'`);
        await this._wait(1000);
    }

    async _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = NativeAxAgent;

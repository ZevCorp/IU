/**
 * Permission Check Utility for Accessibility
 */

const { execFile, exec, execSync } = require('child_process');
const { dialog } = require('electron');

class PermissionManager {
    /**
     * Request Accessibility permissions programmatically
     * This will trigger the system prompt if permissions are not yet granted
     */
    static requestAccessibilityPermissions() {
        try {
            // This AppleScript will trigger the system permission prompt
            const script = `
                ObjC.import('ApplicationServices');
                
                // Request with prompt
                const opts = $.NSMutableDictionary.alloc.init;
                opts.setValueForKey(true, 'AXTrustedCheckOptionPrompt');
                const trusted = $.AXIsProcessTrustedWithOptions(opts);
                
                JSON.stringify({ trusted: trusted });
            `;

            const result = execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, {
                timeout: 5000,
                encoding: 'utf8'
            });

            const parsed = JSON.parse(result);
            return parsed.trusted;
        } catch (e) {
            console.error('⚠️ [Permissions] Could not request permissions:', e.message);
            return false;
        }
    }

    /**
     * Check if the process has Accessibility permissions
     */
    static async checkAccessibilityPermissions() {
        return new Promise((resolve) => {
            const script = `
                ObjC.import('ApplicationServices');
                const trusted = $.AXIsProcessTrusted();
                JSON.stringify({ trusted: trusted });
            `;

            execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 3000 }, (err, stdout) => {
                if (err) {
                    console.warn('⚠️ [Permissions] Check failed:', err.message);
                    resolve({ trusted: false, error: err.message });
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve({ trusted: result.trusted === true });
                } catch (e) {
                    resolve({ trusted: false, error: 'Parse error' });
                }
            });
        });
    }

    /**
     * Prompt user to grant Accessibility permissions
     */
    static async promptForPermissions(mainWindow = null) {
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Permisos de Accesibilidad Necesarios',
            message: 'iü-os necesita permisos de Accesibilidad para controlar aplicaciones',
            detail: `Para usar las funciones de control de pantalla, debes otorgar permisos de Accesibilidad.

⚠️ IMPORTANTE: Agrega TODAS estas apps a la lista:
   • Terminal
   • Electron
   • osascript (si aparece)

Pasos:
1. Haz clic en "Abrir Configuración"
2. Desbloquea el candado 🔓
3. Habilita Terminal y Electron
4. Reinicia la aplicación`,
            buttons: ['Abrir Configuración', 'Más Tarde'],
            defaultId: 0,
            cancelId: 1
        });

        if (result.response === 0) {
            // Try to request permissions programmatically FIRST
            console.log('🔑 [Permissions] Requesting permissions programmatically...');
            const granted = this.requestAccessibilityPermissions();

            if (!granted) {
                // If that doesn't work, open System Settings
                exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"', (err) => {
                    if (err) {
                        console.error('❌ [Permissions] Could not open System Settings:', err);
                    }
                });
            } else {
                console.log('✅ [Permissions] Permissions granted!');
            }

            return true;
        }

        return false;
    }

    /**
     * Check permissions and prompt if needed
     */
    static async ensurePermissions(mainWindow = null) {
        // First, try to request permissions programmatically
        console.log('🔑 [Permissions] Checking and requesting permissions...');
        const programmaticResult = this.requestAccessibilityPermissions();

        if (programmaticResult) {
            console.log('✅ [Permissions] Accessibility permissions granted');
            return true;
        }

        // If that failed, do async check
        const check = await this.checkAccessibilityPermissions();

        if (check.trusted) {
            console.log('✅ [Permissions] Accessibility permissions granted');
            return true;
        }

        console.warn('⚠️ [Permissions] Accessibility permissions NOT granted');

        if (mainWindow) {
            await this.promptForPermissions(mainWindow);
        }

        return false;
    }
}

module.exports = PermissionManager;

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    derivePackageRootFromCliPath,
    resolveOpenClawNodePath,
    resolveOpenClawPackageRoot,
} = require('./OpenClawPackageResolver');

function isFile(filePath) {
    try {
        return Boolean(filePath) && fs.statSync(filePath).isFile();
    } catch (_) {
        return false;
    }
}

function isDir(dirPath) {
    try {
        return Boolean(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch (_) {
        return false;
    }
}

function safeRealpath(inputPath = '') {
    const candidate = String(inputPath || '').trim();
    if (!candidate) return '';
    try {
        return fs.realpathSync(candidate);
    } catch (_) {
        return candidate;
    }
}

function uniqueList(items = []) {
    const seen = new Set();
    return items.filter((item) => {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function deriveCliPathFromPackageRoot(packageRoot = '') {
    const root = String(packageRoot || '').trim();
    if (!root) return '';
    const candidates = [
        path.join(root, 'openclaw.mjs'),
        path.join(root, 'dist', 'index.mjs'),
    ];
    return candidates.find((candidate) => isFile(candidate)) || '';
}

function readJsonFile(filePath = '') {
    const target = String(filePath || '').trim();
    if (!target || !isFile(target)) return null;
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (_) {
        return null;
    }
}

function copyFileWithMode(sourceFile, targetFile) {
    ensureDir(path.dirname(targetFile));
    fs.copyFileSync(sourceFile, targetFile);
    try {
        fs.chmodSync(targetFile, fs.statSync(sourceFile).mode);
    } catch (_) {
        // Ignore mode propagation failures on platforms that do not support it.
    }
}

function writeExecutableTextFile(targetFile, content) {
    ensureDir(path.dirname(targetFile));
    fs.writeFileSync(targetFile, content, { mode: 0o755 });
}

function sanitizePathForShell(inputPath = '') {
    return String(inputPath || '').replace(/'/g, `'\\''`);
}

function sanitizeTextForPlist(input = '') {
    return String(input || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

class OpenClawSupervisorBridge {
    constructor(options = {}) {
        this.log = typeof options.log === 'function' ? options.log : () => {};
        this.getUserDataPath = typeof options.getUserDataPath === 'function'
            ? options.getUserDataPath
            : () => String(options.userDataPath || '').trim() || path.join(os.homedir(), '.iu-os');
        this.getAppBundlePath = typeof options.getAppBundlePath === 'function'
            ? options.getAppBundlePath
            : () => {
                const execPath = String(process.execPath || '').trim();
                if (process.platform === 'darwin' && execPath.includes('.app/Contents/MacOS/')) {
                    return path.resolve(execPath, '..', '..', '..');
                }
                return execPath;
            };
        this.manageLaunchAgent = options.manageLaunchAgent !== false;
        this.lastResolvedInstall = null;
    }

    getManagedRoot() {
        return path.join(this.getUserDataPath(), 'openclaw-supervisor');
    }

    getManagedInstallRoot() {
        return path.join(this.getManagedRoot(), 'managed-install');
    }

    getManagedPackageRoot() {
        return path.join(this.getManagedInstallRoot(), 'openclaw');
    }

    getManagedBinDir() {
        return path.join(this.getManagedInstallRoot(), 'bin');
    }

    getManagedNodePath() {
        return path.join(this.getManagedBinDir(), 'node');
    }

    getManagedCliPath() {
        return path.join(this.getManagedPackageRoot(), 'openclaw.mjs');
    }

    getManagedStateDir() {
        return path.join(this.getUserDataPath(), 'openclaw-runtime');
    }

    getManagedManifestPath() {
        return path.join(this.getManagedRoot(), 'install-manifest.json');
    }

    getManagedCleanupScriptPath() {
        return path.join(this.getManagedRoot(), 'cleanup-managed-openclaw.sh');
    }

    getManagedWatcherScriptPath() {
        return path.join(this.getManagedRoot(), 'watch-managed-openclaw-uninstall.sh');
    }

    getCleanupLaunchAgentLabel() {
        return 'com.iu.openclaw.cleanup';
    }

    getCleanupLaunchAgentPath() {
        return path.join(os.homedir(), 'Library', 'LaunchAgents', `${this.getCleanupLaunchAgentLabel()}.plist`);
    }

    getResolvedInstall() {
        return this.lastResolvedInstall || this.readManagedInstall();
    }

    readManagedInstall() {
        const manifest = readJsonFile(this.getManagedManifestPath());
        if (!manifest || manifest.installedByIU !== true) {
            return null;
        }
        if (String(manifest.source || '').trim() === 'iu-managed') {
            // Legacy copied install from the old embedded experiment. Force a
            // reinstall onto the bundled-runtime scheme instead of reusing it.
            return null;
        }

        const cliPath = String(manifest.cliPath || '').trim();
        const nodePath = String(manifest.nodePath || '').trim();
        const packageRoot = String(manifest.packageRoot || '').trim() || derivePackageRootFromCliPath(cliPath);
        if (!isFile(cliPath) || !isFile(nodePath) || !isDir(packageRoot)) {
            return null;
        }

        const resolved = {
            ...manifest,
            cliPath,
            nodePath,
            packageRoot,
            installedByIU: true,
            managedByIU: true,
            stateDir: String(manifest.stateDir || '').trim() || this.getManagedStateDir(),
        };
        this.lastResolvedInstall = resolved;
        return resolved;
    }

    listExistingExternalCliCandidates() {
        const candidates = [];
        const explicitPath = String(process.env.IU_OPENCLAW_CLI_PATH || '').trim();
        if (explicitPath) {
            candidates.push(explicitPath);
        }

        const pathEntries = String(process.env.PATH || '')
            .split(path.delimiter)
            .map((entry) => entry.trim())
            .filter(Boolean);
        for (const entry of pathEntries) {
            candidates.push(path.join(entry, 'openclaw'));
        }

        const homeDir = os.homedir();
        const nvmRoot = path.join(homeDir, '.nvm', 'versions', 'node');
        try {
            const versions = fs.readdirSync(nvmRoot).sort().reverse();
            for (const version of versions) {
                candidates.push(path.join(nvmRoot, version, 'bin', 'openclaw'));
            }
        } catch (_) {
            // Ignore missing NVM installs.
        }

        candidates.push('/opt/homebrew/bin/openclaw');
        candidates.push('/usr/local/bin/openclaw');
        candidates.push(path.join(homeDir, '.local', 'bin', 'openclaw'));

        return uniqueList(candidates).filter((candidate) => isFile(candidate));
    }

    resolveExistingExternalInstall() {
        const managedCliPath = safeRealpath(this.getManagedCliPath());
        for (const candidate of this.listExistingExternalCliCandidates()) {
            const realCandidate = safeRealpath(candidate);
            if (managedCliPath && realCandidate === managedCliPath) continue;
            const packageRoot = derivePackageRootFromCliPath(realCandidate);
            if (!packageRoot) continue;
            const nodePath = resolveOpenClawNodePath(realCandidate);
            const resolved = {
                cliPath: realCandidate,
                nodePath,
                packageRoot,
                installedByIU: false,
                managedByIU: false,
                source: 'external',
            };
            this.lastResolvedInstall = resolved;
            return resolved;
        }
        return null;
    }

    buildManagedManifest(source = {}) {
        const packageJson = readJsonFile(path.join(source.packageRoot || '', 'package.json')) || {};
        const manifest = {
            installedByIU: true,
            managedByIU: true,
            source: 'iu-bundled',
            installedAt: new Date().toISOString(),
            version: String(packageJson.version || '').trim() || 'unknown',
            cliPath: String(source.cliPath || '').trim(),
            nodePath: String(source.nodePath || '').trim(),
            packageRoot: String(source.packageRoot || '').trim(),
            installRoot: this.getManagedRoot(),
            stateDir: this.getManagedStateDir(),
            cleanupScript: this.getManagedCleanupScriptPath(),
            watcherScript: this.getManagedWatcherScriptPath(),
            cleanupLaunchAgentPath: this.getCleanupLaunchAgentPath(),
            cleanupLaunchAgentLabel: this.getCleanupLaunchAgentLabel(),
            appBundlePath: this.getAppBundlePath(),
            bundledSource: {
                packageRoot: source.packageRoot,
                nodePath: source.nodePath,
            },
        };
        return manifest;
    }

    writeManagedCleanupScript(manifest) {
        const cliPath = sanitizePathForShell(manifest.cliPath);
        const nodePath = sanitizePathForShell(manifest.nodePath);
        const stateDir = sanitizePathForShell(manifest.stateDir);
        const installRoot = sanitizePathForShell(manifest.installRoot);
        const manifestPath = sanitizePathForShell(this.getManagedManifestPath());
        const cleanupScript = `#!/bin/zsh
set -e

CLI_PATH='${cliPath}'
NODE_PATH='${nodePath}'
STATE_DIR='${stateDir}'
INSTALL_ROOT='${installRoot}'
MANIFEST_PATH='${manifestPath}'

if [ -x "$NODE_PATH" ] && [ -f "$CLI_PATH" ]; then
  OPENCLAW_STATE_DIR="$STATE_DIR" OPENCLAW_CONFIG_PATH="$STATE_DIR/openclaw.json" "$NODE_PATH" "$CLI_PATH" gateway uninstall --json >/dev/null 2>&1 || true
fi

rm -rf "$INSTALL_ROOT"
rm -rf "$STATE_DIR"
rm -f "$MANIFEST_PATH"
        `;
        writeExecutableTextFile(this.getManagedCleanupScriptPath(), cleanupScript);
    }

    writeManagedWatcherScript(manifest) {
        const appBundlePath = sanitizePathForShell(manifest.appBundlePath);
        const cleanupScript = sanitizePathForShell(manifest.cleanupScript);
        const launchAgentPath = sanitizePathForShell(manifest.cleanupLaunchAgentPath);
        const watcherScript = `#!/bin/zsh
set -e

APP_BUNDLE_PATH='${appBundlePath}'
CLEANUP_SCRIPT='${cleanupScript}'
LAUNCH_AGENT_PATH='${launchAgentPath}'

if [ -e "$APP_BUNDLE_PATH" ]; then
  exit 0
fi

if [ -x "$CLEANUP_SCRIPT" ]; then
  "$CLEANUP_SCRIPT" || true
fi

/bin/launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || /bin/launchctl unload "$LAUNCH_AGENT_PATH" >/dev/null 2>&1 || true
rm -f "$LAUNCH_AGENT_PATH"
rm -f "$0"
`;
        writeExecutableTextFile(this.getManagedWatcherScriptPath(), watcherScript);
    }

    writeCleanupLaunchAgentPlist(manifest) {
        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${sanitizeTextForPlist(manifest.cleanupLaunchAgentLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${sanitizeTextForPlist(manifest.watcherScript)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${sanitizeTextForPlist(path.join(this.getManagedRoot(), 'cleanup-watch.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${sanitizeTextForPlist(path.join(this.getManagedRoot(), 'cleanup-watch.log'))}</string>
</dict>
</plist>
`;
        ensureDir(path.dirname(this.getCleanupLaunchAgentPath()));
        fs.writeFileSync(this.getCleanupLaunchAgentPath(), plist, 'utf8');
    }

    installCleanupLaunchAgent(manifest) {
        if (!this.manageLaunchAgent || process.platform !== 'darwin') {
            return;
        }

        this.writeManagedWatcherScript(manifest);
        this.writeCleanupLaunchAgentPlist(manifest);

        try {
            execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}`, this.getCleanupLaunchAgentPath()], {
                stdio: 'ignore',
            });
        } catch (_) {
            // Ignore missing or unloaded services before bootstrapping.
        }

        try {
            execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, this.getCleanupLaunchAgentPath()], {
                stdio: 'ignore',
            });
            this.log(`Installed cleanup watcher ${manifest.cleanupLaunchAgentLabel}`);
        } catch (error) {
            this.log(`Failed to bootstrap cleanup watcher: ${String(error?.message || error || 'unknown error')}`);
        }
    }

    removeCleanupLaunchAgent() {
        if (process.platform === 'darwin') {
            try {
                execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}`, this.getCleanupLaunchAgentPath()], {
                    stdio: 'ignore',
                });
            } catch (_) {
                // Ignore missing services during cleanup.
            }
        }
        fs.rmSync(this.getCleanupLaunchAgentPath(), { force: true });
        fs.rmSync(this.getManagedWatcherScriptPath(), { force: true });
    }

    installManagedOpenClaw() {
        const sourcePackageRoot = resolveOpenClawPackageRoot();
        const sourceNodePath = resolveOpenClawNodePath();
        const sourceCliPath = deriveCliPathFromPackageRoot(sourcePackageRoot);
        if (!sourceCliPath || !isFile(sourceCliPath)) {
            throw new Error('No pude resolver openclaw.mjs dentro del runtime empaquetado de IU');
        }

        // Clean up stale copied-package installs from the previous embedded attempt.
        fs.rmSync(this.getManagedInstallRoot(), { recursive: true, force: true });

        const manifest = this.buildManagedManifest({
            packageRoot: sourcePackageRoot,
            nodePath: sourceNodePath,
            cliPath: sourceCliPath,
        });
        ensureDir(path.dirname(this.getManagedManifestPath()));
        fs.writeFileSync(this.getManagedManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        this.writeManagedCleanupScript(manifest);
        this.installCleanupLaunchAgent(manifest);
        this.log(`Installed IU-managed OpenClaw ${manifest.version} at ${manifest.installRoot}`);
        this.lastResolvedInstall = manifest;
        return manifest;
    }

    async ensureInstalled() {
        const managed = this.readManagedInstall();
        if (managed) {
            return managed;
        }

        const preferExternal = String(process.env.IU_OPENCLAW_USE_EXTERNAL || '').trim() === '1';
        if (preferExternal) {
            const external = this.resolveExistingExternalInstall();
            if (external) {
                return external;
            }
        }

        return this.installManagedOpenClaw();
    }

    async uninstallManagedInstall() {
        const managed = this.readManagedInstall();
        if (!managed) {
            fs.rmSync(this.getManagedInstallRoot(), { recursive: true, force: true });
            fs.rmSync(this.getManagedManifestPath(), { force: true });
            return { removed: false, reason: 'not-managed' };
        }

        try {
            if (isFile(this.getManagedCleanupScriptPath())) {
                fs.chmodSync(this.getManagedCleanupScriptPath(), 0o755);
            }
        } catch (_) {
            // Ignore chmod failures.
        }

        this.removeCleanupLaunchAgent();
        if (String(managed.source || '').trim() === 'iu-managed') {
            fs.rmSync(managed.installRoot, { recursive: true, force: true });
        }
        fs.rmSync(this.getManagedInstallRoot(), { recursive: true, force: true });
        fs.rmSync(managed.stateDir, { recursive: true, force: true });
        fs.rmSync(this.getManagedCleanupScriptPath(), { force: true });
        fs.rmSync(this.getManagedManifestPath(), { force: true });
        this.lastResolvedInstall = null;
        return { removed: true, reason: 'removed' };
    }
}

module.exports = OpenClawSupervisorBridge;

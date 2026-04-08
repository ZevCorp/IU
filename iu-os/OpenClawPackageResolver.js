'use strict';

const fs = require('fs');
const path = require('path');

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

function derivePackageRootFromCliPath(cliPath) {
    const candidate = String(cliPath || '').trim();
    if (!candidate) return '';
    try {
        const resolved = fs.realpathSync(candidate);
        const baseName = path.basename(resolved).toLowerCase();
        if (baseName === 'openclaw' || baseName === 'openclaw.mjs') {
            const packageRoot = path.dirname(resolved);
            return isDir(path.join(packageRoot, 'dist')) ? packageRoot : '';
        }
        return '';
    } catch (_) {
        return '';
    }
}

function resolveOpenClawNodePath(cliPath = '') {
    const candidates = [];
    const explicitPath = String(process.env.IU_OPENCLAW_NODE_PATH || '').trim();
    if (explicitPath) {
        candidates.push(explicitPath);
    }

    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'runtime', 'node'));
        candidates.push(path.join(process.resourcesPath, 'runtime', 'node'));
    }

    const cliCandidate = String(cliPath || '').trim();
    if (cliCandidate) {
        const cliDir = path.dirname(cliCandidate);
        if (cliDir) {
            candidates.push(path.join(cliDir, 'node'));
        }
    }

    const pathEntries = String(process.env.PATH || '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean);
    for (const entry of pathEntries) {
        candidates.push(path.join(entry, 'node'));
    }

    const homeDir = process.env.HOME || '';
    if (homeDir) {
        const nvmRoot = path.join(homeDir, '.nvm', 'versions', 'node');
        try {
            const versions = fs.readdirSync(nvmRoot).sort().reverse();
            for (const version of versions) {
                candidates.push(path.join(nvmRoot, version, 'bin', 'node'));
            }
        } catch (_) {
            // Ignore missing NVM installs.
        }
    }

    candidates.push('/opt/homebrew/bin/node');
    candidates.push('/usr/local/bin/node');

    const execPath = String(process.execPath || '').trim();
    if (execPath && path.basename(execPath).toLowerCase() === 'node') {
        candidates.push(execPath);
    }

    const seen = new Set();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        if (isFile(candidate)) {
            return candidate;
        }
    }

    throw new Error('No pude resolver un binario compatible de Node para lanzar OpenClaw');
}

function resolveOpenClawPackageRoot(options = {}) {
    const candidates = [];
    const explicitRoot = String(options.packageRoot || process.env.IU_OPENCLAW_PACKAGE_ROOT || '').trim();
    if (explicitRoot) {
        candidates.push(explicitRoot);
    }

    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw'));
        candidates.push(path.join(process.resourcesPath, 'node_modules', 'openclaw'));
    }

    try {
        const entry = require.resolve('openclaw');
        candidates.push(path.dirname(path.dirname(entry)));
    } catch (_) {
        // Ignore resolution failures; caller will handle if nothing resolves.
    }

    const derivedFromCli = derivePackageRootFromCliPath(options.cliPath || process.env.IU_OPENCLAW_CLI_PATH || '');
    if (derivedFromCli) {
        candidates.push(derivedFromCli);
    }

    const seen = new Set();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        if (isDir(candidate)) {
            return candidate;
        }
    }

    throw new Error('No pude resolver la dependencia local de OpenClaw');
}

module.exports = {
    derivePackageRootFromCliPath,
    resolveOpenClawNodePath,
    resolveOpenClawPackageRoot,
};

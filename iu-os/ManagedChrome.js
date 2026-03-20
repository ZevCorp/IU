'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');

const MANAGED_CHROME_APP = 'Google Chrome';
const MANAGED_CHROME_PORT = 9222;
const VERBOSE_MANAGED_CHROME_LOGS = process.env.IU_VERBOSE_CHROME_LOGS === '1';

function getManagedChromeConfig() {
    const userDataRoot = app.getPath('userData');
    const userDataDir = path.join(userDataRoot, 'iu_managed_chrome');
    return {
        appName: MANAGED_CHROME_APP,
        port: MANAGED_CHROME_PORT,
        userDataDir,
        extensionDir: path.resolve(__dirname, '..', 'iu-chrome-extension'),
        markerPath: path.join(userDataDir, 'iu-browser-marker.json')
    };
}

function ensureManagedChromeProfileMarker(config, extra = {}) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
    fs.writeFileSync(config.markerPath, JSON.stringify({
        appName: config.appName,
        port: config.port,
        userDataDir: config.userDataDir,
        updatedAt: new Date().toISOString(),
        ...extra
    }, null, 2));
}

function fetchJson(pathname, timeout = 1500) {
    const { port } = getManagedChromeConfig();
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

async function isManagedChromeRunning() {
    try {
        const processInfo = await findManagedChromeProcess();
        if (!processInfo) return false;
        await fetchJson('/json/version');
        return true;
    } catch (_) {
        return false;
    }
}

async function getManagedChromeTargets() {
    try {
        const targets = await fetchJson('/json/list');
        return Array.isArray(targets) ? targets.filter(target => target?.type === 'page') : [];
    } catch (_) {
        return [];
    }
}

async function resolveChromeBinary() {
    if (process.platform === 'darwin') {
        const envChromePath = process.env.IU_CHROME_BINARY || process.env.CHROME_PATH;
        if (envChromePath && fs.existsSync(envChromePath)) {
            return envChromePath;
        }

        const home = process.env.HOME || '';
        const candidates = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
        ];

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // Avoid AppleScript "path to application" because it can open Chrome and create an extra window.
        const appPath = await new Promise((resolve) => {
            execFile('mdfind', ['kMDItemCFBundleIdentifier == "com.google.Chrome"'], (err, stdout) => {
                if (err) return resolve('');
                const firstMatch = String(stdout || '')
                    .split('\n')
                    .map(line => line.trim())
                    .find(Boolean) || '';
                resolve(firstMatch);
            });
        });

        if (appPath) {
            const binary = path.join(appPath, 'Contents', 'MacOS', 'Google Chrome');
            if (fs.existsSync(binary)) {
                return binary;
            }
        }

        throw new Error('Google Chrome app path not found');
    }

    if (process.platform === 'win32') {
        return MANAGED_CHROME_APP;
    }

    return 'google-chrome';
}

async function findManagedChromeProcess() {
    const config = getManagedChromeConfig();
    return new Promise((resolve) => {
        execFile('ps', ['ax', '-o', 'pid=,command='], (err, stdout) => {
            if (err) return resolve(null);

            const lines = String(stdout || '').split('\n').map(line => line.trim()).filter(Boolean);
            const candidates = lines.filter(line => line.includes(config.userDataDir));
            const preferred = candidates.find(line => !line.includes('--type=') && line.includes(`--remote-debugging-port=${config.port}`))
                || candidates.find(line => !line.includes('--type='))
                || candidates[0];

            if (preferred) {
                const match = preferred.match(/^(\d+)\s+(.*)$/);
                if (!match) return resolve(null);
                resolve({
                    pid: Number(match[1]),
                    command: match[2]
                });
                return;
            }

            for (const line of lines) {
                if (!line.includes(config.userDataDir)) continue;
                const match = line.match(/^(\d+)\s+(.*)$/);
                if (!match) continue;
                resolve({
                    pid: Number(match[1]),
                    command: match[2]
                });
                return;
            }

            resolve(null);
        });
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function captureCaller() {
    const stack = String(new Error().stack || '').split('\n').slice(3, 6).map(line => line.trim());
    return stack.join(' | ');
}

async function summarizeTargets(limit = 5) {
    const targets = await getManagedChromeTargets();
    return targets.slice(0, limit).map(target => target.url || '(sin url)');
}

async function waitForManagedChrome(maxAttempts = 20, delayMs = 250) {
    for (let i = 0; i < maxAttempts; i++) {
        if (await isManagedChromeRunning()) return true;
        await wait(delayMs);
    }
    return false;
}

async function launchManagedChrome(url = '', extraArgs = [], meta = {}) {
    const config = getManagedChromeConfig();
    const chromeBinary = await resolveChromeBinary();
    ensureManagedChromeProfileMarker(config, {
        source: meta.source || 'unknown',
        chromeBinary
    });
    const args = [
        `--user-data-dir=${config.userDataDir}`,
        `--remote-debugging-port=${config.port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=UseDnsHttpsSvcb,UseDnsHttpsAlpn',
        ...extraArgs
    ];

    if (url) args.push(url);

    console.log(`🧭 [ManagedChrome] launchManagedChrome requested`, {
        source: meta.source || 'unknown',
        url: url || '',
        extraArgs,
        caller: meta.caller || captureCaller(),
        userDataDir: config.userDataDir
    });

    const child = spawn(chromeBinary, args, {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    console.log(`🧭 [ManagedChrome] spawn launched`, { pid: child.pid, binary: chromeBinary, args });

    const ready = await waitForManagedChrome();
    if (!ready) {
        throw new Error('Managed Chrome did not expose CDP on time');
    }

    console.log(`🧭 [ManagedChrome] launchManagedChrome ready`, {
        source: meta.source || 'unknown',
        url: url || '',
        targets: await summarizeTargets()
    });

    return config;
}

async function focusManagedChromeInstance() {
    const processInfo = await findManagedChromeProcess();
    if (!processInfo?.pid) {
        throw new Error('Managed Chrome process not found');
    }

    if (process.platform === 'darwin') {
        await new Promise((resolve) => {
            execFile('osascript', ['-e', `tell application "System Events" to set frontmost of first application process whose unix id is ${processInfo.pid} to true`], (err) => {
                if (err) {
                    execFile('osascript', ['-e', `tell application "${MANAGED_CHROME_APP}" to activate`], () => resolve());
                    return;
                }
                resolve();
            });
        });
        return processInfo;
    }

    return processInfo;
}

async function ensureManagedChrome(url = '', extraArgs = [], meta = {}) {
    const running = await isManagedChromeRunning();
    if (VERBOSE_MANAGED_CHROME_LOGS) {
        console.log(`🧭 [ManagedChrome] ensureManagedChrome`, {
            source: meta.source || 'unknown',
            running,
            url: url || '',
            extraArgs,
            caller: meta.caller || captureCaller()
        });
    }
    if (!running) {
        return launchManagedChrome(url, extraArgs, meta);
    }

    if (VERBOSE_MANAGED_CHROME_LOGS) {
        console.log(`🧭 [ManagedChrome] ensureManagedChrome reuse existing`, {
            source: meta.source || 'unknown',
            targets: await summarizeTargets()
        });
    }
    return getManagedChromeConfig();
}

async function openManagedChromeUrl(url = '', extraArgs = [], meta = {}) {
    const running = await isManagedChromeRunning();
    if (VERBOSE_MANAGED_CHROME_LOGS) {
        console.log(`🧭 [ManagedChrome] openManagedChromeUrl`, {
            source: meta.source || 'unknown',
            running,
            url: url || '',
            extraArgs,
            caller: meta.caller || captureCaller()
        });
    }
    if (!running) {
        return launchManagedChrome(url, extraArgs, meta);
    }

    const chromeBinary = await resolveChromeBinary();
    const config = getManagedChromeConfig();
    const args = [
        `--user-data-dir=${config.userDataDir}`,
        `--remote-debugging-port=${config.port}`,
        ...extraArgs
    ];
    const targetsBefore = await summarizeTargets();

    if (url) args.push(url);

    const child = spawn(chromeBinary, args, {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    await wait(400);
    if (VERBOSE_MANAGED_CHROME_LOGS) {
        console.log(`🧭 [ManagedChrome] openManagedChromeUrl spawned existing-instance launch`, {
            source: meta.source || 'unknown',
            pid: child.pid,
            args,
            targetsBefore,
            targetsAfter: await summarizeTargets()
        });
    }

    return config;
}

module.exports = {
    MANAGED_CHROME_APP,
    MANAGED_CHROME_PORT,
    ensureManagedChrome,
    fetchJson,
    getManagedChromeConfig,
    getManagedChromeTargets,
    isManagedChromeRunning,
    findManagedChromeProcess,
    focusManagedChromeInstance,
    launchManagedChrome,
    openManagedChromeUrl,
    resolveChromeBinary,
    waitForManagedChrome
};

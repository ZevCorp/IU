const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const { startBrowserCoreService, createBrowserCoreClient, toClientOptions } = require('../dist/index.js');

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close((error) => {
                if (error) return reject(error);
                resolve(port);
            });
        });
        server.on('error', reject);
    });
}

function resolveChromeBinary() {
    const envChromePath = process.env.IU_CHROME_BINARY || process.env.CHROME_PATH;
    if (envChromePath && fs.existsSync(envChromePath)) {
        return envChromePath;
    }

    const candidates = process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
        ]
        : process.platform === 'win32'
            ? [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
            ]
            : [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable'
            ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(port, pathname) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', reject);
    });
}

async function waitForChrome(port, attempts = 40) {
    for (let i = 0; i < attempts; i += 1) {
        try {
            const payload = await fetchJson(port, '/json/version');
            if (payload?.Browser) {
                return true;
            }
        } catch (_) {
            // Keep polling.
        }
        await wait(250);
    }
    return false;
}

function startFixtureServer() {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Browser Core Fixture</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      [hidden] { display: none !important; }
      form, nav, section { margin-top: 16px; }
      input { display: block; margin-bottom: 8px; }
      #students-shell { position: relative; width: 280px; margin-top: 12px; }
      #ubeflex-link { display: inline-block; padding: 8px 10px; background: #eef3ff; }
      #students-overlay {
        position: absolute;
        inset: 0;
        border: 0;
        background: rgba(255,255,255,0.92);
      }
    </style>
  </head>
  <body>
    <button id="menu-button" aria-label="Main menu">Menu</button>
    <nav id="menu-panel" hidden>
      <button id="students-button">Estudiantes</button>
      <div id="students-shell">
        <a id="ubeflex-link" href="#ubeflex">Ubeflex</a>
        <button id="students-overlay" aria-label="Expand students section">Expand students section</button>
      </div>
    </nav>
    <section id="login-panel" hidden>
      <label>
        Usuario
        <input id="user-input" placeholder="Usuario" />
      </label>
      <label>
        Password
        <input id="password-input" type="password" placeholder="Password" />
      </label>
      <button id="login-button">Iniciar sesion</button>
    </section>
    <section id="upload-panel" hidden>
      <label>
        Titulo
        <input id="title-input" placeholder="Titulo" />
      </label>
      <button id="upload-button">Subir trabajo</button>
      <p id="status-text">Esperando</p>
    </section>
    <script>
      window.__fixture = { events: [] };
      console.log('fixture-loaded');

      const menuButton = document.getElementById('menu-button');
      const menuPanel = document.getElementById('menu-panel');
      const studentsButton = document.getElementById('students-button');
      const studentsOverlay = document.getElementById('students-overlay');
      const loginPanel = document.getElementById('login-panel');
      const loginButton = document.getElementById('login-button');
      const uploadPanel = document.getElementById('upload-panel');
      const uploadButton = document.getElementById('upload-button');
      const statusText = document.getElementById('status-text');

      menuButton.addEventListener('click', () => {
        menuPanel.hidden = false;
        window.__fixture.events.push('menu-opened');
        console.log('menu-opened');
      });

      studentsButton.addEventListener('click', () => {
        studentsOverlay.hidden = true;
        loginPanel.hidden = false;
        window.__fixture.events.push('students-opened');
        console.log('students-opened');
      });

      loginButton.addEventListener('click', async () => {
        uploadPanel.hidden = false;
        window.__fixture.events.push('login-submitted');
        console.log('login-submitted');
        await fetch('/api/ping', { method: 'POST' });
      });

      uploadButton.addEventListener('click', () => {
        statusText.textContent = 'Trabajo listo para subir';
        window.__fixture.events.push('upload-opened');
        console.log('upload-opened');
      });
    </script>
  </body>
</html>`;

    const server = http.createServer((req, res) => {
        if (req.url === '/api/ping') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
    });

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                port,
                server,
                url: `http://127.0.0.1:${port}/`
            });
        });
        server.on('error', reject);
    });
}

function launchChrome(binary, port) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-browser-core-test-'));
    const child = spawn(binary, [
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=UseDnsHttpsSvcb,UseDnsHttpsAlpn',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1280,900',
        'about:blank'
    ], {
        stdio: 'ignore'
    });

    return {
        child,
        userDataDir,
        async stop() {
            if (!child.killed) {
                child.kill('SIGTERM');
                await wait(300);
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    };
}

function findRef(snapshot, matcher) {
    const element = Array.isArray(snapshot.elements)
        ? snapshot.elements.find((entry) => matcher(String(entry.label || '')))
        : null;
    assert.ok(element, 'Expected snapshot ref to exist.');
    return element.ref;
}

test('browser-core integration: open, reuse, snapshot, act, observe', { timeout: 120000 }, async (t) => {
    const chromeBinary = resolveChromeBinary();
    if (!chromeBinary) {
        t.skip('Google Chrome is not available for browser-core integration tests.');
        return;
    }

    let fixture;
    let chromePort;
    let servicePort;
    try {
        fixture = await startFixtureServer();
        chromePort = await getFreePort();
        servicePort = await getFreePort();
    } catch (error) {
        if (error?.code === 'EPERM') {
            t.skip('Loopback listeners are not permitted in the current environment.');
            return;
        }
        throw error;
    }
    const chrome = launchChrome(chromeBinary, chromePort);

    let service = null;
    try {
        const ready = await waitForChrome(chromePort);
        assert.equal(ready, true, 'Chrome did not expose CDP in time.');

        service = await startBrowserCoreService({
            servicePort,
            authToken: 'integration-test-token',
            defaultProfile: 'user',
            profiles: {
                managed: {
                    name: 'managed',
                    mode: 'managed',
                    driver: 'managed-cdp',
                    cdpUrl: `http://127.0.0.1:${chromePort}`,
                    capabilities: {
                        canLaunch: true,
                        canSnapshot: true,
                        canAct: true,
                        canObserve: true,
                        requiresExistingSession: false
                    }
                },
                user: {
                    name: 'user',
                    mode: 'user',
                    driver: 'user-existing-session',
                    cdpUrl: `http://127.0.0.1:${chromePort}`,
                    capabilities: {
                        canLaunch: false,
                        canSnapshot: true,
                        canAct: true,
                        canObserve: true,
                        requiresExistingSession: true
                    }
                }
            }
        });

        const client = createBrowserCoreClient(toClientOptions(service.config));
        const firstOpen = await client.open({ profile: 'user', url: fixture.url });
        const secondOpen = await client.open({ profile: 'user', url: fixture.url });

        assert.equal(secondOpen.targetId, firstOpen.targetId, 'Expected /open to reuse the same tab for the same URL.');

        let snapshot = await client.snapshot({ profile: 'user', targetId: firstOpen.targetId, format: 'ai' });
        assert.match(snapshot.snapshot, /Menu/i);

        const menuRef = findRef(snapshot, (label) => /menu/i.test(label));
        await client.act('user', { kind: 'click', targetId: firstOpen.targetId, ref: menuRef });

        snapshot = await client.snapshot({ profile: 'user', targetId: firstOpen.targetId, format: 'ai' });
        const studentsRef = findRef(snapshot, (label) => /estudiantes/i.test(label));
        assert.ok(
            !snapshot.snapshot.match(/ubeflex/i),
            'Expected Ubeflex to stay hidden until Estudiantes is expanded.'
        );
        await client.act('user', { kind: 'click', targetId: firstOpen.targetId, ref: studentsRef });

        snapshot = await client.snapshot({ profile: 'user', targetId: firstOpen.targetId, format: 'ai' });
        assert.match(snapshot.snapshot, /Ubeflex/i);
        const userRef = findRef(snapshot, (label) => /usuario/i.test(label));
        const passwordRef = findRef(snapshot, (label) => /password/i.test(label));
        const loginRef = findRef(snapshot, (label) => /iniciar sesion/i.test(label));

        await client.act('user', {
            kind: 'fill',
            targetId: firstOpen.targetId,
            fields: [
                { ref: userRef, value: 'felipe' },
                { ref: passwordRef, value: 'secret' }
            ]
        });
        await client.act('user', { kind: 'click', targetId: firstOpen.targetId, ref: loginRef });
        await client.act('user', { kind: 'wait', targetId: firstOpen.targetId, text: 'Subir trabajo', timeoutMs: 5000 });

        snapshot = await client.snapshot({ profile: 'user', targetId: firstOpen.targetId, format: 'ai' });
        const uploadRef = findRef(snapshot, (label) => /subir trabajo/i.test(label));
        const screenshot = await client.screenshot({ profile: 'user', targetId: firstOpen.targetId, ref: uploadRef });
        assert.ok(String(screenshot.data || '').length > 100, 'Expected element screenshot payload.');

        const consoleState = await client.console('user', firstOpen.targetId);
        assert.ok(consoleState.messages.some((entry) => String(entry.text || '').includes('login-submitted')));

        const networkState = await client.network('user', firstOpen.targetId);
        assert.ok(networkState.requests.some((entry) => String(entry.url || '').includes('/api/ping') && entry.status === 200));
    } finally {
        await service?.stop().catch(() => undefined);
        await chrome.stop().catch(() => undefined);
        if (fixture?.server) {
            await new Promise((resolve) => fixture.server.close(() => resolve()));
        }
    }
});

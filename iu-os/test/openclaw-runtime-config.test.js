const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveOpenClawRuntimeConfig } = require('../OpenClawRuntimeConfig');

async function withEnv(overrides, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(overrides)) {
        previous[key] = process.env[key];
        if (value == null) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value == null) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test('writes a minimal managed OpenClaw config with Anthropic model defaults', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-runtime-'));
    const managedStateDir = path.join(tmpRoot, 'state');

    await withEnv({
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        IU_OPENCLAW_MODEL_PRIMARY: null,
        IU_OPENCLAW_GATEWAY_PORT: '18801',
        IU_OPENCLAW_BROWSER_PROFILE: 'iu-browser',
    }, async () => {
        const runtime = resolveOpenClawRuntimeConfig({
            installInfo: {
                installedByIU: true,
                cliPath: '/tmp/openclaw.mjs',
                nodePath: '/tmp/node',
                packageRoot: '/tmp/openclaw',
            },
            managedStateDir,
            env: process.env,
        });

        const written = JSON.parse(fs.readFileSync(runtime.configPath, 'utf8'));
        assert.equal(runtime.managedByIU, true);
        assert.equal(runtime.profileId, 'iu');
        assert.equal(runtime.authToken.length > 20, true);
        assert.equal(runtime.clientOptions.defaultProfile, 'iu-browser');
        assert.equal(runtime.clientOptions.baseUrl, 'http://127.0.0.1:18803');
        assert.equal(runtime.launchEnv.OPENCLAW_PROFILE, 'iu');
        assert.equal(runtime.launchEnv.IU_OPENCLAW_PROFILE, 'iu');
        assert.equal(written.browser.color, '#FF4500');
        assert.equal(written.browser.profiles['iu-browser'].cdpPort, 18812);
        assert.equal(written.browser.profiles['iu-browser'].color, '#FF4500');
        assert.equal(written.agents.defaults.model.primary, 'anthropic/claude-sonnet-4-5');
        assert.equal(written.env.ANTHROPIC_API_KEY, 'test-anthropic-key');
        assert.equal(typeof written.gateway.remote, 'undefined');
        assert.equal(runtime.launchEnv.OPENCLAW_GATEWAY_TOKEN, runtime.authToken);
    });
});

test('uses a dedicated managed gateway port by default for IU-managed installs', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-runtime-'));
    const managedStateDir = path.join(tmpRoot, 'state');

    await withEnv({
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        IU_OPENCLAW_MODEL_PRIMARY: null,
        IU_OPENCLAW_GATEWAY_PORT: null,
    }, async () => {
        const runtime = resolveOpenClawRuntimeConfig({
            installInfo: {
                installedByIU: true,
                cliPath: '/tmp/openclaw.mjs',
                nodePath: '/tmp/node',
                packageRoot: '/tmp/openclaw',
            },
            managedStateDir,
            env: process.env,
        });

        assert.equal(runtime.gatewayPort, 18795);
        assert.equal(runtime.gatewayUrl, 'ws://127.0.0.1:18795');
        assert.equal(runtime.clientOptions.baseUrl, 'http://127.0.0.1:18797');
    });
});

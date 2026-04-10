const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildManagedOnboardingArgs,
    buildManagedSetupStamp,
    patchManagedConfig,
    resolveAuthChoice,
} = require('../OpenClawManagedSetup');

test('builds non-interactive onboarding args for an IU-managed Anthropic setup', () => {
    const runtime = {
        profileId: 'iu',
        stateDir: '/tmp/iu-openclaw-state',
        workspaceDir: '/tmp/iu-openclaw-state/workspace',
        gatewayPort: 18789,
        authToken: 'test-gateway-token',
        launchEnv: {
            ANTHROPIC_API_KEY: 'test-anthropic-key',
        },
    };

    const args = buildManagedOnboardingArgs(runtime);
    assert.deepEqual(args.slice(0, 4), ['--profile', 'iu', 'onboard', '--non-interactive']);
    assert.ok(args.includes('--accept-risk'));
    assert.ok(args.includes('--install-daemon'));
    assert.ok(args.includes('--gateway-token'));
    assert.ok(args.includes('test-gateway-token'));
    assert.ok(args.includes('--auth-choice'));
    assert.ok(args.includes('apiKey'));
    assert.ok(args.includes('--anthropic-api-key'));
});

test('patchManagedConfig aligns local and remote gateway tokens for the managed profile', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-managed-'));
    const configPath = path.join(tmpRoot, 'openclaw.json');
    fs.writeFileSync(configPath, '{}\n', 'utf8');

    const next = patchManagedConfig({
        configPath,
        stateDir: tmpRoot,
        workspaceDir: path.join(tmpRoot, 'workspace'),
        managedProfile: 'openclaw',
        gatewayPort: 18789,
        gatewayUrl: 'ws://127.0.0.1:18789',
        authToken: 'managed-token',
        modelPrimary: 'anthropic/claude-sonnet-4-5',
    });

    assert.equal(next.gateway.auth.token, 'managed-token');
    assert.equal(typeof next.gateway.remote, 'undefined');
    assert.equal(next.browser.color, '#FF4500');
    assert.equal(next.browser.profiles.openclaw.cdpPort, 18800);
    assert.equal(next.browser.profiles.openclaw.color, '#FF4500');
    assert.equal(next.browser.defaultProfile, 'openclaw');
    assert.equal(next.agents.defaults.model.primary, 'anthropic/claude-sonnet-4-5');
    assert.deepEqual(next.agents.defaults.models['anthropic/claude-sonnet-4-5'], {});
    assert.equal(next.wizard.lastRunMode, 'local');
    assert.equal(next.wizard.lastRunCommand, 'openclaw onboard --non-interactive');
});

test('resolveAuthChoice supports OpenRouter as a managed onboarding source', () => {
    const auth = resolveAuthChoice({
        OPENROUTER_API_KEY: 'test-openrouter-key',
    });
    assert.equal(auth.choice, 'openrouter-api-key');
    assert.deepEqual(auth.args, ['--openrouter-api-key', 'test-openrouter-key']);
});

test('buildManagedSetupStamp records auth provenance for the managed runtime', () => {
    const stamp = buildManagedSetupStamp({
        packageVersion: '2026.2.9',
        profileId: 'iu',
        stateDir: '/tmp/iu-openclaw-state',
        configPath: '/tmp/iu-openclaw-state/openclaw.json',
        gatewayPort: 18795,
        modelPrimary: 'anthropic/claude-sonnet-4-5',
        openClawSettings: {
            provider: 'openai',
            apiKey: 'persisted-openai-key',
        },
    });

    assert.equal(stamp.schemaVersion, 1);
    assert.equal(stamp.authProvider, 'openai');
    assert.equal(typeof stamp.authFingerprint, 'string');
    assert.ok(stamp.authFingerprint.length > 10);
});

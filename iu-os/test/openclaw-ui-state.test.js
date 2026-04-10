const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    OPENCLAW_MODEL_OPTIONS,
    buildOpenClawProviderEnv,
    buildOpenClawRuntimeEnv,
    buildOpenClawUiState,
    detectOpenClawProviderFromEnv,
    detectOpenClawProviderFromApiKey,
    detectOpenClawModelFromEnv,
    fingerprintOpenClawAuth,
    maskOpenClawApiKey,
    normalizeOpenClawProvider,
    normalizeOpenClawModel,
    readOpenClawSetupSignal,
    resolveOpenClawProviderApiKey,
    sanitizeOpenClawSettings,
} = require('../OpenClawUiState');

test('detects a missing OpenClaw config as first-run onboarding', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-ui-state-'));
    const configPath = path.join(tmpRoot, 'openclaw.json');

    const signal = readOpenClawSetupSignal(configPath);
    assert.equal(signal.ready, false);
    assert.equal(signal.status, 'missing_config');
    assert.equal(signal.reason, 'missing_config');
    assert.equal(signal.hasWizard, false);
});

test('detects a ready OpenClaw runtime from wizard metadata and managed config', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-ui-state-'));
    const configPath = path.join(tmpRoot, 'openclaw.json');
    fs.writeFileSync(configPath, JSON.stringify({
        gateway: {
            auth: {
                token: 'gateway-token',
            },
        },
        browser: {
            defaultProfile: 'openclaw',
        },
        agents: {
            defaults: {
                workspace: path.join(tmpRoot, 'workspace'),
            },
        },
        wizard: {
            lastRunAt: '2026-04-09T12:00:00.000Z',
            lastRunCommand: 'openclaw onboard --non-interactive',
            lastRunMode: 'local',
        },
    }, null, 2));

    const signal = readOpenClawSetupSignal(configPath);
    assert.equal(signal.ready, true);
    assert.equal(signal.reason, 'ready');
    assert.equal(signal.status, 'ready');
    assert.equal(signal.hasWizard, true);
    assert.equal(signal.hasGatewayToken, true);
    assert.equal(signal.hasWorkspace, true);
    assert.equal(signal.hasBrowserProfile, true);
});

test('builds a UI state with provider detection, env auth and masked key', () => {
    const env = {
        OPENAI_API_KEY: 'test-openai-secret',
    };
    const state = buildOpenClawUiState({
        settings: sanitizeOpenClawSettings({}, env),
        configPath: '',
        env,
    });

    assert.equal(state.settings.provider, 'openai');
    assert.equal(state.settings.providerLabel, 'OpenAI');
    assert.equal(state.settings.apiKeyConfigured, true);
    assert.equal(state.ready, false);
    assert.equal(state.shouldPromptSetup, true);
    assert.notEqual(state.settings.apiKeyMasked, 'test-openai-secret');
    assert.ok(state.auth.fingerprint.length > 10);
});

test('normalizes provider aliases and builds provider env correctly', () => {
    assert.equal(normalizeOpenClawProvider('Google'), 'gemini');
    assert.equal(detectOpenClawProviderFromEnv({
        GEMINI_API_KEY: 'test-gemini-key',
    }), 'gemini');
    assert.equal(detectOpenClawProviderFromApiKey('sk-or-v1-abc123'), 'openrouter');
    assert.equal(normalizeOpenClawModel('nemotron-3-super'), 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
    assert.equal(detectOpenClawModelFromEnv({
        IU_OPENCLAW_MODEL_PRIMARY: 'nemotron-3-super',
    }), 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');

    const providerEnv = buildOpenClawProviderEnv({
        provider: 'gemini',
        apiKey: 'test-gemini-key',
    });
    assert.deepEqual(providerEnv, {
        GEMINI_API_KEY: 'test-gemini-key',
        GOOGLE_API_KEY: 'test-gemini-key',
    });
    assert.equal(OPENCLAW_MODEL_OPTIONS.find((option) => option.value === 'openrouter/nvidia/nemotron-3-super-120b-a12b:free')?.label, 'Nemotron 3 Super (OpenRouter)');
});

test('defaults OpenRouter to Nemotron 3 Super when no model is selected', () => {
    const settings = sanitizeOpenClawSettings({
        provider: 'openrouter',
        apiKey: 'test-openrouter-key',
    }, {});

    assert.equal(settings.modelPrimary, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
    const state = buildOpenClawUiState({
        settings,
        configPath: '',
        env: {},
    });
    assert.equal(state.settings.modelPrimary, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
    assert.equal(state.settings.modelLabel, 'Nemotron 3 Super (OpenRouter)');
});

test('infers OpenRouter from an OpenRouter api key even when provider was left on default', () => {
    const settings = sanitizeOpenClawSettings({
        provider: 'anthropic',
        apiKey: 'sk-or-v1-test-openrouter-key',
    }, {
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        OPENROUTER_API_KEY: 'test-openrouter-key',
    });

    assert.equal(settings.provider, 'openrouter');
    assert.equal(settings.modelPrimary, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
});

test('builds an isolated OpenClaw runtime env that strips unrelated provider keys', () => {
    const runtimeEnv = buildOpenClawRuntimeEnv({
        provider: 'openrouter',
        apiKey: 'sk-or-v1-test-openrouter-key',
        modelPrimary: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    }, {
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        OPENAI_API_KEY: 'test-openai-key',
        OPENROUTER_API_KEY: 'test-openrouter-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    });

    assert.equal(runtimeEnv.ANTHROPIC_API_KEY, undefined);
    assert.equal(runtimeEnv.OPENAI_API_KEY, undefined);
    assert.equal(runtimeEnv.OPENROUTER_API_KEY, 'sk-or-v1-test-openrouter-key');
    assert.equal(runtimeEnv.IU_OPENCLAW_MODEL_PRIMARY, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
    assert.equal(runtimeEnv.OPENROUTER_MODEL, 'openrouter/nvidia/nemotron-3-super-120b-a12b:free');
    assert.equal(runtimeEnv.OPENROUTER_BASE_URL, 'https://openrouter.ai/api/v1');
});

test('resolves auth from runtime settings before falling back to env', () => {
    const resolved = resolveOpenClawProviderApiKey({
        provider: 'openrouter',
        runtimeApiKey: 'runtime-openrouter-key',
    }, {
        OPENROUTER_API_KEY: 'env-openrouter-key',
    });

    assert.deepEqual(resolved, {
        provider: 'openrouter',
        apiKey: 'runtime-openrouter-key',
    });
    assert.equal(fingerprintOpenClawAuth({
        provider: 'openrouter',
        runtimeApiKey: 'runtime-openrouter-key',
    }, {
        OPENROUTER_API_KEY: 'env-openrouter-key',
    }).length > 10, true);
    assert.equal(maskOpenClawApiKey('short'), 'sh***rt');
});

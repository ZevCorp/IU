'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseEnvText,
    readEnvFile,
    upsertEnvFile,
    resolveInceptionConfig,
    maskSecret
} = require('../InceptionEnv');
const {
    extractPotentialApiKeys,
    detectInceptionPageState
} = require('../InceptionPageState');

test('parseEnvText parses plain env files', () => {
    const parsed = parseEnvText('# comment\nINCEPTION_API_KEY=test_123\nBRAIN_CHAT_PROVIDER=inception\n');
    assert.equal(parsed.INCEPTION_API_KEY, 'test_123');
    assert.equal(parsed.BRAIN_CHAT_PROVIDER, 'inception');
});

test('upsertEnvFile preserves existing keys and appends new ones', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-inception-env-'));
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'OPENAI_API_KEY=sk-test\n');

    upsertEnvFile(envPath, {
        INCEPTION_API_KEY: 'incep_test_ABC123456789',
        BRAIN_CHAT_PROVIDER: 'inception'
    });

    const read = readEnvFile(envPath);
    assert.equal(read.OPENAI_API_KEY, 'sk-test');
    assert.equal(read.INCEPTION_API_KEY, 'incep_test_ABC123456789');
    assert.equal(read.BRAIN_CHAT_PROVIDER, 'inception');
});

test('resolveInceptionConfig prefers personal key over bootstrap key', () => {
    const config = resolveInceptionConfig({
        INCEPTION_API_KEY: 'personal-key',
        IU_BOOTSTRAP_INCEPTION_API_KEY: 'shared-key'
    });

    assert.equal(config.activeKey, 'personal-key');
    assert.equal(config.hasPersonalKey, true);
    assert.equal(config.hasBootstrapKey, true);
});

test('maskSecret keeps edges only', () => {
    assert.equal(maskSecret('abcdefghijklmnop'), 'abcdef...mnop');
});

test('extractPotentialApiKeys finds contextual candidates', () => {
    const keys = extractPotentialApiKeys({
        text: 'Your API key is incep_test_ABC123456789_SUPERSECRET and can be copied now.'
    });

    assert.deepEqual(keys, ['incep_test_ABC123456789_SUPERSECRET']);
});

test('detectInceptionPageState requests user turn on login pages', () => {
    const state = detectInceptionPageState({
        url: 'https://platform.inceptionlabs.ai/login',
        title: 'Sign in - Inception',
        text: 'Continue with Google to access your dashboard'
    });

    assert.equal(state.stage, 'login_required');
    assert.equal(state.requiresUserTurn, true);
});

test('detectInceptionPageState marks visible keys when candidates exist', () => {
    const state = detectInceptionPageState({
        url: 'https://platform.inceptionlabs.ai/api-keys',
        title: 'API Keys',
        text: 'Copy your API key',
        candidates: ['incep_test_VISIBLEKEY_1234567890ABCD']
    });

    assert.equal(state.stage, 'key_visible');
    assert.deepEqual(state.potentialApiKeys, ['incep_test_VISIBLEKEY_1234567890ABCD']);
});

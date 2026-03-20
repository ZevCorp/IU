'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_INCEPTION_BASE_URL = 'https://api.inceptionlabs.ai/v1';
const DEFAULT_INCEPTION_MODEL = 'mercury';
const DEFAULT_INCEPTION_ONBOARDING_URL = 'https://platform.inceptionlabs.ai/';

function normalizeEnvValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\r?\n/g, '\\n');
}

function parseEnvText(text) {
    const result = {};
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;
        const key = line.slice(0, eqIndex).trim();
        const value = line.slice(eqIndex + 1).trim();
        if (!key) continue;
        result[key] = value.replace(/^["']|["']$/g, '');
    }
    return result;
}

function readEnvFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return {};
        return parseEnvText(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return {};
    }
}

function upsertEnvFile(filePath, updates) {
    const targetPath = path.resolve(filePath);
    const existingText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    const lines = existingText ? existingText.split(/\r?\n/) : [];
    const remaining = new Set(Object.keys(updates || {}).filter(Boolean));
    const nextLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) return line;
        const key = line.slice(0, eqIndex).trim();
        if (!remaining.has(key)) return line;
        remaining.delete(key);
        return `${key}=${normalizeEnvValue(updates[key])}`;
    });

    for (const key of remaining) {
        nextLines.push(`${key}=${normalizeEnvValue(updates[key])}`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${nextLines.join('\n').replace(/\n+$/g, '')}\n`);
}

function maskSecret(value) {
    const secret = String(value || '');
    if (!secret) return '';
    if (secret.length <= 10) return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
    return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function resolveInceptionConfig(env = process.env, fileEnv = {}) {
    const merged = { ...fileEnv, ...env };
    const personalKey = String(merged.INCEPTION_API_KEY || '').trim();
    const bootstrapKey = String(merged.IU_BOOTSTRAP_INCEPTION_API_KEY || '').trim();
    const baseUrl = String(merged.INCEPTION_BASE_URL || DEFAULT_INCEPTION_BASE_URL).trim() || DEFAULT_INCEPTION_BASE_URL;
    const model = String(merged.INCEPTION_MODEL || DEFAULT_INCEPTION_MODEL).trim() || DEFAULT_INCEPTION_MODEL;
    const onboardingUrl = String(merged.IU_INCEPTION_ONBOARDING_URL || DEFAULT_INCEPTION_ONBOARDING_URL).trim() || DEFAULT_INCEPTION_ONBOARDING_URL;

    return {
        personalKey,
        bootstrapKey,
        hasPersonalKey: Boolean(personalKey),
        hasBootstrapKey: Boolean(bootstrapKey),
        activeKey: personalKey || bootstrapKey || '',
        baseUrl,
        model,
        onboardingUrl
    };
}

module.exports = {
    DEFAULT_INCEPTION_BASE_URL,
    DEFAULT_INCEPTION_MODEL,
    DEFAULT_INCEPTION_ONBOARDING_URL,
    parseEnvText,
    readEnvFile,
    upsertEnvFile,
    maskSecret,
    resolveInceptionConfig
};

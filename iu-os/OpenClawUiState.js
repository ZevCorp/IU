'use strict';

const crypto = require('crypto');
const fs = require('fs');

const OPENCLAW_PROVIDER_OPTIONS = [
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'gemini', label: 'Gemini / Google' },
    { value: 'xai', label: 'xAI' },
];

const PROVIDER_ENV_KEYS = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    openrouter: ['OPENROUTER_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    xai: ['XAI_API_KEY'],
};

const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

const OPENCLAW_MODEL_OPTIONS = [
    { value: DEFAULT_OPENROUTER_MODEL, label: 'OpenRouter Auto (compatible)' },
];

function safeTrim(value) {
    return String(value || '').trim();
}

function safeReadJson(filePath = '') {
    const target = safeTrim(filePath);
    if (!target || !fs.existsSync(target)) return null;
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (_) {
        return null;
    }
}

function normalizeOpenClawProvider(value = '') {
    const normalized = safeTrim(value).toLowerCase();
    if (!normalized) return '';
    if (normalized === 'google') return 'gemini';
    if (normalized === 'gemini') return 'gemini';
    if (normalized === 'anthropic') return 'anthropic';
    if (normalized === 'openai') return 'openai';
    if (normalized === 'openrouter') return 'openrouter';
    if (normalized === 'xai') return 'xai';
    return '';
}

function normalizeOpenClawModel(value = '') {
    const normalized = safeTrim(value);
    if (!normalized) return '';
    const lowered = normalized.toLowerCase();
    if (
        lowered === 'nemotron-3-super' ||
        lowered === 'nemotron-3-super:free' ||
        lowered === 'nvidia/nemotron-3-super' ||
        lowered === 'nvidia/nemotron-3-super-120b-a12b' ||
        lowered === 'nvidia/nemotron-3-super-120b-a12b:free' ||
        lowered === 'openrouter/nvidia/nemotron-3-super-120b-a12b' ||
        lowered === 'openrouter/nvidia/nemotron-3-super-120b-a12b:free' ||
        lowered === 'openrouter/auto'
    ) {
        return DEFAULT_OPENROUTER_MODEL;
    }
    return normalized;
}

function detectOpenClawModelFromEnv(env = process.env) {
    return normalizeOpenClawModel(env.IU_OPENCLAW_MODEL_PRIMARY || env.OPENROUTER_MODEL || '');
}

function detectOpenClawProviderFromApiKey(value = '') {
    const secret = safeTrim(value);
    if (!secret) return '';
    if (secret.startsWith('sk-or-v1-')) return 'openrouter';
    if (secret.startsWith('sk-ant-')) return 'anthropic';
    if (secret.startsWith('sk-proj-') || secret.startsWith('sk-')) return 'openai';
    if (/^AIza/i.test(secret)) return 'gemini';
    return '';
}

function detectOpenClawProviderFromEnv(env = process.env) {
    if (safeTrim(env.ANTHROPIC_API_KEY)) return 'anthropic';
    if (safeTrim(env.OPENAI_API_KEY)) return 'openai';
    if (safeTrim(env.OPENROUTER_API_KEY)) return 'openrouter';
    if (safeTrim(env.GEMINI_API_KEY) || safeTrim(env.GOOGLE_API_KEY)) return 'gemini';
    if (safeTrim(env.XAI_API_KEY)) return 'xai';
    return '';
}

function sanitizeOpenClawSettings(settings = {}, env = process.env) {
    const apiKey = safeTrim(settings.apiKey);
    const runtimeApiKey = safeTrim(settings.runtimeApiKey);
    const providerFromKey = detectOpenClawProviderFromApiKey(runtimeApiKey || apiKey);
    let provider = normalizeOpenClawProvider(settings.provider) || detectOpenClawProviderFromEnv(env) || 'anthropic';
    if (providerFromKey && (provider === 'anthropic' || provider === providerFromKey || !settings.provider)) {
        provider = providerFromKey;
    }
    return {
        provider,
        apiKey,
        runtimeApiKey,
        rememberApiKey: settings.rememberApiKey !== false,
        lastConfiguredAt: safeTrim(settings.lastConfiguredAt),
        modelPrimary: normalizeOpenClawModel(settings.modelPrimary) || (provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : detectOpenClawModelFromEnv(env)),
    };
}

function maskOpenClawApiKey(value = '') {
    const secret = safeTrim(value);
    if (!secret) return '';
    if (secret.length <= 10) {
        return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
    }
    return `${secret.slice(0, 6)}...${secret.slice(-4)}`;
}

function resolveOpenClawProviderApiKey(settings = {}, env = process.env) {
    const provider = normalizeOpenClawProvider(settings.provider) || detectOpenClawProviderFromEnv(env) || 'anthropic';
    const runtimeApiKey = safeTrim(settings.runtimeApiKey);
    const persistedApiKey = safeTrim(settings.apiKey);
    if (runtimeApiKey) {
        return { provider, apiKey: runtimeApiKey };
    }
    if (persistedApiKey) {
        return { provider, apiKey: persistedApiKey };
    }

    const envKeys = PROVIDER_ENV_KEYS[provider] || [];
    for (const key of envKeys) {
        const value = safeTrim(env[key]);
        if (value) {
            return { provider, apiKey: value };
        }
    }
    return { provider, apiKey: '' };
}

function buildOpenClawProviderEnv(settings = {}, env = process.env) {
    const { provider, apiKey } = resolveOpenClawProviderApiKey(settings, env);
    if (!provider || !apiKey) return {};

    if (provider === 'gemini') {
        return {
            GEMINI_API_KEY: apiKey,
            GOOGLE_API_KEY: apiKey,
        };
    }

    const envKeys = PROVIDER_ENV_KEYS[provider] || [];
    if (envKeys.length === 0) return {};
    return { [envKeys[0]]: apiKey };
}

function buildOpenClawRuntimeEnv(settings = {}, env = process.env) {
    const sanitized = sanitizeOpenClawSettings(settings, env);
    const nextEnv = {
        ...env,
    };
    for (const keys of Object.values(PROVIDER_ENV_KEYS)) {
        for (const key of keys) {
            delete nextEnv[key];
        }
    }
    Object.assign(nextEnv, buildOpenClawProviderEnv(sanitized, env));
    if (sanitized.provider === 'openrouter' && sanitized.modelPrimary) {
        nextEnv.IU_OPENCLAW_MODEL_PRIMARY = sanitized.modelPrimary;
        nextEnv.OPENROUTER_MODEL = sanitized.modelPrimary;
    } else {
        delete nextEnv.IU_OPENCLAW_MODEL_PRIMARY;
        delete nextEnv.OPENROUTER_MODEL;
    }
    return nextEnv;
}

function fingerprintOpenClawAuth(settings = {}, env = process.env) {
    const { provider, apiKey } = resolveOpenClawProviderApiKey(settings, env);
    if (!provider || !apiKey) return '';
    return crypto.createHash('sha256').update(`${provider}:${apiKey}`).digest('hex');
}

function readOpenClawSetupSignal(configPath = '') {
    const targetPath = safeTrim(configPath);
    const config = safeReadJson(targetPath);
    if (!targetPath || !fs.existsSync(targetPath)) {
        return {
            ready: false,
            status: 'missing_config',
            reason: 'missing_config',
            configPath: targetPath,
            config: null,
            wizard: null,
            hasWizard: false,
            hasGatewayToken: false,
            summary: 'OpenClaw todavía no tiene un openclaw.json inicial.',
        };
    }

    if (!config || typeof config !== 'object') {
        return {
            ready: false,
            status: 'invalid_config',
            reason: 'invalid_config',
            configPath: targetPath,
            config: null,
            wizard: null,
            hasWizard: false,
            hasGatewayToken: false,
            summary: 'openclaw.json existe, pero no pude leerlo.',
        };
    }

    const wizard = config.wizard && typeof config.wizard === 'object' ? config.wizard : null;
    const hasWizard = Boolean(safeTrim(wizard?.lastRunAt));
    const hasGatewayToken = Boolean(safeTrim(config?.gateway?.auth?.token));
    const hasWorkspace = Boolean(safeTrim(config?.agents?.defaults?.workspace));
    const hasBrowserProfile = Boolean(safeTrim(config?.browser?.defaultProfile));
    const ready = hasWizard && hasGatewayToken && hasWorkspace && hasBrowserProfile;
    const status = ready ? 'ready' : 'needs_onboarding';
    const reason = ready ? 'ready' : (hasWizard ? 'incomplete_config' : 'wizard_missing');
    const summary = ready
        ? 'OpenClaw ya quedó inicializado y su wizard está registrado.'
        : hasWizard
            ? 'OpenClaw tiene config, pero aún le faltan señales de bootstrap completas.'
            : 'OpenClaw aún no registra un onboarding inicial.';

    return {
        ready,
        status,
        reason,
        configPath: targetPath,
        config,
        wizard,
        hasWizard,
        hasGatewayToken,
        hasWorkspace,
        hasBrowserProfile,
        summary,
    };
}

function buildOpenClawUiState({
    settings = {},
    configPath = '',
    env = process.env,
} = {}) {
    const sanitizedSettings = sanitizeOpenClawSettings(settings, env);
    const setupSignal = readOpenClawSetupSignal(configPath);
    const provider = sanitizedSettings.provider;
    const apiKey = resolveOpenClawProviderApiKey(sanitizedSettings, env).apiKey;
    const modelPrimary = provider === 'openrouter' ? normalizeOpenClawModel(sanitizedSettings.modelPrimary) : '';
    return {
        settings: {
            provider,
            providerLabel: OPENCLAW_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label || provider,
            apiKeyMasked: maskOpenClawApiKey(apiKey),
            apiKeyConfigured: Boolean(apiKey),
            rememberApiKey: sanitizedSettings.rememberApiKey,
            lastConfiguredAt: sanitizedSettings.lastConfiguredAt,
            modelPrimary,
            modelLabel: OPENCLAW_MODEL_OPTIONS.find((option) => option.value === modelPrimary)?.label || (modelPrimary ? modelPrimary : 'Automático'),
        },
        setup: setupSignal,
        ready: setupSignal.ready,
        shouldPromptSetup: !setupSignal.ready,
        auth: {
            provider,
            fingerprint: fingerprintOpenClawAuth(sanitizedSettings, env),
        },
    };
}

module.exports = {
    OPENCLAW_PROVIDER_OPTIONS,
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
};

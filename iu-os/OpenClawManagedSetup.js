'use strict';

const fs = require('fs');
const path = require('path');
const { execOpenClawCli } = require('./OpenClawProcessRunner');
const { buildManagedBrowserProfile } = require('./OpenClawRuntimeConfig');

const SETUP_SCHEMA_VERSION = 1;

function safeTrim(value) {
    return String(value || '').trim();
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
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

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveAuthChoice(env = process.env) {
    if (safeTrim(env.ANTHROPIC_API_KEY)) {
        return {
            choice: 'apiKey',
            args: ['--anthropic-api-key', safeTrim(env.ANTHROPIC_API_KEY)],
        };
    }
    if (safeTrim(env.OPENAI_API_KEY)) {
        return {
            choice: 'openai-api-key',
            args: ['--openai-api-key', safeTrim(env.OPENAI_API_KEY)],
        };
    }
    if (safeTrim(env.OPENROUTER_API_KEY)) {
        return {
            choice: 'openrouter-api-key',
            args: ['--openrouter-api-key', safeTrim(env.OPENROUTER_API_KEY)],
        };
    }
    if (safeTrim(env.GEMINI_API_KEY)) {
        return {
            choice: 'gemini-api-key',
            args: ['--gemini-api-key', safeTrim(env.GEMINI_API_KEY)],
        };
    }
    if (safeTrim(env.GOOGLE_API_KEY)) {
        return {
            choice: 'gemini-api-key',
            args: ['--gemini-api-key', safeTrim(env.GOOGLE_API_KEY)],
        };
    }
    if (safeTrim(env.XAI_API_KEY)) {
        return {
            choice: 'xai-api-key',
            args: ['--xai-api-key', safeTrim(env.XAI_API_KEY)],
        };
    }
    return {
        choice: 'skip',
        args: [],
    };
}

function buildManagedOnboardingArgs(runtime = {}) {
    const auth = resolveAuthChoice(runtime.launchEnv || process.env);
    const workspaceDir = safeTrim(runtime.workspaceDir) || path.join(runtime.stateDir, 'workspace');
    const profile = safeTrim(runtime.profileId) || 'iu';
    const args = [
        '--profile', profile,
        'onboard',
        '--non-interactive',
        '--accept-risk',
        '--mode', 'local',
        '--flow', 'quickstart',
        '--workspace', workspaceDir,
        '--gateway-port', String(runtime.gatewayPort),
        '--gateway-bind', 'loopback',
        '--gateway-auth', 'token',
        '--gateway-token', safeTrim(runtime.authToken),
        '--install-daemon',
        '--daemon-runtime', 'node',
        '--skip-channels',
        '--skip-skills',
        '--skip-ui',
        '--skip-health',
        '--json',
        '--auth-choice', auth.choice,
        ...auth.args,
    ];
    return args;
}

function buildManagedSetupStamp(runtime = {}) {
    return {
        schemaVersion: SETUP_SCHEMA_VERSION,
        completedAt: new Date().toISOString(),
        packageVersion: safeTrim(runtime.packageVersion) || 'unknown',
        profileId: safeTrim(runtime.profileId) || 'iu',
        configPath: safeTrim(runtime.configPath),
        stateDir: safeTrim(runtime.stateDir),
        gatewayPort: Number(runtime.gatewayPort) || 18789,
        modelPrimary: safeTrim(runtime.modelPrimary),
    };
}

function patchManagedConfig(runtime = {}) {
    const configPath = safeTrim(runtime.configPath);
    if (!configPath) {
        throw new Error('No pude resolver openclaw.json para aplicar el setup gestionado.');
    }

    const existing = safeReadJson(configPath) || {};
    const managedProfile = safeTrim(runtime.managedProfile) || 'openclaw';
    const workspaceDir = safeTrim(runtime.workspaceDir) || path.join(runtime.stateDir, 'workspace');
    const authToken = safeTrim(runtime.authToken);
    const gatewayUrl = safeTrim(runtime.gatewayUrl);

    const next = {
        ...existing,
        gateway: {
            ...(existing.gateway && typeof existing.gateway === 'object' ? existing.gateway : {}),
            mode: 'local',
            bind: 'loopback',
            port: Number(runtime.gatewayPort) || 18789,
            auth: {
                ...((existing.gateway && existing.gateway.auth && typeof existing.gateway.auth === 'object') ? existing.gateway.auth : {}),
                mode: 'token',
                token: authToken,
            },
        },
        browser: {
            ...(existing.browser && typeof existing.browser === 'object' ? existing.browser : {}),
            enabled: true,
            color: safeTrim(existing?.browser?.color) || '#FF4500',
            defaultProfile: managedProfile,
            profiles: {
                ...((existing.browser && existing.browser.profiles && typeof existing.browser.profiles === 'object') ? existing.browser.profiles : {}),
                [managedProfile]: buildManagedBrowserProfile((((existing.browser && existing.browser.profiles) || {})[managedProfile] || {}), runtime.gatewayPort),
            },
        },
        agents: {
            ...(existing.agents && typeof existing.agents === 'object' ? existing.agents : {}),
            defaults: {
                ...((existing.agents && existing.agents.defaults && typeof existing.agents.defaults === 'object') ? existing.agents.defaults : {}),
                workspace: workspaceDir,
                model: safeTrim(runtime.modelPrimary)
                    ? { primary: safeTrim(runtime.modelPrimary) }
                    : (((existing.agents || {}).defaults || {}).model || {}),
            },
        },
        wizard: {
            ...((existing.wizard && typeof existing.wizard === 'object') ? existing.wizard : {}),
            lastRunMode: safeTrim(existing?.wizard?.lastRunMode) || 'local',
            lastRunCommand: safeTrim(existing?.wizard?.lastRunCommand) || 'openclaw onboard --non-interactive',
        },
    };

    writeJson(configPath, next);
    return next;
}

async function ensureManagedOpenClawSetup(runtime = {}, options = {}) {
    if (runtime.managedByIU !== true) {
        return {
            changed: false,
            onboarded: false,
            configPatched: false,
            reason: 'external-install',
        };
    }

    const stampPath = safeTrim(options.stampPath) || path.join(runtime.stateDir, 'iu-managed-setup.json');
    const stamp = safeReadJson(stampPath);
    const needsOnboard = !stamp ||
        Number(stamp.schemaVersion) !== SETUP_SCHEMA_VERSION ||
        safeTrim(stamp.packageVersion) !== safeTrim(runtime.packageVersion) ||
        safeTrim(stamp.profileId) !== safeTrim(runtime.profileId);

    let onboarded = false;
    if (needsOnboard) {
        const args = buildManagedOnboardingArgs(runtime);
        if (typeof options.log === 'function') {
            options.log(`Running managed OpenClaw onboarding: ${args.join(' ')}`);
        }
        await execOpenClawCli(runtime.cliPath, args, {
            env: runtime.launchEnv,
            timeout: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 180000,
            maxBuffer: 16 * 1024 * 1024,
        });
        onboarded = true;
    }

    patchManagedConfig(runtime);
    writeJson(stampPath, buildManagedSetupStamp(runtime));
    return {
        changed: onboarded || needsOnboard,
        onboarded,
        configPatched: true,
        stampPath,
    };
}

module.exports = {
    SETUP_SCHEMA_VERSION,
    buildManagedOnboardingArgs,
    buildManagedSetupStamp,
    ensureManagedOpenClawSetup,
    patchManagedConfig,
    resolveAuthChoice,
};

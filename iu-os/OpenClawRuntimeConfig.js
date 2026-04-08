'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomBytes } = require('crypto');

const MANAGED_GATEWAY_PORT = 18795;

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

function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function deriveGatewayPort(baseUrl = '') {
    try {
        const parsed = new URL(String(baseUrl || '').trim());
        const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
        if (Number.isFinite(port) && port > 2) {
            return port - 2;
        }
    } catch (_) {
        // Ignore invalid urls.
    }
    return MANAGED_GATEWAY_PORT;
}

function buildGatewayUrl(gatewayPort) {
    return `ws://127.0.0.1:${gatewayPort}`;
}

function resolveDefaultModel(env = process.env) {
    const explicit = safeTrim(env.IU_OPENCLAW_MODEL_PRIMARY);
    if (explicit) return explicit;
    if (safeTrim(env.ANTHROPIC_API_KEY)) return 'anthropic/claude-sonnet-4-5';
    if (safeTrim(env.OPENAI_API_KEY)) return 'openai/gpt-5-mini';
    if (safeTrim(env.GEMINI_API_KEY) || safeTrim(env.GOOGLE_API_KEY)) return 'google/gemini-2.5-flash';
    return '';
}

function pickManagedEnv(env = process.env) {
    const keys = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'GOOGLE_API_KEY',
        'GEMINI_API_KEY',
        'XAI_API_KEY',
        'MISTRAL_API_KEY',
        'DEEPSEEK_API_KEY',
    ];
    const result = {};
    for (const key of keys) {
        const value = safeTrim(env[key]);
        if (value) result[key] = value;
    }
    return result;
}

function resolveUserProfileAlias(profiles = {}) {
    return Object.entries(profiles || {}).find(([, profile]) => profile?.driver === 'existing-session')?.[0] || 'user';
}

function deriveManagedCdpPort(gatewayPort) {
    const basePort = Number(gatewayPort) || MANAGED_GATEWAY_PORT;
    return basePort + 11;
}

function buildManagedBrowserProfile(existingProfile = {}, gatewayPort) {
    return {
        ...(existingProfile && typeof existingProfile === 'object' ? existingProfile : {}),
        cdpPort: Number(existingProfile?.cdpPort) || deriveManagedCdpPort(gatewayPort),
        color: safeTrim(existingProfile?.color) || '#FF4500',
    };
}

function buildManagedConfig(options = {}) {
    const existing = options.existingConfig && typeof options.existingConfig === 'object'
        ? options.existingConfig
        : {};
    const existingBrowser = existing.browser && typeof existing.browser === 'object' ? existing.browser : {};
    const existingProfiles = existingBrowser.profiles && typeof existingBrowser.profiles === 'object'
        ? existingBrowser.profiles
        : {};
    const workspaceDir = safeTrim(options.workspaceDir) || path.join(options.stateDir, 'workspace');
    const managedProfile = safeTrim(options.managedProfile) || 'openclaw';
    const modelPrimary = safeTrim(options.modelPrimary)
        || safeTrim(existing?.agents?.defaults?.model?.primary)
        || '';
    const nextConfig = {
        gateway: {
            mode: 'local',
            bind: 'loopback',
            port: options.gatewayPort,
            auth: {
                mode: 'token',
                token: options.authToken,
            },
        },
        browser: {
            enabled: true,
            color: safeTrim(existingBrowser?.color) || '#FF4500',
            defaultProfile: managedProfile,
            profiles: {
                [managedProfile]: buildManagedBrowserProfile(existingProfiles[managedProfile] || {}, options.gatewayPort),
            },
        },
        env: {
            ...(existing.env && typeof existing.env === 'object' ? existing.env : {}),
            ...pickManagedEnv(options.env),
        },
        agents: {
            defaults: {
                workspace: workspaceDir,
                model: modelPrimary ? { primary: modelPrimary } : cloneJson(existing?.agents?.defaults?.model || {}),
            },
        },
    };
    return nextConfig;
}

function buildLaunchEnv(baseEnv = process.env, runtime = {}) {
    return {
        ...baseEnv,
        ...(runtime.config?.env && typeof runtime.config.env === 'object' ? runtime.config.env : {}),
        OPENCLAW_HOME: runtime.homeDir,
        OPENCLAW_STATE_DIR: runtime.stateDir,
        OPENCLAW_CONFIG_PATH: runtime.configPath,
        OPENCLAW_PROFILE: runtime.profileId,
        IU_OPENCLAW_CLI_PATH: runtime.cliPath,
        IU_OPENCLAW_NODE_PATH: runtime.nodePath,
        IU_OPENCLAW_PACKAGE_ROOT: runtime.packageRoot,
        IU_OPENCLAW_PROFILE: runtime.profileId,
        IU_OPENCLAW_GATEWAY_TOKEN: runtime.authToken,
        OPENCLAW_GATEWAY_TOKEN: runtime.authToken,
    };
}

function resolveOpenClawRuntimeConfig(options = {}) {
    const installInfo = options.installInfo || {};
    const env = options.env || process.env;
    const explicitConfigPath = safeTrim(env.IU_OPENCLAW_CONFIG_PATH);
    const explicitHomeDir = safeTrim(env.IU_OPENCLAW_HOME);
    const managedStateDir = safeTrim(options.managedStateDir);
    const isManaged = installInfo.installedByIU === true;

    let homeDir = explicitHomeDir;
    let stateDir = safeTrim(env.OPENCLAW_STATE_DIR);
    let configPath = explicitConfigPath;

    if (configPath && !stateDir) {
        stateDir = path.dirname(configPath);
    }
    if (!homeDir && stateDir) {
        homeDir = stateDir;
    }

    if (!homeDir) {
        homeDir = isManaged
            ? (managedStateDir || path.join(os.homedir(), '.openclaw-iu'))
            : path.join(os.homedir(), '.openclaw');
    }
    if (!stateDir) {
        stateDir = homeDir;
    }
    if (!configPath) {
        configPath = path.join(stateDir, 'openclaw.json');
    }

    const existingConfig = safeReadJson(configPath) || {};
    const managedProfile = safeTrim(env.IU_OPENCLAW_BROWSER_PROFILE)
        || safeTrim(existingConfig?.browser?.defaultProfile)
        || 'openclaw';
    const profileId = safeTrim(env.IU_OPENCLAW_PROFILE)
        || safeTrim(env.OPENCLAW_PROFILE)
        || (isManaged ? 'iu' : 'default');
    const configuredGatewayPort = Number.parseInt(safeTrim(env.IU_OPENCLAW_GATEWAY_PORT), 10);
    const defaultGatewayPort = isManaged ? MANAGED_GATEWAY_PORT : 18789;
    const gatewayPort = Number.isFinite(configuredGatewayPort) && configuredGatewayPort > 0
        ? configuredGatewayPort
        : (Number(existingConfig?.gateway?.port) || defaultGatewayPort);
    const authToken = safeTrim(env.IU_OPENCLAW_GATEWAY_TOKEN)
        || safeTrim(existingConfig?.gateway?.auth?.token)
        || randomBytes(24).toString('hex');
    const modelPrimary = resolveDefaultModel(env) || safeTrim(existingConfig?.agents?.defaults?.model?.primary);
    const runtime = {
        homeDir,
        stateDir,
        configPath,
        managedProfile,
        profileId,
        userProfile: safeTrim(env.IU_OPENCLAW_BROWSER_USER_PROFILE)
            || resolveUserProfileAlias(existingConfig?.browser?.profiles)
            || 'user',
        gatewayPort,
        authToken,
        gatewayUrl: buildGatewayUrl(gatewayPort),
        cliPath: safeTrim(installInfo.cliPath),
        nodePath: safeTrim(installInfo.nodePath),
        packageRoot: safeTrim(installInfo.packageRoot),
        packageVersion: safeTrim(installInfo.version),
        modelPrimary,
        managedByIU: isManaged,
        installedByIU: isManaged,
        config: existingConfig,
        workspaceDir: path.join(stateDir, 'workspace'),
    };

    if (isManaged) {
        ensureDir(stateDir);
        ensureDir(path.join(stateDir, 'workspace'));
        runtime.config = buildManagedConfig({
            existingConfig,
            env,
            stateDir,
            workspaceDir: runtime.workspaceDir,
            managedProfile,
            gatewayPort,
            authToken,
            modelPrimary,
        });
        fs.writeFileSync(configPath, `${JSON.stringify(runtime.config, null, 2)}\n`, 'utf8');
    }

    runtime.clientOptions = {
        baseUrl: safeTrim(env.IU_OPENCLAW_BROWSER_BASE_URL) || `http://127.0.0.1:${gatewayPort + 2}`,
        authToken,
        backend: 'openclaw',
        defaultProfile: managedProfile,
        profileAliases: {
            managed: managedProfile,
            user: runtime.userProfile,
        },
    };
    runtime.gatewayUrl = safeTrim(env.IU_OPENCLAW_GATEWAY_URL) || buildGatewayUrl(deriveGatewayPort(runtime.clientOptions.baseUrl));
    runtime.launchEnv = buildLaunchEnv(env, runtime);
    return runtime;
}

module.exports = {
    MANAGED_GATEWAY_PORT,
    buildManagedBrowserProfile,
    deriveManagedCdpPort,
    resolveDefaultModel,
    resolveOpenClawRuntimeConfig,
    safeReadJson,
};

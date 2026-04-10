'use strict';

const fs = require('fs');
const path = require('path');
const { execOpenClawCli } = require('./OpenClawProcessRunner');

function normalizeProfileName(profileName) {
    const normalized = String(profileName || '').trim().toLowerCase();
    return normalized === 'user' ? 'user' : 'managed';
}

function appendFlag(args, flag, value) {
    if (value === undefined || value === null || value === '') return;
    args.push(flag, String(value));
}

function computeSnapshotStats(snapshot, refsCount) {
    const lines = snapshot ? snapshot.split('\n').length : 0;
    return {
        lines,
        chars: snapshot.length,
        refs: refsCount,
        interactive: refsCount,
    };
}

function parsePort(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return Number.parseInt(parsed.port || '', 10) || 0;
    } catch (_) {
        return 0;
    }
}

function parseCliStatusOutput(rawText = '') {
    const result = {};
    String(rawText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
            const match = /^([^:]+):\s*(.*)$/.exec(line);
            if (!match) return;
            result[String(match[1] || '').trim()] = String(match[2] || '').trim();
        });
    return result;
}

function extractJsonPayload(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (_) {
        // Continue to relaxed parsing below.
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            return JSON.parse(text.slice(firstBrace, lastBrace + 1));
        } catch (_) {
            return null;
        }
    }
    return null;
}

class OpenClawCliBrowserClient {
    constructor(options = {}) {
        this.options = options;
        this.isOpenClawCliBackend = true;
        this.gatewayUrl = String(options.gatewayUrl || '').trim();
        this.authToken = String(options.authToken || '').trim();
        this.preferConfigGateway = options.preferConfigGateway === true;
        this.defaultProfile = String(options.defaultProfile || 'openclaw').trim() || 'openclaw';
        this.profileAliases = options.profileAliases || {};
        this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
            ? Math.max(1000, Number(options.requestTimeoutMs))
            : 45000;

        if (!this.gatewayUrl && !this.preferConfigGateway) {
            throw new Error('OpenClaw gateway URL is required');
        }
    }

    buildQuery(query = {}) {
        const params = new URLSearchParams();
        Object.entries(query || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            params.set(key, String(value));
        });
        return params.toString();
    }

    resolveOpenClawProfile(profile) {
        const aliases = this.profileAliases || {};
        const requested = String(profile || '').trim();
        if (requested === 'managed') {
            return aliases.managed || this.defaultProfile || 'openclaw';
        }
        if (requested === 'user') {
            return aliases.user || 'user';
        }
        return requested || this.defaultProfile || aliases.managed || 'openclaw';
    }

    buildConnectParams(nonce) {
        return {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: 'cli',
                version: '1.0.0',
                platform: process.platform,
                mode: 'cli',
            },
            caps: [],
            commands: [],
            role: 'operator',
            // Newer gateway builds can require explicit operator.write for
            // browser.request even when operator.admin is present.
            scopes: [
                'operator.admin',
                'operator.read',
                'operator.write',
                'operator.approvals',
                'operator.pairing',
            ],
            auth: this.authToken ? { token: this.authToken } : undefined,
        };
    }

    buildCliEnv() {
        const env = {
            ...process.env,
            ...(this.options.env && typeof this.options.env === 'object' ? this.options.env : {}),
        };
        const cliDir = path.dirname(String(this.options.cliPath || '').trim());
        if (cliDir) {
            const currentPath = String(env.PATH || '');
            const entries = currentPath.split(path.delimiter).filter(Boolean);
            env.PATH = [cliDir, ...entries.filter((entry) => entry !== cliDir)].join(path.delimiter);
        }
        if (this.options.homeDir) {
            env.OPENCLAW_HOME = this.options.homeDir;
        }
        if (this.options.stateDir) {
            env.OPENCLAW_STATE_DIR = this.options.stateDir;
        }
        if (this.options.configPath) {
            env.OPENCLAW_CONFIG_PATH = this.options.configPath;
        }
        return env;
    }

    async tryCliStatus(profile = 'managed') {
        const cliPath = String(this.options.cliPath || '').trim();
        if (!cliPath) {
            return null;
        }

        const resolvedProfile = this.resolveOpenClawProfile(profile);
        const { stdout } = await execOpenClawCli(
            cliPath,
            ['browser', '--browser-profile', resolvedProfile, 'status'],
            {
                env: this.buildCliEnv(),
                timeout: Math.max(1000, Math.min(15000, this.requestTimeoutMs)),
            }
        );

        const parsed = parseCliStatusOutput(stdout);
        const cdpUrl = String(parsed.cdpUrl || '').trim();
        const enabled = String(parsed.enabled || '').trim().toLowerCase() !== 'false';

        return {
            ok: true,
            enabled,
            defaultProfile: 'managed',
            servicePort: parsePort(cdpUrl),
            profiles: [
                this.mapOpenClawProfile('managed', { cdpUrl }),
                this.mapOpenClawProfile('user', {}),
            ],
            transport: parsed.transport || '',
            running: String(parsed.running || '').trim().toLowerCase() === 'true',
            browser: parsed.browser || '',
            detectedBrowser: parsed.detectedBrowser || '',
            detectedPath: parsed.detectedPath || '',
        };
    }

    async requestBrowser(method, pathName, options = {}) {
        const cliPath = String(this.options.cliPath || '').trim();
        if (!cliPath) {
            throw new Error('OpenClaw CLI path is required for browser requests');
        }
        const timeoutMs = Number.isFinite(options.timeoutMs)
            ? Math.max(1000, Number(options.timeoutMs))
            : this.requestTimeoutMs;
        const query = options.query && typeof options.query === 'object'
            ? Object.fromEntries(
                Object.entries(options.query).filter(([, value]) => (
                    value !== undefined &&
                    value !== null &&
                    value !== ''
                ))
            )
            : undefined;
        const args = ['gateway', 'call', 'browser.request', '--json', '--timeout', String(timeoutMs)];
        if (!this.preferConfigGateway) {
            appendFlag(args, '--url', this.gatewayUrl);
            appendFlag(args, '--token', this.authToken || undefined);
        }
        args.push('--params', JSON.stringify({
            method,
            path: pathName,
            query,
            body: options.body,
            timeoutMs,
        }));

        const { stdout, stderr } = await execOpenClawCli(cliPath, args, {
            env: this.buildCliEnv(),
            timeout: timeoutMs + 5000,
            maxBuffer: 8 * 1024 * 1024,
        });
        const payload = extractJsonPayload(stdout) || extractJsonPayload(stderr);
        if (payload === null) {
            const message = String(stderr || stdout || '').trim();
            throw new Error(message || 'OpenClaw browser.request did not return JSON');
        }
        return payload;
    }

    mapOpenClawProfile(profileName, remote = {}) {
        const actualDriver = remote.driver || (profileName === 'user' ? 'existing-session' : 'openclaw');
        const usesExistingSession = actualDriver === 'existing-session';
        return {
            name: profileName,
            mode: profileName,
            driver: usesExistingSession ? 'user-existing-session' : 'managed-cdp',
            cdpUrl: remote.cdpUrl || this.options.baseUrl || '',
            capabilities: {
                canLaunch: !usesExistingSession,
                canSnapshot: true,
                canAct: true,
                canObserve: true,
                requiresExistingSession: usesExistingSession,
            },
        };
    }

    mapOpenClawSnapshot(snapshot, profile) {
        const normalizedProfile = normalizeProfileName(profile);
        if (snapshot.format === 'ai') {
            const refs = snapshot.refs || {};
            const elements = Object.entries(refs).map(([ref, info]) => ({
                ref,
                key: `${info.role}:${info.name || ''}:${info.nth || 0}`,
                role: info.role,
                label: info.name || info.role,
                ...(info.name ? { name: info.name } : {}),
                ...(typeof info.nth === 'number' ? { nth: info.nth } : {}),
            }));
            return {
                ok: true,
                profile: normalizedProfile,
                format: 'ai',
                targetId: snapshot.targetId,
                url: snapshot.url,
                snapshot: snapshot.snapshot || '',
                refs: Object.fromEntries(elements.map((element) => {
                    const { ref, ...rest } = element;
                    return [ref, rest];
                })),
                stats: snapshot.stats || computeSnapshotStats(snapshot.snapshot || '', elements.length),
                ...(snapshot.truncated ? { truncated: true } : {}),
                elements,
            };
        }

        const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
        const snapshotText = nodes
            .map((node) => `${'  '.repeat(Math.max(0, Number(node.depth) || 0))}${node.ref} ${node.role} ${node.name || ''}`.trimEnd())
            .join('\n');
        const elements = nodes.map((node) => ({
            ref: node.ref,
            key: `${node.role}:${node.name || ''}:0`,
            role: node.role,
            label: node.name || node.role,
            ...(node.name ? { name: node.name } : {}),
        }));
        return {
            ok: true,
            profile: normalizedProfile,
            format: 'aria',
            targetId: snapshot.targetId,
            url: snapshot.url,
            snapshot: snapshotText,
            refs: Object.fromEntries(elements.map((element) => {
                const { ref, ...rest } = element;
                return [ref, rest];
            })),
            stats: computeSnapshotStats(snapshotText, elements.length),
            elements,
        };
    }

    async inferCurrentTab(profile, targetIdHint) {
        const response = await this.tabs(profile);
        const tabs = Array.isArray(response.tabs) ? response.tabs : [];
        if (targetIdHint) {
            const exact = tabs.find((tab) => tab.targetId === targetIdHint);
            if (exact) return exact;
            const prefixed = tabs.find((tab) => String(tab.targetId || '').startsWith(String(targetIdHint)));
            if (prefixed) return prefixed;
        }
        return tabs.find((tab) => tab.active) || tabs[0] || null;
    }

    async status() {
        let payload = {};
        let statusResolved = false;
        for (const pathName of ['/', '/status']) {
            try {
                payload = await this.requestBrowser('GET', pathName, {
                    query: { profile: this.resolveOpenClawProfile('managed') },
                    timeoutMs: 45000,
                });
                statusResolved = true;
                break;
            } catch (error) {
                const message = String(error?.message || error || '').trim();
                if (!/not found/i.test(message)) {
                    throw error;
                }
            }
        }
        const profiles = (await this.profiles()).profiles;
        return {
            ok: true,
            enabled: statusResolved ? payload.enabled !== false : true,
            defaultProfile: 'managed',
            servicePort: parsePort(this.options.baseUrl),
            profiles,
        };
    }

    async profiles() {
        const payload = await this.requestBrowser('GET', '/profiles', { timeoutMs: 45000 });
        const remoteProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
        const managedRemote =
            remoteProfiles.find((profile) => profile.name === this.resolveOpenClawProfile('managed')) ||
            remoteProfiles.find((profile) => profile.driver !== 'existing-session');
        const userRemote =
            remoteProfiles.find((profile) => profile.name === this.resolveOpenClawProfile('user')) ||
            remoteProfiles.find((profile) => profile.driver === 'existing-session');

        const profiles = [this.mapOpenClawProfile('managed', managedRemote)];
        if (userRemote || this.resolveOpenClawProfile('user')) {
            profiles.push(this.mapOpenClawProfile('user', userRemote));
        }
        return { ok: true, profiles };
    }

    async start(profile = 'managed', options = {}) {
        const payload = await this.requestBrowser('POST', '/start', {
            query: { profile: this.resolveOpenClawProfile(profile) },
            timeoutMs: Number.isFinite(options.timeoutMs)
                ? Math.max(1000, Number(options.timeoutMs))
                : 60000,
        });
        return {
            ok: true,
            profile: normalizeProfileName(profile),
            details: payload && typeof payload === 'object' ? payload : {},
        };
    }

    async tabs(profile) {
        const normalizedProfile = normalizeProfileName(profile);
        const payload = await this.requestBrowser('GET', '/tabs', {
            query: { profile: this.resolveOpenClawProfile(profile) },
            timeoutMs: 45000,
        });
        return {
            ok: true,
            profile: normalizedProfile,
            tabs: Array.isArray(payload.tabs) ? payload.tabs.map((tab) => ({
                targetId: tab.targetId,
                title: tab.title || '',
                url: tab.url || '',
                active: Boolean(tab.active),
            })) : [],
        };
    }

    async open(request) {
        const payload = await this.requestBrowser('POST', '/tabs/open', {
            query: { profile: this.resolveOpenClawProfile(request.profile) },
            body: { url: request.url },
            timeoutMs: 60000,
        });
        return {
            ok: true,
            profile: normalizeProfileName(request.profile),
            targetId: payload.targetId || '',
            url: payload.url || request.url,
        };
    }

    async navigate(request) {
        const payload = await this.requestBrowser('POST', '/navigate', {
            query: { profile: this.resolveOpenClawProfile(request.profile) },
            body: {
                url: request.url,
                targetId: request.targetId || undefined,
            },
            timeoutMs: request.timeoutMs || 60000,
        });
        const currentTab = await this.inferCurrentTab(request.profile, request.targetId);
        return {
            ok: true,
            profile: normalizeProfileName(request.profile),
            targetId: currentTab?.targetId || request.targetId || '',
            url: payload.url || currentTab?.url || request.url,
        };
    }

    async snapshot(request = {}) {
        const payload = await this.requestBrowser('GET', '/snapshot', {
            query: {
                profile: this.resolveOpenClawProfile(request.profile),
                format: request.format === 'aria' ? 'aria' : 'ai',
                targetId: request.targetId || undefined,
                maxChars: request.maxChars,
            },
            timeoutMs: 60000,
        });
        return this.mapOpenClawSnapshot(payload, request.profile);
    }

    async screenshot(request = {}) {
        const payload = await this.requestBrowser('POST', '/screenshot', {
            query: { profile: this.resolveOpenClawProfile(request.profile) },
            body: {
                targetId: request.targetId || undefined,
                fullPage: Boolean(request.fullPage),
                ref: request.ref || undefined,
                element: request.selector || undefined,
                type: request.type === 'jpeg' ? 'jpeg' : 'png',
            },
            timeoutMs: 60000,
        });
        const path = String(payload.path || '').trim();
        if (!path || !fs.existsSync(path)) {
            throw new Error('OpenClaw screenshot path was not generated');
        }
        const currentTab = await this.inferCurrentTab(request.profile, request.targetId);
        return {
            ok: true,
            profile: normalizeProfileName(request.profile),
            targetId: currentTab?.targetId || request.targetId || '',
            url: currentTab?.url || '',
            type: request.type === 'jpeg' ? 'jpeg' : 'png',
            data: fs.readFileSync(path, 'base64'),
        };
    }

    async console(profile, targetId) {
        const payload = await this.requestBrowser('GET', '/console', {
            query: {
                profile: this.resolveOpenClawProfile(profile),
                targetId: targetId || undefined,
            },
            timeoutMs: 45000,
        });
        return Array.isArray(payload.messages) ? payload.messages : [];
    }

    async network(profile, targetId) {
        const payload = await this.requestBrowser('GET', '/requests', {
            query: {
                profile: this.resolveOpenClawProfile(profile),
                targetId: targetId || undefined,
            },
            timeoutMs: 45000,
        });
        return Array.isArray(payload.requests) ? payload.requests : [];
    }

    async buildActionResult(profile, targetIdHint, payload = {}) {
        const currentTab = await this.inferCurrentTab(profile, targetIdHint || payload.targetId);
        return {
            ok: true,
            profile: normalizeProfileName(profile),
            targetId: payload.targetId || currentTab?.targetId || targetIdHint || '',
            url: payload.url || currentTab?.url || '',
            details: payload && typeof payload === 'object' ? payload : {},
        };
    }

    async runSingleAction(profile, request = {}) {
        const targetId = request.targetId;
        switch (request.kind) {
            case 'click': {
                if (!request.ref) throw new Error('OpenClaw click requires a ref');
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'click',
                        ref: request.ref,
                        targetId,
                        button: request.button || undefined,
                        doubleClick: Boolean(request.doubleClick),
                        modifiers: Array.isArray(request.modifiers) ? request.modifiers : undefined,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'type': {
                if (!request.ref) throw new Error('OpenClaw type requires a ref');
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'type',
                        ref: request.ref,
                        text: request.text || '',
                        targetId,
                        submit: Boolean(request.submit),
                        slowly: Boolean(request.slowly),
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'press': {
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'press',
                        key: request.key || 'Enter',
                        targetId,
                    },
                    timeoutMs: request.delayMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'hover': {
                if (!request.ref) throw new Error('OpenClaw hover requires a ref');
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'hover',
                        ref: request.ref,
                        targetId,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'scrollIntoView': {
                if (!request.ref) throw new Error('OpenClaw scrollIntoView requires a ref');
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'scrollIntoView',
                        ref: request.ref,
                        targetId,
                        timeoutMs: request.timeoutMs,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'select': {
                if (!request.ref) throw new Error('OpenClaw select requires a ref');
                const values = Array.isArray(request.value) ? request.value : [request.value];
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'select',
                        ref: request.ref,
                        value: values.map((value) => String(value)),
                        targetId,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'drag': {
                if (!request.startRef || !request.endRef) throw new Error('OpenClaw drag requires startRef and endRef');
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'drag',
                        startRef: request.startRef,
                        endRef: request.endRef,
                        targetId,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'wait': {
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'wait',
                        timeMs: request.timeMs,
                        selector: request.selector,
                        url: request.url,
                        loadState: request.loadState,
                        targetId,
                        timeoutMs: request.timeoutMs,
                    },
                    timeoutMs: request.timeoutMs || request.timeMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            case 'fill': {
                if (!Array.isArray(request.fields) || request.fields.length === 0) {
                    throw new Error('OpenClaw fill requires fields');
                }
                const payload = await this.requestBrowser('POST', '/act', {
                    query: { profile: this.resolveOpenClawProfile(profile) },
                    body: {
                        kind: 'fill',
                        targetId,
                        fields: request.fields,
                    },
                    timeoutMs: request.timeoutMs || 45000,
                });
                return await this.buildActionResult(profile, targetId, payload);
            }
            default:
                throw new Error(`OpenClaw action kind not yet supported: ${request.kind}`);
        }
    }

    async act(profile, request = {}) {
        if (request.kind === 'batch') {
            const results = [];
            for (const action of Array.isArray(request.actions) ? request.actions : []) {
                try {
                    const result = await this.runSingleAction(profile, {
                        ...action,
                        targetId: action.targetId || request.targetId,
                    });
                    results.push({ ok: true, result });
                } catch (error) {
                    results.push({ ok: false, error: error.message });
                    if (request.stopOnError !== false) {
                        throw error;
                    }
                }
            }
            const currentTab = await this.inferCurrentTab(profile, request.targetId);
            return {
                ok: true,
                profile: normalizeProfileName(profile),
                targetId: currentTab?.targetId || request.targetId || '',
                url: currentTab?.url || '',
                details: { results },
            };
        }
        return await this.runSingleAction(profile, request);
    }
}

module.exports = OpenClawCliBrowserClient;

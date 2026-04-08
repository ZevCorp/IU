'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execOpenClawCli } = require('./OpenClawProcessRunner');
const { resolveOpenClawNodePath, resolveOpenClawPackageRoot } = require('./OpenClawPackageResolver');

function extractJsonPayload(rawText = '') {
    const text = String(rawText || '').trim();
    if (!text) return null;
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        return JSON.parse(text);
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    return null;
}

function formatGatewayStatusSummary(status) {
    if (!status || typeof status !== 'object') {
        return 'No pude leer el estado del servicio de OpenClaw.';
    }

    const details = [];
    const service = status.service || {};
    const runtime = service.runtime || {};
    const port = status.port || {};
    const rpc = status.rpc || {};
    const daemonConfig = status.config?.daemon || {};
    const cliConfig = status.config?.cli || {};

    details.push(`service.loaded=${Boolean(service.loaded)}`);
    if (cliConfig.valid === false) {
        details.push(`cliConfigInvalid=${String((cliConfig.issues || []).map((issue) => issue?.message || issue?.path || 'issue').join('; ')).slice(0, 220)}`);
    }
    if (daemonConfig.valid === false) {
        details.push(`daemonConfigInvalid=${String((daemonConfig.issues || []).map((issue) => issue?.message || issue?.path || 'issue').join('; ')).slice(0, 220)}`);
    }
    if (runtime.status) {
        details.push(`runtime=${runtime.status}`);
    }
    if (runtime.detail) {
        details.push(`runtimeDetail=${String(runtime.detail).replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    if (port.status) {
        details.push(`port=${port.status}`);
    }
    if (Array.isArray(port.listeners) && port.listeners.length > 0) {
        const listeners = port.listeners
            .map((listener) => `${listener.command || 'process'}:${listener.pid || '?'}`)
            .join(', ');
        details.push(`listeners=${listeners}`);
    }
    if (rpc && rpc.ok === false) {
        details.push(`rpc=${String(rpc.error || 'failed').replace(/\s+/g, ' ').slice(0, 220)}`);
    }

    return details.join(' | ');
}

function safeRealpath(inputPath = '') {
    const candidate = String(inputPath || '').trim();
    if (!candidate) return '';
    try {
        return fs.realpathSync(candidate);
    } catch (_) {
        return candidate;
    }
}

function normalizePathForCompare(inputPath = '') {
    return safeRealpath(inputPath).replace(/\\/g, '/').toLowerCase();
}

function readLaunchAgentProgramArguments(plistPath = '') {
    const target = String(plistPath || '').trim();
    if (!target || !fs.existsSync(target)) return [];
    const raw = fs.readFileSync(target, 'utf8');
    const match = raw.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/i);
    if (!match) return [];
    return Array.from(match[1].matchAll(/<string>([\s\S]*?)<\/string>/gi))
        .map((entry) => String(entry[1] || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim())
        .filter(Boolean);
}

function detectGatewayServiceDrift(cliPath = '', env = process.env) {
    if (process.platform !== 'darwin') {
        return '';
    }

    const gatewayProfile = String((env && env.IU_OPENCLAW_PROFILE) || '').trim();
    const label = gatewayProfile ? `ai.openclaw.gateway.${gatewayProfile}` : 'ai.openclaw.gateway';
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    const programArguments = readLaunchAgentProgramArguments(plistPath);
    if (programArguments.length < 2) {
        return '';
    }

    const installedNodePath = normalizePathForCompare(programArguments[0]);
    const installedEntrypoint = normalizePathForCompare(programArguments[1]);
    const expectedNodePath = normalizePathForCompare(resolveOpenClawNodePath(cliPath));
    const expectedPackageRoot = normalizePathForCompare(resolveOpenClawPackageRoot({ cliPath }));

    if (expectedNodePath && installedNodePath && installedNodePath !== expectedNodePath) {
        return `node mismatch (${programArguments[0]} != ${expectedNodePath})`;
    }
    if (expectedPackageRoot && installedEntrypoint && !installedEntrypoint.startsWith(expectedPackageRoot)) {
        return `package mismatch (${programArguments[1]} not under ${expectedPackageRoot})`;
    }
    return '';
}

class OpenClawGatewaySupervisor {
    constructor(options = {}) {
        this.log = typeof options.log === 'function' ? options.log : () => {};
        this.createClient = typeof options.createClient === 'function' ? options.createClient : null;
        this.startPromise = null;
    }

    async ensureStarted(params = {}) {
        if (this.startPromise) {
            return await this.startPromise;
        }
        this.startPromise = this._ensureStarted(params);
        try {
            return await this.startPromise;
        } finally {
            this.startPromise = null;
        }
    }

    async _ensureStarted(params = {}) {
        const cliPath = String(params.cliPath || '').trim();
        if (!cliPath) {
            throw new Error('No encontré el binario de OpenClaw. Configura IU_OPENCLAW_CLI_PATH o instala openclaw globalmente.');
        }
        if (!this.createClient) {
            throw new Error('OpenClawGatewaySupervisor requires a client factory');
        }

        const launchEnv = params.env || process.env;
        const clientOptions = params.clientOptions || {};
        const gatewayUrl = String(params.gatewayUrl || '').trim();
        const browserProfile = String(params.profile || clientOptions.defaultProfile || 'openclaw').trim() || 'openclaw';
        const useConfigGateway = params.useConfigGateway === true;
        const autoStartEnabled = params.autoStart !== false;
        const warmProbeTimeoutMs = Number.isFinite(params.warmProbeTimeoutMs)
            ? Math.max(1000, Number(params.warmProbeTimeoutMs))
            : 2500;
        const readyTimeoutMs = Number.isFinite(params.readyTimeoutMs)
            ? Math.max(1000, Number(params.readyTimeoutMs))
            : 45000;
        const freshlyInstalledTimeoutMs = Number.isFinite(params.freshlyInstalledTimeoutMs)
            ? Math.max(readyTimeoutMs, Number(params.freshlyInstalledTimeoutMs))
            : Math.max(readyTimeoutMs, 45000);
        const serviceDrift = detectGatewayServiceDrift(cliPath, launchEnv);

        try {
            if (serviceDrift) {
                throw new Error(`Embedded OpenClaw service drift detected: ${serviceDrift}`);
            }
            const warmStatus = await this.getGatewayStatus({
                cliPath,
                env: launchEnv,
                noProbe: true,
            });
            const warmRuntimeStatus = String(warmStatus?.service?.runtime?.status || '').trim().toLowerCase();
            const warmLoaded = Boolean(warmStatus?.service?.loaded);
            if (warmLoaded && warmRuntimeStatus === 'running') {
                await this.verifyGatewayAccess({
                    cliPath,
                    env: launchEnv,
                    ...(useConfigGateway ? {} : {
                        gatewayUrl,
                        authToken: clientOptions.authToken,
                    }),
                });
                this.log(`Reusing running gateway service at ${gatewayUrl || clientOptions.baseUrl}`);
                return clientOptions;
            }
            throw new Error(`Gateway not ready yet (${formatGatewayStatusSummary(warmStatus)})`);
        } catch (initialError) {
            if (!autoStartEnabled) {
                throw new Error(`OpenClaw no responde en ${clientOptions.baseUrl}: ${initialError.message}`);
            }

            const serviceStatus = await this.getGatewayStatus({
                cliPath,
                env: launchEnv,
                ...(useConfigGateway ? {} : {
                    gatewayUrl,
                    authToken: clientOptions.authToken,
                }),
                noProbe: true,
            });
            const serviceLoaded = Boolean(serviceStatus?.service?.loaded);
            const missingService = serviceStatus?.service?.runtime?.missingUnit === true || !serviceLoaded || Boolean(serviceDrift);
            const runtimeStatus = String(serviceStatus?.service?.runtime?.status || '').trim().toLowerCase();

            this.log(`Gateway not ready yet; current service snapshot: ${formatGatewayStatusSummary(serviceStatus)}`);
            if (serviceDrift) {
                this.log(`Gateway service drift detected; reinstalling embedded runtime: ${serviceDrift}`);
            }

            if (missingService) {
                const installArgs = ['--json', '--force', '--port', String(params.gatewayPort), '--runtime', 'node'];
                if (clientOptions.authToken) {
                    installArgs.push('--token', clientOptions.authToken);
                }
                this.log(`Installing launchd gateway service via CLI: ${cliPath} gateway install ${installArgs.join(' ')}`);
                await this.runGatewayCommand(cliPath, 'install', installArgs, { env: launchEnv, timeoutMs: 45000 });
            } else {
                const recoveryCommand = runtimeStatus === 'running' ? 'restart' : 'start';
                this.log(`Recovering existing OpenClaw service via gateway ${recoveryCommand}. Snapshot: ${formatGatewayStatusSummary(serviceStatus)}`);
                await this.runGatewayCommand(cliPath, recoveryCommand, ['--json'], { env: launchEnv, timeoutMs: 30000 });
            }

            try {
                await this.waitForGatewayServiceReady({
                    cliPath,
                    env: launchEnv,
                    timeoutMs: missingService ? freshlyInstalledTimeoutMs : readyTimeoutMs,
                });
                await this.verifyGatewayAccess({
                    cliPath,
                    env: launchEnv,
                    ...(useConfigGateway ? {} : {
                        gatewayUrl,
                        authToken: clientOptions.authToken,
                    }),
                });
            } catch (recoveryError) {
                const finalStatus = await this.getGatewayStatus({
                    cliPath,
                    env: launchEnv,
                    ...(useConfigGateway ? {} : {
                        gatewayUrl,
                        authToken: clientOptions.authToken,
                    }),
                });
                throw new Error(
                    `OpenClaw no inició correctamente. Validación inicial: ${initialError.message}. ` +
                    `Recuperación: ${recoveryError.message}. Estado final: ${formatGatewayStatusSummary(finalStatus)}`
                );
            }

            this.log(`Gateway ready at ${clientOptions.baseUrl}`);
            return clientOptions;
        }
    }

    async verifyGatewayAccess(params = {}) {
        const args = ['--json'];
        if (params.gatewayUrl) {
            args.push('--url', params.gatewayUrl);
        }
        if (params.authToken) {
            args.push('--token', params.authToken);
        }
        args.push('--timeout', String(Number.isFinite(params.timeoutMs) ? Math.max(1000, Number(params.timeoutMs)) : 5000));
        return await this.runGatewayCommand(params.cliPath, 'health', args, {
            env: params.env,
            timeoutMs: Number.isFinite(params.timeoutMs) ? Math.max(1000, Number(params.timeoutMs) + 1000) : 7000,
        });
    }

    async waitForGatewayServiceReady(params = {}) {
        const deadline = Date.now() + Math.max(1000, params.timeoutMs || 20000);
        let lastStatus = null;
        while (Date.now() < deadline) {
            lastStatus = await this.getGatewayStatus({
                cliPath: params.cliPath,
                env: params.env,
                noProbe: true,
            });
            const loaded = Boolean(lastStatus?.service?.loaded);
            const runtimeStatus = String(lastStatus?.service?.runtime?.status || '').trim().toLowerCase();
            if (loaded && runtimeStatus === 'running') {
                return lastStatus;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error(`Gateway service not ready (${formatGatewayStatusSummary(lastStatus)})`);
    }

    async waitForBrowserBackendReady(params = {}) {
        const deadline = Date.now() + Math.max(1000, params.timeoutMs || 20000);
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                const client = this.createClient({
                    gatewayUrl: params.gatewayUrl,
                    authToken: params.authToken,
                    preferConfigGateway: params.preferConfigGateway === true,
                    defaultProfile: params.profile || 'openclaw',
                    cliPath: params.cliPath,
                    env: params.env,
                    homeDir: params.homeDir,
                    stateDir: params.stateDir,
                    configPath: params.configPath,
                    profileAliases: {
                        managed: params.profile || 'openclaw',
                        user: 'user',
                    },
                    requestTimeoutMs: Math.max(1000, Math.min(10000, params.statusTimeoutMs || 4000)),
                });
                const payload = await client.status();
                if (payload && payload.enabled !== false) {
                    return payload;
                }
                lastError = new Error(payload?.error || 'OpenClaw browser status not ready yet');
            } catch (error) {
                lastError = error;
            }
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
        throw lastError || new Error(`Timed out waiting for OpenClaw browser backend after ${params.timeoutMs}ms`);
    }

    async getGatewayStatus(params = {}) {
        const args = ['--json'];
        if (params.noProbe) {
            args.push('--no-probe');
        } else {
            if (params.gatewayUrl) {
                args.push('--url', params.gatewayUrl);
            }
            if (params.authToken) {
                args.push('--token', params.authToken);
            }
            if (params.password) {
                args.push('--password', params.password);
            }
        }

        try {
            return await this.runGatewayCommand(params.cliPath, 'status', args, {
                env: params.env,
                timeoutMs: 15000,
            });
        } catch (error) {
            this.log(`Unable to read gateway status: ${error.message}`);
            return null;
        }
    }

    async runGatewayCommand(cliPath, subcommand, extraArgs = [], options = {}) {
        const args = [];
        const gatewayProfile = String((options.env && options.env.IU_OPENCLAW_PROFILE) || process.env.IU_OPENCLAW_PROFILE || '').trim();
        if (gatewayProfile) {
            args.push('--profile', gatewayProfile);
        }
        args.push('gateway', subcommand, ...extraArgs);

        const timeoutMs = Number.isFinite(options.timeoutMs)
            ? Math.max(1000, Number(options.timeoutMs))
            : 15000;

        const { stdout } = await execOpenClawCli(cliPath, args, {
            env: options.env || process.env,
            timeout: timeoutMs,
            maxBuffer: 8 * 1024 * 1024,
        });

        const parsed = extractJsonPayload(String(stdout || '').trim());
        return parsed === null ? stdout : parsed;
    }

    shutdown() {
        // Reserved for future explicit child-process fallback mode.
    }
}

module.exports = OpenClawGatewaySupervisor;

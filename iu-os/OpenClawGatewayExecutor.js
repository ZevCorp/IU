'use strict';

const { execOpenClawCli, spawnOpenClawProcess } = require('./OpenClawProcessRunner');
const { ensureManagedOpenClawSetup } = require('./OpenClawManagedSetup');
const { resolveOpenClawRuntimeConfig } = require('./OpenClawRuntimeConfig');
const { buildOpenClawRuntimeEnv, sanitizeOpenClawSettings } = require('./OpenClawUiState');

function safeTrim(value) {
    return String(value || '').trim();
}

function sliceText(value, max = 240) {
    const text = safeTrim(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max).trim()}...`;
}

function extractJsonPayload(rawText = '') {
    const text = safeTrim(rawText);
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

function extractPayloadText(payload = {}) {
    const resultPayload = payload && typeof payload.result === 'object' ? payload.result : null;
    const payloads = Array.isArray(payload.payloads)
        ? payload.payloads
        : Array.isArray(resultPayload?.payloads)
            ? resultPayload.payloads
            : [];
    const parts = [];
    for (const item of payloads) {
        if (!item || typeof item !== 'object') continue;
        const textCandidates = [
            item.text,
            item.content,
            item.markdown,
            item.body,
            item.summary,
        ];
        for (const candidate of textCandidates) {
            const clean = safeTrim(candidate);
            if (clean) {
                parts.push(clean);
                break;
            }
        }
    }
    return safeTrim(parts.join('\n\n'));
}

function buildAgentMessage(goal, app, stepsHint) {
    const lines = [
        'Ejecuta esta tarea usando OpenClaw y su navegador dedicado.',
        `Objetivo: ${safeTrim(goal)}`,
    ];
    const cleanApp = safeTrim(app);
    const cleanSteps = safeTrim(stepsHint);
    if (cleanApp) {
        lines.push(`Contexto inicial: ${cleanApp}`);
    }
    if (cleanSteps) {
        lines.push(`Guía: ${cleanSteps}`);
    }
    lines.push('Usa herramientas reales del navegador cuando hagan falta y responde al final con lo que hiciste o con la pregunta mínima si falta información del usuario.');
    return lines.join('\n');
}

function inferAwaitingUserInput(summary = '') {
    const clean = safeTrim(summary);
    if (!clean) return false;
    return /\?\s*$/.test(clean);
}

class OpenClawGatewayExecutor {
    constructor(mainWindow, options = {}) {
        this.mainWindow = mainWindow || null;
        this.supervisorBridge = options.supervisorBridge || null;
        this.gatewaySupervisor = options.gatewaySupervisor || null;
        this.getOpenClawSettings = typeof options.getOpenClawSettings === 'function'
            ? options.getOpenClawSettings
            : () => options.openClawSettings || {};
        this.log = typeof options.log === 'function' ? options.log : () => {};
        this.isRunning = false;
        this.currentRun = null;
    }

    _emitStatus(payload = {}) {
        if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
        this.mainWindow.webContents.send('action-status', payload);
    }

    _writeRuntimeLog(sessionId, message) {
        const line = `🦞 [OpenClaw][${sessionId}] ${message}`;
        process.stderr.write(`${line}\n`);
        this.log(line);
    }

    async _ensureRuntimeReady() {
        if (!this.supervisorBridge || !this.gatewaySupervisor) {
            throw new Error('OpenClaw gateway executor is missing supervisor dependencies');
        }
        const openClawSettings = sanitizeOpenClawSettings(this.getOpenClawSettings() || {}, process.env);
        const installInfo = await this.supervisorBridge.ensureInstalled();
        const launchEnv = buildOpenClawRuntimeEnv(openClawSettings, process.env);
        const runtime = resolveOpenClawRuntimeConfig({
            installInfo,
            managedStateDir: this.supervisorBridge.getManagedStateDir(),
            env: launchEnv,
        });
        runtime.openClawSettings = openClawSettings;
        await ensureManagedOpenClawSetup(runtime, {
            log: (message) => this.log(message),
        });
        const clientOptions = await this.gatewaySupervisor.ensureStarted({
            cliPath: installInfo.cliPath,
            env: runtime.launchEnv,
            clientOptions: runtime.clientOptions,
            gatewayUrl: runtime.gatewayUrl,
            gatewayPort: runtime.gatewayPort,
            profile: runtime.managedProfile,
            homeDir: runtime.homeDir,
            stateDir: runtime.stateDir,
            configPath: runtime.configPath,
            openClawSettings,
            autoStart: String(process.env.IU_OPENCLAW_AUTO_START || '1').trim() !== '0',
            useConfigGateway: true,
            readyTimeoutMs: Number.parseInt(String(process.env.IU_OPENCLAW_START_TIMEOUT_MS || '').trim(), 10) || 30000,
            freshlyInstalledTimeoutMs: Number.parseInt(String(process.env.IU_OPENCLAW_FRESH_INSTALL_TIMEOUT_MS || '').trim(), 10) || 45000,
        });
        this._writeRuntimeLog('gateway', `Gateway ready at ${runtime.gatewayUrl}`);
        const browserStartTimeoutMs = Number.parseInt(String(process.env.IU_OPENCLAW_BROWSER_START_TIMEOUT_MS || '').trim(), 10) || 60000;
        const browserClient = this.gatewaySupervisor.createClient({
            gatewayUrl: runtime.gatewayUrl,
            authToken: runtime.authToken,
            preferConfigGateway: true,
            defaultProfile: runtime.managedProfile,
            cliPath: installInfo.cliPath,
            env: launchEnv,
            homeDir: runtime.homeDir,
            stateDir: runtime.stateDir,
            configPath: runtime.configPath,
            profileAliases: {
                managed: runtime.managedProfile,
                user: 'user',
            },
            requestTimeoutMs: browserStartTimeoutMs,
        });
        await browserClient.start('managed', { timeoutMs: browserStartTimeoutMs });
        await this.gatewaySupervisor.waitForBrowserBackendReady({
            gatewayUrl: runtime.gatewayUrl,
            authToken: runtime.authToken,
            preferConfigGateway: true,
            profile: runtime.managedProfile,
            cliPath: installInfo.cliPath,
            env: launchEnv,
            homeDir: runtime.homeDir,
            stateDir: runtime.stateDir,
            configPath: runtime.configPath,
            timeoutMs: Number.parseInt(String(process.env.IU_OPENCLAW_BROWSER_READY_TIMEOUT_MS || '').trim(), 10) || 45000,
            statusTimeoutMs: Number.parseInt(String(process.env.IU_OPENCLAW_BROWSER_STATUS_TIMEOUT_MS || '').trim(), 10) || 12000,
        });
        return {
            ...runtime,
            installInfo,
            clientOptions,
        };
    }

    async _runAgent(runtime, message, sessionId) {
        const cliPath = runtime.installInfo.cliPath;
        const args = ['agent', '--session-id', sessionId, '--message', message, '--json'];
        const explicitAgentId = safeTrim(process.env.IU_OPENCLAW_AGENT_ID);
        if (explicitAgentId) {
            args.splice(1, 0, '--agent', explicitAgentId);
        }
        const thinking = safeTrim(process.env.IU_OPENCLAW_THINKING);
        if (thinking) {
            args.push('--thinking', thinking);
        }
        const timeoutSeconds = Number.parseInt(String(process.env.IU_OPENCLAW_AGENT_TIMEOUT_SECONDS || '').trim(), 10) || 600;
        args.push('--timeout', String(timeoutSeconds));

        const child = spawnOpenClawProcess(cliPath, args, {
            env: runtime.launchEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.currentRun.child = child;

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            const text = String(chunk || '');
            stdout += text;
            const clean = safeTrim(text);
            if (clean) {
                this._writeRuntimeLog(sessionId, `[stdout] ${sliceText(clean, 500)}`);
            }
        });
        child.stderr?.on('data', (chunk) => {
            const text = String(chunk || '');
            stderr += text;
            const clean = safeTrim(text);
            if (clean) {
                this._writeRuntimeLog(sessionId, `[stderr] ${sliceText(clean, 500)}`);
            }
        });

        const exit = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });

        if (this.currentRun?.stopRequested) {
            return {
                success: false,
                aborted: true,
                summary: 'OpenClaw detenido por IU.',
            };
        }

        const payload = extractJsonPayload(stdout) || extractJsonPayload(stderr);
        if (exit.code !== 0) {
            const messageText = safeTrim(stderr) || safeTrim(stdout) || `OpenClaw terminó con código ${exit.code}`;
            throw new Error(messageText);
        }
        if (!payload) {
            throw new Error(safeTrim(stdout) || safeTrim(stderr) || 'OpenClaw no devolvió un resultado JSON.');
        }

        const summary = extractPayloadText(payload);
        const awaitingUserInput = inferAwaitingUserInput(summary);
        return {
            success: summary.length > 0,
            awaitingUserInput,
            aborted: false,
            summary: summary || 'OpenClaw terminó sin devolver texto visible.',
            rawResult: payload,
        };
    }

    async executeAction(goal, app, stepsHint, options = {}) {
        if (this.isRunning) {
            throw new Error('OpenClaw ya está ejecutando una tarea');
        }

        const sessionId = safeTrim(options.sessionId) || `iu-openclaw-${Date.now()}`;
        this.isRunning = true;
        this.currentRun = {
            sessionId,
            stopRequested: false,
            child: null,
        };

        try {
            this._emitStatus({
                phase: 'starting',
                status: 'starting',
                step: 'Iniciando el runtime oficial de OpenClaw...',
            });
            const runtime = await this._ensureRuntimeReady();
            this.currentRun.runtime = runtime;
            this._emitStatus({
                phase: 'confirming',
                status: 'confirming',
                step: 'Abriendo el navegador oficial de OpenClaw...',
            });
            this._writeRuntimeLog(sessionId, `Runtime listo en ${runtime.clientOptions.baseUrl}`);

            this._emitStatus({
                phase: 'execution_state',
                status: 'execution_state',
                step: 'OpenClaw está ejecutando la tarea...',
            });
            const result = await this._runAgent(runtime, buildAgentMessage(goal, app, stepsHint), sessionId);
            this._emitStatus({
                phase: result.awaitingUserInput ? 'waiting_user' : 'completed',
                status: result.awaitingUserInput ? 'waiting_user' : 'completed',
                step: result.awaitingUserInput ? '' : 'OpenClaw terminó la tarea.',
            });
            return {
                ...result,
                runtimeContext: {
                    executor: 'openclaw',
                    sessionId,
                },
            };
        } finally {
            this.isRunning = false;
            this.currentRun = null;
        }
    }

    stop() {
        const run = this.currentRun;
        if (!run) return;
        run.stopRequested = true;
        const runtime = run.runtime;
        if (runtime?.installInfo?.cliPath) {
            void execOpenClawCli(runtime.installInfo.cliPath, [
                'agent',
                '--session-id',
                run.sessionId,
                '--message',
                '/stop',
                '--json',
            ], {
                env: runtime.launchEnv,
                timeout: 15000,
            }).catch(() => { });
        }
        if (run.child && !run.child.killed) {
            try {
                run.child.kill('SIGTERM');
            } catch (_) {
                // Ignore kill failures.
            }
        }
    }
}

module.exports = OpenClawGatewayExecutor;
module.exports._private = {
    buildAgentMessage,
    extractJsonPayload,
    extractPayloadText,
    inferAwaitingUserInput,
};

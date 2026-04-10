const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OpenClawGatewayExecutor = require('../OpenClawGatewayExecutor');

const {
    buildAgentMessage,
    extractJsonPayload,
    extractPayloadText,
    inferAwaitingUserInput,
} = OpenClawGatewayExecutor._private;

test('extracts JSON payload from stdout with surrounding noise', () => {
    const payload = extractJsonPayload('info line\n{"payloads":[{"text":"hola"}],"meta":{"ok":true}}\n');
    assert.equal(payload.meta.ok, true);
    assert.equal(payload.payloads[0].text, 'hola');
});

test('extracts visible text from normalized payloads', () => {
    const summary = extractPayloadText({
        payloads: [
            { text: 'Primer bloque' },
            { markdown: 'Segundo bloque' },
        ],
    });
    assert.equal(summary, 'Primer bloque\n\nSegundo bloque');
});

test('extracts visible text from gateway agent result payloads', () => {
    const summary = extractPayloadText({
        runId: 'abc',
        result: {
            payloads: [
                { text: 'Texto visible de OpenClaw' },
            ],
        },
    });
    assert.equal(summary, 'Texto visible de OpenClaw');
});

test('marks clear questions as awaiting user input', () => {
    assert.equal(inferAwaitingUserInput('¿Quieres que compare precios?'), true);
    assert.equal(inferAwaitingUserInput('Terminé la búsqueda.'), false);
});

test('builds a browser-focused prompt for OpenClaw', () => {
    const message = buildAgentMessage('Buscar parabrisas Mazda 3', 'navegador', 'Compara MercadoLibre y Google');
    assert.match(message, /Objetivo: Buscar parabrisas Mazda 3/);
    assert.match(message, /Contexto inicial: navegador/);
    assert.match(message, /Guía: Compara MercadoLibre y Google/);
});

test('uses config-scoped browser client requests for the managed OpenClaw runtime', async () => {
    const createdClients = [];
    const managedStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-openclaw-runtime-'));
    fs.writeFileSync('/tmp/openclaw.mjs', '#!/usr/bin/env node\nconsole.log(JSON.stringify({ status: "ok" }));\n', 'utf8');
    fs.writeFileSync(path.join(managedStateDir, 'openclaw.json'), JSON.stringify({
        gateway: {
            auth: {
                token: 'token-123',
            },
        },
        browser: {
            defaultProfile: 'openclaw',
        },
        agents: {
            defaults: {
                workspace: path.join(managedStateDir, 'workspace'),
            },
        },
        wizard: {
            lastRunAt: '2026-04-09T12:00:00.000Z',
            lastRunCommand: 'openclaw onboard --non-interactive',
            lastRunMode: 'local',
        },
    }, null, 2));
    fs.writeFileSync(path.join(managedStateDir, 'iu-managed-setup.json'), JSON.stringify({
        schemaVersion: 1,
        packageVersion: '2026.2.9',
        profileId: 'iu',
    }), 'utf8');
    const bridge = {
        async ensureInstalled() {
            return {
                installedByIU: true,
                managedByIU: true,
                cliPath: '/tmp/openclaw.mjs',
                nodePath: '/tmp/node',
                packageRoot: '/tmp/openclaw',
                version: '2026.2.9',
            };
        },
        getManagedStateDir() {
            return managedStateDir;
        },
    };
    const gatewaySupervisor = {
        async ensureStarted() {
            return { baseUrl: 'http://127.0.0.1:18797', authToken: 'token-123' };
        },
        createClient(options) {
            createdClients.push(options);
            return {
                async start() {
                    return { ok: true };
                },
                async status() {
                    return { enabled: true };
                },
            };
        },
        async waitForBrowserBackendReady(params) {
            createdClients.push({ waitParams: params });
            return { enabled: true };
        },
    };
    const executor = new OpenClawGatewayExecutor(null, {
        supervisorBridge: bridge,
        gatewaySupervisor,
        log: () => {},
    });

    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    const originalAutoStart = process.env.IU_OPENCLAW_AUTO_START;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.IU_OPENCLAW_AUTO_START = '1';

    try {
        const runtime = await executor._ensureRuntimeReady();
        assert.equal(runtime.gatewayUrl, 'ws://127.0.0.1:18795');
        assert.equal(createdClients[0].gatewayUrl, 'ws://127.0.0.1:18795');
        assert.equal(createdClients[0].authToken, runtime.authToken);
        assert.equal(createdClients[0].preferConfigGateway, true);
        assert.equal(createdClients[1].waitParams.gatewayUrl, 'ws://127.0.0.1:18795');
        assert.equal(createdClients[1].waitParams.authToken, runtime.authToken);
        assert.equal(createdClients[1].waitParams.preferConfigGateway, true);
    } finally {
        if (originalAnthropic === undefined) {
            delete process.env.ANTHROPIC_API_KEY;
        } else {
            process.env.ANTHROPIC_API_KEY = originalAnthropic;
        }
        if (originalAutoStart === undefined) {
            delete process.env.IU_OPENCLAW_AUTO_START;
        } else {
            process.env.IU_OPENCLAW_AUTO_START = originalAutoStart;
        }
    }
});

test('emits a completed status when OpenClaw finishes without user input', async () => {
    const executor = new OpenClawGatewayExecutor(null, {
        supervisorBridge: {},
        gatewaySupervisor: {},
        log: () => {},
    });

    const statuses = [];
    executor._emitStatus = (payload) => statuses.push(payload);
    executor._ensureRuntimeReady = async () => ({ clientOptions: {}, gatewayUrl: 'ws://127.0.0.1:18795', launchEnv: {}, installInfo: { cliPath: '/tmp/openclaw.mjs' } });
    executor._runAgent = async () => ({
        success: true,
        awaitingUserInput: false,
        aborted: false,
        summary: 'Hecho',
        runtimeContext: { executor: 'openclaw' },
    });

    const result = await executor.executeAction('Hacer algo', 'navegador', '');
    assert.equal(result.success, true);
    assert.equal(statuses.at(-1).status, 'completed');
    assert.equal(statuses.at(-1).phase, 'completed');
    assert.equal(statuses.at(-1).step, 'OpenClaw terminó la tarea.');
});

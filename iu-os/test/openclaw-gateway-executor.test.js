const test = require('node:test');
const assert = require('node:assert/strict');

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

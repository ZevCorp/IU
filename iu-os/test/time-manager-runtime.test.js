'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const TimeManagerRuntime = require('../time-manager/TimeManagerRuntime');
const TimeManagerStore = require('../time-manager/TimeManagerStore');
const {
    INTERRUPTION_KINDS,
    TRIGGER_KINDS,
    SHIELD_MODES
} = require('../time-manager/TimeManagerContracts');

function createModelSwitchWithToolCall(toolName, args) {
    return {
        isReady({ capability }) {
            return capability === 'chat';
        },
        async chatCompletion() {
            return {
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments: JSON.stringify(args)
                            }
                        }]
                    }
                }]
            };
        }
    };
}

test('TimeManagerRuntime schedules notification delivery through tool calling', async () => {
    const store = new TimeManagerStore();
    const runtime = new TimeManagerRuntime({
        modelSwitch: createModelSwitchWithToolCall('schedule_notification_delivery', {
            importance: 83,
            summary: 'Mostrarla cuando abra WhatsApp.',
            reasoning: 'La respuesta será más útil cuando el usuario ya esté en el contexto conversacional correcto.',
            trigger_kind: 'app_open',
            app_id: 'com.whatsapp',
            app_name: 'WhatsApp'
        }),
        store
    });

    const result = await runtime.decideInterruption({
        notification: {
            id: 'notif_1',
            sourceApp: 'Slack',
            title: 'Nuevo mensaje',
            body: '¿Puedes revisar el brief?'
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.decision.kind, INTERRUPTION_KINDS.SCHEDULE);
    assert.equal(result.decision.importance, 83);
    assert.equal(result.decision.plan.trigger.kind, TRIGGER_KINDS.APP_OPEN);
    assert.equal(result.decision.plan.trigger.appId, 'com.whatsapp');
    assert.equal(result.decision.plan.shieldMode, SHIELD_MODES.OS_FOCUS_MODE);
    assert.equal(store.getRecentDecisions(1)[0].notificationId, 'notif_1');
});

test('TimeManagerRuntime can consult main assistant before deciding', async () => {
    const store = new TimeManagerStore();
    let consultedQuestion = '';
    const modelSwitch = {
        isReady() {
            return true;
        },
        async chatCompletion({ messages }) {
            const toolMessages = messages.filter((item) => item.role === 'tool');
            if (toolMessages.length === 0) {
                return {
                    choices: [{
                        message: {
                            content: '',
                            tool_calls: [{
                                id: 'call_bridge',
                                type: 'function',
                                function: {
                                    name: 'ask_main_assistant',
                                    arguments: JSON.stringify({
                                        question: '¿Está el usuario en una tarea de foco profundo ahora mismo?'
                                    })
                                }
                            }]
                        }
                    }]
                };
            }

            return {
                choices: [{
                    message: {
                        content: '',
                        tool_calls: [{
                            id: 'call_deliver',
                            type: 'function',
                            function: {
                                name: 'deliver_notification_now',
                                arguments: JSON.stringify({
                                    importance: 91,
                                    summary: 'Es una interrupción legítima ahora.',
                                    reasoning: 'El agente principal indicó que el usuario espera esta respuesta y no está en foco profundo.'
                                })
                            }
                        }]
                    }
                }]
            };
        }
    };

    const runtime = new TimeManagerRuntime({
        modelSwitch,
        store,
        askMainAssistant: async ({ question }) => {
            consultedQuestion = question;
            return {
                ok: true,
                answer: 'No está en foco profundo y está esperando contexto de mensajería.'
            };
        }
    });

    const result = await runtime.decideInterruption({
        notification: {
            id: 'notif_2',
            sourceApp: 'Telegram',
            title: 'Urgente',
            body: 'Contéstame cuando puedas'
        }
    });

    assert.equal(consultedQuestion, '¿Está el usuario en una tarea de foco profundo ahora mismo?');
    assert.equal(result.decision.kind, INTERRUPTION_KINDS.DELIVER_NOW);
    assert.equal(result.decision.importance, 91);
});

test('TimeManagerRuntime falls back to a delayed decision if the model returns no tools', async () => {
    const store = new TimeManagerStore();
    const runtime = new TimeManagerRuntime({
        modelSwitch: {
            isReady() {
                return true;
            },
            async chatCompletion() {
                return {
                    choices: [{
                        message: {
                            content: 'Sin acciones.'
                        }
                    }]
                };
            }
        },
        store
    });

    const before = Date.now();
    const result = await runtime.decideInterruption({
        notification: {
            id: 'notif_3',
            sourceApp: 'Mail',
            title: 'Newsletter',
            body: 'Resumen semanal'
        },
        defaultDelayMs: 5000
    });

    assert.equal(result.decision.kind, INTERRUPTION_KINDS.SCHEDULE);
    assert.equal(result.decision.plan.trigger.kind, TRIGGER_KINDS.TIME);
    assert.ok(result.decision.plan.trigger.at >= before + 5000);
});

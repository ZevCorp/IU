'use strict';

const {
    INTERRUPTION_KINDS,
    TRIGGER_KINDS,
    DELIVERY_SURFACES,
    SHIELD_MODES,
    normalizeNotificationEnvelope,
    normalizeDeliveryPlan
} = require('./TimeManagerContracts');

class TimeManagerRuntime {
    constructor(options = {}) {
        this.modelSwitch = options.modelSwitch;
        this.store = options.store;
        this.safeSliceText = typeof options.safeSliceText === 'function'
            ? options.safeSliceText
            : ((value, max = 1000) => {
                const text = String(value || '').trim();
                return text.length > max ? `${text.slice(0, max).trim()}...` : text;
            });
        this.askMainAssistant = typeof options.askMainAssistant === 'function'
            ? options.askMainAssistant
            : (async () => ({ ok: false, error: 'Main assistant bridge unavailable' }));
        this.onDecision = typeof options.onDecision === 'function'
            ? options.onDecision
            : (async (decision) => decision);
    }

    async decideInterruption(options = {}) {
        const envelope = normalizeNotificationEnvelope(options.notification || options);
        const runId = String(options.runId || `time_mgr_${Date.now()}`).trim();
        const emit = typeof options.emit === 'function' ? options.emit : () => {};

        if (!this.modelSwitch?.isReady?.({ capability: 'chat' })) {
            return {
                success: false,
                runId,
                error: 'Modelo no disponible',
                decision: null,
                toolEvents: []
            };
        }

        if (this.store?.ingestNotification) {
            this.store.ingestNotification(envelope);
        }

        const toolEvents = [];
        const registry = this._createToolRegistry({ envelope, emit, runId, toolEvents });
        const messages = [
            {
                role: 'system',
                content: this._buildSystemPrompt(options)
            },
            {
                role: 'user',
                content: JSON.stringify({
                    notification: envelope,
                    context: this._buildContextDigest(options)
                })
            }
        ];

        let finalDecision = null;
        const maxTurns = Math.max(3, Math.min(8, Number(options.maxTurns || 5)));

        for (let turn = 1; turn <= maxTurns; turn += 1) {
            const response = await this.modelSwitch.chatCompletion({
                messages,
                tools: registry.definitions,
                tool_choice: 'auto'
            });

            const message = response?.choices?.[0]?.message || {};
            messages.push({
                role: 'assistant',
                content: message.content || '',
                tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined
            });

            if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
                break;
            }

            for (const call of message.tool_calls) {
                const toolName = String(call?.function?.name || '').trim();
                const handler = registry.handlers.get(toolName);
                const args = this._parseToolArgs(call?.function?.arguments);
                let result;

                try {
                    result = handler
                        ? await handler(args, { envelope, runId, toolName })
                        : { ok: false, error: `Tool desconocida: ${toolName}` };
                } catch (error) {
                    result = { ok: false, error: error?.message || `Falló ${toolName}` };
                }

                if (toolName === 'schedule_notification_delivery' && result?.ok) {
                    finalDecision = result.decision || null;
                } else if (toolName === 'deliver_notification_now' && result?.ok) {
                    finalDecision = result.decision || null;
                } else if (toolName === 'suppress_notification' && result?.ok) {
                    finalDecision = result.decision || null;
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(result)
                });
            }
        }

        if (!finalDecision) {
            finalDecision = await this._fallbackDecision(envelope, options);
        }

        if (this.store?.saveDecision) {
            this.store.saveDecision(finalDecision);
        }

        await this.onDecision(finalDecision, { notification: envelope, runId });

        return {
            success: true,
            runId,
            decision: finalDecision,
            toolEvents
        };
    }

    _buildSystemPrompt(options = {}) {
        const now = new Date().toLocaleString('es-ES');
        const productContext = String(options.productContext || '').trim();
        const userContext = String(options.userContext || '').trim();
        const focusModePolicy = String(options.focusModePolicy || 'El sistema mantendrá modo enfoque/no molestar completo activo y Time Manager decide cuándo re-entregar.').trim();

        return [
            'Eres Time Manager, un agente especializado de IÜ OS.',
            'Tu estructura mental y de tool-calling es la misma del agente principal: decides usando el modelo y herramientas, no con heurísticas locales.',
            'Tu responsabilidad principal es decidir el momento exacto en que una notificación debe interrumpir al usuario.',
            'Reglas duras:',
            '- Debes producir una decision operativa usando tools.',
            '- Prioriza preservar el foco del usuario y la continuidad de su vida actual.',
            '- Si falta contexto importante, puedes consultar al agente principal con ask_main_assistant.',
            '- No menciones tool calls, JSON ni pipeline interno.',
            '- Si la notificación debe pasar ya mismo, usa deliver_notification_now.',
            '- Si conviene esperar una condicion, usa schedule_notification_delivery.',
            '- Si no debe mostrarse por ahora o debe suprimirse por completo, usa suppress_notification.',
            '- Usa como modo de bloqueo base el enfoque completo del sistema operativo.',
            `Politica de bloqueo base: ${focusModePolicy}`,
            `Fecha y hora actual: ${now}.`,
            productContext ? `Contexto de producto: ${productContext}` : '',
            userContext ? `Contexto relevante del usuario: ${userContext}` : ''
        ].filter(Boolean).join('\n');
    }

    _buildContextDigest(options = {}) {
        const recentDecisions = this.store?.getRecentDecisions
            ? this.store.getRecentDecisions(6).map((item) => ({
                notificationId: item.notificationId,
                kind: item.kind,
                importance: item.importance,
                summary: item.summary,
                trigger: item.plan?.trigger?.kind || ''
            }))
            : [];

        return {
            focusMode: String(options.focusMode || SHIELD_MODES.OS_FOCUS_MODE),
            currentActivity: options.currentActivity || null,
            ambient: options.ambient || null,
            location: options.location || null,
            recentDecisions
        };
    }

    _createToolRegistry(context = {}) {
        const handlers = new Map();
        const definitions = [];
        const register = (definition, handler) => {
            definitions.push(definition);
            handlers.set(definition.function.name, handler);
        };

        register({
            type: 'function',
            function: {
                name: 'ask_main_assistant',
                description: 'Consulta al agente principal cuando necesites contexto adicional sobre el usuario, la tarea actual o la importancia real de un evento.',
                parameters: {
                    type: 'object',
                    properties: {
                        question: { type: 'string', description: 'Pregunta concreta para el agente principal.' }
                    },
                    required: ['question']
                }
            }
        }, async (args = {}) => {
            const question = String(args.question || '').trim();
            const response = await this.askMainAssistant({
                question,
                notification: context.envelope,
                runId: context.runId
            });
            const event = {
                eventKind: 'bridge',
                label: 'Main assistant consulted',
                summary: this.safeSliceText(question, 120),
                detail: this.safeSliceText(response?.summary || response?.answer || '', 180)
            };
            context.toolEvents.push(event);
            context.emit({ type: 'tool_event', runId: context.runId, ...event });
            return {
                ok: true,
                question,
                response
            };
        });

        register({
            type: 'function',
            function: {
                name: 'deliver_notification_now',
                description: 'Entregar la notificación de inmediato con audio y rostro.',
                parameters: {
                    type: 'object',
                    properties: {
                        importance: { type: 'integer', description: 'Importancia de 0 a 100.' },
                        summary: { type: 'string', description: 'Resumen breve de por qué debe mostrarse ahora.' },
                        reasoning: { type: 'string', description: 'Razonamiento interno resumido.' }
                    },
                    required: ['importance', 'summary', 'reasoning']
                }
            }
        }, async (args = {}) => {
            const decision = this._buildDecision(context.envelope, {
                kind: INTERRUPTION_KINDS.DELIVER_NOW,
                importance: args.importance,
                summary: args.summary,
                reasoning: args.reasoning,
                plan: {
                    kind: INTERRUPTION_KINDS.DELIVER_NOW,
                    trigger: { kind: TRIGGER_KINDS.IMMEDIATE },
                    surface: DELIVERY_SURFACES.FACE_AUDIO,
                    shieldMode: SHIELD_MODES.OS_FOCUS_MODE
                }
            });
            const event = {
                eventKind: 'decision',
                label: 'Deliver now',
                summary: this.safeSliceText(decision.summary, 120),
                detail: this.safeSliceText(decision.reasoning, 180)
            };
            context.toolEvents.push(event);
            context.emit({ type: 'tool_event', runId: context.runId, ...event });
            return { ok: true, decision };
        });

        register({
            type: 'function',
            function: {
                name: 'schedule_notification_delivery',
                description: 'Programa la entrega futura de una notificación con la condicion exacta.',
                parameters: {
                    type: 'object',
                    properties: {
                        importance: { type: 'integer', description: 'Importancia de 0 a 100.' },
                        summary: { type: 'string', description: 'Resumen breve de la estrategia de entrega.' },
                        reasoning: { type: 'string', description: 'Por qué esta condicion conserva mejor la atención.' },
                        trigger_kind: {
                            type: 'string',
                            enum: Object.values(TRIGGER_KINDS),
                            description: 'Tipo de trigger que activará la entrega.'
                        },
                        trigger_at: { type: 'integer', description: 'Timestamp epoch ms si aplica.' },
                        location_id: { type: 'string', description: 'ID simbólico del lugar si aplica.' },
                        location_label: { type: 'string', description: 'Nombre legible del lugar.' },
                        app_id: { type: 'string', description: 'Bundle/package id si aplica.' },
                        app_name: { type: 'string', description: 'Nombre de la app si aplica.' },
                        keywords: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Palabras clave relevantes si aplica.'
                        },
                        ambient_profile: { type: 'string', description: 'Perfil de ambiente esperado si aplica.' },
                        note: { type: 'string', description: 'Nota breve de entrega.' }
                    },
                    required: ['importance', 'summary', 'reasoning', 'trigger_kind']
                }
            }
        }, async (args = {}) => {
            const decision = this._buildDecision(context.envelope, {
                kind: INTERRUPTION_KINDS.SCHEDULE,
                importance: args.importance,
                summary: args.summary,
                reasoning: args.reasoning,
                plan: normalizeDeliveryPlan({
                    kind: INTERRUPTION_KINDS.SCHEDULE,
                    trigger: {
                        kind: args.trigger_kind,
                        at: args.trigger_at,
                        locationId: args.location_id,
                        locationLabel: args.location_label,
                        appId: args.app_id,
                        appName: args.app_name,
                        keywords: args.keywords,
                        ambientProfile: args.ambient_profile,
                        reasoning: args.reasoning
                    },
                    note: args.note,
                    surface: DELIVERY_SURFACES.FACE_AUDIO,
                    shieldMode: SHIELD_MODES.OS_FOCUS_MODE
                })
            });
            const event = {
                eventKind: 'decision',
                label: 'Scheduled delivery',
                summary: `${decision.plan.trigger.kind}: ${this.safeSliceText(decision.summary, 90)}`,
                detail: this.safeSliceText(decision.reasoning, 180)
            };
            context.toolEvents.push(event);
            context.emit({ type: 'tool_event', runId: context.runId, ...event });
            return { ok: true, decision };
        });

        register({
            type: 'function',
            function: {
                name: 'suppress_notification',
                description: 'Suprime o descarta la notificación por ahora.',
                parameters: {
                    type: 'object',
                    properties: {
                        importance: { type: 'integer', description: 'Importancia de 0 a 100.' },
                        summary: { type: 'string', description: 'Resumen breve de por qué se suprime.' },
                        reasoning: { type: 'string', description: 'Explicación resumida.' },
                        note: { type: 'string', description: 'Nota opcional para auditoría.' }
                    },
                    required: ['importance', 'summary', 'reasoning']
                }
            }
        }, async (args = {}) => {
            const decision = this._buildDecision(context.envelope, {
                kind: INTERRUPTION_KINDS.SUPPRESS,
                importance: args.importance,
                summary: args.summary,
                reasoning: args.reasoning,
                plan: normalizeDeliveryPlan({
                    kind: INTERRUPTION_KINDS.SUPPRESS,
                    trigger: { kind: TRIGGER_KINDS.MANUAL_WINDOW },
                    note: args.note,
                    surface: DELIVERY_SURFACES.CHAT,
                    shieldMode: SHIELD_MODES.OS_FOCUS_MODE
                })
            });
            const event = {
                eventKind: 'decision',
                label: 'Suppressed',
                summary: this.safeSliceText(decision.summary, 120),
                detail: this.safeSliceText(decision.reasoning, 180)
            };
            context.toolEvents.push(event);
            context.emit({ type: 'tool_event', runId: context.runId, ...event });
            return { ok: true, decision };
        });

        return { definitions, handlers };
    }

    _buildDecision(envelope, input = {}) {
        return {
            notificationId: envelope.id,
            kind: String(input.kind || INTERRUPTION_KINDS.SCHEDULE),
            importance: this._clampInt(input.importance, 50, 0, 100),
            summary: String(input.summary || '').trim(),
            reasoning: String(input.reasoning || '').trim(),
            createdAt: Date.now(),
            plan: normalizeDeliveryPlan(input.plan || {})
        };
    }

    async _fallbackDecision(envelope, options = {}) {
        return this._buildDecision(envelope, {
            kind: INTERRUPTION_KINDS.SCHEDULE,
            importance: envelope.priorityHint,
            summary: 'Programada para revisión posterior por Time Manager.',
            reasoning: 'El modelo no dejó una decisión explícita final; se conserva bloqueada bajo modo enfoque completo hasta una oportunidad posterior.',
            plan: {
                kind: INTERRUPTION_KINDS.SCHEDULE,
                trigger: {
                    kind: TRIGGER_KINDS.TIME,
                    at: Date.now() + (Number(options.defaultDelayMs || 15 * 60 * 1000))
                },
                surface: DELIVERY_SURFACES.FACE_AUDIO,
                shieldMode: SHIELD_MODES.OS_FOCUS_MODE
            }
        });
    }

    _parseToolArgs(rawArgs) {
        if (!rawArgs) return {};
        if (typeof rawArgs === 'object') return rawArgs;
        try {
            return JSON.parse(rawArgs);
        } catch (_error) {
            return {};
        }
    }

    _clampInt(value, fallback, min, max) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(min, Math.min(max, Math.round(numeric)));
    }
}

module.exports = TimeManagerRuntime;

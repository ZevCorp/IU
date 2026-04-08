const {
    MANAGED_EXECUTOR_OPENCLAW,
    MANAGED_EXECUTOR_IU_DESKTOP,
    isManagedActionToolName,
    parseManagedActionArgs
} = require('./ManagedActionDefinition');

class AgentRuntime {
    constructor(options = {}) {
        this.modelSwitch = options.modelSwitch;
        this.knowledgeService = options.knowledgeService;
        this.logging = options.logging || null;
        this.safeSliceText = typeof options.safeSliceText === 'function'
            ? options.safeSliceText
            : ((value, max = 1200) => {
                const text = String(value || '').trim();
                if (text.length <= max) return text;
                return `${text.slice(0, max).trim()}...`;
            });
        this.getActionTools = typeof options.getActionTools === 'function'
            ? options.getActionTools
            : (() => []);
        this.executeActionTool = typeof options.executeActionTool === 'function'
            ? options.executeActionTool
            : (async () => null);
        this.openClawBridge = options.openClawBridge || null;
    }

    async planActionIntent(options = {}) {
        const text = String(options.text || options.prompt || '').trim();
        const mode = String(options.mode || 'general').trim().toLowerCase() || 'general';
        const allowReply = options.allowReply !== false;
        const recent = this._normalizeRecentMessages(options.recent);
        const longTerm = String(options.longTerm || '').trim();
        const learnedWorkflows = Array.isArray(options.learnedWorkflows)
            ? options.learnedWorkflows.filter(Boolean).slice(0, 4)
            : [];
        const actionTools = this.getActionTools();

        if (!text) {
            return {
                ok: false,
                kind: 'none',
                error: 'Texto vacio'
            };
        }

        if (!this.modelSwitch?.isReady?.({ capability: 'chat' })) {
            return {
                ok: false,
                kind: 'none',
                error: 'Modelo no disponible'
            };
        }

        if (!Array.isArray(actionTools) || actionTools.length === 0) {
            return {
                ok: false,
                kind: 'none',
                error: 'No hay tools de accion disponibles'
            };
        }

        const systemParts = [
            'Eres el runtime central de IÜ OS para interpretar instrucciones del usuario.',
            'Decides si corresponde ejecutar una accion del computador, programar un recordatorio, abrir Agar.io o solo responder brevemente.',
            'Reglas duras:',
            '- Si el usuario pide ejecutar algo ahora en su computador, usa una tool de accion.',
            '- Si pide un recordatorio o algo para despues, usa schedule_reminder.',
            '- Si pide jugar Agar.io, usa play_agario.',
            '- Si la intencion no es una accion clara y allowReply es true, responde breve y natural en espanol.',
            '- Si la intencion no es una accion clara y allowReply es false, no inventes acciones.',
            '- No menciones tool calls, JSON ni pipeline interno.',
            '- Si una accion requiere varias apps, en app pon solo la primera y deja el resto en steps_hint.',
            `- Usa ${MANAGED_EXECUTOR_OPENCLAW} cuando la tarea sea principalmente de navegador o web.`,
            `- Usa ${MANAGED_EXECUTOR_IU_DESKTOP} para GUI desktop, AX, mouse o teclado sobre apps nativas.`,
            '- Siempre incluye executor_reason cuando prepares una accion.',
            `Modo actual: ${mode}.`,
            `FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-ES')}`
        ];

        if (learnedWorkflows.length > 0) {
            systemParts.push(
                'Aprendizajes relevantes del usuario:',
                ...learnedWorkflows.map((workflow, index) => {
                    const name = String(workflow?.workflowName || workflow?.name || `Workflow ${index + 1}`).trim();
                    const summary = String(workflow?.summary || workflow?.description || '').trim();
                    const style = String(workflow?.executionStyle || '').trim();
                    return `${index + 1}. ${name}${summary ? ` - ${summary}` : ''}${style ? ` (${style})` : ''}`;
                })
            );
        }

        if (longTerm) {
            systemParts.push('Memoria relevante del usuario:', longTerm);
        }

        const messages = [
            {
                role: 'system',
                content: systemParts.join('\n')
            },
            ...recent,
            {
                role: 'user',
                content: text
            }
        ];

        const response = await this.modelSwitch.chatCompletion({
            messages,
            tools: actionTools,
            tool_choice: 'auto'
        });

        const message = response?.choices?.[0]?.message || {};
        const reply = String(message.content || '').trim();
        const firstToolCall = Array.isArray(message.tool_calls) ? message.tool_calls[0] : null;
        const action = this._extractActionFromToolCall(firstToolCall);

        if (action) {
            return {
                ok: true,
                kind: 'action',
                action,
                reply,
                toolCall: firstToolCall || null
            };
        }

        if (allowReply) {
            return {
                ok: true,
                kind: 'reply',
                reply
            };
        }

        return {
            ok: true,
            kind: 'none',
            reply
        };
    }

    async runPromptChat(options = {}) {
        const prompt = String(options.prompt || '').trim();
        const runId = String(options.runId || `prompt_run_${Date.now()}`).trim();
        const emit = typeof options.emit === 'function' ? options.emit : () => {};
        const recent = this._normalizeRecentMessages(options.recent);
        const longTerm = String(options.longTerm || '').trim();
        const learnedWorkflows = Array.isArray(options.learnedWorkflows)
            ? options.learnedWorkflows.filter(Boolean).slice(0, 4)
            : [];

        if (!prompt) {
            emit({
                type: 'status',
                phase: 'error',
                visibility: 'public',
                message: 'Prompt vacío'
            });
            return {
                success: false,
                runId,
                error: 'Prompt vacio',
                assistantReply: ''
            };
        }

        if (!this.modelSwitch?.isReady?.({ capability: 'chat' })) {
            emit({
                type: 'status',
                phase: 'error',
                visibility: 'public',
                message: 'Modelo no disponible'
            });
            return {
                success: false,
                runId,
                error: 'Provider de texto no inicializado',
                assistantReply: ''
            };
        }

        const changes = {
            createdNotes: [],
            updatedNotes: [],
            deletedNotes: [],
            createdMetas: [],
            updatedMetas: [],
            deletedMetas: [],
            attachments: [],
            detachments: [],
            financeUpdates: [],
            actions: []
        };
        const toolEvents = [];
        const failures = [];
        const toolRegistry = this._createToolRegistry({ emit, changes, runId });
        const workspaceDigest = this._buildWorkspaceDigest();
        const actionFastPath = await this.planActionIntent({
            text: prompt,
            recent,
            longTerm,
            learnedWorkflows,
            allowReply: false,
            mode: 'prompt_chat'
        }).catch(() => null);

        if (actionFastPath?.kind === 'action' && actionFastPath?.toolCall) {
            const toolName = String(actionFastPath.toolCall?.function?.name || '').trim();
            const args = this._parseToolArgs(actionFastPath.toolCall?.function?.arguments);
            if (toolName) {
                const preamble = this._looksLikeInternalReasoning(actionFastPath.reply)
                    ? ''
                    : this._extractAssistantStatusMessage(actionFastPath.reply);
                if (preamble) {
                    emit({
                        type: 'assistant_message',
                        phase: 'execution',
                        message: preamble
                    });
                }

                emit({
                    type: 'tool_call',
                    phase: 'start',
                    toolName,
                    args: this._buildToolCallPreview(toolName, args)
                });

                let result;
                try {
                    result = await this.executeActionTool({
                        name: toolName,
                        args,
                        runId
                    });
                } catch (error) {
                    result = {
                        ok: false,
                        error: error?.message || `Falló ${toolName}`
                    };
                }

                if (result?.action) {
                    changes.actions.push(result.action);
                }
                if (result?.ok === false) {
                    failures.push(String(result?.error || `Falló ${toolName}`));
                }
                emit({
                    type: 'tool_call',
                    phase: 'result',
                    toolName,
                    ok: result?.ok !== false,
                    args: this._buildToolCallPreview(toolName, args),
                    result: this._buildToolCallPreview(toolName, result)
                });

                const publicEvent = this._buildPublicToolEvent(toolName, args, result);
                if (publicEvent) {
                    toolEvents.push(publicEvent);
                    emit({
                        type: 'tool_event',
                        runId,
                        ...publicEvent
                    });
                }

                const assistantReply = this._buildFastPathActionReply(result, actionFastPath.reply);
                return {
                    success: true,
                    runId,
                    assistantReply,
                    toolEvents,
                    changes
                };
            }
        }

        const messages = [
            {
                role: 'system',
                content: [
                    'Eres el runtime central del chat principal de IÜ OS.',
                    'Trabajas como un agente generalista de nivel coding-agent, pero sobre conocimiento personal y acciones del computador.',
                    'Tu trabajo es resolver peticiones usando herramientas libremente, sin pedir permiso innecesario ni inventar contexto que puedes verificar.',
                    'Puedes inspeccionar notas, metas y ejecutar acciones del computador cuando haga falta.',
                    'Reglas duras:',
                    '- Si una operación es destructiva (borrar nota/meta), solo ejecútala cuando la intención del usuario sea explícita.',
                    '- No hables del pipeline interno, no menciones JSON ni tool calls.',
                    '- No expongas razonamiento interno, cadenas tipo "The user wants..." ni listas de planificación ocultas.',
                    '- Si necesitas contexto, usa herramientas; no adivines.',
                    '- Si el usuario solo conversa, responde normal y no fuerces herramientas.',
                    '- Si el usuario escribe solo un nombre, tema, frase suelta o algo ambiguo, no lo conviertas automaticamente en una accion sobre notas o metas.',
                    '- Solo crea, edita, anida o borra notas/metas cuando la intencion del usuario sea clara.',
                    '- Si el usuario pide un listado o panorama general, intenta resolverlo con una sola tool de listado o búsqueda; no abras cada elemento uno por uno salvo que haga falta.',
                    '- Evita tool calls redundantes cuando ya tengas datos suficientes para responder.',
                    '- Si vas a usar tools, puedes escribir mensajes intermedios libres antes de un bloque de ejecucion cuando ayuden al usuario.',
                    '- Si explicas algo antes de ejecutar, habla de la fase o del bloque completo que sigue, no describas cada tool ni cada cambio individual.',
                    '- Si no hace falta explicar nada, puedes ejecutar directamente sin escribir mensajes intermedios.',
                    '- En tareas compuestas o largas, suele ser buena idea escribir una frase breve antes del primer bloque importante para orientar al usuario.',
                    '- Si vas a encadenar varias tools y tu mensaje quedaria vacio, prefiere escribir una explicacion corta de lo que vas a hacer primero.',
                    '- Buen ejemplo de mensaje intermedio: "Voy a revisar las metas que ya tienes, elegiré una direccion clara y despues crearé las notas necesarias para sostenerla."',
                    '- Otro buen ejemplo: "Primero voy a abrir tus metas para elegir la más alineada con tu app, y después bajaré eso a un plan ejecutable en notas anidadas."',
                    '- Evita mensajes repetitivos y demasiado granulares como "Voy a crear una nota..." antes de cada creacion.',
                    '- Cuando el usuario pida varios elementos nuevos, intenta que sean distintos entre si y evita duplicados tontos.',
                    '- Si ya hiciste cambios, dilo claro y preciso al final.',
                    '- Responde en español.',
                    '- Mantén la respuesta final breve, directa y útil.'
                ].join('\n')
            },
            ...(learnedWorkflows.length > 0
                ? [{
                    role: 'system',
                    content: [
                        'Aprendizajes relevantes del usuario:',
                        ...learnedWorkflows.map((workflow, index) => {
                            const name = String(workflow?.workflowName || workflow?.name || `Workflow ${index + 1}`).trim();
                            const summary = String(workflow?.summary || workflow?.description || '').trim();
                            const style = String(workflow?.executionStyle || '').trim();
                            return `${index + 1}. ${name}${summary ? ` - ${summary}` : ''}${style ? ` (${style})` : ''}`;
                        })
                    ].join('\n')
                }]
                : []),
            ...(longTerm
                ? [{
                    role: 'system',
                    content: `Memoria semántica relevante:\n${longTerm}`
                }]
                : []),
            ...(recent.length > 0
                ? [{
                    role: 'system',
                    content: `Hilo reciente del usuario:\n${recent.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n')}`
                }]
                : []),
            {
                role: 'system',
                content: `Estado actual de notas y metas:\n${JSON.stringify(workspaceDigest)}`
            },
            {
                role: 'user',
                content: prompt
            }
        ];

        const maxTurns = Math.max(4, Math.min(10, Number(options.maxTurns || 8)));
        let assistantReply = '';
        let emptyResponseRetries = 0;
        let reasoningRetryCount = 0;

        for (let turn = 1; turn <= maxTurns; turn += 1) {
            const response = await this.modelSwitch.chatCompletion({
                messages,
                tools: toolRegistry.definitions,
                tool_choice: 'auto'
            });

            const message = response?.choices?.[0]?.message || {};
            const assistantMessage = {
                role: 'assistant',
                content: message.content || '',
                tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined
            };
            messages.push(assistantMessage);

            if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
                assistantReply = String(message.content || '').trim();
                if (!assistantReply) {
                    if (emptyResponseRetries < 1 && turn < maxTurns) {
                        emptyResponseRetries += 1;
                        messages.push({
                            role: 'system',
                            content: 'Tu turno anterior salió vacío. Reintenta ahora con una respuesta útil: responde normalmente o usa tools si hacen falta.'
                        });
                        continue;
                    }
                    failures.push('El modelo no devolvió una respuesta útil para esta solicitud.');
                } else if (this._looksLikeInternalReasoning(assistantReply) && reasoningRetryCount < 1 && turn < maxTurns) {
                    reasoningRetryCount += 1;
                    assistantReply = '';
                    messages.push({
                        role: 'system',
                        content: 'Tu mensaje anterior expuso razonamiento interno o un plan oculto. Reintenta ahora con una respuesta final natural en español o usando tools si hace falta, sin mostrar análisis interno.'
                    });
                    continue;
                }
                break;
            }

            let assistantStatus = this._extractAssistantStatusMessage(message.content);
            if (!assistantStatus && this._shouldRequestExecutionPreamble({
                prompt,
                turn,
                toolCalls: message.tool_calls
            })) {
                assistantStatus = await this._generateExecutionPreamble({
                    prompt,
                    toolCalls: message.tool_calls
                });
            }
            if (assistantStatus) {
                emit({
                    type: 'assistant_message',
                    phase: 'execution',
                    message: assistantStatus
                });
            }

            for (const call of message.tool_calls) {
                const toolName = String(call?.function?.name || '').trim();
                const handler = toolRegistry.handlers.get(toolName);
                if (!handler) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: JSON.stringify({ ok: false, error: `Tool desconocida: ${toolName}` })
                    });
                    continue;
                }

                const args = this._parseToolArgs(call?.function?.arguments);
                emit({
                    type: 'tool_call',
                    phase: 'start',
                    toolName,
                    args: this._buildToolCallPreview(toolName, args)
                });

                let result;
                try {
                    result = await handler(args, { runId, prompt, toolName });
                } catch (error) {
                    result = {
                        ok: false,
                        error: error?.message || `Falló ${toolName}`
                    };
                }
                if (result?.ok === false) {
                    failures.push(String(result?.error || `Falló ${toolName}`));
                }
                emit({
                    type: 'tool_call',
                    phase: 'result',
                    toolName,
                    ok: result?.ok !== false,
                    args: this._buildToolCallPreview(toolName, args),
                    result: this._buildToolCallPreview(toolName, result)
                });

                const publicEvent = this._buildPublicToolEvent(toolName, args, result);
                if (publicEvent) {
                    toolEvents.push(publicEvent);
                    emit({
                        type: 'tool_event',
                        runId,
                        ...publicEvent
                    });
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(this._buildToolResultPayload(toolName, args, result))
                });
            }
        }

        if (!assistantReply) {
            assistantReply = this._fallbackAssistantReply(changes, failures);
        }

        const changeSummary = this._buildChangeSummary(changes);
        if (changeSummary) {
            const summaryEvent = {
                eventKind: 'summary',
                label: 'Summary',
                summary: changeSummary.title,
                detail: changeSummary.detail,
                items: changeSummary.items
            };
            toolEvents.push(summaryEvent);
            emit({
                type: 'tool_event',
                runId,
                ...summaryEvent
            });
        }

        return {
            success: true,
            runId,
            assistantReply,
            toolEvents,
            changes
        };
    }

    _buildWorkspaceDigest() {
        const state = this.knowledgeService?.getKnowledgeState?.() || { tabs: [], metas: [] };
        const notes = Array.isArray(state.tabs) ? state.tabs : [];
        const metas = Array.isArray(state.metas) ? state.metas : [];

        return {
            notesCount: notes.length,
            metasCount: metas.length,
            notes: notes.slice(0, 80).map((note) => ({
                id: String(note?.id || ''),
                title: String(note?.title || '').trim() || 'Sin titulo',
                preview: this.safeSliceText(note?.body || '', 180),
                charCount: String(note?.body || '').trim().length
            })),
            metas: metas.slice(0, 40).map((meta) => ({
                id: String(meta?.id || ''),
                kind: String(meta?.kind || 'generic'),
                isFixed: Boolean(meta?.isFixed),
                title: String(meta?.title || '').trim() || 'Meta sin titulo',
                description: this.safeSliceText(meta?.description || '', 180),
                noteIds: Array.isArray(meta?.noteIds) ? meta.noteIds.slice(0, 16) : [],
                finance: meta?.kind === 'finance'
                    ? {
                        pocketCount: Array.isArray(meta?.finance?.pockets) ? meta.finance.pockets.length : 0,
                        totalBalance: (Array.isArray(meta?.finance?.pockets) ? meta.finance.pockets : []).reduce((sum, pocket) => sum + Number(pocket?.balance || 0), 0),
                        expectedIncome: Number(meta?.finance?.forecast?.expectedIncome || 0),
                        expectedExpenses: Number(meta?.finance?.forecast?.expectedExpenses || 0),
                        horizonWeeks: Number(meta?.finance?.forecast?.horizonWeeks || 0)
                    }
                    : null
            }))
        };
    }

    _createToolRegistry(registryContext = {}) {
        const handlers = new Map();
        const definitions = [];
        const register = (definition, handler) => {
            definitions.push(definition);
            handlers.set(definition.function.name, handler);
        };

        register({
            type: 'function',
            function: {
                name: 'list_notes',
                description: 'Lista notas disponibles con titulo, preview y estado suficiente para responder panoramas generales.',
                parameters: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', description: 'Cantidad maxima de notas.' }
                    }
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const limit = this._clampInt(args.limit, 12, 1, 60);
            const notes = this._getNotes()
                .slice(0, limit)
                .map((note) => this._summarizeNote(note));
            return { ok: true, notes, count: notes.length };
        });

        register({
            type: 'function',
            function: {
                name: 'search_notes',
                description: 'Busca notas por titulo o contenido.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Texto a buscar.' },
                        limit: { type: 'integer', description: 'Cantidad maxima de resultados.' }
                    },
                    required: ['query']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const query = String(args.query || '').trim();
            const limit = this._clampInt(args.limit, 8, 1, 24);
            const matches = this._searchNotes(query, limit);
            return {
                ok: true,
                query,
                matches,
                count: matches.length
            };
        });

        register({
            type: 'function',
            function: {
                name: 'find_note_by_title',
                description: 'Busca una nota por coincidencia de titulo y devuelve la mejor candidata.',
                parameters: {
                    type: 'object',
                    properties: {
                        title_query: { type: 'string', description: 'Titulo o fragmento del titulo.' }
                    },
                    required: ['title_query']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const titleQuery = String(args.title_query || '').trim();
            const note = this._findBestNoteByTitle(titleQuery);
            if (!note) return { ok: false, error: 'No encontré una nota con ese titulo.' };
            return {
                ok: true,
                note: this._summarizeNote(note)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'get_note',
                description: 'Lee una nota completa por id.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota.' },
                        max_chars: { type: 'integer', description: 'Maximo de caracteres a devolver.' }
                    },
                    required: ['note_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const noteId = String(args.note_id || '').trim();
            const maxChars = this._clampInt(args.max_chars, 12000, 200, 24000);
            const note = this._findNote(noteId);
            if (!note) return { ok: false, error: 'Nota no encontrada', note_id: noteId };
            return {
                ok: true,
                note: {
                    id: note.id,
                    title: note.title || 'Sin titulo',
                    body: this.safeSliceText(note.body || '', maxChars),
                    updatedAt: note.updatedAt || null
                }
            };
        });

        register({
            type: 'function',
            function: {
                name: 'create_note',
                description: 'Crea una nota nueva.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Titulo de la nota.' },
                        body: { type: 'string', description: 'Contenido inicial.' },
                        meta_id: { type: 'string', description: 'Meta opcional a la que se anida.' }
                    },
                    required: ['title']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const requestedTitle = String(args.title || '').trim();
            const resolvedTitle = this._ensureUniqueNoteTitle(requestedTitle);
            const created = this.knowledgeService.createNote({
                title: resolvedTitle,
                body: args.body !== undefined ? String(args.body || '') : '',
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            const note = created?.note || created?.tab || null;
            if (!note?.id) return { ok: false, error: 'No pude crear la nota.' };
            registryContext.changes.createdNotes.push({ id: note.id, title: note.title || 'Sin titulo' });
            const metaId = String(args.meta_id || '').trim();
            if (metaId) {
                const meta = this.knowledgeService.attachNoteToMeta(metaId, note.id, {
                    source: 'prompt_agent',
                    runId: runtimeContext.runId
                });
                if (meta?.id) {
                    registryContext.changes.attachments.push({
                        metaId: meta.id,
                        metaTitle: meta.title || 'Meta sin titulo',
                        noteId: note.id,
                        noteTitle: note.title || 'Sin titulo'
                    });
                }
            }
            return {
                ok: true,
                note: this._summarizeNote(this._findNote(note.id) || note)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'append_to_note',
                description: 'Agrega texto al final de una nota existente.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota.' },
                        text: { type: 'string', description: 'Texto a agregar.' }
                    },
                    required: ['note_id', 'text']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const noteId = String(args.note_id || '').trim();
            const text = String(args.text || '');
            const current = this._findNote(noteId);
            if (!current) return { ok: false, error: 'No encontré esa nota para agregar contenido.' };
            const baseBody = String(current.body || '');
            const nextBody = baseBody.trimEnd()
                ? `${baseBody.replace(/\s+$/, '')}\n\n${text.trim()}`
                : text.trim();
            const updated = this.knowledgeService.updateNote(noteId, {
                body: nextBody,
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!updated?.note) return { ok: false, error: 'No pude agregar contenido a esa nota.' };
            registryContext.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
            return {
                ok: true,
                note: this._summarizeNote(updated.note)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'replace_in_note',
                description: 'Reemplaza un fragmento exacto dentro de una nota.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota.' },
                        find_text: { type: 'string', description: 'Texto exacto a reemplazar.' },
                        replace_with: { type: 'string', description: 'Texto nuevo.' }
                    },
                    required: ['note_id', 'find_text', 'replace_with']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const noteId = String(args.note_id || '').trim();
            const findText = String(args.find_text || '');
            const replaceWith = String(args.replace_with || '');
            const current = this._findNote(noteId);
            if (!current) return { ok: false, error: 'No encontré esa nota para reemplazar texto.' };
            const body = String(current.body || '');
            if (!findText || !body.includes(findText)) {
                return { ok: false, error: 'No encontré ese fragmento exacto dentro de la nota.' };
            }
            const nextBody = body.replace(findText, replaceWith);
            const updated = this.knowledgeService.updateNote(noteId, {
                body: nextBody,
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!updated?.note) return { ok: false, error: 'No pude reemplazar el texto en esa nota.' };
            registryContext.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
            return {
                ok: true,
                note: this._summarizeNote(updated.note)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'update_note',
                description: 'Actualiza una nota existente reemplazando titulo o contenido completo.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota.' },
                        title: { type: 'string', description: 'Nuevo titulo.' },
                        body: { type: 'string', description: 'Nuevo contenido completo.' }
                    },
                    required: ['note_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const updated = this.knowledgeService.updateNote(String(args.note_id || '').trim(), {
                title: args.title,
                body: args.body,
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!updated?.note) return { ok: false, error: 'No encontré esa nota para actualizar.' };
            registryContext.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
            return {
                ok: true,
                note: this._summarizeNote(updated.note)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'delete_note',
                description: 'Elimina una nota existente.',
                parameters: {
                    type: 'object',
                    properties: {
                        note_id: { type: 'string', description: 'ID de la nota.' }
                    },
                    required: ['note_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const note = this._findNote(String(args.note_id || '').trim());
            const deleted = this.knowledgeService.deleteNote(String(args.note_id || '').trim(), {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!deleted) return { ok: false, error: 'No pude eliminar esa nota.' };
            registryContext.changes.deletedNotes.push({
                id: String(args.note_id || '').trim(),
                title: note?.title || 'Nota'
            });
            return { ok: true, deleted: true, note_id: String(args.note_id || '').trim() };
        });

        register({
            type: 'function',
            function: {
                name: 'list_metas',
                description: 'Lista metas disponibles con descripcion, cantidad de notas y algunos titulos enlazados.',
                parameters: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', description: 'Cantidad maxima de metas.' }
                    }
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const limit = this._clampInt(args.limit, 12, 1, 40);
            const metas = this._getMetas()
                .slice(0, limit)
                .map((meta) => this._summarizeMeta(meta));
            return { ok: true, metas, count: metas.length };
        });

        register({
            type: 'function',
            function: {
                name: 'search_metas',
                description: 'Busca metas por titulo o descripcion.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Texto a buscar.' },
                        limit: { type: 'integer', description: 'Cantidad maxima de resultados.' }
                    },
                    required: ['query']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const query = String(args.query || '').trim();
            const limit = this._clampInt(args.limit, 8, 1, 24);
            const matches = this._searchMetas(query, limit);
            return {
                ok: true,
                query,
                matches,
                count: matches.length
            };
        });

        register({
            type: 'function',
            function: {
                name: 'find_meta_by_title',
                description: 'Busca una meta por coincidencia de titulo y devuelve la mejor candidata.',
                parameters: {
                    type: 'object',
                    properties: {
                        title_query: { type: 'string', description: 'Titulo o fragmento del titulo.' }
                    },
                    required: ['title_query']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const titleQuery = String(args.title_query || '').trim();
            const meta = this._findBestMetaByTitle(titleQuery);
            if (!meta) return { ok: false, error: 'No encontré una meta con ese titulo.' };
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'get_meta',
                description: 'Lee una meta con sus notas enlazadas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta.' }
                    },
                    required: ['meta_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const metaId = String(args.meta_id || '').trim();
            const meta = this._findMeta(metaId);
            if (!meta) return { ok: false, error: 'Meta no encontrada', meta_id: metaId };
            const noteTitles = (Array.isArray(meta.noteIds) ? meta.noteIds : [])
                .map((noteId) => this._findNote(noteId))
                .filter(Boolean)
                .map((note) => ({ id: note.id, title: note.title || 'Sin titulo' }));
            return {
                ok: true,
                meta: {
                    ...this._summarizeMeta(meta),
                    notes: noteTitles
                }
            };
        });

        register({
            type: 'function',
            function: {
                name: 'create_meta',
                description: 'Crea una meta nueva.',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Titulo de la meta.' },
                        description: { type: 'string', description: 'Descripcion de la meta.' }
                    },
                    required: ['title']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.createMeta({
                title: String(args.title || '').trim(),
                description: String(args.description || '').trim(),
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude crear la meta.' };
            registryContext.changes.createdMetas.push({ id: meta.id, title: meta.title || 'Meta sin titulo' });
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'update_meta',
                description: 'Actualiza una meta existente.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta.' },
                        title: { type: 'string', description: 'Nuevo titulo.' },
                        description: { type: 'string', description: 'Nueva descripcion.' }
                    },
                    required: ['meta_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.updateMeta(String(args.meta_id || '').trim(), {
                title: args.title,
                description: args.description,
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No encontré esa meta para actualizar.' };
            registryContext.changes.updatedMetas.push({ id: meta.id, title: meta.title || 'Meta sin titulo' });
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'update_finance_instructions',
                description: 'Actualiza el texto libre de la meta fija Finanzas. Úsalo para capturar reglas operativas, feedback y criterios futuros del agente financiero.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        instructions: { type: 'string', description: 'Nuevo texto completo de instrucciones.' }
                    },
                    required: ['meta_id', 'instructions']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.updateFinanceInstructions(String(args.meta_id || '').trim(), String(args.instructions || ''), {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude actualizar las instrucciones de Finanzas.' };
            registryContext.changes.financeUpdates.push({ type: 'instructions', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'create_finance_pocket',
                description: 'Crea un bolsillo dentro de la meta fija Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        name: { type: 'string', description: 'Nombre del bolsillo.' },
                        bank: { type: 'string', description: 'Banco o app bancaria.' },
                        purpose: { type: 'string', description: 'Propósito del bolsillo.' },
                        balance: { type: 'number', description: 'Saldo inicial.' }
                    },
                    required: ['meta_id', 'name']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.createFinancePocket(String(args.meta_id || '').trim(), {
                name: String(args.name || '').trim(),
                bank: String(args.bank || '').trim(),
                purpose: String(args.purpose || '').trim(),
                balance: Number(args.balance || 0)
            }, {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude crear ese bolsillo en Finanzas.' };
            registryContext.changes.financeUpdates.push({ type: 'create_pocket', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'update_finance_pocket',
                description: 'Edita un bolsillo existente de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo.' },
                        name: { type: 'string', description: 'Nuevo nombre.' },
                        bank: { type: 'string', description: 'Nuevo banco o app.' },
                        purpose: { type: 'string', description: 'Nuevo propósito.' },
                        balance: { type: 'number', description: 'Nuevo saldo absoluto.' }
                    },
                    required: ['meta_id', 'pocket_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.updateFinancePocket(String(args.meta_id || '').trim(), String(args.pocket_id || '').trim(), {
                name: args.name,
                bank: args.bank,
                purpose: args.purpose,
                balance: args.balance
            }, {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude actualizar ese bolsillo de Finanzas.' };
            registryContext.changes.financeUpdates.push({ type: 'update_pocket', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'delete_finance_pocket',
                description: 'Elimina un bolsillo de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo.' }
                    },
                    required: ['meta_id', 'pocket_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.deleteFinancePocket(String(args.meta_id || '').trim(), String(args.pocket_id || '').trim(), {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude eliminar ese bolsillo de Finanzas.' };
            registryContext.changes.financeUpdates.push({ type: 'delete_pocket', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'deposit_finance_pocket',
                description: 'Carga dinero en un bolsillo de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo.' },
                        amount: { type: 'number', description: 'Monto a cargar.' }
                    },
                    required: ['meta_id', 'pocket_id', 'amount']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.adjustFinancePocket(
                String(args.meta_id || '').trim(),
                String(args.pocket_id || '').trim(),
                Number(args.amount || 0),
                'deposit',
                {
                    source: 'prompt_agent',
                    runId: runtimeContext.runId
                }
            );
            if (!meta?.id) return { ok: false, error: 'No pude cargar dinero en ese bolsillo.' };
            registryContext.changes.financeUpdates.push({ type: 'deposit_pocket', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'withdraw_finance_pocket',
                description: 'Descarga dinero de un bolsillo de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        pocket_id: { type: 'string', description: 'ID del bolsillo.' },
                        amount: { type: 'number', description: 'Monto a descargar.' }
                    },
                    required: ['meta_id', 'pocket_id', 'amount']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.adjustFinancePocket(
                String(args.meta_id || '').trim(),
                String(args.pocket_id || '').trim(),
                Number(args.amount || 0),
                'withdraw',
                {
                    source: 'prompt_agent',
                    runId: runtimeContext.runId
                }
            );
            if (!meta?.id) return { ok: false, error: 'No pude descargar dinero de ese bolsillo.' };
            registryContext.changes.financeUpdates.push({ type: 'withdraw_pocket', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'move_money_between_finance_pockets',
                description: 'Mueve dinero entre dos bolsillos de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        from_pocket_id: { type: 'string', description: 'ID del bolsillo origen.' },
                        to_pocket_id: { type: 'string', description: 'ID del bolsillo destino.' },
                        amount: { type: 'number', description: 'Monto a mover.' }
                    },
                    required: ['meta_id', 'from_pocket_id', 'to_pocket_id', 'amount']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.moveMoneyBetweenFinancePockets(
                String(args.meta_id || '').trim(),
                String(args.from_pocket_id || '').trim(),
                String(args.to_pocket_id || '').trim(),
                Number(args.amount || 0),
                {
                    source: 'prompt_agent',
                    runId: runtimeContext.runId
                }
            );
            if (!meta?.id) return { ok: false, error: 'No pude mover dinero entre esos bolsillos.' };
            registryContext.changes.financeUpdates.push({ type: 'move_between_pockets', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'update_finance_projection',
                description: 'Actualiza ingresos previstos, gastos previstos y horizonte temporal de Finanzas.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta de finanzas.' },
                        expected_income: { type: 'number', description: 'Ingreso previsto para el horizonte.' },
                        expected_expenses: { type: 'number', description: 'Gasto previsto para el horizonte.' },
                        horizon_weeks: { type: 'integer', description: 'Horizonte en semanas.' },
                        current_label: { type: 'string', description: 'Etiqueta de tiempo actual.' },
                        future_label: { type: 'string', description: 'Etiqueta de tiempo futuro.' }
                    },
                    required: ['meta_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.updateFinanceProjection(String(args.meta_id || '').trim(), {
                expectedIncome: args.expected_income,
                expectedExpenses: args.expected_expenses,
                horizonWeeks: args.horizon_weeks,
                currentLabel: args.current_label,
                futureLabel: args.future_label
            }, {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!meta?.id) return { ok: false, error: 'No pude actualizar la proyección de Finanzas.' };
            registryContext.changes.financeUpdates.push({ type: 'update_projection', metaId: meta.id, title: meta.title || 'Finanzas' });
            return { ok: true, meta: this._summarizeMeta(meta) };
        });

        register({
            type: 'function',
            function: {
                name: 'delete_meta',
                description: 'Elimina una meta existente.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta.' }
                    },
                    required: ['meta_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this._findMeta(String(args.meta_id || '').trim());
            const ok = this.knowledgeService.deleteMeta(String(args.meta_id || '').trim(), {
                source: 'prompt_agent',
                runId: runtimeContext.runId
            });
            if (!ok) return { ok: false, error: 'No pude eliminar esa meta.' };
            registryContext.changes.deletedMetas.push({
                id: String(args.meta_id || '').trim(),
                title: meta?.title || 'Meta'
            });
            return { ok: true, deleted: true, meta_id: String(args.meta_id || '').trim() };
        });

        register({
            type: 'function',
            function: {
                name: 'attach_note_to_meta',
                description: 'Anida una nota dentro de una meta.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta.' },
                        note_id: { type: 'string', description: 'ID de la nota.' }
                    },
                    required: ['meta_id', 'note_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.attachNoteToMeta(
                String(args.meta_id || '').trim(),
                String(args.note_id || '').trim(),
                { source: 'prompt_agent', runId: runtimeContext.runId }
            );
            if (!meta?.id) return { ok: false, error: 'No pude anidar la nota en esa meta.' };
            const note = this._findNote(String(args.note_id || '').trim());
            registryContext.changes.attachments.push({
                metaId: meta.id,
                metaTitle: meta.title || 'Meta sin titulo',
                noteId: String(args.note_id || '').trim(),
                noteTitle: note?.title || 'Sin titulo'
            });
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
        });

        register({
            type: 'function',
            function: {
                name: 'detach_note_from_meta',
                description: 'Saca una nota de una meta.',
                parameters: {
                    type: 'object',
                    properties: {
                        meta_id: { type: 'string', description: 'ID de la meta.' },
                        note_id: { type: 'string', description: 'ID de la nota.' }
                    },
                    required: ['meta_id', 'note_id']
                }
            }
        }, async (args = {}, runtimeContext = {}) => {
            const meta = this.knowledgeService.detachNoteFromMeta(
                String(args.meta_id || '').trim(),
                String(args.note_id || '').trim(),
                { source: 'prompt_agent', runId: runtimeContext.runId }
            );
            if (!meta?.id) return { ok: false, error: 'No pude sacar la nota de esa meta.' };
            const note = this._findNote(String(args.note_id || '').trim());
            registryContext.changes.detachments.push({
                metaId: meta.id,
                metaTitle: meta.title || 'Meta sin titulo',
                noteId: String(args.note_id || '').trim(),
                noteTitle: note?.title || 'Sin titulo'
            });
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
        });

        if (this.openClawBridge) {
            register({
                type: 'function',
                function: {
                    name: 'list_openclaw_documents',
                    description: 'Lista los markdowns y la configuración disponibles en la instalación local de OpenClaw.',
                    parameters: {
                        type: 'object',
                        properties: {}
                    }
                }
            }, async () => {
                const result = this.openClawBridge.scanOpenClawWorkspace();
                if (!result?.ok) {
                    return { ok: false, error: result?.reason || 'No encontré OpenClaw local.' };
                }
                return {
                    ok: true,
                    workspaceDir: result.workspaceDir,
                    configPath: result.configPath,
                    counts: result.counts,
                    documents: result.documents.map((document) => ({
                        document_id: document.documentId,
                        title: document.title,
                        category: document.category,
                        relative_path: document.relativePath,
                        char_count: document.charCount,
                        updated_at: document.updatedAt
                    }))
                };
            });

            register({
                type: 'function',
                function: {
                    name: 'get_openclaw_document',
                    description: 'Lee un markdown o la configuración importable de OpenClaw.',
                    parameters: {
                        type: 'object',
                        properties: {
                            document_id: { type: 'string', description: 'ID del documento devuelto por list_openclaw_documents.' },
                            max_chars: { type: 'integer', description: 'Máximo de caracteres a devolver.' }
                        },
                        required: ['document_id']
                    }
                }
            }, async (args = {}) => {
                const result = this.openClawBridge.readOpenClawDocument(
                    String(args.document_id || '').trim(),
                    this._clampInt(args.max_chars, 12000, 300, 60000)
                );
                if (!result?.ok) {
                    return { ok: false, error: result?.error || 'No pude leer ese documento de OpenClaw.' };
                }
                return {
                    ok: true,
                    document: {
                        document_id: result.document.documentId,
                        title: result.document.title,
                        category: result.document.category,
                        relative_path: result.document.relativePath,
                        body: result.document.body
                    }
                };
            });

            register({
                type: 'function',
                function: {
                    name: 'import_openclaw_documents',
                    description: 'Importa uno o varios documentos de OpenClaw como notas de Ü, evitando duplicados. Puede adjuntarlos a una meta existente.',
                    parameters: {
                        type: 'object',
                        properties: {
                            document_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'IDs de documentos devueltos por list_openclaw_documents.'
                            },
                            target_meta_id: { type: 'string', description: 'Meta opcional a la que se deben adjuntar las notas importadas.' }
                        },
                        required: ['document_ids']
                    }
                }
            }, async (args = {}) => {
                const documentIds = Array.isArray(args.document_ids) ? args.document_ids : [];
                const result = await this.openClawBridge.importOpenClawDocuments({
                    knowledgeService: this.knowledgeService,
                    documentIds,
                    targetMetaId: String(args.target_meta_id || '').trim()
                });
                if (!result?.ok) {
                    return { ok: false, error: result?.error || result?.reason || 'No pude importar esos documentos de OpenClaw.' };
                }
                const importedNotes = [];
                for (const entry of result.imported || []) {
                    const note = this._findNote(entry.noteId);
                    if (note) {
                        importedNotes.push({ id: note.id, title: note.title || entry.title || 'Sin titulo' });
                        registryContext.changes.updatedNotes.push({ id: note.id, title: note.title || entry.title || 'Sin titulo' });
                    }
                    if (args.target_meta_id) {
                        const meta = this._findMeta(String(args.target_meta_id || '').trim());
                        if (meta && note) {
                            registryContext.changes.attachments.push({
                                metaId: meta.id,
                                metaTitle: meta.title || 'Meta sin titulo',
                                noteId: note.id,
                                noteTitle: note.title || entry.title || 'Sin titulo'
                            });
                        }
                    }
                }
                return {
                    ok: true,
                    imported_count: Number(result.importedCount || 0),
                    notes: importedNotes
                };
            });

            register({
                type: 'function',
                function: {
                    name: 'sync_openclaw_memory',
                    description: 'Sincroniza los markdowns de OpenClaw ubicados en workspace/memory con la memoria semántica de Ü.',
                    parameters: {
                        type: 'object',
                        properties: {
                            document_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'IDs opcionales de documentos memory para indexar. Si se omiten, usa todos.'
                            }
                        }
                    }
                }
            }, async (args = {}) => {
                const result = await this.openClawBridge.syncOpenClawMemoryToSemanticMemory({
                    documentIds: Array.isArray(args.document_ids) ? args.document_ids : []
                });
                if (!result?.ok) {
                    return { ok: false, error: result?.error || result?.reason || 'No pude sincronizar la memoria de OpenClaw.' };
                }
                return {
                    ok: true,
                    skipped: Boolean(result.skipped),
                    imported_memory_documents: Number(result.importedMemoryDocuments || 0),
                    memory_path: String(result.memoryPath || '')
                };
            });
        }

        for (const actionTool of this.getActionTools()) {
            register(actionTool, async (args = {}, runtimeContext = {}) => {
                const result = await this.executeActionTool({
                    name: actionTool.function.name,
                    args,
                    runId: runtimeContext.runId
                });
                if (result?.action) {
                    registryContext.changes.actions.push(result.action);
                }
                return result || { ok: false, error: `No se pudo ejecutar ${actionTool.function.name}` };
            });
        }

        return { definitions, handlers };
    }

    _extractAssistantStatusMessage(content) {
        const text = String(content || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return this.safeSliceText(text, 220);
    }

    _looksLikeInternalReasoning(content) {
        const text = String(content || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!text) return false;
        return [
            'the user wants to',
            'we need to break down',
            'let\'s break down',
            'i need to',
            'first, i need to',
            'the request is',
            'voy a desglosar',
            'necesitamos desglosar',
            'plan:',
            'internal reasoning'
        ].some((pattern) => text.includes(pattern));
    }

    _buildFastPathActionReply(result = {}, suggestedReply = '') {
        const cleanSuggested = this._looksLikeInternalReasoning(suggestedReply)
            ? ''
            : String(suggestedReply || '').trim();
        if (cleanSuggested) return cleanSuggested;

        const action = result?.action || null;
        if (action?.type === 'managed_action') {
            return `Voy a ejecutarlo en ${action.app || 'tu computador'} y te iré mostrando el progreso.`;
        }
        if (action?.type === 'reminder') {
            return 'Listo. Dejé programado ese recordatorio.';
        }
        if (action?.type === 'play_agario') {
            return 'Listo. Preparé Agar.io para lanzarlo.';
        }
        if (String(result?.summary || '').trim()) {
            return `Listo. ${String(result.summary || '').trim()}.`;
        }
        if (String(result?.error || '').trim()) {
            return `No pude completar eso: ${String(result.error || '').trim()}.`;
        }
        return 'Listo.';
    }

    _shouldRequestExecutionPreamble(options = {}) {
        const prompt = String(options.prompt || '').trim();
        const turn = Number(options.turn || 1);
        const toolCalls = Array.isArray(options.toolCalls) ? options.toolCalls : [];
        if (turn !== 1) return false;
        if (toolCalls.length >= 2) return true;
        if (prompt.length >= 140 && toolCalls.length >= 1) return true;
        return false;
    }

    async _generateExecutionPreamble(options = {}) {
        if (!this.modelSwitch?.isReady?.({ capability: 'chat' })) {
            return '';
        }

        const prompt = String(options.prompt || '').trim();
        const plannedTools = (Array.isArray(options.toolCalls) ? options.toolCalls : [])
            .slice(0, 8)
            .map((call) => {
                const toolName = String(call?.function?.name || '').trim();
                const args = this._parseToolArgs(call?.function?.arguments);
                return {
                    tool: toolName,
                    preview: this._buildToolCallPreview(toolName, args)
                };
            });

        try {
            const response = await this.modelSwitch.chatCompletion({
                messages: [
                    {
                        role: 'system',
                        content: [
                            'Escribe una sola frase breve en español para orientar al usuario antes de ejecutar un bloque de trabajo.',
                            'Debe sonar natural, inteligente y concreta.',
                            'Habla del objetivo general o de la fase que viene, no describas tool por tool.',
                            'No menciones JSON, tools, pipeline interno ni IDs.',
                            'Si no hay nada útil que decir, responde con una cadena vacía.'
                        ].join('\n')
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            prompt,
                            plannedTools
                        })
                    }
                ]
            });
            return this._extractAssistantStatusMessage(response?.choices?.[0]?.message?.content || '');
        } catch (error) {
            return '';
        }
    }

    _buildPublicToolEvent(toolName, args = {}, result = {}) {
        if (!result || result.ok === false) {
            return {
                eventKind: 'error',
                label: 'Error',
                summary: String(result?.error || `Falló ${toolName}`),
                detail: ''
            };
        }

        if (toolName === 'list_notes') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: `Explored ${Number(result.count || 0)} note${Number(result.count || 0) === 1 ? '' : 's'}`,
                items: Array.isArray(result.notes) ? result.notes.slice(0, 4).map((note) => note.title) : []
            };
        }
        if (toolName === 'list_openclaw_documents') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: `Explored ${Number(result?.counts?.total || 0)} OpenClaw document${Number(result?.counts?.total || 0) === 1 ? '' : 's'}`,
                items: Array.isArray(result.documents) ? result.documents.slice(0, 4).map((document) => document.title) : []
            };
        }
        if (toolName === 'get_openclaw_document') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: 'Opened 1 OpenClaw document',
                items: result?.document?.title ? [result.document.title] : []
            };
        }
        if (toolName === 'import_openclaw_documents') {
            return {
                eventKind: 'changed',
                label: 'Changed',
                summary: `Imported ${Number(result.imported_count || 0)} OpenClaw note${Number(result.imported_count || 0) === 1 ? '' : 's'}`,
                items: Array.isArray(result.notes) ? result.notes.slice(0, 4).map((note) => note.title) : []
            };
        }
        if (toolName === 'sync_openclaw_memory') {
            return {
                eventKind: 'changed',
                label: 'Changed',
                summary: result?.skipped
                    ? 'OpenClaw memory already in sync'
                    : `Synced ${Number(result.imported_memory_documents || 0)} OpenClaw memory file${Number(result.imported_memory_documents || 0) === 1 ? '' : 's'}`,
                detail: String(result.memory_path || '').trim()
            };
        }
        if (toolName === 'search_notes') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: `Explored ${Number(result.count || 0)} match${Number(result.count || 0) === 1 ? '' : 'es'}`,
                detail: String(result.query || '').trim(),
                items: Array.isArray(result.matches) ? result.matches.slice(0, 4).map((note) => note.title) : []
            };
        }
        if (toolName === 'find_note_by_title') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: 'Matched 1 note',
                items: result?.note?.title ? [result.note.title] : []
            };
        }
        if (toolName === 'get_note') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: 'Opened 1 note',
                items: result?.note?.title ? [result.note.title] : []
            };
        }
        if (toolName === 'list_metas') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: `Explored ${Number(result.count || 0)} meta${Number(result.count || 0) === 1 ? '' : 's'}`,
                items: Array.isArray(result.metas) ? result.metas.slice(0, 4).map((meta) => meta.title) : []
            };
        }
        if (toolName === 'search_metas') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: `Explored ${Number(result.count || 0)} meta match${Number(result.count || 0) === 1 ? '' : 'es'}`,
                detail: String(result.query || '').trim(),
                items: Array.isArray(result.matches) ? result.matches.slice(0, 4).map((meta) => meta.title) : []
            };
        }
        if (toolName === 'find_meta_by_title') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: 'Matched 1 meta',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'get_meta') {
            return {
                eventKind: 'explored',
                label: 'Explored',
                summary: 'Opened 1 meta',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'create_note') {
            return {
                eventKind: 'created',
                label: 'Created',
                summary: 'Created 1 note',
                items: result?.note?.title ? [result.note.title] : []
            };
        }
        if (toolName === 'create_meta') {
            return {
                eventKind: 'created',
                label: 'Created',
                summary: 'Created 1 meta',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'update_note') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Edited 1 note',
                items: result?.note?.title ? [result.note.title] : []
            };
        }
        if (toolName === 'append_to_note' || toolName === 'replace_in_note') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Updated 1 note',
                items: result?.note?.title ? [result.note.title] : []
            };
        }
        if (toolName === 'update_meta') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Edited 1 meta',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'update_finance_instructions') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Updated finance instructions',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'create_finance_pocket') {
            return {
                eventKind: 'created',
                label: 'Created',
                summary: 'Created 1 finance pocket',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'update_finance_pocket' || toolName === 'deposit_finance_pocket' || toolName === 'withdraw_finance_pocket' || toolName === 'move_money_between_finance_pockets' || toolName === 'update_finance_projection') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Updated finance state',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'delete_finance_pocket') {
            return {
                eventKind: 'deleted',
                label: 'Deleted',
                summary: 'Deleted 1 finance pocket',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'attach_note_to_meta') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Updated meta linkage',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'detach_note_from_meta') {
            return {
                eventKind: 'edited',
                label: 'Edited',
                summary: 'Removed note from meta',
                items: result?.meta?.title ? [result.meta.title] : []
            };
        }
        if (toolName === 'delete_note') {
            return {
                eventKind: 'deleted',
                label: 'Deleted',
                summary: 'Deleted 1 note'
            };
        }
        if (toolName === 'delete_meta') {
            return {
                eventKind: 'deleted',
                label: 'Deleted',
                summary: 'Deleted 1 meta'
            };
        }
        if (isManagedActionToolName(toolName) || toolName === 'play_agario' || toolName === 'schedule_reminder') {
            return {
                eventKind: 'action',
                label: 'Action',
                summary: String(result?.summary || `Prepared ${toolName}`),
                detail: String(result?.detail || '').trim()
            };
        }

        return null;
    }

    _buildToolCallPreview(toolName, payload = {}) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const note = data.note && typeof data.note === 'object' ? data.note : null;
        const meta = data.meta && typeof data.meta === 'object' ? data.meta : null;

        if (toolName === 'create_note' || toolName === 'update_note') {
            return {
                note_id: String(data.note_id || note?.id || '').trim(),
                title: String(data.title || note?.title || '').trim(),
                body: this.safeSliceText(data.body || note?.body || '', 2400)
            };
        }
        if (toolName === 'append_to_note' || toolName === 'replace_in_note') {
            return {
                note_id: String(data.note_id || note?.id || '').trim(),
                title: String(note?.title || '').trim(),
                body: this.safeSliceText(note?.body || '', 2400),
                text: this.safeSliceText(data.text || '', 800)
            };
        }
        if (toolName === 'create_meta' || toolName === 'update_meta') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                title: String(data.title || meta?.title || '').trim(),
                description: this.safeSliceText(data.description || meta?.description || '', 1800)
            };
        }
        if (toolName === 'update_finance_instructions') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                title: String(meta?.title || '').trim(),
                instructions: this.safeSliceText(data.instructions || data.description || meta?.description || '', 1800)
            };
        }
        if (toolName === 'create_finance_pocket' || toolName === 'update_finance_pocket') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                pocket_id: String(data.pocket_id || '').trim(),
                name: String(data.name || '').trim(),
                bank: String(data.bank || '').trim(),
                purpose: this.safeSliceText(data.purpose || '', 240),
                balance: Number(data.balance || 0)
            };
        }
        if (toolName === 'delete_finance_pocket' || toolName === 'deposit_finance_pocket' || toolName === 'withdraw_finance_pocket') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                pocket_id: String(data.pocket_id || '').trim(),
                amount: Number(data.amount || 0)
            };
        }
        if (toolName === 'move_money_between_finance_pockets') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                from_pocket_id: String(data.from_pocket_id || '').trim(),
                to_pocket_id: String(data.to_pocket_id || '').trim(),
                amount: Number(data.amount || 0)
            };
        }
        if (toolName === 'update_finance_projection') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                expected_income: Number(data.expected_income || 0),
                expected_expenses: Number(data.expected_expenses || 0),
                horizon_weeks: Number(data.horizon_weeks || 0),
                current_label: String(data.current_label || '').trim(),
                future_label: String(data.future_label || '').trim()
            };
        }
        if (toolName === 'attach_note_to_meta' || toolName === 'detach_note_from_meta') {
            return {
                meta_id: String(data.meta_id || meta?.id || '').trim(),
                note_id: String(data.note_id || '').trim()
            };
        }
        return {};
    }

    _buildToolResultPayload(toolName, args = {}, result = {}) {
        return {
            tool: toolName,
            ok: result?.ok !== false,
            args,
            result: result?.note || result?.meta || result?.matches || result?.notes || result?.metas || result?.action || result?.summary || result?.error || result
        };
    }

    _buildChangeSummary(changes = {}) {
        const items = [];
        if ((changes.createdNotes || []).length > 0) items.push(`${changes.createdNotes.length} note${changes.createdNotes.length === 1 ? '' : 's'} created`);
        if ((changes.updatedNotes || []).length > 0) items.push(`${changes.updatedNotes.length} note${changes.updatedNotes.length === 1 ? '' : 's'} edited`);
        if ((changes.deletedNotes || []).length > 0) items.push(`${changes.deletedNotes.length} note${changes.deletedNotes.length === 1 ? '' : 's'} deleted`);
        if ((changes.createdMetas || []).length > 0) items.push(`${changes.createdMetas.length} meta${changes.createdMetas.length === 1 ? '' : 's'} created`);
        if ((changes.updatedMetas || []).length > 0) items.push(`${changes.updatedMetas.length} meta${changes.updatedMetas.length === 1 ? '' : 's'} edited`);
        if ((changes.deletedMetas || []).length > 0) items.push(`${changes.deletedMetas.length} meta${changes.deletedMetas.length === 1 ? '' : 's'} deleted`);
        if ((changes.attachments || []).length > 0) items.push(`${changes.attachments.length} linkage${changes.attachments.length === 1 ? '' : 's'} added`);
        if ((changes.detachments || []).length > 0) items.push(`${changes.detachments.length} linkage${changes.detachments.length === 1 ? '' : 's'} removed`);
        if ((changes.financeUpdates || []).length > 0) items.push(`${changes.financeUpdates.length} finance change${changes.financeUpdates.length === 1 ? '' : 's'} applied`);
        if ((changes.actions || []).length > 0) items.push(`${changes.actions.length} computer action${changes.actions.length === 1 ? '' : 's'} prepared`);
        if (items.length === 0) return null;
        return {
            title: `${items.length} change${items.length === 1 ? '' : 's'} recorded`,
            detail: items.join(' · '),
            items
        };
    }

    _fallbackAssistantReply(changes = {}, failures = []) {
        const summary = this._buildChangeSummary(changes);
        const firstFailure = Array.from(new Set((Array.isArray(failures) ? failures : []).filter(Boolean)))[0] || '';
        if (summary && firstFailure) {
            return `Hice parte del trabajo, pero hubo un problema: ${firstFailure}. ${summary.detail}.`;
        }
        if (summary) {
            return `Listo. ${summary.detail}.`;
        }
        if (firstFailure) {
            return `No pude completar eso: ${firstFailure}.`;
        }
        return 'No pude completar eso.';
    }

    _getKnowledgeState() {
        return this.knowledgeService?.getKnowledgeState?.() || { tabs: [], metas: [] };
    }

    _getNotes() {
        const state = this._getKnowledgeState();
        return Array.isArray(state.tabs) ? state.tabs : [];
    }

    _getMetas() {
        const state = this._getKnowledgeState();
        return Array.isArray(state.metas) ? state.metas : [];
    }

    _findNote(noteId) {
        const id = String(noteId || '').trim();
        return this._getNotes().find((note) => String(note?.id || '').trim() === id) || null;
    }

    _ensureUniqueNoteTitle(title) {
        const base = String(title || '').trim() || 'Sin titulo';
        const existing = new Set(
            this._getNotes()
                .map((note) => String(note?.title || '').trim().toLowerCase())
                .filter(Boolean)
        );
        if (!existing.has(base.toLowerCase())) return base;
        let index = 2;
        let candidate = `${base} ${index}`;
        while (existing.has(candidate.toLowerCase())) {
            index += 1;
            candidate = `${base} ${index}`;
        }
        return candidate;
    }

    _findMeta(metaId) {
        const id = String(metaId || '').trim();
        return this._getMetas().find((meta) => String(meta?.id || '').trim() === id) || null;
    }

    _summarizeNote(note) {
        return {
            id: String(note?.id || ''),
            title: String(note?.title || '').trim() || 'Sin titulo',
            preview: this.safeSliceText(note?.body || '', 180),
            updatedAt: note?.updatedAt || null
        };
    }

    _summarizeMeta(meta) {
        const linkedNotes = (Array.isArray(meta?.noteIds) ? meta.noteIds : [])
            .map((noteId) => this._findNote(noteId))
            .filter(Boolean)
            .slice(0, 6)
            .map((note) => ({
                id: note.id,
                title: note.title || 'Sin titulo'
            }));
        const pockets = Array.isArray(meta?.finance?.pockets) ? meta.finance.pockets : [];
        const totalBalance = pockets.reduce((sum, pocket) => sum + Number(pocket?.balance || 0), 0);
        return {
            id: String(meta?.id || ''),
            kind: String(meta?.kind || 'generic'),
            isFixed: Boolean(meta?.isFixed),
            title: String(meta?.title || '').trim() || 'Meta sin titulo',
            description: this.safeSliceText(meta?.description || '', 180),
            noteIds: Array.isArray(meta?.noteIds) ? meta.noteIds.slice(0, 24) : [],
            noteCount: Array.isArray(meta?.noteIds) ? meta.noteIds.length : 0,
            noteTitles: linkedNotes,
            finance: meta?.kind === 'finance'
                ? {
                    pocketCount: pockets.length,
                    totalBalance: Math.round(totalBalance * 100) / 100,
                    expectedIncome: Number(meta?.finance?.forecast?.expectedIncome || 0),
                    expectedExpenses: Number(meta?.finance?.forecast?.expectedExpenses || 0),
                    horizonWeeks: Number(meta?.finance?.forecast?.horizonWeeks || 0)
                }
                : null
        };
    }

    _searchNotes(query, limit = 8) {
        const needle = String(query || '').trim().toLowerCase();
        if (!needle) return [];
        const terms = needle.split(/\s+/).filter(Boolean);

        return this._getNotes()
            .map((note) => {
                const title = String(note?.title || '').toLowerCase();
                const body = String(note?.body || '').toLowerCase();
                let score = 0;
                for (const term of terms) {
                    if (title.includes(term)) score += 5;
                    if (body.includes(term)) score += 2;
                }
                if (!score) return null;
                return {
                    ...this._summarizeNote(note),
                    score
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    _searchMetas(query, limit = 8) {
        const needle = String(query || '').trim().toLowerCase();
        if (!needle) return [];
        const terms = needle.split(/\s+/).filter(Boolean);

        return this._getMetas()
            .map((meta) => {
                const title = String(meta?.title || '').toLowerCase();
                const description = String(meta?.description || '').toLowerCase();
                let score = 0;
                for (const term of terms) {
                    if (title.includes(term)) score += 5;
                    if (description.includes(term)) score += 2;
                }
                if (!score) return null;
                return {
                    ...this._summarizeMeta(meta),
                    score
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    _findBestNoteByTitle(titleQuery) {
        const query = String(titleQuery || '').trim().toLowerCase();
        if (!query) return null;
        return this._getNotes()
            .map((note) => {
                const title = String(note?.title || '').trim();
                const lowered = title.toLowerCase();
                let score = 0;
                if (lowered === query) score += 100;
                if (lowered.includes(query)) score += 40;
                if (query.includes(lowered) && lowered) score += 20;
                return score > 0 ? { note, score } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.note)[0] || null;
    }

    _findBestMetaByTitle(titleQuery) {
        const query = String(titleQuery || '').trim().toLowerCase();
        if (!query) return null;
        return this._getMetas()
            .map((meta) => {
                const title = String(meta?.title || '').trim();
                const lowered = title.toLowerCase();
                let score = 0;
                if (lowered === query) score += 100;
                if (lowered.includes(query)) score += 40;
                if (query.includes(lowered) && lowered) score += 20;
                return score > 0 ? { meta, score } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.meta)[0] || null;
    }

    _normalizeRecentMessages(messages) {
        if (!Array.isArray(messages)) return [];
        return messages
            .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
            .map((message) => ({
                role: message.role === 'user' ? 'user' : 'assistant',
                content: String(message.content || '').trim()
            }))
            .filter((message) => message.content.length > 0)
            .slice(-12);
    }

    _extractActionFromToolCall(call) {
        const toolName = String(call?.function?.name || '').trim();
        if (!toolName) return null;

        const args = this._parseToolArgs(call?.function?.arguments);

        if (isManagedActionToolName(toolName)) {
            const parsed = parseManagedActionArgs(args, {
                fallbackExecutor: MANAGED_EXECUTOR_IU_DESKTOP
            });
            if (!parsed.goal || !parsed.app || !parsed.stepsHint) return null;

            return {
                type: 'managed_action',
                goal: parsed.goal,
                app: parsed.app,
                stepsHint: parsed.stepsHint,
                executor: parsed.executor,
                executorReason: parsed.executorReason
            };
        }

        if (toolName === 'play_agario') {
            return {
                type: 'play_agario',
                nickname: String(args.nickname || '').trim()
            };
        }

        if (toolName === 'schedule_reminder') {
            const task = String(args.task || '').trim();
            const minutes = this._clampInt(args.minutes, 0, 1, 60 * 24 * 30);
            if (!task || !minutes) return null;
            return {
                type: 'schedule',
                task,
                minutes
            };
        }

        return null;
    }

    _parseToolArgs(raw) {
        try {
            return JSON.parse(raw || '{}');
        } catch (_) {
            return {};
        }
    }

    _clampInt(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.round(parsed)));
    }
}

module.exports = AgentRuntime;

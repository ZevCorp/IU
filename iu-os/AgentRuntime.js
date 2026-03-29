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
            actions: []
        };
        const toolEvents = [];
        const toolRegistry = this._createToolRegistry({ emit, changes, runId });
        const workspaceDigest = this._buildWorkspaceDigest();

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
                    '- Si necesitas contexto, usa herramientas; no adivines.',
                    '- Si el usuario solo conversa, responde normal y no fuerces herramientas.',
                    '- Si el usuario escribe solo un nombre, tema, frase suelta o algo ambiguo, no lo conviertas automaticamente en una accion sobre notas o metas.',
                    '- Solo crea, edita, anida o borra notas/metas cuando la intencion del usuario sea clara.',
                    '- Si el usuario pide un listado o panorama general, intenta resolverlo con una sola tool de listado o búsqueda; no abras cada elemento uno por uno salvo que haga falta.',
                    '- Evita tool calls redundantes cuando ya tengas datos suficientes para responder.',
                    '- Si vas a usar tools, puedes escribir antes una sola frase breve, natural y descriptiva sobre el siguiente paso. Debe sonar humana, concreta y util para el usuario.',
                    '- Cuando el usuario pida varios elementos nuevos, intenta que sean distintos entre si y evita duplicados tontos.',
                    '- Si ya hiciste cambios, dilo claro y preciso al final.',
                    '- Responde en español.',
                    '- Mantén la respuesta final breve, directa y útil.'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify({
                    prompt,
                    workspace: workspaceDigest
                })
            }
        ];

        const maxTurns = Math.max(4, Math.min(10, Number(options.maxTurns || 8)));
        let assistantReply = '';

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
                break;
            }

            const assistantStatus = this._extractAssistantStatusMessage(message.content);
            if (assistantStatus) {
                emit({
                    type: 'status',
                    phase: 'execution',
                    visibility: 'public',
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
                const statusMessage = this._buildStatusForToolStart(toolName, args);
                if (statusMessage && !assistantStatus) {
                    emit({
                        type: 'status',
                        phase: 'execution',
                        visibility: 'public',
                        message: statusMessage
                    });
                }

                let result;
                try {
                    result = await handler(args, { runId, prompt, toolName });
                } catch (error) {
                    result = {
                        ok: false,
                        error: error?.message || `Falló ${toolName}`
                    };
                }

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
            assistantReply = this._fallbackAssistantReply(changes);
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
                title: String(meta?.title || '').trim() || 'Meta sin titulo',
                description: this.safeSliceText(meta?.description || '', 180),
                noteIds: Array.isArray(meta?.noteIds) ? meta.noteIds.slice(0, 16) : []
            }))
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
                name: 'list_notes',
                description: 'Lista notas disponibles con titulo, preview y estado suficiente para responder panoramas generales.',
                parameters: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', description: 'Cantidad maxima de notas.' }
                    }
                }
            }
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
            const requestedTitle = String(args.title || '').trim();
            const resolvedTitle = this._ensureUniqueNoteTitle(requestedTitle);
            const created = this.knowledgeService.createNote({
                title: resolvedTitle,
                body: args.body !== undefined ? String(args.body || '') : ''
            });
            const note = created?.note || created?.tab || null;
            if (!note?.id) return { ok: false, error: 'No pude crear la nota.' };
            context.changes.createdNotes.push({ id: note.id, title: note.title || 'Sin titulo' });
            const metaId = String(args.meta_id || '').trim();
            if (metaId) {
                const meta = this.knowledgeService.attachNoteToMeta(metaId, note.id, { source: 'manual' });
                if (meta?.id) {
                    context.changes.attachments.push({
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
        }, async (args = {}) => {
            const noteId = String(args.note_id || '').trim();
            const text = String(args.text || '');
            const current = this._findNote(noteId);
            if (!current) return { ok: false, error: 'No encontré esa nota para agregar contenido.' };
            const baseBody = String(current.body || '');
            const nextBody = baseBody.trimEnd()
                ? `${baseBody.replace(/\s+$/, '')}\n\n${text.trim()}`
                : text.trim();
            const updated = this.knowledgeService.updateNote(noteId, { body: nextBody });
            if (!updated?.note) return { ok: false, error: 'No pude agregar contenido a esa nota.' };
            context.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
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
        }, async (args = {}) => {
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
            const updated = this.knowledgeService.updateNote(noteId, { body: nextBody });
            if (!updated?.note) return { ok: false, error: 'No pude reemplazar el texto en esa nota.' };
            context.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
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
        }, async (args = {}) => {
            const updated = this.knowledgeService.updateNote(String(args.note_id || '').trim(), {
                title: args.title,
                body: args.body
            });
            if (!updated?.note) return { ok: false, error: 'No encontré esa nota para actualizar.' };
            context.changes.updatedNotes.push({ id: updated.note.id, title: updated.note.title || 'Sin titulo' });
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
        }, async (args = {}) => {
            const note = this._findNote(String(args.note_id || '').trim());
            const deleted = this.knowledgeService.deleteNote(String(args.note_id || '').trim());
            if (!deleted) return { ok: false, error: 'No pude eliminar esa nota.' };
            context.changes.deletedNotes.push({
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
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
        }, async (args = {}) => {
            const meta = this.knowledgeService.createMeta({
                title: String(args.title || '').trim(),
                description: String(args.description || '').trim()
            });
            if (!meta?.id) return { ok: false, error: 'No pude crear la meta.' };
            context.changes.createdMetas.push({ id: meta.id, title: meta.title || 'Meta sin titulo' });
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
        }, async (args = {}) => {
            const meta = this.knowledgeService.updateMeta(String(args.meta_id || '').trim(), {
                title: args.title,
                description: args.description
            });
            if (!meta?.id) return { ok: false, error: 'No encontré esa meta para actualizar.' };
            context.changes.updatedMetas.push({ id: meta.id, title: meta.title || 'Meta sin titulo' });
            return {
                ok: true,
                meta: this._summarizeMeta(meta)
            };
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
        }, async (args = {}) => {
            const meta = this._findMeta(String(args.meta_id || '').trim());
            const ok = this.knowledgeService.deleteMeta(String(args.meta_id || '').trim());
            if (!ok) return { ok: false, error: 'No pude eliminar esa meta.' };
            context.changes.deletedMetas.push({
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
        }, async (args = {}) => {
            const meta = this.knowledgeService.attachNoteToMeta(
                String(args.meta_id || '').trim(),
                String(args.note_id || '').trim(),
                { source: 'manual' }
            );
            if (!meta?.id) return { ok: false, error: 'No pude anidar la nota en esa meta.' };
            const note = this._findNote(String(args.note_id || '').trim());
            context.changes.attachments.push({
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
        }, async (args = {}) => {
            const meta = this.knowledgeService.detachNoteFromMeta(
                String(args.meta_id || '').trim(),
                String(args.note_id || '').trim()
            );
            if (!meta?.id) return { ok: false, error: 'No pude sacar la nota de esa meta.' };
            const note = this._findNote(String(args.note_id || '').trim());
            context.changes.detachments.push({
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

        for (const actionTool of this.getActionTools()) {
            register(actionTool, async (args = {}, runtimeContext = {}) => {
                const result = await this.executeActionTool({
                    name: actionTool.function.name,
                    args,
                    runId: runtimeContext.runId
                });
                if (result?.action) {
                    context.changes.actions.push(result.action);
                }
                return result || { ok: false, error: `No se pudo ejecutar ${actionTool.function.name}` };
            });
        }

        return { definitions, handlers };
    }

    _buildStatusForToolStart(toolName, args = {}) {
        const noteTitle = this._resolveNoteStatusLabel(args.note_id, args.title);
        const metaTitle = this._resolveMetaStatusLabel(args.meta_id, args.title);
        const noteText = this._formatStatusLabel(noteTitle, 'esa nota');
        const metaText = this._formatStatusLabel(metaTitle, 'esa meta');
        const query = String(args.query || args.title_query || '').trim();

        if (toolName === 'search_notes') {
            return query
                ? `Estoy revisando tus notas para ubicar lo importante sobre "${this.safeSliceText(query, 80)}".`
                : 'Estoy revisando tus notas para ubicar lo importante.';
        }
        if (toolName === 'find_note_by_title' || toolName === 'find_meta_by_title') {
            return '';
        }
        if (toolName === 'list_notes' || toolName === 'list_metas') {
            if (toolName === 'list_notes') {
                return 'Estoy repasando tus notas para darte un panorama claro.';
            }
            return 'Estoy repasando tus metas para darte un panorama claro.';
        }
        if (toolName === 'get_note' || toolName === 'get_meta') {
            if (toolName === 'get_note') {
                return `Voy a abrir ${noteText} para trabajar con el contenido exacto.`;
            }
            return `Voy a abrir ${metaText} para revisar cómo está armada.`;
        }
        if (toolName === 'search_metas') {
            return query
                ? `Estoy revisando tus metas para encontrar lo relevante sobre "${this.safeSliceText(query, 80)}".`
                : 'Estoy revisando tus metas para encontrar lo relevante.';
        }
        if (toolName === 'create_note') {
            if (noteTitle) {
                return `Voy a crear una nota nueva para dejar esto aterrizado como ${this._formatStatusLabel(noteTitle, 'una nota nueva')}.`;
            }
            return 'Voy a crear una nota nueva para dejar esto aterrizado.';
        }
        if (toolName === 'create_meta') {
            if (metaTitle) {
                return `Voy a crear una meta nueva para organizar esto como ${this._formatStatusLabel(metaTitle, 'una meta nueva')}.`;
            }
            return 'Voy a crear una meta nueva para organizar esto mejor.';
        }
        if (toolName === 'append_to_note') {
            return `Voy a sumar ese contenido al final de ${noteText} sin tocar el resto.`;
        }
        if (toolName === 'replace_in_note') {
            return `Estoy ajustando un fragmento puntual dentro de ${noteText}.`;
        }
        if (toolName === 'update_note') {
            return `Voy a reescribir ${noteText} para dejarla alineada con lo que pediste.`;
        }
        if (toolName === 'update_meta') {
            return `Ahora voy a actualizar ${metaText} para dejarla con el enfoque que pediste.`;
        }
        if (toolName === 'attach_note_to_meta') {
            return `Estoy vinculando ${noteText} dentro de ${metaText} para que quede organizada en el mismo lugar.`;
        }
        if (toolName === 'detach_note_from_meta') {
            return `Voy a sacar ${noteText} de ${metaText} para dejar esa estructura limpia.`;
        }
        if (toolName === 'delete_note') {
            return `Voy a eliminar ${noteText} tal como lo pediste.`;
        }
        if (toolName === 'delete_meta') {
            return `Voy a eliminar ${metaText} tal como lo pediste.`;
        }
        if (toolName === 'execute_screen_action') {
            return 'Preparando la acción en tu computador.';
        }
        if (toolName === 'play_agario') {
            return 'Preparando Agar.io.';
        }
        if (toolName === 'schedule_reminder') {
            return 'Programando el recordatorio.';
        }
        return '';
    }

    _extractAssistantStatusMessage(content) {
        const text = String(content || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return this.safeSliceText(text, 220);
    }

    _resolveNoteStatusLabel(noteId, fallbackTitle) {
        const id = String(noteId || '').trim();
        if (id) {
            const note = this._findNote(id);
            if (note?.title) return note.title;
        }
        const title = String(fallbackTitle || '').trim();
        return title || '';
    }

    _resolveMetaStatusLabel(metaId, fallbackTitle) {
        const id = String(metaId || '').trim();
        if (id) {
            const meta = this._findMeta(id);
            if (meta?.title) return meta.title;
        }
        const title = String(fallbackTitle || '').trim();
        return title || '';
    }

    _formatStatusLabel(label, fallback) {
        const text = String(label || '').trim();
        if (!text) return fallback;
        return `"${this.safeSliceText(text, 80)}"`;
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
        if (toolName === 'execute_screen_action' || toolName === 'play_agario' || toolName === 'schedule_reminder') {
            return {
                eventKind: 'action',
                label: 'Action',
                summary: String(result?.summary || `Prepared ${toolName}`),
                detail: String(result?.detail || '').trim()
            };
        }

        return null;
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
        if ((changes.actions || []).length > 0) items.push(`${changes.actions.length} computer action${changes.actions.length === 1 ? '' : 's'} prepared`);
        if (items.length === 0) return null;
        return {
            title: `${items.length} change${items.length === 1 ? '' : 's'} recorded`,
            detail: items.join(' · '),
            items
        };
    }

    _fallbackAssistantReply(changes = {}) {
        const summary = this._buildChangeSummary(changes);
        if (summary) {
            return `Listo. ${summary.detail}.`;
        }
        return 'Listo.';
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
        return {
            id: String(meta?.id || ''),
            title: String(meta?.title || '').trim() || 'Meta sin titulo',
            description: this.safeSliceText(meta?.description || '', 180),
            noteIds: Array.isArray(meta?.noteIds) ? meta.noteIds.slice(0, 24) : [],
            noteCount: Array.isArray(meta?.noteIds) ? meta.noteIds.length : 0,
            noteTitles: linkedNotes
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

        if (toolName === 'execute_screen_action') {
            const goal = String(args.goal || '').trim();
            const stepsHint = String(args.steps_hint || '').trim();
            const app = this._sanitizeActionApp(args.app);

            if (!goal || !app || !stepsHint) return null;

            return {
                type: 'screen_action',
                goal,
                app,
                stepsHint
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

    _sanitizeActionApp(value) {
        let cleanApp = String(value || '').trim();
        if (!cleanApp) return '';
        const separators = [' y ', ' Y ', ' and ', ' AND ', ',', ' y,', ' and,'];
        for (const separator of separators) {
            if (cleanApp.includes(separator)) {
                cleanApp = cleanApp.split(separator)[0].trim();
            }
        }
        return cleanApp;
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

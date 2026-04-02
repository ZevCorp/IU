function cloneSchema(value) {
    return JSON.parse(JSON.stringify(value));
}

const CUSTOM_GPT_SYSTEM_PROMPT = `
Eres el asistente de voz principal de IU OS operando dentro de un GPT personalizado conectado a herramientas reales.

Tu trabajo es conversar de forma natural, breve y precisa, pero ejecutar acciones reales SOLO mediante herramientas.

Objetivo operativo:
- Ser la capa de voz del sistema principal.
- Usar herramientas para notas, metas, finanzas, recordatorios y acciones en el computador.
- Mantener sincronizado el contexto de voz con el cerebro principal usando \`voice_turn_summary\`.

Reglas críticas:
- Nunca inventes que ejecutaste una accion si no llamaste la herramienta correspondiente.
- Nunca simules resultados de herramientas.
- Si una accion cambia notas, metas, finanzas, recordatorios o el computador, debes usar la herramienta.
- Si solo necesitas responder conversacionalmente, responde sin herramienta.
- Si necesitas datos antes de actuar, consulta primero con herramientas de lectura.
- Para acciones de computador, usa \`execute_screen_action\` con un objetivo claro, la app objetivo y \`steps_hint\` concretos.
- No dependas del texto detectado por polling para ejecutar acciones. El polling solo existe como reflejo visual externo de la conversación.
- Cuando cierres un turno importante o quede una decisión/resultado útil para el sistema principal, llama \`voice_turn_summary\`.
- \`voice_turn_summary\` debe resumir intención, decisión, resultado y próximos pasos si existen.
- Si una herramienta devuelve error, explícalo con honestidad y propone el siguiente paso mínimo.

Estilo:
- Español natural por defecto, salvo que el usuario cambie de idioma.
- Respuestas cortas y claras en voz.
- Evita listas largas salvo que ayuden de verdad.
- Confirma brevemente cuando una accion ya quedó preparada o ejecutada.

Prioridad de comportamiento:
1. Seguridad y veracidad.
2. Usar herramientas reales cuando corresponda.
3. Mantener continuidad con el cerebro principal mediante \`voice_turn_summary\`.
4. Conversación fluida y útil.
`.trim();

const CUSTOM_GPT_ACTIONS = [
    {
        name: 'list_notes',
        summary: 'List notes',
        description: 'Lista notas disponibles con titulo, preview y metadata basica.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer' }
            }
        }
    },
    {
        name: 'search_notes',
        summary: 'Search notes',
        description: 'Busca notas por titulo o contenido.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer' }
            },
            required: ['query']
        }
    },
    {
        name: 'get_note',
        summary: 'Get note',
        description: 'Devuelve una nota completa por id.',
        inputSchema: {
            type: 'object',
            properties: {
                note_id: { type: 'string' },
                max_chars: { type: 'integer' }
            },
            required: ['note_id']
        }
    },
    {
        name: 'create_note',
        summary: 'Create note',
        description: 'Crea una nota nueva.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                body: { type: 'string' }
            },
            required: ['title']
        }
    },
    {
        name: 'update_note',
        summary: 'Update note',
        description: 'Actualiza titulo o cuerpo completo de una nota.',
        inputSchema: {
            type: 'object',
            properties: {
                note_id: { type: 'string' },
                title: { type: 'string' },
                body: { type: 'string' }
            },
            required: ['note_id']
        }
    },
    {
        name: 'delete_note',
        summary: 'Delete note',
        description: 'Elimina una nota existente.',
        inputSchema: {
            type: 'object',
            properties: {
                note_id: { type: 'string' }
            },
            required: ['note_id']
        }
    },
    {
        name: 'list_metas',
        summary: 'List metas',
        description: 'Lista metas disponibles.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer' }
            }
        }
    },
    {
        name: 'search_metas',
        summary: 'Search metas',
        description: 'Busca metas por titulo o descripcion.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer' }
            },
            required: ['query']
        }
    },
    {
        name: 'get_meta',
        summary: 'Get meta',
        description: 'Devuelve una meta por id con sus notas vinculadas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' }
            },
            required: ['meta_id']
        }
    },
    {
        name: 'create_meta',
        summary: 'Create meta',
        description: 'Crea una meta nueva.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                description: { type: 'string' }
            },
            required: ['title']
        }
    },
    {
        name: 'update_meta',
        summary: 'Update meta',
        description: 'Actualiza una meta existente.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' }
            },
            required: ['meta_id']
        }
    },
    {
        name: 'delete_meta',
        summary: 'Delete meta',
        description: 'Elimina una meta existente.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' }
            },
            required: ['meta_id']
        }
    },
    {
        name: 'attach_note_to_meta',
        summary: 'Attach note to meta',
        description: 'Vincula una nota a una meta.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                note_id: { type: 'string' }
            },
            required: ['meta_id', 'note_id']
        }
    },
    {
        name: 'detach_note_from_meta',
        summary: 'Detach note from meta',
        description: 'Desvincula una nota de una meta.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                note_id: { type: 'string' }
            },
            required: ['meta_id', 'note_id']
        }
    },
    {
        name: 'update_finance_instructions',
        summary: 'Update finance instructions',
        description: 'Actualiza el texto libre de la meta fija Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                instructions: { type: 'string' }
            },
            required: ['meta_id', 'instructions']
        }
    },
    {
        name: 'create_finance_pocket',
        summary: 'Create finance pocket',
        description: 'Crea un bolsillo dentro de Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                name: { type: 'string' },
                bank: { type: 'string' },
                purpose: { type: 'string' },
                balance: { type: 'number' }
            },
            required: ['meta_id', 'name']
        }
    },
    {
        name: 'update_finance_pocket',
        summary: 'Update finance pocket',
        description: 'Edita un bolsillo de Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                pocket_id: { type: 'string' },
                name: { type: 'string' },
                bank: { type: 'string' },
                purpose: { type: 'string' },
                balance: { type: 'number' }
            },
            required: ['meta_id', 'pocket_id']
        }
    },
    {
        name: 'delete_finance_pocket',
        summary: 'Delete finance pocket',
        description: 'Elimina un bolsillo de Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                pocket_id: { type: 'string' }
            },
            required: ['meta_id', 'pocket_id']
        }
    },
    {
        name: 'deposit_finance_pocket',
        summary: 'Deposit finance pocket',
        description: 'Carga dinero en un bolsillo.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                pocket_id: { type: 'string' },
                amount: { type: 'number' }
            },
            required: ['meta_id', 'pocket_id', 'amount']
        }
    },
    {
        name: 'withdraw_finance_pocket',
        summary: 'Withdraw finance pocket',
        description: 'Descarga dinero de un bolsillo.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                pocket_id: { type: 'string' },
                amount: { type: 'number' }
            },
            required: ['meta_id', 'pocket_id', 'amount']
        }
    },
    {
        name: 'move_money_between_finance_pockets',
        summary: 'Move money between finance pockets',
        description: 'Mueve dinero entre bolsillos de Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                from_pocket_id: { type: 'string' },
                to_pocket_id: { type: 'string' },
                amount: { type: 'number' }
            },
            required: ['meta_id', 'from_pocket_id', 'to_pocket_id', 'amount']
        }
    },
    {
        name: 'update_finance_projection',
        summary: 'Update finance projection',
        description: 'Actualiza ingresos, gastos y horizonte de Finanzas.',
        inputSchema: {
            type: 'object',
            properties: {
                meta_id: { type: 'string' },
                expected_income: { type: 'number' },
                expected_expenses: { type: 'number' },
                horizon_weeks: { type: 'integer' },
                current_label: { type: 'string' },
                future_label: { type: 'string' }
            },
            required: ['meta_id']
        }
    },
    {
        name: 'execute_screen_action',
        summary: 'Prepare computer action',
        description: 'Prepara una accion del computador usando goal, app y steps_hint.',
        inputSchema: {
            type: 'object',
            properties: {
                goal: { type: 'string' },
                app: { type: 'string' },
                steps_hint: { type: 'string' }
            },
            required: ['goal', 'app', 'steps_hint']
        }
    },
    {
        name: 'schedule_reminder',
        summary: 'Schedule reminder',
        description: 'Programa un recordatorio futuro.',
        inputSchema: {
            type: 'object',
            properties: {
                task: { type: 'string' },
                minutes: { type: 'integer' }
            },
            required: ['task', 'minutes']
        }
    },
    {
        name: 'play_agario',
        summary: 'Prepare Agar.io session',
        description: 'Prepara una sesion de Agar.io.',
        inputSchema: {
            type: 'object',
            properties: {
                nickname: { type: 'string' }
            }
        }
    },
    {
        name: 'voice_turn_summary',
        summary: 'Send voice turn summary to main brain',
        description: 'Entrega un resumen de la conversacion de voz al cerebro principal.',
        inputSchema: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                user_text: { type: 'string' },
                assistant_text: { type: 'string' }
            },
            required: ['summary']
        }
    }
];

function buildCustomGptOpenApi(options = {}) {
    const baseUrl = String(options.baseUrl || 'https://example.com').replace(/\/$/, '');
    const title = String(options.title || 'IU OS Custom GPT Relay');
    const description = String(options.description || 'Relay HTTP para el GPT personalizado de IU OS.');
    const paths = {};

    for (const action of CUSTOM_GPT_ACTIONS) {
        paths[`/custom-gpt/actions/${action.name}`] = {
            post: {
                operationId: action.name,
                summary: action.summary,
                description: action.description,
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: false,
                    content: {
                        'application/json': {
                            schema: cloneSchema(action.inputSchema || {
                                type: 'object',
                                additionalProperties: true
                            })
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Successful response',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    additionalProperties: true
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    return {
        openapi: '3.1.0',
        info: {
            title,
            version: '1.0.0',
            description
        },
        servers: [
            { url: baseUrl }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'API Key'
                }
            }
        },
        paths
    };
}

module.exports = {
    CUSTOM_GPT_SYSTEM_PROMPT,
    CUSTOM_GPT_ACTIONS,
    buildCustomGptOpenApi
};

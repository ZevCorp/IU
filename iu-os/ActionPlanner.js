/**
 * ActionPlanner.js
 * Planner that receives user intent (explicit or implicit)
 * and decides what app to open and what action to perform via function calling.
 * Uses ModelSwitch to alternate between OpenAI (GPT-5-mini) and Gemini (2.5 Flash).
 */

const ModelSwitch = require('./ModelSwitch');
const LearningAgent = require('./LearningAgent');
const {
    MANAGED_ACTION_TOOL_NAME,
    MANAGED_EXECUTOR_OPENCLAW,
    MANAGED_EXECUTOR_IU_DESKTOP,
    buildManagedActionToolDefinition,
    isManagedActionToolName,
    parseManagedActionArgs
} = require('./ManagedActionDefinition');

class ActionPlanner {
    constructor(openai) {
        this.openai = openai;
        this.tools = [
            buildManagedActionToolDefinition(MANAGED_ACTION_TOOL_NAME, {
                description: "Prepara una accion del computador y elige entre openclaw e iu_desktop."
            }),
            {
                type: "function",
                function: {
                    name: "play_agario",
                    description: "Open AgarIO and prepare it for play. Use this when the user says 'I want to play AgarIO' or similar. It automatically handles the nickname and starts the game.",
                    parameters: {
                        type: "object",
                        properties: {
                            nickname: { type: "string", description: "Optional nickname to use. If not provided, a random one will be generated." }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "schedule_reminder",
                    description: "Schedule a future task or reminder for the user. Use this when the user says 'Remind me to...' or 'In 10 minutes...'.",
                    parameters: {
                        type: "object",
                        properties: {
                            task: { type: "string", description: " The task description." },
                            minutes: { type: "integer", description: "Minutes from now to trigger." }
                        },
                        required: ["task", "minutes"]
                    }
                }
            }
        ];
    }

    /**
     * Plan from explicit user speech.
     * The user directly asked U to do something.
     */
    async planFromExplicit(userText, context = { recent: [], longTerm: '' }) {
        // if (!this.openai) return null; // Removed check

        try {
            console.log('🧠 [Planner] Planning from EXPLICIT intent:', userText.substring(0, 60));

            // Format history for context (Recent RAM)
            const historyContext = (context.recent || [])
                .filter(msg => msg && (msg.role === 'user' || msg.role === 'assistant'))
                .map(msg => {
                    const content = (msg.content === null || msg.content === undefined) ? '' : String(msg.content).trim();
                    return {
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content
                    };
                })
                .filter(msg => msg.content.length > 0);

            // Add Long-Term Memory if available
            let systemContent = `Eres U, un asistente digital silencioso.
FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-ES')}

Recibes instrucciones del usuario.
Si detectas una petición de RECORDATORIO ("Recuérdame...", "Mañana a las..."), usa 'schedule_reminder' y calcula el parámetro 'minutes'.
Si detectas que quiere ejecutar algo AHORA en su computador (abrir apps, buscar, escribir, clickear, navegar, usar terminal o archivos), DEBES llamar a '${MANAGED_ACTION_TOOL_NAME}'.

NO respondas con texto conversacional si la intención es una acción. EJECUTA LA ACCIÓN DIRECTAMENTE.
Incluso si el usuario es amable ("Por favor podrías..."), NO respondas "Claro que sí", simplemente LLAMA A LA FUNCIÓN.

Debes elegir el executor por CAPACIDAD:
- Usa '${MANAGED_EXECUTOR_OPENCLAW}' cuando la tarea se resuelve principalmente en navegador o web.
- Usa '${MANAGED_EXECUTOR_IU_DESKTOP}' cuando requiere GUI desktop arbitraria, AX, mouse/keyboard sobre apps nativas o interacción visual del SO.
Si la tarea requiere múltiples apps (ej: "Abrir X y luego Y"), usa SOLO la primera app en 'app' y describe el cambio en 'steps_hint'.
Siempre llena 'executor_reason' con una justificación breve y concreta.
IMPORTANTE: El campo 'app' debe ser UN SOLO nombre de aplicación (ej: "Calculadora").

Responde en español.`;

            if (context.longTerm) {
                systemContent += `\n\nMEMORIA A LARGO PLAZO RELEVANTE:\n${context.longTerm}`;
            }

            const relevantLearned = LearningAgent.findRelevantWorkflows(userText, 3);
            if (relevantLearned.length > 0) {
                const learnedText = relevantLearned.map((wf, i) =>
                    `${i + 1}. ${wf.workflowName} — ${wf.summary}`
                ).join('\n');
                systemContent += `\n\nAPRENDIZAJES ENSEÑADOS RELEVANTES:\n${learnedText}
\nSi vas a ejecutar usando uno de estos, prioriza esa ruta enseñada por el usuario.
Si hay ambigüedad fuerte entre dos aprendizajes, pide una aclaración breve en lugar de ejecutar mal.`;
            }

            // System instructions
            const systemMsg = {
                role: "system",
                content: systemContent
            };

            const messages = [systemMsg, ...historyContext, {
                role: "user",
                content: `El usuario dijo: "${userText}"`
            }];

            const response = await ModelSwitch.chatCompletion({
                messages: messages,
                tools: this.tools,
                tool_choice: "auto" // Anthropic might prefer 'auto', or forceful 'any' if we are sure
            });

            return this._extractAction(response);
        } catch (e) {
            console.error('❌ [Planner] Explicit planning failed:', e.message);
            return null;
        }
    }

    // ... (planFromImplicit and planAutonomousAction remain largely the same, maybe update system prompt similarly if needed) ...

    /**
     * Plan from implicit context.
     * Audio environment was captured, user confirmed a suggestion by nodding.
     */
    async planFromImplicit(contextText, confirmedSuggestion, context = { recent: [], longTerm: '' }) {
        try {
            console.log('🧠 [Planner] Planning from IMPLICIT intent:', confirmedSuggestion.substring(0, 60));

            let systemContent = `Eres U, un asistente digital.
            El usuario confirmó una sugerencia. EJECUTA LA ACCIÓN AHORA MISMO.
            Piensa en qué app abrir, qué pasos seguir y cuál executor corresponde.
            Llama la función ${MANAGED_ACTION_TOOL_NAME}.
            NO converses. EJECUTA.`;

            if (context.longTerm) {
                systemContent += `\n\nMEMORIA A LARGO PLAZO RELEVANTE:\n${context.longTerm}`;
            }

            const messages = [
                {
                    role: "system",
                    content: systemContent
                },
                ...(context.recent || [])
                    .filter(msg => msg && (msg.role === 'user' || msg.role === 'assistant'))
                    .map(msg => ({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: (msg.content === null || msg.content === undefined) ? '' : String(msg.content).trim()
                    }))
                    .filter(msg => msg.content.length > 0),
                {
                    role: "user",
                    content: `Contexto: "${contextText}"\nSugerencia confirmada: "${confirmedSuggestion}"`
                }
            ];

            const response = await ModelSwitch.chatCompletion({
                messages: messages,
                tools: this.tools,
                tool_choice: "required"
            });

            return this._extractAction(response);
        } catch (e) {
            console.error('❌ [Planner] Implicit planning failed:', e.message);
            return null;
        }
    }

    /**
     * Plan from autonomous trigger (Brain).
     * No user present. System decided to act based on schedule or notification.
     */
    async planAutonomousAction(goal, contextPreferences = []) {
        try {
            console.log('🧠 [Planner] Planning AUTONOMOUS action:', goal);

            const prefsText = Array.isArray(contextPreferences) ? contextPreferences.join('\n') : contextPreferences;

            const systemContent = `Eres U, asistente autónomo.
OBJETIVO: "${goal}"
PREFERENCIAS: ${prefsText}

EJECUTA LA TAREA AHORA. Llama a '${MANAGED_ACTION_TOOL_NAME}' y elige el executor correcto por capacidad.
NO converses.`;

            const messages = [
                {
                    role: "system",
                    content: systemContent
                },
                {
                    role: "user",
                    content: `Ejecuta: "${goal}"`
                }
            ];

            const response = await ModelSwitch.chatCompletion({
                messages: messages,
                tools: this.tools,
                tool_choice: "required"
            });

            return this._extractAction(response);
        } catch (e) {
            console.error('❌ [Planner] Autonomous planning failed:', e.message);
            return null;
        }
    }

    _extractAction(response) {
        const choice = response.choices[0];
        const message = choice.message;

        if (message.tool_calls && message.tool_calls.length > 0) {
            const call = message.tool_calls[0];
            const args = JSON.parse(call.function.arguments);

            if (isManagedActionToolName(call.function.name)) {
                const parsed = parseManagedActionArgs(args, {
                    fallbackExecutor: MANAGED_EXECUTOR_IU_DESKTOP
                });
                if (!parsed.goal || !parsed.app || !parsed.stepsHint) {
                    return null;
                }
                console.log(`🎯 [Planner] Action planned (${parsed.executor}): ${parsed.app} -> ${parsed.stepsHint}`);

                return {
                    type: 'managed_action',
                    goal: parsed.goal,
                    app: parsed.app,
                    stepsHint: parsed.stepsHint,
                    executor: parsed.executor,
                    executorReason: parsed.executorReason
                };
            } else if (call.function.name === 'play_agario') {
                console.log(`🎮 [Planner] Play AgarIO: nickname=${args.nickname}`);
                return {
                    type: 'play_agario',
                    nickname: args.nickname
                };
            } else if (call.function.name === 'schedule_reminder') {
                console.log(`⏰ [Planner] Scheduled Reminder: ${args.task} in ${args.minutes} min`);
                return {
                    type: 'schedule',
                    task: args.task,
                    minutes: args.minutes
                };
            }
        }

        console.log('💬 [Planner] No action needed (conversational only)');
        return null; // Return null if no action found
    }
}

module.exports = ActionPlanner;

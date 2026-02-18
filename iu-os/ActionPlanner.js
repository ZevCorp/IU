/**
 * ActionPlanner.js
 * Planner that receives user intent (explicit or implicit)
 * and decides what app to open and what action to perform via function calling.
 * Uses ModelSwitch to alternate between OpenAI (GPT-5-mini) and Gemini (2.5 Flash).
 */

const ModelSwitch = require('./ModelSwitch');

class ActionPlanner {
    constructor(openai) {
        this.openai = openai;
        this.tools = [
            {
                type: "function",
                function: {
                    name: "execute_screen_action",
                    description: "Execute an action on the user's screen. Opens an app and performs clicks/typing to accomplish the user's goal.",
                    parameters: {
                        type: "object",
                        properties: {
                            goal: {
                                type: "string",
                                description: "Clear description of what the user wants to accomplish. E.g. 'Send a voice note to María on WhatsApp'"
                            },
                            app: {
                                type: "string",
                                description: "The INITIAL application to open. If multiple apps are needed, specify the FIRST one here."
                            },
                            steps_hint: {
                                type: "string",
                                description: "High-level hint of steps needed. Can include switching apps (e.g. 'Open Notes, copy text, switch to Mail, paste')."
                            }
                        },
                        required: ["goal", "app", "steps_hint"]
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
        if (!this.openai) return null;

        try {
            console.log('🧠 [Planner] Planning from EXPLICIT intent:', userText.substring(0, 60));

            // Format history for context (Recent RAM)
            const historyContext = (context.recent || []).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            }));

            // Add Long-Term Memory if available
            let systemContent = `Eres U, un asistente digital silencioso.
FECHA Y HORA ACTUAL: ${new Date().toLocaleString('es-ES')}

Recibes lo que el usuario dice explícitamente.
Si detectas una petición de RECORDATORIO ("Recuérdame...", "Mañana a las..."), usa la función 'schedule_reminder' y calcula el parámetro 'minutes' basándote en la hora actual.
Si detectas que quiere ejecutar algo AHORA en su computador, piensa en qué app abrir y qué pasos seguir.
Llama la función execute_screen_action con esa información.
Si la tarea requiere múltiples apps (ej: "Abrir X y luego Y"), usa SOLO la primera app en 'app' y describe el cambio en 'steps_hint'.
IMPORTANTE: El campo 'app' debe ser UN SOLO nombre de aplicación (ej: "Calculadora"). NUNCA uses "Calculadora y Notas" o listas.

SIEMPRE PRIORIZA LA ACCIÓN:
Si el usuario dice frases como "Quiero que...", "Abre...", "Busca...", "Revisa...", "Lee...", "Escribe...", INTERPRÉTALO COMO UNA ORDEN DE EJECUCIÓN y llama a 'execute_screen_action'.
Ignora si el usuario combina la orden con conversación (ej: "Sí puedes hacerlo, abre WhatsApp"). Enfócate en la parte de la orden.
Solo si el usuario está CLARAMENTE solo conversando o haciendo preguntas generales ("¿Cómo estás?", "¿Qué es la vida?"), entonces NO llames ninguna función.
Responde en español.`;

            if (context.longTerm) {
                systemContent += `\n\nMEMORIA A LARGO PLAZO RELEVANTE:\n${context.longTerm}`;
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
                tool_choice: "auto"
            });

            return this._extractAction(response);
        } catch (e) {
            console.error('❌ [Planner] Explicit planning failed:', e.message);
            return null;
        }
    }

    /**
     * Plan from implicit context.
     * Audio environment was captured, user confirmed a suggestion by nodding.
     */
    async planFromImplicit(contextText, confirmedSuggestion, context = { recent: [], longTerm: '' }) {
        if (!this.openai) return null;

        try {
            console.log('🧠 [Planner] Planning from IMPLICIT intent:', confirmedSuggestion.substring(0, 60));

            // Add Long-Term Memory if available
            let systemContent = `Eres U, un asistente digital que escucha el ambiente del usuario.
El usuario confirmó (asintió con la cabeza) una sugerencia que le hiciste.
Ahora debes ejecutar esa acción. Piensa en qué app abrir y qué pasos seguir.
Llama la función execute_screen_action con esa información.
Responde en español.`;

            if (context.longTerm) {
                systemContent += `\n\nMEMORIA A LARGO PLAZO RELEVANTE:\n${context.longTerm}`;
            }

            const messages = [
                {
                    role: "system",
                    content: systemContent
                },
                ...(context.recent || []).map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
                {
                    role: "user",
                    content: `Contexto ambiental: "${contextText}"\nSugerencia confirmada por el usuario: "${confirmedSuggestion}"`
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
        if (!this.openai) return null;

        try {
            console.log('🧠 [Planner] Planning AUTONOMOUS action:', goal);

            const prefsText = Array.isArray(contextPreferences) ? contextPreferences.join('\n') : contextPreferences;

            const systemContent = `Eres U, un asistente autónomo operando en "Modo Desconexión".
El usuario no está disponible. Debes realizar tareas de mantenimiento o responder mensajes urgentes por él.
OBJETIVO: "${goal}"

PREFERENCIAS DEL USUARIO:
${prefsText}

Piensa en qué app abrir y qué pasos seguir para cumplir este objetivo de forma eficiente y segura.
Llama la función execute_screen_action con el plan.
Si la tarea requiere múltiples apps, usa 'app' para la primera y describe el resto en 'steps_hint'.
Responde en español.`;

            const messages = [
                {
                    role: "system",
                    content: systemContent
                },
                {
                    role: "user",
                    content: `Ejecuta la tarea autónoma: "${goal}"`
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

    /**
     * Extract the function call result from the API response.
     */
    _extractAction(response) {
        const message = response.choices[0].message;

        if (message.tool_calls && message.tool_calls.length > 0) {
            const call = message.tool_calls[0];
            if (call.function.name === 'execute_screen_action') {
                const args = JSON.parse(call.function.arguments);

                // SANITIZATION: Ensure 'app' is a single application name
                let cleanApp = args.app;
                if (cleanApp) {
                    // Split by common separators used by LLMs when hallucinating lists
                    const separators = [' y ', ' Y ', ' and ', ' AND ', ',', ' y,', ' and,'];
                    for (const sep of separators) {
                        if (cleanApp.includes(sep)) {
                            cleanApp = cleanApp.split(sep)[0].trim();
                        }
                    }
                }

                console.log(`🎯 [Planner] Action planned (raw): ${args.app} -> (sanitized): ${cleanApp}`);

                return {
                    goal: args.goal,
                    app: cleanApp, // Return the sanitized single app name
                    stepsHint: args.steps_hint
                };
            } else if (call.function.name === 'schedule_reminder') {
                const args = JSON.parse(call.function.arguments);
                console.log(`⏰ [Planner] Scheduled Reminder: ${args.task} in ${args.minutes} min`);
                return {
                    type: 'schedule',
                    task: args.task,
                    minutes: args.minutes
                };
            }
        }

        console.log('💬 [Planner] No action needed (conversational only)');
        return null;
    }
}

module.exports = ActionPlanner;

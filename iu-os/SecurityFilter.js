/**
 * SecurityFilter.js
 * Validates autonomous actions before execution to ensure user safety.
 */

const ModelSwitch = require('./ModelSwitch');

class SecurityFilter {
    constructor() {
    }

    /**
     * Analyze a proposed action for safety and validity.
     * @param {string} actionDescription - What the agent wants to do (e.g. "Send email to Boss saying I quit")
     * @param {string} context - The context that triggered this (e.g. "Incoming message from Boss: 'You are fired'")
     * @param {Array} userPreferences - Relevant user preferences from memory
     * @returns {Promise<{safe: boolean, reason: string}>}
     */
    async validateAction(actionDescription, context, userPreferences = []) {
        console.log('🛡️ [Security] Validating action:', actionDescription);

        const prefsText = userPreferences.map(p => `- ${p}`).join('\n');

        const messages = [
            {
                role: "system",
                content: `Eres el Filtro de Seguridad de U (el asistente personal del usuario).
Tu trabajo es aprobar o rechazar acciones autónomas que el asistente quiere realizar en nombre del usuario mientras él está desconectado.

CRITERIOS DE APROBACIÓN:
1. VERACIDAD: ¿La acción tiene sentido dado el contexto?
2. SEGURIDAD: ¿La acción podría causar daño irreversible (borrar archivos, transferir dinero, insultar a alguien)?
3. PREFERENCIAS: ¿La acción respeta las preferencias del usuario?

PREFERENCIAS DEL USUARIO:
${prefsText || '(No hay preferencias específicas registradas)'}

Si la acción es segura y beneficiosa, responde con JSON { "safe": true, "reason": "..." }.
Si la acción es peligrosa, dudosa o viola preferencias, responde con JSON { "safe": false, "reason": "..." }.
`
            },
            {
                role: "user",
                content: `CONTEXTO: "${context}"
ACCIÓN PROPUESTA: "${actionDescription}"

¿Es seguro ejecutar esto?`
            }
        ];

        try {
            const response = await ModelSwitch.chatCompletion({
                messages,
                max_tokens: 300,
                tool_choice: "none"
            });

            const text = response.choices[0].message.content;
            // Extract JSON
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            } else {
                console.warn('⚠️ [Security] Could not parse JSON response, default to unsafe.');
                return { safe: false, reason: "Error parsing security verification" };
            }

        } catch (e) {
            console.error('❌ [Security] Validation failed:', e);
            return { safe: false, reason: "Security check error" };
        }
    }
}

module.exports = new SecurityFilter();

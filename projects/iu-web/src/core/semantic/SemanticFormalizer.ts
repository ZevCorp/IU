/**
 * Semantic Formalizer
 * Prepares context for the LLM (App Registry, Screen Description)
 */

export interface AppEntry {
    id: string;
    name: string;
    description: string;
    url: string;
    keywords: string[];
}

export interface SemanticContext {
    openApps: AppEntry[];
    currentApp?: string; // ID of the currently focused app
    userState: 'idle' | 'working' | 'distracted';
    timestamp: number;
}

// Initial Registry of "Known Apps"
export const APP_REGISTRY: AppEntry[] = [
    {
        id: 'medical-emr',
        name: 'Medical EMR',
        description: 'Electronic Medical Record system for patient management, orders, and charts.',
        url: 'https://iü.space/medical/',
        keywords: ['patient', 'chart', 'order', 'medical', 'exam', 'doctor', 'nurse', 'hospital']
    },
    {
        id: 'calendar',
        name: 'Calendar',
        description: 'Schedule management and appointments.',
        url: 'https://calendar.google.com',
        keywords: ['schedule', 'meeting', 'appointment', 'date', 'time', 'availability']
    },
    {
        id: 'email',
        name: 'Email Client',
        description: 'Email communication interface.',
        url: 'https://gmail.com',
        keywords: ['email', 'send', 'inbox', 'message', 'contact', 'mail']
    }
];

export class SemanticFormalizer {
    /**
     * Captures the current Semantic Context to send to the LLM
     */
    public captureContext(): SemanticContext {
        // In a real multi-window OS, we would query the window manager.
        // For this Web POC, we assume these apps are "available" to be opened.

        return {
            openApps: APP_REGISTRY,
            // currentApp: 'unknown', 
            userState: 'working',
            timestamp: Date.now()
        };
    }

    /**
     * Formats the context into a system prompt snippet
     */
    public formatContextForPrompt(ctx: SemanticContext): string {
        const apps = ctx.openApps.map(app =>
            `- ${app.name} (ID: ${app.id}): ${app.description}`
        ).join('\n');

        return `
CURRENT CONTEXT:
Available Apps:
${apps}

User State: ${ctx.userState}
Time: ${new Date(ctx.timestamp).toISOString()}
`;
    }
}

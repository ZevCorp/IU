'use strict';

const MANAGED_ACTION_TOOL_NAME = 'execute_managed_action';
const LEGACY_MANAGED_ACTION_TOOL_NAME = 'execute_screen_action';
const MANAGED_EXECUTOR_OPENCLAW = 'openclaw';
const MANAGED_EXECUTOR_IU_DESKTOP = 'iu_desktop';
const MANAGED_EXECUTOR_VALUES = [MANAGED_EXECUTOR_OPENCLAW, MANAGED_EXECUTOR_IU_DESKTOP];

function sanitizeManagedActionApp(value) {
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

function normalizeManagedExecutor(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z_]/g, '');
    if (normalized === MANAGED_EXECUTOR_OPENCLAW) return MANAGED_EXECUTOR_OPENCLAW;
    if (normalized === MANAGED_EXECUTOR_IU_DESKTOP) return MANAGED_EXECUTOR_IU_DESKTOP;
    if (normalized === 'browser' || normalized === 'web' || normalized === 'navegador') {
        return MANAGED_EXECUTOR_OPENCLAW;
    }
    if (normalized === 'desktop' || normalized === 'screen') {
        return MANAGED_EXECUTOR_IU_DESKTOP;
    }
    return '';
}

function parseManagedActionArgs(args = {}, options = {}) {
    const fallbackExecutor = normalizeManagedExecutor(options.fallbackExecutor || '') || MANAGED_EXECUTOR_IU_DESKTOP;
    const goal = String(args.goal || '').trim();
    const app = sanitizeManagedActionApp(args.app);
    const stepsHint = String(args.steps_hint || args.stepsHint || '').trim();
    const executor = normalizeManagedExecutor(args.executor) || fallbackExecutor;
    const executorReason = String(args.executor_reason || args.executorReason || '').trim();

    return {
        goal,
        app,
        stepsHint,
        executor,
        executorReason
    };
}

function buildManagedActionToolDefinition(name = MANAGED_ACTION_TOOL_NAME, options = {}) {
    const description = String(options.description || '').trim()
        || 'Prepara una accion del computador usando goal, app, steps_hint y executor.';
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: {
                type: 'object',
                properties: {
                    goal: {
                        type: 'string',
                        description: 'Descripcion clara del objetivo del usuario.'
                    },
                    app: {
                        type: 'string',
                        description: 'La aplicacion o contexto inicial recomendado. Si varias apps participan, deja aqui solo la primera.'
                    },
                    steps_hint: {
                        type: 'string',
                        description: 'Guia breve de alto nivel para resolver la tarea.'
                    },
                    executor: {
                        type: 'string',
                        enum: MANAGED_EXECUTOR_VALUES,
                        description: 'Motor de ejecucion. Usa openclaw para navegador/web. Usa iu_desktop para GUI/AX del sistema.'
                    },
                    executor_reason: {
                        type: 'string',
                        description: 'Justificacion breve de por que ese executor es el correcto para la tarea.'
                    }
                },
                required: ['goal', 'app', 'steps_hint', 'executor', 'executor_reason']
            }
        }
    };
}

function buildManagedActionInputSchema() {
    return buildManagedActionToolDefinition(MANAGED_ACTION_TOOL_NAME).function.parameters;
}

function isManagedActionToolName(name = '') {
    const value = String(name || '').trim();
    return value === MANAGED_ACTION_TOOL_NAME || value === LEGACY_MANAGED_ACTION_TOOL_NAME;
}

module.exports = {
    MANAGED_ACTION_TOOL_NAME,
    LEGACY_MANAGED_ACTION_TOOL_NAME,
    MANAGED_EXECUTOR_OPENCLAW,
    MANAGED_EXECUTOR_IU_DESKTOP,
    MANAGED_EXECUTOR_VALUES,
    buildManagedActionInputSchema,
    buildManagedActionToolDefinition,
    isManagedActionToolName,
    normalizeManagedExecutor,
    parseManagedActionArgs,
    sanitizeManagedActionApp
};

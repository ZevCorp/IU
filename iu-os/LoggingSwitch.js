'use strict';

const VALID_MODES = new Set(['execution', 'uiux', 'both', 'silent']);
const EXECUTION_TAG_HINTS = [
    '[BrowserAgent]',
    '[ScreenAgent]',
    '[VectorIndex]',
    '[Context]',
    '[PromptAgent]',
    '[ModelSwitch]',
    '[CommandHold]',
    '[SimpleAxAgent]',
    '[BrowserCore]',
    '[ManagedChrome]',
    '[LearningAgent]',
    '[Gesture',
    'Action System initialized'
];
const UIUX_TAG_HINTS = ['[UIUX]', '[ChatUIUX]', '[PromptChatUIUX]'];

const rawConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

let consolePatched = false;
let currentMode = normalizeMode(process.env.IU_LOG_MODE || 'execution');

function normalizeMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return VALID_MODES.has(normalized) ? normalized : 'execution';
}

function stringifyArgs(args) {
    return args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            try {
                return JSON.stringify(arg);
            } catch (_) {
                return String(arg);
            }
        })
        .join(' ');
}

function includesAny(haystack, hints) {
    return hints.some((hint) => haystack.includes(hint));
}

function shouldPrint(level, args) {
    if (level === 'error') return true;
    if (currentMode === 'both') return true;
    if (currentMode === 'execution') return true;
    if (currentMode === 'silent') return false;

    const text = stringifyArgs(args);
    if (text.includes('[Logging]')) return true;

    const isUiux = includesAny(text, UIUX_TAG_HINTS);
    if (isUiux) return true;

    const isExecution = includesAny(text, EXECUTION_TAG_HINTS);
    if (isExecution) return false;

    if (level === 'warn') return false;
    return false;
}

function patchConsole() {
    if (consolePatched) return;
    consolePatched = true;

    console.log = (...args) => {
        if (!shouldPrint('log', args)) return;
        rawConsole.log(...args);
    };
    console.info = (...args) => {
        if (!shouldPrint('info', args)) return;
        rawConsole.info(...args);
    };
    console.warn = (...args) => {
        if (!shouldPrint('warn', args)) return;
        rawConsole.warn(...args);
    };
    console.error = (...args) => {
        if (!shouldPrint('error', args)) return;
        rawConsole.error(...args);
    };
}

function applyVerboseDefaultsForMode() {
    const verboseExecution = currentMode === 'execution' || currentMode === 'both';
    if (!verboseExecution) {
        process.env.IU_VERBOSE_BROWSER_LOGS = '0';
        process.env.IU_VERBOSE_AGENT_LOGS = '0';
        process.env.IU_VERBOSE_CHROME_LOGS = '0';
    }
}

function setMode(mode, options = {}) {
    currentMode = normalizeMode(mode);
    if (options.persistEnv !== false) {
        process.env.IU_LOG_MODE = currentMode;
    }
    applyVerboseDefaultsForMode();
    rawConsole.log(`🪵 [Logging] Mode set to: ${currentMode}`);
    return currentMode;
}

function getMode() {
    return currentMode;
}

function isExecutionEnabled() {
    return currentMode === 'execution' || currentMode === 'both';
}

function isUiUxEnabled() {
    return currentMode === 'uiux' || currentMode === 'both';
}

function execution(scope, message, details) {
    if (!isExecutionEnabled()) return;
    if (details === undefined) {
        rawConsole.log(`⚙️ [EXEC][${scope}] ${message}`);
        return;
    }
    rawConsole.log(`⚙️ [EXEC][${scope}] ${message}`, details);
}

function uiux(scope, event, details) {
    if (!isUiUxEnabled()) return;
    if (details === undefined) {
        rawConsole.log(`🧪 [UIUX][${scope}] ${event}`);
        return;
    }
    rawConsole.log(`🧪 [UIUX][${scope}] ${event}`, details);
}

function install() {
    patchConsole();
    setMode(currentMode, { persistEnv: true });
}

module.exports = {
    install,
    setMode,
    getMode,
    execution,
    uiux,
    isExecutionEnabled,
    isUiUxEnabled
};

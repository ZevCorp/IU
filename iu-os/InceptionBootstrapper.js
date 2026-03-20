'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const OpenAI = require('openai');
const { chromium } = require('playwright-core');
const ModelSwitch = require('./ModelSwitch');
const { MANAGED_CHROME_PORT } = require('./ManagedChrome');
const { detectInceptionPageState, extractPotentialApiKeys } = require('./InceptionPageState');
const { readEnvFile, resolveInceptionConfig, upsertEnvFile, maskSecret } = require('./InceptionEnv');

const DEFAULT_STATE = {
    status: 'idle',
    dismissedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
    lastMessage: '',
    lastError: '',
    lastSavedKeyMasked: '',
    waitingForUser: false
};

class InceptionBootstrapper extends EventEmitter {
    constructor(options = {}) {
        super();
        this.browserAgent = options.browserAgent || null;
        this.envPath = options.envPath || '';
        this.statePath = options.statePath || '';
        this.runningPromise = null;
    }

    getState() {
        const persisted = this._readStateFile();
        const fileEnv = readEnvFile(this.envPath);
        const config = resolveInceptionConfig(process.env, fileEnv);
        const shouldPrompt = Boolean(config.hasBootstrapKey && !config.hasPersonalKey && !persisted.dismissedAt);

        return {
            ...persisted,
            available: config.hasBootstrapKey || config.hasPersonalKey,
            shouldPrompt,
            hasBootstrapKey: config.hasBootstrapKey,
            hasPersonalKey: config.hasPersonalKey,
            chatProviderConfigured: String(fileEnv.BRAIN_CHAT_PROVIDER || process.env.BRAIN_CHAT_PROVIDER || '').trim() === 'inception',
            onboardingUrl: config.onboardingUrl
        };
    }

    dismiss() {
        const next = this._writeState({
            dismissedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastMessage: 'Onboarding pospuesto por el usuario.'
        });
        this.emit('status', next);
        return next;
    }

    async start() {
        if (this.runningPromise) return await this.runningPromise;
        this.runningPromise = this._run().catch((error) => {
            return this._fail(error?.message || String(error));
        }).finally(() => {
            this.runningPromise = null;
        });
        return await this.runningPromise;
    }

    async _run() {
        if (!this.browserAgent || !this.browserAgent.browserCoreClient) {
            return this._fail('El browser core no esta disponible para el onboarding de Inception.');
        }

        const fileEnv = readEnvFile(this.envPath);
        const config = resolveInceptionConfig(process.env, fileEnv);
        if (!config.activeKey) {
            return this._fail('No hay una API inicial de Inception configurada para arrancar el bootstrap.');
        }

        this._updateProgress({
            status: 'running',
            dismissedAt: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            waitingForUser: false,
            lastError: '',
            lastMessage: 'Abriendo Inception en el navegador gestionado...'
        });

        await this.browserAgent.openUrl(config.onboardingUrl);
        await this.browserAgent.focusManagedChrome().catch(() => { });

        const client = new OpenAI({
            apiKey: config.activeKey,
            baseURL: config.baseUrl
        });

        for (let turn = 0; turn < 14; turn += 1) {
            await this.browserAgent.act({ kind: 'wait', timeMs: turn === 0 ? 1800 : 1200 }, 'managed');
            const page = await this._readCurrentPage();
            const detected = detectInceptionPageState(page);
            const candidateKeys = detected.potentialApiKeys?.length ? detected.potentialApiKeys : extractPotentialApiKeys(page);

            if (candidateKeys.length > 0) {
                return this._complete(candidateKeys[0], config);
            }

            if (detected.requiresUserTurn) {
                return this._pauseForUser('Necesito que completes el login de Inception en IU Chrome. Cuando termines, vuelve a pulsar "Continuar configuracion".');
            }

            const snapshot = await this.browserAgent.getSnapshot({ profile: 'managed', maxChars: 12000 });
            if (snapshot?.targetId) {
                this.browserAgent.setBrowserContext(snapshot.url || page.url || config.onboardingUrl, {
                    targetId: snapshot.targetId,
                    wsUrl: snapshot.url || page.url || config.onboardingUrl
                });
            }

            const action = await this._decideNextAction(client, config, page, snapshot, candidateKeys);
            const handled = await this._applyAction(action, snapshot?.targetId);
            if (handled?.completed) {
                return handled.state;
            }
            if (handled?.paused) {
                return handled.state;
            }
        }

        return this._pauseForUser('Llegue hasta el flujo de Inception, pero no pude confirmar la API key automaticamente todavia. Puedes terminar el paso visible en IU Chrome y luego reintentar.');
    }

    async _decideNextAction(client, config, page, snapshot, candidateKeys) {
        const candidatePreview = candidateKeys.length > 0
            ? candidateKeys.map((value) => `- ${maskSecret(value)}`).join('\n')
            : 'Ninguna detectada todavia.';

        const response = await client.chat.completions.create({
            model: config.model,
            max_tokens: 500,
            tool_choice: 'required',
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'click_ref',
                        description: 'Haz click en un elemento visible del snapshot por ref.',
                        parameters: {
                            type: 'object',
                            properties: {
                                ref: { type: 'string' }
                            },
                            required: ['ref']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'type_ref',
                        description: 'Escribe texto en un input visible del snapshot por ref.',
                        parameters: {
                            type: 'object',
                            properties: {
                                ref: { type: 'string' },
                                text: { type: 'string' },
                                submit: { type: 'boolean' }
                            },
                            required: ['ref', 'text']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'press_key',
                        description: 'Presiona una tecla simple como Enter, Tab o Escape.',
                        parameters: {
                            type: 'object',
                            properties: {
                                key: { type: 'string' }
                            },
                            required: ['key']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'wait_for_ui',
                        description: 'Espera a que la UI reaccione cuando acabas de navegar o pulsar algo.',
                        parameters: {
                            type: 'object',
                            properties: {
                                time_ms: { type: 'integer' }
                            }
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'request_user_turn',
                        description: 'Pide al usuario que complete manualmente un paso bloqueante como login, captcha o verificacion.',
                        parameters: {
                            type: 'object',
                            properties: {
                                message: { type: 'string' }
                            },
                            required: ['message']
                        }
                    }
                }
            ],
            messages: [
                {
                    role: 'system',
                    content: [
                        'Eres un bootstrapper extremadamente conservador.',
                        'Objetivo: llegar al dashboard de Inception y dejar lista la generacion de una API key personal.',
                        'Solo puedes navegar dentro de la plataforma de Inception.',
                        'No inventes formularios ni escribas datos sensibles del usuario.',
                        'Si aparece login, captcha, verificacion o aprobacion humana, llama request_user_turn.',
                        'Haz una sola accion por turno.'
                    ].join('\n')
                },
                {
                    role: 'user',
                    content: [
                        `URL actual: ${page.url || ''}`,
                        `Titulo: ${page.title || ''}`,
                        'Snapshot interactivo:',
                        snapshot?.snapshot || '(sin snapshot)',
                        'Posibles keys detectadas:',
                        candidatePreview
                    ].join('\n\n')
                }
            ]
        });

        const toolCall = response?.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.name) {
            return { type: 'wait_for_ui', time_ms: 1000 };
        }

        let args = {};
        try {
            args = JSON.parse(toolCall.function.arguments || '{}');
        } catch (_) {
            args = {};
        }

        return {
            type: toolCall.function.name,
            ...args
        };
    }

    async _applyAction(action, targetId) {
        const type = action?.type || 'wait_for_ui';

        if (type === 'request_user_turn') {
            return {
                paused: true,
                state: this._pauseForUser(action.message || 'Necesito una confirmacion manual en Inception para continuar.')
            };
        }

        if (type === 'click_ref' && action.ref) {
            this._updateProgress({ lastMessage: `Interactuando con ${action.ref}...` });
            await this.browserAgent.act({ kind: 'click', targetId, ref: action.ref, timeoutMs: 10000 }, 'managed');
            return { completed: false };
        }

        if (type === 'type_ref' && action.ref) {
            this._updateProgress({ lastMessage: `Escribiendo en ${action.ref}...` });
            await this.browserAgent.act({
                kind: 'type',
                targetId,
                ref: action.ref,
                text: String(action.text || ''),
                submit: action.submit === true,
                timeoutMs: 10000
            }, 'managed');
            return { completed: false };
        }

        if (type === 'press_key' && action.key) {
            this._updateProgress({ lastMessage: `Presionando ${action.key}...` });
            await this.browserAgent.act({ kind: 'press', targetId, key: action.key }, 'managed');
            return { completed: false };
        }

        this._updateProgress({ lastMessage: 'Esperando a que la pagina termine de reaccionar...' });
        await this.browserAgent.act({ kind: 'wait', targetId, timeMs: Math.max(500, Number(action.time_ms) || 1200) }, 'managed');
        return { completed: false };
    }

    async _readCurrentPage() {
        let browser;
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${MANAGED_CHROME_PORT}`);
            const context = browser.contexts()[0];
            const pages = context?.pages() || [];
            const preferredTargetId = String(this.browserAgent?.browserContext?.targetId || '');

            let page = null;
            for (const candidate of pages) {
                const session = await candidate.context().newCDPSession(candidate).catch(() => null);
                const info = session ? await session.send('Target.getTargetInfo').catch(() => null) : null;
                const candidateTargetId = String(info?.targetInfo?.targetId || '');
                if (candidateTargetId && candidateTargetId === preferredTargetId) {
                    page = candidate;
                    break;
                }
            }

            if (!page) {
                page = pages.find((candidate) => (candidate.url() || '').includes('inception')) || pages[0] || null;
            }
            if (!page) {
                return { url: '', title: '', text: '', candidates: [] };
            }

            return await page.evaluate(() => {
                const candidateSelectors = [
                    'code',
                    'pre',
                    'input:not([type="password"])',
                    'textarea',
                    '[data-testid*="key"]',
                    '[data-test*="key"]',
                    '[aria-label*="key" i]'
                ];
                const candidates = [];
                for (const selector of candidateSelectors) {
                    for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 12)) {
                        const value = 'value' in element ? String(element.value || '') : String(element.textContent || '');
                        const normalized = value.replace(/\s+/g, ' ').trim();
                        if (normalized.length >= 24) {
                            candidates.push(normalized);
                        }
                    }
                }

                return {
                    url: window.location.href,
                    title: document.title || '',
                    text: String(document.body?.innerText || '').slice(0, 10000),
                    candidates
                };
            });
        } finally {
            if (browser) {
                await browser.close().catch(() => { });
            }
        }
    }

    _complete(apiKey, config) {
        const cleanKey = String(apiKey || '').trim();
        if (!cleanKey) {
            return this._fail('Se detecto una key vacia al cerrar el onboarding de Inception.');
        }

        upsertEnvFile(this.envPath, {
            INCEPTION_API_KEY: cleanKey,
            INCEPTION_BASE_URL: config.baseUrl,
            INCEPTION_MODEL: config.model,
            BRAIN_CHAT_PROVIDER: 'inception'
        });

        process.env.INCEPTION_API_KEY = cleanKey;
        process.env.INCEPTION_BASE_URL = config.baseUrl;
        process.env.INCEPTION_MODEL = config.model;
        process.env.BRAIN_CHAT_PROVIDER = 'inception';
        ModelSwitch.initInception(cleanKey, { source: 'personal' });

        const next = this._writeState({
            status: 'completed',
            waitingForUser: false,
            lastError: '',
            lastMessage: 'La API personal de Inception quedo guardada para usarla como provider de texto.',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastSavedKeyMasked: maskSecret(cleanKey)
        });
        this.emit('status', next);
        return next;
    }

    _pauseForUser(message) {
        const next = this._writeState({
            status: 'waiting_user',
            waitingForUser: true,
            lastMessage: String(message || '').trim(),
            updatedAt: new Date().toISOString()
        });
        this.emit('status', next);
        return next;
    }

    _fail(message) {
        const next = this._writeState({
            status: 'error',
            waitingForUser: false,
            lastError: String(message || '').trim(),
            lastMessage: String(message || '').trim(),
            updatedAt: new Date().toISOString()
        });
        this.emit('status', next);
        return next;
    }

    _updateProgress(patch) {
        const next = this._writeState({
            status: 'running',
            waitingForUser: false,
            updatedAt: new Date().toISOString(),
            ...patch
        });
        this.emit('status', next);
        return next;
    }

    _readStateFile() {
        try {
            if (!this.statePath || !fs.existsSync(this.statePath)) return { ...DEFAULT_STATE };
            const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return { ...DEFAULT_STATE, ...parsed };
        } catch (_) {
            return { ...DEFAULT_STATE };
        }
    }

    _writeState(patch = {}) {
        const next = {
            ...this._readStateFile(),
            ...patch
        };
        if (this.statePath) {
            fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
            fs.writeFileSync(this.statePath, JSON.stringify(next, null, 2));
        }
        return {
            ...this.getState(),
            ...next
        };
    }
}

module.exports = InceptionBootstrapper;

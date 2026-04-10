/**
 * BrowserAgent.js
 * ─────────────────────────────────────────────────────────────
 * Capa de control transversal del navegador.
 *
 * ARQUITECTURA (3 capas limpias):
 *
 *  1. EXTRACCIÓN DE AFFORDANCES
 *     → CDP (Chrome DevTools Protocol) vía WebSocket
 *     → DOM / ARIA snapshot de cualquier página web
 *
 *  2. AGENTE (LLM / Lógica)
 *     → ModelSwitch.chatCompletion() (igual que ScreenAgent)
 *     → Decide qué acción ejecutar a partir de los affordances
 *
 *  3. EJECUCIÓN ESPECIALIZADA
 *     → nut-js mouse.setPosition() para movimiento de cursor
 *     → CDP Input.dispatchMouseEvent / Runtime.evaluate para acciones propias del browser
 *
 * USO ACTUAL → AgarIO
 *   Cuando el contexto activo es "agar.io":
 *   - El gesto PINZA mueve el cursor del SO (nut-js), que AgarIO detecta nativamente.
 *   - El agente abre agar.io, escribe nickname, hace click en Play y espera al anuncio.
 *
 * USO FUTURO → Cualquier página web
 *   - Extrae affordances DOM/ARIA de cualquier tab Chrome.
 *   - El agente LLM decide la acción óptima.
 *   - La capa de ejecución la realiza via CDP o cursor.
 */

'use strict';

const net = require('net');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { chromium } = require('playwright-core'); // Incorporado Playwright
const LoggingSwitch = require('./LoggingSwitch');
const {
    MANAGED_CHROME_APP,
    MANAGED_CHROME_PORT,
    ensureManagedChrome,
    focusManagedChromeInstance,
    getManagedChromeConfig,
    getManagedChromeTargets,
    openManagedChromeUrl
} = require('./ManagedChrome');
const VERBOSE_BROWSER_LOGS = process.env.IU_VERBOSE_BROWSER_LOGS === '1';

function isRestrictedBrowserUrl(url = '') {
    const normalized = String(url || '').toLowerCase();
    if (!normalized) return true;
    return normalized.startsWith('chrome://') ||
        normalized.startsWith('chrome-extension://') ||
        normalized.startsWith('devtools://') ||
        normalized.startsWith('edge://') ||
        normalized.startsWith('about:');
}

// ─────────────────────────────────────────────────────────────
// CDP HTTP helpers
// ─────────────────────────────────────────────────────────────

/**
 * Obtiene la lista de tabs abiertos en Chrome via /json/list.
 * Chrome debe estar corriendo con --remote-debugging-port=9222
 */
function fetchCdpTargets(host = '127.0.0.1', port = 9222) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host, port, path: '/json/list', timeout: 2000 }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('CDP timeout')); });
    });
}

// ─────────────────────────────────────────────────────────────
// Extracción de affordances DOM / ARIA usando Playwright + CDP
// (Al estilo OpenClaw pero con coordenadas Físicas nativas para OS)
// ─────────────────────────────────────────────────────────────

/**
 * Extrae el Accessibility Tree y calcula el Bounding Box de cada elemento.
 * Luego traduce los cuadros a Coordenadas Absolutas de la Ventana física.
 */
async function extractAriaAffordances(wsUrl, limit = 400) {
    let browser;
    try {
        // Conectar Playwright al browser gestionado de IU y seleccionar la tab objetivo.
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${MANAGED_CHROME_PORT}`);
        const context = browser.contexts()[0];
        const page = context.pages().find(p => (p.url() || '') === wsUrl)
            || context.pages().find(p => (p.url() || '').includes(wsUrl))
            || context.pages().find(p => !isRestrictedBrowserUrl(p.url() || ''))
            || context.pages()[0];
        if (!page) throw new Error("No hay página activa");

        // 1. Obtener la distancia exacta desde el borde superior de la pantalla hasta 
        // el área de contenido (viewport) interno del browser.
        const viewportOffset = await page.evaluate(() => {
            // El gap entre window.screenY y la página real (Barras de URL, bookmarks, tabs).
            // NOTA: Chrome reporta outerHeight y innerHeight. La diferencia suele ser la UI de arriba.
            const uiHeaderHeight = window.outerHeight - window.innerHeight;
            return {
                x: window.screenX + ((window.outerWidth - window.innerWidth) / 2),
                y: window.screenY + uiHeaderHeight
            };
        });

        // 2. Establecer sesión cruda CDP para usar el nativo Accessibility Tree (soporta Shadow DOM/iFrames)
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Accessibility.enable').catch(() => { });
        await cdp.send('DOM.enable').catch(() => { });

        // 3. Extraer el árbol semántico entero
        const res = await cdp.send('Accessibility.getFullAXTree');
        const nodes = Array.isArray(res?.nodes) ? res.nodes : [];

        // 4. Filtrar nodos interactivos listos
        const interactives = nodes.filter(n => {
            if (!n.role?.value || n.role.value === 'none' || n.role.value === 'generic') return false;
            if (!n.name?.value && !n.value?.value && !['textbox', 'searchbox', 'combobox'].includes(n.role.value)) return false;

            // Foco principal en roles clickeables / tecleables
            const roles = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem', 'checkbox', 'radio', 'tab'];
            return roles.includes(n.role.value);
        });

        const affordances = [];
        let idCounter = 1;

        // 5. Para cada nodo importante, pedir sus coordenadas exactas
        for (const n of interactives) {
            if (!n.backendDOMNodeId) continue;
            try {
                // Resolver el nodo en el DOM backend para obtener un objectId temporal
                const nodeInfo = await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId }).catch(() => null);
                if (nodeInfo && nodeInfo.object?.objectId) {

                    // Pedir el modelo de caja geométrico (BoxModel -> TopLeft, TopRight...)
                    const box = await cdp.send('DOM.getBoxModel', { objectId: nodeInfo.object.objectId }).catch(() => null);

                    // Liberar memoria
                    cdp.send('Runtime.releaseObject', { objectId: nodeInfo.object.objectId }).catch(() => null);

                    if (box && box.model) {
                        const quad = box.model.border;

                        // Determinar bounding box (X e Y mínimo)
                        const vx = Math.min(quad[0], quad[2], quad[4], quad[6]);
                        const vy = Math.min(quad[1], quad[3], quad[5], quad[7]);
                        const vw = Math.max(quad[0], quad[2], quad[4], quad[6]) - vx;
                        const vh = Math.max(quad[1], quad[3], quad[5], quad[7]) - vy;

                        if (vw > 0 && vh > 0) {

                            // Traducir las coordenadas locales del viewport a Coordenadas Absolutas del Mouse en Pantalla
                            const absX = viewportOffset.x + vx;
                            const absY = viewportOffset.y + vy;

                            affordances.push({
                                id: idCounter++,
                                role: n.role.value,
                                label: n.name?.value || n.value?.value || n.role.value,
                                type: n.role.value,

                                // Coordenadas normalizadas con sistema OS absoluto
                                bbox: { x: absX, y: absY, w: vw, h: vh },
                                center: {
                                    x: absX + (vw / 2),
                                    y: absY + (vh / 2)
                                },

                                nodeId: n.nodeId,
                                backendDOMNodeId: n.backendDOMNodeId
                            });

                            if (affordances.length >= limit) break;
                        }
                    }
                }
            } catch (e) {
                // Ignore silent element resolution failures
            }
        }

        return affordances;

    } catch (e) {
        console.error('❌ [BrowserAgent/Playwright] Error al capturar Snapshot:', e.message);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Fallback a extracción DOM por JavaScript si ARIA falla o está vacío.
 */
async function extractDomAffordances(wsUrl) {
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${MANAGED_CHROME_PORT}`);
        const context = browser.contexts()[0];
        const page = context.pages().find(p => (p.url() || '') === wsUrl)
            || context.pages().find(p => (p.url() || '').includes(wsUrl))
            || context.pages().find(p => !isRestrictedBrowserUrl(p.url() || ''))
            || context.pages()[0];
        if (!page) throw new Error("No hay página activa");

        const affordances = await page.evaluate(() => {
            const uiHeaderHeight = window.outerHeight - window.innerHeight;
            const absoluteOX = window.screenX + ((window.outerWidth - window.innerWidth) / 2);
            const absoluteOY = window.screenY + uiHeaderHeight;

            const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], canvas';
            const els = Array.from(document.querySelectorAll(selectors)).slice(0, 200);
            return els.map((el, i) => {
                const rect = el.getBoundingClientRect();

                const absX = absoluteOX + rect.x;
                const absY = absoluteOY + rect.y;

                return {
                    id: i + 1,
                    tag: el.tagName.toLowerCase(),
                    type: el.type || el.getAttribute('role') || 'generic',
                    label: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
                    bbox: { x: absX, y: absY, w: rect.width, h: rect.height },
                    center: { x: absX + (rect.width / 2), y: absY + (rect.height / 2) }
                };
            }).filter(el => el.bbox.w > 0 && el.bbox.h > 0);
        });
        return affordances;

    } catch (e) {
        console.error('❌ [BrowserAgent/DOM] Fallback fallido:', e.message);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

/**
 * Ejecuta JavaScript en la tab activa via Playwright CDP.
 */
async function evalInTab(wsUrl, expression) {
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${MANAGED_CHROME_PORT}`);
        const context = browser.contexts()[0];
        const page = context.pages().find(p => (p.url() || '') === wsUrl)
            || context.pages().find(p => (p.url() || '').includes(wsUrl))
            || context.pages().find(p => !isRestrictedBrowserUrl(p.url() || ''))
            || context.pages()[0];
        if (!page) throw new Error("No hay página activa");
        const result = await page.evaluate(expression);
        return result;
    } catch (e) {
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// BrowserAgent — Clase principal
// ─────────────────────────────────────────────────────────────

class BrowserAgent extends EventEmitter {
    constructor(mainWindow, options = {}) {
        super();
        this.mainWindow = mainWindow;
        this.browserCoreClient = options.browserCoreClient || null;
        this.backendInitError = String(options.backendInitError || '').trim();

        // Estado del contexto activo del browser
        this.browserContext = {
            active: false,       // ¿Está activo el modo browser?
            url: '',             // URL activa
            app: '',             // Nombre del sitio/app (ej: 'agario', 'gmail')
            wsUrl: '',           // URL/CDP identity del tab activo
            targetId: '',        // Target CDP del tab cuando se conoce
        };
        this.lastRequestedUrl = '';
        this._lastContextLogKey = '';
        this._lastContextLogAt = 0;

        // Estado del cursor para AgarIO (pinch gesture → mouse move)
        this.agarIoCursor = {
            active: false,
            startHandX: 0,
            startHandY: 0,
            startMouseX: 0,
            startMouseY: 0,
            lastX: 0,
            lastY: 0,
        };

        // nut-js (lazy load)
        this._nutjs = null;

        // Config CDP
        this.CDP_HOST = '127.0.0.1';
        this.CDP_PORT = MANAGED_CHROME_PORT;
        this.managedChrome = getManagedChromeConfig();
        this.extensionOnboardingShown = false;

        // Gain del cursor para AgarIO (mueve más rápido que la ventana Electron)
        this.AGARIO_CURSOR_GAIN = 3.5;

        // Configuración de Servidor WS local para Extensión de Chrome Nativa
        this.extensionWebSocket = null;
        this.extensionPendingResolve = null;
        this._initExtensionServer();

        console.log('🌐 [BrowserAgent] Initialized');
    }

    async getStatus() {
        if (!this.browserCoreClient) {
            return {
                active: this.browserContext.active,
                app: this.browserContext.app,
                url: this.browserContext.url,
                isAgarIO: this.isAgarIO,
                core: null,
                coreError: this.backendInitError || null
            };
        }
        try {
            const core = await this.browserCoreClient.status();
            return {
                active: this.browserContext.active,
                app: this.browserContext.app,
                url: this.browserContext.url,
                isAgarIO: this.isAgarIO,
                core
            };
        } catch (error) {
            return {
                active: this.browserContext.active,
                app: this.browserContext.app,
                url: this.browserContext.url,
                isAgarIO: this.isAgarIO,
                coreError: error.message
            };
        }
    }

    async listProfiles() {
        if (!this.browserCoreClient) {
            return {
                ok: true,
                profiles: []
            };
        }
        return await this.browserCoreClient.profiles();
    }

    async listTabs(profile = 'managed') {
        if (!this.browserCoreClient) {
            return { ok: true, profile, tabs: [] };
        }
        return await this.browserCoreClient.tabs(profile);
    }

    async getSnapshot(options = {}) {
        if (!this.browserCoreClient) {
            throw new Error('Browser core client is not available');
        }
        return await this.browserCoreClient.snapshot({
            profile: options.profile || 'managed',
            targetId: options.targetId,
            format: options.format,
            maxChars: options.maxChars
        });
    }

    async act(request, profile = 'managed') {
        if (!this.browserCoreClient) {
            throw new Error('Browser core client is not available');
        }
        return await this.browserCoreClient.act(profile, request);
    }

    async takeScreenshot(options = {}) {
        if (!this.browserCoreClient) {
            throw new Error('Browser core client is not available');
        }
        return await this.browserCoreClient.screenshot({
            profile: options.profile || 'managed',
            targetId: options.targetId,
            ref: options.ref,
            selector: options.selector,
            fullPage: options.fullPage,
            type: options.type
        });
    }

    async getConsole(profile = 'managed', targetId = undefined) {
        if (!this.browserCoreClient) {
            throw new Error('Browser core client is not available');
        }
        return await this.browserCoreClient.console(profile, targetId);
    }

    async getNetwork(profile = 'managed', targetId = undefined) {
        if (!this.browserCoreClient) {
            throw new Error('Browser core client is not available');
        }
        return await this.browserCoreClient.network(profile, targetId);
    }

    // ─── Servidor WebSocket para Extensión de Chrome ───────────
    _initExtensionServer() {
        try {
            const WebSocket = require('ws');
            const server = http.createServer();
            const wss = new WebSocket.Server({ noServer: true });
            this.extensionServer = server;
            this.wss = wss;

            server.on('upgrade', (request, socket, head) => {
                wss.handleUpgrade(request, socket, head, (ws) => {
                    wss.emit('connection', ws, request);
                });
            });

            server.on('error', (error) => {
                const message = String(error?.message || error || '').trim();
                if (error?.code === 'EADDRINUSE') {
                    console.warn('⚠️ [BrowserAgent] Puerto 9223 ocupado; desactivo el WS legacy de la extensión para no tumbar la app.');
                    return;
                }
                console.warn(`⚠️ [BrowserAgent] Error en servidor WS de extensión: ${message}`);
            });

            this.wss.on('connection', (ws) => {
                console.log('🔌 [BrowserAgent] Extensión de Chrome Conectada!');
                this.extensionWebSocket = ws;
                this.extensionOnboardingShown = false;

                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        if (data.type === 'AFFORDANCES_RESULT' || data.type === 'ERROR') {
                            if (this.extensionPendingResolve) {
                                this.extensionPendingResolve(data);
                                this.extensionPendingResolve = null;
                            }
                        }
                    } catch (e) {
                        console.error('Error parseando msj de extensión', e);
                    }
                });

                ws.on('close', () => {
                    console.log('🔌 [BrowserAgent] Extensión de Chrome Desconectada');
                    this.extensionWebSocket = null;
                    if (this.extensionPendingResolve) {
                        this.extensionPendingResolve({ type: 'ERROR', error: 'Desconectado' });
                        this.extensionPendingResolve = null;
                    }
                });
            });
            server.listen(9223, '127.0.0.1', () => {
                console.log('🌐 [BrowserAgent] Escuchando Extensión en puerto 9223');
            });
        } catch (e) {
            console.warn('⚠️ [BrowserAgent] No se pudo iniciar WS Server para Extensión:', e.message);
        }
    }

    // ─── nut-js lazy loader ────────────────────────────────────
    async _getNutJS() {
        if (!this._nutjs) {
            const { mouse, keyboard, Button, Key, Point } = require('@nut-tree-fork/nut-js');
            mouse.config.autoDelayMs = 0; // Sin delay para movimiento suave
            keyboard.config.autoDelayMs = 50;
            this._nutjs = { mouse, keyboard, Button, Key, Point };
        }
        return this._nutjs;
    }

    // ─── Detección de Chrome vía CDP ──────────────────────────

    /**
     * Verifica si Chrome está corriendo con --remote-debugging-port
     * y devuelve la lista de tabs disponibles.
     */
    async getChromeTargets() {
        try {
            await ensureManagedChrome('', [], { source: 'BrowserAgent.getChromeTargets' });
            return await getManagedChromeTargets();
        } catch (e) {
            console.log(`⚠️ [BrowserAgent] IU Chrome no disponible en puerto ${this.CDP_PORT}:`, e.message);
            return [];
        }
    }

    /**
     * Detecta el tab activo de Chrome que coincida con un patrón de URL.
     * Devuelve el target CDP o null.
     */
    async findActiveTab(urlPattern) {
        const targets = await this.getChromeTargets();
        if (urlPattern) {
            return targets.find(t => t.url && t.url.includes(urlPattern)) || null;
        }
        // Sin patrón: prioriza tabs web reales por sobre internas/restringidas.
        return targets.find(t => t.url && !isRestrictedBrowserUrl(t.url)) || targets[0] || null;
    }

    // ─── Contexto activo ──────────────────────────────────────

    /**
     * Activa el modo browser con el contexto del tab actual.
     * Llamado cuando el usuario cambia de app nativa a browser.
     */
    setBrowserContext(url, meta = {}) {
        const previous = { ...this.browserContext };
        const app = this._detectApp(url);
        const nextTargetId = String(meta.targetId || '');
        const nextWsUrl = String(meta.wsUrl || '');
        this.browserContext = {
            active: true,
            url,
            app,
            wsUrl: nextWsUrl,
            targetId: nextTargetId,
        };
        this.lastRequestedUrl = url || this.lastRequestedUrl || '';

        const now = Date.now();
        const contextKey = `${String(url || '')}|${nextTargetId}|${nextWsUrl}`;
        const changed =
            !previous.active ||
            String(previous.url || '') !== String(url || '') ||
            String(previous.targetId || '') !== nextTargetId ||
            String(previous.wsUrl || '') !== nextWsUrl;
        const shouldEmit = changed || this._lastContextLogKey !== contextKey || (now - this._lastContextLogAt) > 15000;
        if (shouldEmit) {
            LoggingSwitch.execution('BrowserAgent', `Context set -> ${app} (${url})`);
            this._lastContextLogKey = contextKey;
            this._lastContextLogAt = now;
        }
    }

    _normalizeUrlForMatch(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        try {
            const parsed = new URL(raw);
            const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
            return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase();
        } catch (_) {
            return raw.replace(/\/+$/, '').toLowerCase();
        }
    }

    _urlsMatch(left, right) {
        const a = this._normalizeUrlForMatch(left);
        const b = this._normalizeUrlForMatch(right);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    }

    _pickBestTabMatch(tabs, preferredUrl = '', preferredTargetId = '') {
        if (!Array.isArray(tabs) || tabs.length === 0) return null;

        const preferred = String(preferredUrl || '').trim();
        const targetId = String(preferredTargetId || '').trim();

        return tabs.find((tab) => targetId && tab?.targetId === targetId)
            || tabs.find((tab) => preferred && this._urlsMatch(tab?.url, preferred) && tab?.active)
            || tabs.find((tab) => preferred && this._urlsMatch(tab?.url, preferred))
            || tabs.find((tab) => tab?.active && tab?.url && !isRestrictedBrowserUrl(tab.url))
            || tabs.find((tab) => tab?.url && !isRestrictedBrowserUrl(tab.url))
            || tabs[0]
            || null;
    }

    /**
     * Desactiva el modo browser (usuario cambió a app nativa).
     */
    clearBrowserContext() {
        this.browserContext.active = false;
        this.agarIoCursor.active = false;
        this._lastContextLogKey = '';
        this._lastContextLogAt = 0;
        LoggingSwitch.execution('BrowserAgent', 'Context cleared (native app mode)');
    }

    async syncActiveTabContext(preferredUrl = '') {
        if (this.browserCoreClient) {
            try {
                const preferred = String(preferredUrl || this.lastRequestedUrl || this.browserContext?.url || '').trim();
                const preferredTargetId = String(this.browserContext?.targetId || '').trim();
                const response = await this.browserCoreClient.tabs('managed');
                const tabs = Array.isArray(response?.tabs) ? response.tabs : [];
                const chosen = this._pickBestTabMatch(tabs, preferred, preferredTargetId);
                if (!chosen?.url) {
                    return { ...this.browserContext };
                }
                this.setBrowserContext(chosen.url, {
                    targetId: chosen.targetId || '',
                    wsUrl: chosen.url || ''
                });
                return { ...this.browserContext };
            } catch (error) {
                if (this.browserContext?.active && this.browserContext?.url) {
                    console.warn('⚠️ [BrowserAgent] browser-core sync failed; preserving current browser context:', error.message);
                    return { ...this.browserContext };
                }
                // Fallback al camino legacy mientras migramos
            }
        }

        const preferred = String(preferredUrl || this.browserContext?.url || '').trim();
        const targets = await this.getChromeTargets();

        let pageStates = [];
        try {
            const { browser, context } = await this._connectManagedBrowser();
            try {
                const pages = context.pages().filter(page => !isRestrictedBrowserUrl(page.url() || ''));
                pageStates = await Promise.all(pages.map(async (page) => {
                    const url = page.url() || '';
                    let visibilityState = 'unknown';
                    let hasFocus = false;
                    try {
                        const state = await page.evaluate(() => ({
                            visibilityState: document.visibilityState,
                            hasFocus: document.hasFocus()
                        }));
                        visibilityState = String(state?.visibilityState || 'unknown');
                        hasFocus = Boolean(state?.hasFocus);
                    } catch (_) {
                        // best effort only
                    }

                    return {
                        url,
                        visibilityState,
                        hasFocus
                    };
                }));
            } finally {
                await browser.close().catch(() => { });
            }
        } catch (_) {
            // best effort only
        }

        const targetByUrl = (url = '') => targets.find(target => target?.url === url)
            || targets.find(target => String(target?.url || '').includes(url) || String(url || '').includes(String(target?.url || '')))
            || null;

        const preferredVisible = pageStates.find(page => page.url === preferred && (page.hasFocus || page.visibilityState === 'visible'));
        const preferredPartialVisible = pageStates.find(page => preferred && String(page.url || '').includes(preferred) && (page.hasFocus || page.visibilityState === 'visible'));
        const focused = pageStates.find(page => page.hasFocus);
        const visible = pageStates.find(page => page.visibilityState === 'visible');
        const preferredTarget = targets.find(target => target?.url === preferred)
            || targets.find(target => preferred && String(target?.url || '').includes(preferred))
            || null;
        const fallbackTarget = targets.find(target => target?.url && !isRestrictedBrowserUrl(target.url)) || null;

        const chosenUrl = preferredVisible?.url
            || preferredPartialVisible?.url
            || focused?.url
            || visible?.url
            || preferredTarget?.url
            || fallbackTarget?.url
            || '';

        if (!chosenUrl) {
            return { ...this.browserContext };
        }

        const chosenTarget = targetByUrl(chosenUrl);
        this.setBrowserContext(chosenUrl, {
            targetId: chosenTarget?.id || '',
            wsUrl: chosenTarget?.url || chosenUrl
        });

        return { ...this.browserContext };
    }

    async _connectManagedBrowser() {
        await ensureManagedChrome('', [], { source: 'BrowserAgent._connectManagedBrowser' });
        const browser = await chromium.connectOverCDP(`http://${this.CDP_HOST}:${this.CDP_PORT}`);
        const context = browser.contexts()[0];
        if (!context) {
            await browser.close().catch(() => { });
            throw new Error('No se pudo obtener el contexto del IU Chrome');
        }
        return { browser, context };
    }

    _pickReusablePage(pages, targetUrl = '') {
        const target = String(targetUrl || '');
        return pages.find(page => target && (page.url() || '') === target)
            || pages.find(page => target && (page.url() || '').includes(target))
            || pages.find(page => {
                const url = page.url() || '';
                return url && !url.includes('chatgpt.com') && !isRestrictedBrowserUrl(url);
            })
            || pages.find(page => {
                const url = page.url() || '';
                return !url || url === 'about:blank' || url.startsWith('chrome://new-tab-page') || url.startsWith('chrome://newtab');
            })
            || null;
    }

    /**
     * Dado una URL, detecta el nombre del app/sitio.
     */
    _detectApp(url) {
        if (!url) return 'unknown';
        if (url.includes('agar.io')) return 'agario';
        if (url.includes('gmail.com')) return 'gmail';
        if (url.includes('slack.com')) return 'slack';
        if (url.includes('notion.so')) return 'notion';
        if (url.includes('github.com')) return 'github';
        if (url.includes('youtube.com')) return 'youtube';
        if (url.includes('instagram.com')) return 'instagram';
        if (url.includes('web.whatsapp.com')) return 'whatsapp';
        if (url.includes('linkedin.com')) return 'linkedin';
        if (url.includes('reddit.com')) return 'reddit';
        if (url.includes('facebook.com')) return 'facebook';
        if (url.includes('twitter.com') || url.includes('x.com')) return 'x';
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch (_) {
            return 'browser';
        }
    }

    /**
     * ¿El contexto activo es AgarIO?
     */
    get isAgarIO() {
        return this.browserContext.active && this.browserContext.app === 'agario';
    }

    // ─── CURSOR CONTROL (AgarIO pinch gesture) ────────────────

    /**
     * Maneja el evento pinch del gesto de mano para mover el cursor.
     * Reemplaza el movimiento de la ventana Electron cuando AgarIO está activo.
     *
     * @param {object} payload - { phase: 'start'|'move'|'end', xNorm, yNorm }
     * @param {object} handBounds - { x, y, width, height } del handWindow
     * @param {object} screenBounds - { width, height } del display primario
     */
    async handlePinchMove(payload, handBounds, screenBounds) {
        if (!this.isAgarIO) return false;

        const { phase, xNorm, yNorm } = payload;
        if (typeof xNorm !== 'number' || typeof yNorm !== 'number') return false;

        // Coordenada absoluta de la mano en pantalla
        const handX = handBounds.x + (xNorm * handBounds.width);
        const handY = handBounds.y + (yNorm * handBounds.height);

        const nutjs = await this._getNutJS();
        const { mouse, Point } = nutjs;

        if (phase === 'start' || !this.agarIoCursor.active) {
            // Guardamos la posición actual del cursor como punto de anclaje
            let currentPos;
            try { currentPos = await mouse.getPosition(); }
            catch (_) { currentPos = { x: screenBounds.width / 2, y: screenBounds.height / 2 }; }

            this.agarIoCursor = {
                active: true,
                startHandX: handX,
                startHandY: handY,
                startMouseX: currentPos.x,
                startMouseY: currentPos.y,
                lastX: currentPos.x,
                lastY: currentPos.y,
            };
            console.log(`🎮 [BrowserAgent] AgarIO cursor start at (${currentPos.x}, ${currentPos.y})`);
            return true;
        }

        if (phase === 'end') {
            this.agarIoCursor.active = false;
            console.log('🎮 [BrowserAgent] AgarIO cursor drag ended');
            return true;
        }

        // Move phase: calcular delta relativo al punto de inicio
        const deltaX = (handX - this.agarIoCursor.startHandX) * this.AGARIO_CURSOR_GAIN;
        const deltaY = (handY - this.agarIoCursor.startHandY) * this.AGARIO_CURSOR_GAIN;

        const targetX = Math.round(this.agarIoCursor.startMouseX + deltaX);
        const targetY = Math.round(this.agarIoCursor.startMouseY + deltaY);

        // Clampar a los límites de la pantalla
        const clampedX = Math.max(0, Math.min(targetX, screenBounds.width - 1));
        const clampedY = Math.max(0, Math.min(targetY, screenBounds.height - 1));

        try {
            await mouse.setPosition(new Point(clampedX, clampedY));
            this.agarIoCursor.lastX = clampedX;
            this.agarIoCursor.lastY = clampedY;
        } catch (e) {
            console.warn('⚠️ [BrowserAgent] mouse.setPosition failed:', e.message);
        }

        return true;
    }

    // ─── AGENTE AGENTICO: Lanzar AgarIO ──────────────────────

    /**
     * Ejecuta el flujo completo de AgarIO:
     *  1. Abre agar.io en Chrome (via AppleScript si es necesario)
     *  2. Escribe un nickname
     *  3. Hace click en Play
     *  4. Espera 7s para saltar el anuncio
     *  5. Activa el modo cursor (pinch → mouse move)
     *
     * @param {string} [nickname] - Nickname a usar. Si no se pasa, se genera uno.
     */
    async launchAgarIO(nickname) {
        const nick = nickname || this._generateNickname();
        console.log(`🎮 [BrowserAgent] Launching AgarIO with nickname: "${nick}"`);

        this.emit('status', { phase: 'launching', message: `Abriendo AgarIO como "${nick}"` });

        // 1. Abrir agar.io en Chrome
        await this._openInChrome('https://agar.io');
        await this._wait(3000); // Esperar que cargue

        // 2. Conectar via CDP al tab de AgarIO
        const tab = await this.findActiveTab('agar.io');
        if (!tab || !tab.webSocketDebuggerUrl) {
            console.error('❌ [BrowserAgent] No se encontró tab de AgarIO via CDP');
            this.emit('status', { phase: 'error', message: 'No se pudo conectar a Chrome. Asegúrate de tener Chrome abierto.' });
            return { success: false, error: 'cdp_not_found' };
        }

        this.browserContext.wsUrl = tab.webSocketDebuggerUrl;
        this.setBrowserContext(tab.url, {
            targetId: tab.id || '',
            wsUrl: tab.webSocketDebuggerUrl || tab.url || ''
        });

        // 3. Escribir nickname y hacer click en Play via CDP
        try {
            await this._fillAgarIONickname(tab.webSocketDebuggerUrl, nick);
            await this._wait(500);
            await this._clickAgarIOPlay(tab.webSocketDebuggerUrl);

            this.emit('status', { phase: 'ingame', message: `Jugando como "${nick}". Usa la pinza para moverte.` });

            // 4. Esperar 7s para que pase el anuncio
            console.log('⏳ [BrowserAgent] Esperando 7s para saltar anuncio...');
            this.emit('status', { phase: 'ad_wait', message: 'Saltando anuncio en 7 segundos...' });
            await this._wait(7000);

            // 5. Activar modo cursor activo 
            this.agarIoCursor.active = false; // Se activa con el primer pinch
            console.log('✅ [BrowserAgent] AgarIO listo. Pinza activada para mover el cursor.');
            this.emit('status', { phase: 'ready', message: '¡Juega! Usa la pinza para mover la bola.' });

            return { success: true, nickname: nick };
        } catch (e) {
            console.error('❌ [BrowserAgent] AgarIO launch failed:', e.message);
            this.emit('status', { phase: 'error', message: e.message });
            return { success: false, error: e.message };
        }
    }

    /**
     * Escribe el nickname en el input de AgarIO.
     */
    async _fillAgarIONickname(wsUrl, nickname) {
        // AgarIO tiene un input de tipo text para el nick
        const expression = `(() => {
            // Intentar múltiples selectores (el sitio puede cambiar)
            const selectors = [
                'input[placeholder*="nick" i]',
                'input[id*="nick" i]',
                'input[name*="nick" i]',
                'input[type="text"]',
                '#nick',
                '.nick-input',
                'input[maxlength]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    el.focus();
                    el.value = '';
                    // Simular escritura real para que React/frameworks detecten el cambio
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(el, ${JSON.stringify(nickname)});
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { found: true, selector: sel };
                }
            }
            return { found: false };
        })()`;

        const result = await evalInTab(wsUrl, expression);
        if (result?.found) {
            console.log(`✅ [BrowserAgent] Nickname "${nickname}" escrito en ${result.selector}`);
        } else {
            console.warn('⚠️ [BrowserAgent] No se encontró el input de nickname. El sitio puede haber cambiado.');
        }
    }

    /**
     * Hace click en el botón Play de AgarIO.
     */
    async _clickAgarIOPlay(wsUrl) {
        const expression = `(() => {
            const selectors = [
                'button[id*="play" i]',
                'button[class*="play" i]',
                'input[value*="play" i]',
                'button[onclick*="play" i]',
                '.play-button',
                '#play-btn',
                '.btn-play',
                // Selector amplio: botones con texto "play" o "jugar"
                ...Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
                    .filter(el => /play|jugar|start|iniciar/i.test(el.textContent || el.value))
                    .map((_, i) => null)  // marcador
            ];

            for (const sel of selectors) {
                if (!sel) continue;
                const el = document.querySelector(sel);
                if (el) { el.click(); return { found: true, selector: sel }; }
            }

            // Fallback: buscar por texto
            const allBtns = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
            const playBtn = allBtns.find(el => /play|jugar|start|iniciar/i.test(el.textContent || el.value || ''));
            if (playBtn) { playBtn.click(); return { found: true, selector: 'text-match' }; }

            return { found: false };
        })()`;

        const result = await evalInTab(wsUrl, expression);
        if (result?.found) {
            console.log(`✅ [BrowserAgent] Click en Play (${result.selector})`);
        } else {
            console.warn('⚠️ [BrowserAgent] No se encontró el botón Play. Intentando coordenadas visuales...');
        }
    }

    /**
     * Abre una URL en Chrome y actualiza el contexto activo inmediatamente.
     */
    async openUrl(url) {
        if (!url) return { success: false, error: 'missing_url' };
        this.lastRequestedUrl = url;
        LoggingSwitch.execution('BrowserAgent', 'openUrl requested', {
            url,
            currentContext: this.browserContext?.url || '',
            extensionConnected: Boolean(this.extensionWebSocket && this.extensionWebSocket.readyState === 1)
        });
        if (this.browserContext?.active && this.browserContext.url === url) {
            LoggingSwitch.execution('BrowserAgent', 'openUrl reusing current tab/context', { url });
            await this.focusManagedChrome();
            return {
                success: true,
                url,
                app: this.browserContext.app
            };
        }
        if (this.browserCoreClient) {
            try {
                const result = await this.browserCoreClient.open({ profile: 'managed', url });
                await this.focusManagedChrome().catch(() => { });
                this.setBrowserContext(result.url || url, {
                    targetId: result.targetId || '',
                    wsUrl: result.url || url
                });
                return {
                    success: true,
                    url: result.url || url,
                    app: this.browserContext.app,
                    targetId: result.targetId || ''
                };
            } catch (error) {
                console.warn('⚠️ [BrowserAgent] browser-core openUrl failed, falling back to legacy path:', error.message);
            }
        }
        const { browser, context } = await this._connectManagedBrowser();
        try {
            const pages = context.pages();
            let page = this._pickReusablePage(pages, url);

            if (!page) {
                LoggingSwitch.execution('BrowserAgent', 'openUrl creating dedicated automation tab', { url });
                page = await context.newPage();
            } else {
                LoggingSwitch.execution('BrowserAgent', 'openUrl reusing page', {
                    from: page.url() || 'about:blank',
                    to: url
                });
            }

            await page.bringToFront().catch(() => { });
            await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
        } finally {
            await browser.close().catch(() => { });
        }
        await this.focusManagedChrome();
        const activeTarget = await this.findActiveTab(url).catch(() => null);
        this.setBrowserContext(url, {
            targetId: activeTarget?.id || '',
            wsUrl: activeTarget?.url || url
        });
        return {
            success: true,
            url,
            app: this.browserContext.app
        };
    }

    async navigateUrl(url) {
        if (!url) return { success: false, error: 'missing_url' };
        this.lastRequestedUrl = url;

        if (this.browserCoreClient && this.browserContext?.targetId) {
            try {
                const result = await this.browserCoreClient.navigate({
                    profile: 'managed',
                    targetId: this.browserContext.targetId,
                    url
                });
                await this.focusManagedChrome().catch(() => { });
                this.setBrowserContext(result.url || url, {
                    targetId: result.targetId || this.browserContext.targetId || '',
                    wsUrl: result.url || url
                });
                return {
                    success: true,
                    url: result.url || url,
                    app: this.browserContext.app,
                    targetId: result.targetId || this.browserContext.targetId || ''
                };
            } catch (error) {
                console.warn('⚠️ [BrowserAgent] browser-core navigateUrl failed, falling back to openUrl:', error.message);
            }
        }

        return await this.openUrl(url);
    }

    async openExtensionOnboarding() {
        const config = this.managedChrome || getManagedChromeConfig();
        const extensionDir = config.extensionDir;
        this.extensionOnboardingShown = true;
        LoggingSwitch.execution('BrowserAgent', 'openExtensionOnboarding requested', {
            currentContext: this.browserContext?.url || '',
            extensionDir
        });

        this.emit('status', {
            phase: 'extension_onboarding',
            message: 'Instala la extensión de IÜ en el perfil aislado de IU Chrome.'
        });

        await this._openInChrome('chrome://extensions', {
            newWindow: false,
            source: 'BrowserAgent.openExtensionOnboarding'
        });

        await new Promise((resolve) => {
            execFile('open', [extensionDir], () => resolve());
        });

        LoggingSwitch.execution('BrowserAgent', `Extension onboarding opened. Folder: ${extensionDir}`);
    }

    _shouldAutoOpenExtensionOnboarding() {
        const url = String(this.browserContext?.url || '').toLowerCase();
        const appName = String(this.browserContext?.app || '').toLowerCase();
        if (!url) return false;
        if (appName === 'chatgpt.com') return false;
        if (url.startsWith('https://chatgpt.com')) return false;
        if (url.startsWith('chrome://extensions')) return false;
        if (url.startsWith('chrome://newtab')) return false;
        return true;
    }

    /**
     * Abre una URL en el Google Chrome gestionado por IU.
     */
    async _openInChrome(url, options = {}) {
        const extraArgs = options.newWindow ? ['--new-window'] : [];
        await openManagedChromeUrl(url || '', extraArgs, {
            source: options.source || 'BrowserAgent._openInChrome',
            caller: options.caller || `target=${url || 'managed-home'} context=${this.browserContext?.url || 'none'}`
        });
        LoggingSwitch.execution('BrowserAgent', `Opened ${url || 'managed Chrome home'} in ${MANAGED_CHROME_APP}`);
    }

    async focusManagedChrome() {
        if (this.browserCoreClient && this.browserCoreClient.isOpenClawCliBackend) {
            await new Promise((resolve, reject) => {
                execFile('osascript', ['-e', 'tell application "Google Chrome" to activate'], (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
            LoggingSwitch.execution('BrowserAgent', 'Focused Google Chrome for OpenClaw browser session');
            return;
        }
        await focusManagedChromeInstance();
        LoggingSwitch.execution('BrowserAgent', `Focused ${MANAGED_CHROME_APP}`);
    }

    /**
     * Genera un nickname gracioso basado en el contexto.
     */
    _generateNickname() {
        const options = [
            'Ü_SystemBot',
            'IU_Agent',
            'PinchMaster',
            'HandGesture',
            'DigitalNomad',
            'Ü_OS_Player',
            'GestureKing',
            'PinchBlob',
        ];
        return options[Math.floor(Math.random() * options.length)];
    }

    // ─── EXTRACCIÓN DE AFFORDANCES (uso futuro / agéntico) ────

    /**
     * Extrae los affordances de la tab activa.
     * Compatible con cualquier página web — base para el agente transversal.
     *
     * @returns {Promise<{elements: Array, url: string, app: string, source: string}>}
     */
    async extractAffordances() {
        if (!this.browserContext.active) {
            console.warn('⚠️ [BrowserAgent] No hay contexto de browser activo');
            return { elements: [], url: '', app: '', source: 'NONE' };
        }

        if (VERBOSE_BROWSER_LOGS) {
            LoggingSwitch.execution('BrowserAgent', 'extractAffordances start', {
                url: this.browserContext.url,
                app: this.browserContext.app,
                hasExtension: Boolean(this.extensionWebSocket && this.extensionWebSocket.readyState === 1),
                hasWsUrl: Boolean(this.browserContext.wsUrl)
            });
        }

        await ensureManagedChrome('', [], {
            source: 'BrowserAgent.extractAffordances',
            caller: `context=${this.browserContext?.url || 'none'}`
        });

        if (this.browserCoreClient) {
            try {
                const snapshot = await this.browserCoreClient.snapshot({
                    profile: 'managed',
                    targetId: this.browserContext.targetId || undefined,
                    format: 'ai'
                });
                const elements = Array.isArray(snapshot.elements) ? snapshot.elements.map((element, index) => ({
                    id: index + 1,
                    browserRef: element.ref,
                    browserTargetId: snapshot.targetId || this.browserContext.targetId || '',
                    browserProfile: snapshot.profile || 'managed',
                    role: element.role,
                    label: element.label,
                    type: element.role,
                    selector: element.selector,
                    bbox: element.bbox,
                    center: element.center
                })).filter(element => element.browserRef) : [];
                if (elements.length > 0) {
                    this.setBrowserContext(snapshot.url || this.browserContext.url, {
                        targetId: snapshot.targetId || this.browserContext.targetId || '',
                        wsUrl: snapshot.url || this.browserContext.url
                    });
                    return {
                        elements,
                        url: snapshot.url || this.browserContext.url,
                        app: this.browserContext.app || 'browser',
                        source: 'BROWSER_CORE',
                        targetId: snapshot.targetId || this.browserContext.targetId || ''
                    };
                }
            } catch (error) {
                console.warn('⚠️ [BrowserAgent] browser-core snapshot failed, trying fallback paths:', error.message);
            }
        }

        // Prioridad 1 temporal: Extensión nativa como fallback mientras retiramos este camino
        if (this.extensionWebSocket && this.extensionWebSocket.readyState === 1 /* WebSocket.OPEN */) {
            if (VERBOSE_BROWSER_LOGS) {
                console.log('🌐 [BrowserAgent] Solicitando Extracción vía Extensión de Chrome...');
            }
            try {
                const response = await new Promise((resolve) => {
                    this.extensionPendingResolve = resolve;
                    this.extensionWebSocket.send(JSON.stringify({
                        type: 'GET_AFFORDANCES',
                        preferredUrl: this.browserContext.url || ''
                    }));
                    setTimeout(() => {
                        if (this.extensionPendingResolve) {
                            this.extensionPendingResolve = null;
                            resolve({ type: 'ERROR', error: 'Timeout' });
                        }
                    }, 5000);
                });

                if (response.type === 'AFFORDANCES_RESULT') {
                    const data = response.data;
                    if (VERBOSE_BROWSER_LOGS) {
                        console.log(`🌐 [BrowserAgent] Extracted ${data.elements?.length || 0} affordances from Extension (${data.url})`);
                    }
                    return {
                        elements: data.elements || [],
                        url: data.url || this.browserContext.url,
                        app: 'browser',
                        source: data.source || 'EXTENSION_DOM'
                    };
                } else {
                    // Extensión conectada pero no puede acceder a esta tab (chrome://, edge://, etc.)
                    // No intentamos CDP 9222  — dejamos que ScreenAgent use AX nativo silenciosamente.
                    console.log('🔕 [BrowserAgent] Extensión no puede acceder a esta página, usando AX nativo.');
                    return { elements: [], url: this.browserContext.url, app: this.browserContext.app, source: 'EXTENSION_RESTRICTED' };
                }
            } catch (e) {
                console.warn('⚠️ [BrowserAgent] Error conectando con Extensión:', e.message);
                return { elements: [], url: this.browserContext.url, app: this.browserContext.app, source: 'EXTENSION_ERROR' };
            }
        }

        if (!this.extensionOnboardingShown && this._shouldAutoOpenExtensionOnboarding()) {
            this.extensionOnboardingShown = true;
            console.warn('⚠️ [BrowserAgent] Extensión no conectada. Omitiendo onboarding automático para no abrir ventanas durante la tarea.');
            this.emit('status', {
                phase: 'extension_missing',
                message: 'La extensión de IÜ no está conectada en IU Chrome. Puedes instalarla luego desde el onboarding.'
            });
        }

        // Prioridad 2: CDP Playwright directo (solo si NO hay extensión conectada)
        // Requiere el IU Chrome gestionado en puerto 9222.
        if (!this.browserContext.wsUrl) {
            const tab = await this.findActiveTab();
            if (tab?.webSocketDebuggerUrl) {
                this.browserContext.wsUrl = tab.url || this.browserContext.url;
                this.browserContext.targetId = tab.id || this.browserContext.targetId || '';
            }
        }

        if (!this.browserContext.wsUrl) {
            console.error('❌ [BrowserAgent] CDP wsUrl no disponible en IU Chrome.');
            return { elements: [], url: this.browserContext.url, app: this.browserContext.app, source: 'CDP_UNAVAILABLE' };
        }

        try {
            // Intentar ARIA primero (más semántico)
            let elements = await extractAriaAffordances(this.browserContext.wsUrl);
            let source = 'ARIA';

            // Fallback a DOM si ARIA no tiene datos útiles
            if (elements.length < 3) {
                elements = await extractDomAffordances(this.browserContext.wsUrl);
                source = 'DOM';
            }

            if (VERBOSE_BROWSER_LOGS) {
                console.log(`🌐 [BrowserAgent] Extracted ${elements.length} affordances (${source}) from ${this.browserContext.app}`);
            }
            return {
                elements,
                url: this.browserContext.url,
                app: this.browserContext.app,
                source
            };
        } catch (e) {
            console.error('❌ [BrowserAgent] Affordance extraction failed:', e.message);
            return { elements: [], url: this.browserContext.url, app: this.browserContext.app, source: 'ERROR' };
        }
    }

    // ─── Utilities ────────────────────────────────────────────
    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

module.exports = BrowserAgent;

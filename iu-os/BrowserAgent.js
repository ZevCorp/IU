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
const { EventEmitter } = require('events');

// ─────────────────────────────────────────────────────────────
// CDP WebSocket helper (sin dependencias externas)
// ─────────────────────────────────────────────────────────────

/**
 * Abre una conexión CDP WebSocket en el endpoint indicado y devuelve
 * una función `send(method, params?)` que retorna una Promise con el resultado.
 *
 * El socket se cierra automáticamente tras closeAfterMs o cuando se llame close().
 */
function createCdpSocket(wsUrl) {
    return new Promise((resolve, reject) => {
        const url = new URL(wsUrl);
        const isSecure = url.protocol === 'wss:';
        const port = url.port || (isSecure ? 443 : 80);

        // Usamos el módulo ws si está disponible, si no, raw WebSocket via net
        let ws;
        try {
            const WebSocket = require('ws');
            ws = new WebSocket(wsUrl);
        } catch (_) {
            return reject(new Error('El módulo ws no está instalado. Ejecuta: npm install ws'));
        }

        let msgId = 1;
        const pending = new Map();

        ws.on('open', () => {
            const send = (method, params = {}) => {
                return new Promise((res, rej) => {
                    const id = msgId++;
                    pending.set(id, { resolve: res, reject: rej });
                    ws.send(JSON.stringify({ id, method, params }));
                });
            };
            const close = () => ws.close();
            resolve({ send, close, ws });
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.id && pending.has(msg.id)) {
                    const { resolve: res, reject: rej } = pending.get(msg.id);
                    pending.delete(msg.id);
                    if (msg.error) rej(new Error(msg.error.message));
                    else res(msg.result);
                }
            } catch (_) { }
        });

        ws.on('error', reject);
        ws.on('close', () => {
            for (const [, { reject: rej }] of pending) {
                rej(new Error('CDP socket closed'));
            }
            pending.clear();
        });
    });
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
// Extracción de affordances DOM / ARIA desde Chrome
// ─────────────────────────────────────────────────────────────

/**
 * Extrae un snapshot de la ARIA Accessibility Tree del tab actual.
 * Devuelve un array de nodos con role, name, value, etc.
 */
async function extractAriaAffordances(wsUrl, limit = 300) {
    let cdp;
    try {
        cdp = await createCdpSocket(wsUrl);
        await cdp.send('Accessibility.enable').catch(() => { });
        const res = await cdp.send('Accessibility.getFullAXTree');
        const nodes = Array.isArray(res?.nodes) ? res.nodes : [];

        // Serializar en formato legible para el LLM
        const affordances = nodes
            .filter(n => n.role?.value && n.role.value !== 'none' && n.role.value !== 'generic')
            .slice(0, limit)
            .map((n, i) => ({
                id: i + 1,
                role: n.role?.value || 'unknown',
                name: n.name?.value || '',
                value: n.value?.value || '',
                nodeId: n.nodeId,
                backendDOMNodeId: n.backendDOMNodeId,
            }));

        return affordances;
    } finally {
        cdp?.close();
    }
}

/**
 * Extrae el DOM de forma simplificada (lista de elementos interactivos).
 * Más liviano que ARIA, útil para páginas sin semántica accesible.
 */
async function extractDomAffordances(wsUrl) {
    let cdp;
    try {
        cdp = await createCdpSocket(wsUrl);
        const expression = `(() => {
            const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], canvas';
            const els = Array.from(document.querySelectorAll(selectors)).slice(0, 200);
            return els.map((el, i) => {
                const rect = el.getBoundingClientRect();
                return {
                    id: i + 1,
                    tag: el.tagName.toLowerCase(),
                    type: el.type || el.getAttribute('role') || '',
                    text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
                    href: el.href || '',
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                };
            }).filter(el => el.w > 0 && el.h > 0);
        })()`;

        const { result } = await cdp.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            userGesture: true,
        });

        return Array.isArray(result?.value) ? result.value : [];
    } finally {
        cdp?.close();
    }
}

/**
 * Ejecuta JavaScript en la tab activa via CDP.
 */
async function evalInTab(wsUrl, expression) {
    let cdp;
    try {
        cdp = await createCdpSocket(wsUrl);
        const { result } = await cdp.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            userGesture: true,
            awaitPromise: true,
        });
        return result?.value;
    } finally {
        cdp?.close();
    }
}

// ─────────────────────────────────────────────────────────────
// BrowserAgent — Clase principal
// ─────────────────────────────────────────────────────────────

class BrowserAgent extends EventEmitter {
    constructor(mainWindow) {
        super();
        this.mainWindow = mainWindow;

        // Estado del contexto activo del browser
        this.browserContext = {
            active: false,       // ¿Está activo el modo browser?
            url: '',             // URL activa
            app: '',             // Nombre del sitio/app (ej: 'agario', 'gmail')
            wsUrl: '',           // CDP WebSocket URL del tab activo
        };

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
        this.CDP_PORT = 9222;

        // Gain del cursor para AgarIO (mueve más rápido que la ventana Electron)
        this.AGARIO_CURSOR_GAIN = 3.5;

        console.log('🌐 [BrowserAgent] Initialized');
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
            const targets = await fetchCdpTargets(this.CDP_HOST, this.CDP_PORT);
            return targets.filter(t => t.type === 'page');
        } catch (e) {
            console.log(`⚠️ [BrowserAgent] Chrome CDP no disponible en puerto ${this.CDP_PORT}:`, e.message);
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
        // Sin patrón: devuelve el primer tab de página
        return targets[0] || null;
    }

    // ─── Contexto activo ──────────────────────────────────────

    /**
     * Activa el modo browser con el contexto del tab actual.
     * Llamado cuando el usuario cambia de app nativa a browser.
     */
    setBrowserContext(url) {
        const app = this._detectApp(url);
        this.browserContext = {
            active: true,
            url,
            app,
            wsUrl: '', // Se resolverá vía CDP al primer uso
        };
        console.log(`🌐 [BrowserAgent] Context set → ${app} (${url})`);
    }

    /**
     * Desactiva el modo browser (usuario cambió a app nativa).
     */
    clearBrowserContext() {
        this.browserContext.active = false;
        this.agarIoCursor.active = false;
        console.log('🌐 [BrowserAgent] Context cleared (native app mode)');
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
        this.setBrowserContext(tab.url);

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
     * Abre una URL en Chrome vía AppleScript (macOS).
     * Si Chrome ya está abierto, abre una nueva tab.
     */
    async _openInChrome(url) {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const script = `
                tell application "Google Chrome"
                    activate
                    if (count of windows) = 0 then
                        make new window
                    end if
                    set URL of active tab of front window to "${url}"
                end tell
            `;
            exec(`osascript -e '${script}'`, (err) => {
                if (err) {
                    console.warn('⚠️ [BrowserAgent] AppleScript failed, trying open command:', err.message);
                    exec(`open -a "Google Chrome" "${url}"`, (err2) => {
                        if (err2) console.warn('⚠️ [BrowserAgent] open command also failed:', err2.message);
                        resolve();
                    });
                } else {
                    console.log(`🌐 [BrowserAgent] Opened ${url} in Chrome`);
                    resolve();
                }
            });
        });
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

        // Intentar resolver wsUrl si no lo tenemos
        if (!this.browserContext.wsUrl) {
            const tab = await this.findActiveTab();
            if (tab?.webSocketDebuggerUrl) {
                this.browserContext.wsUrl = tab.webSocketDebuggerUrl;
            }
        }

        if (!this.browserContext.wsUrl) {
            console.error('❌ [BrowserAgent] CDP wsUrl no disponible. Chrome debe estar con --remote-debugging-port=9222');
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

            console.log(`🌐 [BrowserAgent] Extracted ${elements.length} affordances (${source}) from ${this.browserContext.app}`);
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

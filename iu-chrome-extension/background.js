// background.js - Comunicador con IU-OS

const WS_URL = 'ws://127.0.0.1:9223';
const EXT_VERSION = chrome.runtime?.getManifest?.().version || 'dev';
let socket = null;
let reconnectTimer = null;

console.log(`[I&Ü Extension v${EXT_VERSION}] Service worker iniciado`);

function safeSend(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
        socket.send(JSON.stringify(payload));
        return true;
    } catch (_) {
        return false;
    }
}

function isRestrictedUrl(url = '') {
    const normalized = String(url || '').toLowerCase();
    if (!normalized) return true;
    return normalized.startsWith('chrome://') ||
        normalized.startsWith('chrome-extension://') ||
        normalized.startsWith('devtools://') ||
        normalized.startsWith('edge://') ||
        normalized.startsWith('about:');
}

function isWebUrl(url = '') {
    const normalized = String(url || '').toLowerCase();
    return normalized.startsWith('http://') || normalized.startsWith('https://');
}

async function pickBestTab(preferredUrl = '') {
    const preferred = String(preferredUrl || '');
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab && isWebUrl(activeTab.url) && !isRestrictedUrl(activeTab.url)) {
        if (!preferred || activeTab.url === preferred || activeTab.url.includes(preferred)) {
            return activeTab;
        }
    }

    const allTabs = await chrome.tabs.query({});
    if (preferred) {
        const exact = allTabs.find(tab => tab.url === preferred);
        if (exact && isWebUrl(exact.url) && !isRestrictedUrl(exact.url)) return exact;

        const partial = allTabs.find(tab => String(tab.url || '').includes(preferred));
        if (partial && isWebUrl(partial.url) && !isRestrictedUrl(partial.url)) return partial;
    }

    const firstWeb = allTabs.find(tab => isWebUrl(tab.url) && !isRestrictedUrl(tab.url));
    if (firstWeb) return firstWeb;

    return null;
}

function connectToApp() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }
    socket = null;
    console.log('[I&Ü Extension] Intentando conectar a IU-OS en', WS_URL);
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log('[I&Ü Extension] Conectado a IU-OS exitosamente');
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    };

    socket.onmessage = async (event) => {
        try {
            const req = JSON.parse(event.data);
            if (req.type === 'GET_AFFORDANCES') {
                const results = await extractCurrentTabAffordances(req.preferredUrl || '');
                if (results.skip) {
                    // Página restringida — informar al agente para que use AX nativo
                    safeSend({ type: 'ERROR', error: results.error || 'RESTRICTED_URL' });
                } else {
                    safeSend({ type: 'AFFORDANCES_RESULT', data: results });
                }
            }
        } catch (e) {
            console.error('[I&Ü Extension] Error procesando mensaje:', e);
            safeSend({ type: 'ERROR', error: e.message });
        }
    };

    socket.onclose = () => {
        console.log('[I&Ü Extension] Desconectado de IU-OS. Reintentando en 3s...');
        socket = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectToApp();
        }, 3000);
    };

    socket.onerror = (err) => {
        // Ignorar para evitar ruido, el close handler se encargará
        if (socket) socket.close();
    };
}

connectToApp();

// Extrae affordances desde el DOM real de la página sin usar chrome.debugger.
// Esto evita la infobar "is debugging this browser", que alteraba el viewport.
async function extractCurrentTabAffordances(preferredUrl = '') {
    const tab = await pickBestTab(preferredUrl);
    if (!tab) {
        return { elements: [], url: '', app: 'browser', source: 'NO_WEB_TAB', error: 'No active web tab found', skip: true };
    }
    const tabId = tab.id;
    const url = tab.url || '';

    // Páginas restringidas donde ninguna extensión puede inyectar (devolver skip limpio)
    if (isRestrictedUrl(url) || !isWebUrl(url)) {
        return { elements: [], url, app: 'browser', source: 'RESTRICTED', skip: true };
    }

    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const absoluteOX = window.screenX + ((window.outerWidth - window.innerWidth) / 2);
                const absoluteOY = window.screenY + (window.outerHeight - window.innerHeight);
                const roleLike = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem', 'checkbox', 'radio', 'tab', 'switch'];
                const selector = [
                    'a[href]',
                    'button',
                    'input',
                    'select',
                    'textarea',
                    'summary',
                    '[role]',
                    '[contenteditable="true"]',
                    '[tabindex]'
                ].join(',');

                const isVisible = (el, rect) => {
                    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
                    const style = window.getComputedStyle(el);
                    if (!style) return false;
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    if (Number(style.opacity || '1') === 0) return false;
                    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
                    return true;
                };

                const labelFor = (el) => {
                    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
                    const text = el.innerText || el.textContent || '';
                    const value = el.value || el.getAttribute('value') || el.getAttribute('placeholder') || '';
                    return String(aria || value || text || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                };

                const roleFor = (el) => {
                    const explicitRole = (el.getAttribute('role') || '').trim().toLowerCase();
                    if (explicitRole) return explicitRole;
                    const tag = el.tagName.toLowerCase();
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    if (tag === 'a') return 'link';
                    if (tag === 'button') return 'button';
                    if (tag === 'select') return 'combobox';
                    if (tag === 'textarea') return 'textbox';
                    if (tag === 'summary') return 'button';
                    if (tag === 'input') {
                        if (['button', 'submit', 'reset'].includes(type)) return 'button';
                        if (['checkbox'].includes(type)) return 'checkbox';
                        if (['radio'].includes(type)) return 'radio';
                        return 'textbox';
                    }
                    if (el.isContentEditable) return 'textbox';
                    return 'generic';
                };

                const candidates = Array.from(document.querySelectorAll(selector));
                const seen = new Set();
                const elements = [];
                let idCounter = 1;

                for (const el of candidates) {
                    if (!(el instanceof HTMLElement)) continue;

                    const rect = el.getBoundingClientRect();
                    if (!isVisible(el, rect)) continue;

                    const role = roleFor(el);
                    const label = labelFor(el);
                    const tabindex = el.getAttribute('tabindex');
                    const hasSemanticRole = roleLike.includes(role);
                    const isFocusable = tabindex !== null && tabindex !== '-1';
                    const isInteractive = hasSemanticRole || el.onclick || el.isContentEditable || isFocusable;
                    if (!isInteractive) continue;
                    if (!label && !['textbox', 'searchbox', 'combobox', 'checkbox', 'radio'].includes(role)) continue;

                    const key = [
                        role,
                        label,
                        Math.round(rect.left),
                        Math.round(rect.top),
                        Math.round(rect.width),
                        Math.round(rect.height)
                    ].join('|');
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const absX = absoluteOX + rect.left;
                    const absY = absoluteOY + rect.top;
                    elements.push({
                        id: idCounter++,
                        role,
                        label: label || role,
                        type: role,
                        bbox: { x: absX, y: absY, w: rect.width, h: rect.height },
                        center: { x: absX + (rect.width / 2), y: absY + (rect.height / 2) }
                    });
                }

                const uiHeaderHeight = window.outerHeight - window.innerHeight;
                return {
                    elements: elements.slice(0, 250),
                    viewportOffset: {
                        x: window.screenX + ((window.outerWidth - window.innerWidth) / 2),
                        y: window.screenY + uiHeaderHeight
                    }
                };
            }
        });
        return {
            elements: Array.isArray(result?.elements) ? result.elements : [],
            app: 'browser',
            url,
            source: 'EXTENSION_DOM'
        };
    } catch (e) {
        return { elements: [], url, app: 'browser', source: 'ERROR', error: e.message, skip: true };
    }
}

/**
 * ScreenAgent.js
 * SoM (Set-of-Mark) + Visual fallback action loop.
 * 
 * Architecture:
 *   1. Screenshot → YOLO UI detector → JSON elements list
 *   2. LLM receives element list → decides: select_element(#id) OR need_visual_inspection
 *   3. If select_element: deterministic click on bbox center (0 coordinate error)
 *   4. If need_visual_inspection: fallback to vision-based loop (1 iteration with screenshot)
 *   5. Repeat
 */

const { screen, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { execFile } = require('child_process');
const ModelSwitch = require('./ModelSwitch');
const PersistentMemory = require('./PersistentMemory');
const GraphFormalizer = require('./GraphFormalizer');
const WhatsAppContext = require('./WhatsAppContext');
const LearningAgent = require('./LearningAgent');
const { detectBrowserExecutionState } = require('./BrowserExecutionState');
const { reduceBrowserGoalProgress, shouldSkipRedundantBrowserAction } = require('./BrowserStepReducer');
const { extractDirectWebTarget } = require('./BrowserTargetResolver');
const {
    ensureManagedChrome,
    focusManagedChromeInstance,
    openManagedChromeUrl
} = require('./ManagedChrome');
const stickyFace = require('./StickyFaceController'); // Sticky Face Controller for Automation Mode
// const nativeGlass = require('./NativeGlassController'); // Controller for Native Bubble Window - REMOVING FOR ISOLATION
const VERBOSE_SCREEN_AGENT_LOGS = process.env.IU_VERBOSE_AGENT_LOGS === '1';

// Path to Python venv and YOLO detection script
const YOLO_PYTHON = path.join(__dirname, 'yolo_venv', 'bin', 'python3');
const YOLO_SCRIPT = path.join(__dirname, 'yolo_detect.py');

// ============================================================
// SoM Tools — LLM selects element by ID (deterministic) or requests visual fallback
// ============================================================
const SOM_TOOLS = [
    {
        type: "function",
        function: {
            name: "select_element",
            description: "Click on a detected UI element by its ID number. The click will be placed at the exact center of the element's bounding box — no coordinate estimation needed.",
            parameters: {
                type: "object",
                properties: {
                    element_id: { type: "number", description: "The #id number of the detected element to click" }
                },
                required: ["element_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "type_text",
            description: "Type text into the currently focused input field. IMPORTANT: You must click on the input field FIRST in a previous iteration before typing.",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "The text to type" }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "key_press",
            description: "Press a special key (Enter, Tab, Escape, etc). Use after typing to submit, or to navigate.",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", enum: ["enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "home", "end"], description: "The key to press" }
                },
                required: ["key"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "perform_set_of_actions",
            description: "Execute a sequence of actions in order (batch execution). Use this when you are confident about multiple steps (e.g. typing then pressing enter, or clicking multiple known buttons like a calculator). This is MUCH faster than doing one action at a time.",
            parameters: {
                type: "object",
                properties: {
                    actions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                action: { type: "string", enum: ["click", "type", "key"], description: "Type of action to perform" },
                                element_id: { type: "number", description: "If action=click, the ID of the element" },
                                text: { type: "string", description: "If action=type, the text to type" },
                                key: { type: "string", description: "If action=key, the key to press" }
                            },
                            required: ["action"]
                        }
                    },
                    justificacion: { type: "string", description: "Breve justificación de este plan (máx 15 palabras)" }
                },
                required: ["actions", "justificacion"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "switch_app",
            description: "Switch focus to a different application or open it if closed. Use this when the goal requires interacting with multiple apps (e.g. copying from Notes to Calendar).",
            parameters: {
                type: "object",
                properties: {
                    app_name: { type: "string", description: "Name of the app to switch to (e.g. 'Calculator', 'Notes', 'Calendar')" }
                },
                required: ["app_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "goal_reached",
            description: "Call this ONLY after YOU have personally executed ALL required actions in this session and verified the result. Do NOT call this if you merely observe a pre-existing screen state that appears to match the goal — you must have actually performed the actions yourself. For multi-step goals, ALL steps must be completed before calling this.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Brief summary of what was accomplished" }
                },
                required: ["summary"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "request_user_input",
            description: "Use when the task cannot continue safely without user input, either because data is missing OR because the next route/action is ambiguous and you would otherwise be guessing. This pauses execution and asks one short explicit question.",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Short, explicit question asking only the missing info." },
                    missing_fields: { type: "string", description: "Comma-separated list of missing fields (e.g., nombre, documento, telefono)." }
                },
                required: ["question", "missing_fields"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "scroll",
            description: "Scroll the page up or down to reveal hidden content.",
            parameters: {
                type: "object",
                properties: {
                    direction: { type: "string", enum: ["up", "down"], description: "Direction to scroll" },
                    amount: { type: "string", enum: ["small", "medium", "large"], description: "Amount of scroll" }
                },
                required: ["direction"]
            }
        }
    }
];

// Visual fallback tools — used when LLM requests visual inspection (coordinate-based)
const VISUAL_TOOLS = [
    {
        type: "function",
        function: {
            name: "click",
            description: "Click on a UI element. Provide the CENTER of the element using normalized coordinates (0.0 to 1.0), where (0,0) is top-left and (1,1) is bottom-right of the screen.",
            parameters: {
                type: "object",
                properties: {
                    x: { type: "number", description: "Normalized X coordinate (0.0 = left edge, 1.0 = right edge). Must be between 0 and 1." },
                    y: { type: "number", description: "Normalized Y coordinate (0.0 = top edge, 1.0 = bottom edge). Must be between 0 and 1." },
                    label: { type: "string", description: "Short description of what you're clicking" },
                    reasoning: { type: "string", description: "Why this click advances the goal" }
                },
                required: ["x", "y", "label", "reasoning"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "type_text",
            description: "Type text into the currently focused input field.",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "The text to type" },
                    label: { type: "string", description: "Short description of what field you're typing into" },
                    reasoning: { type: "string", description: "Why typing this text advances the goal" }
                },
                required: ["text", "label", "reasoning"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "key_press",
            description: "Press a special key.",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", enum: ["enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "home", "end"], description: "The key to press" },
                    label: { type: "string", description: "Short description" },
                    reasoning: { type: "string", description: "Why this key press advances the goal" }
                },
                required: ["key", "label", "reasoning"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "goal_reached",
            description: "Call this ONLY after YOU have personally executed ALL required actions in this session. Do NOT call if you observe a pre-existing state — you must have performed the actions yourself.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Brief summary of what was accomplished" }
                },
                required: ["summary"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "scroll",
            description: "Scroll the page",
            parameters: {
                type: "object",
                properties: {
                    direction: { type: "string", enum: ["up", "down"] },
                    amount: { type: "string", enum: ["small", "medium", "large"] }
                },
                required: ["direction"]
            }
        }
    }
];

class ScreenAgent {
    constructor(openai, mainWindow, chatPage = null) {
        this.openai = openai; // kept for backward compat, actual calls go through ModelSwitch
        this.mainWindow = mainWindow;
        this.chatPage = chatPage; // ChatGPT Playwright page for web searches
        this.isRunning = false;
        this.abortRequested = false;
        this.deferWindowRestore = false;
        this.windowsHiddenByAutomation = false;
        this.maxIterations = 15;
        this.nutjs = null;
        this.debugDir = path.join(require('os').homedir(), 'u_debug');
        this.screenWidth = 0;
        this.screenHeight = 0;
        // this.currentBubblePos = null; // Track bubble position for "drag & drop" focus strategy - REMOVED

        // Use simple deterministic agent (fast and reliable)
        // For complex future scenarios, see AxExtractionAgent.js.future
        const SimpleAxAgent = require('./SimpleAxAgent');
        this.axAgent = new SimpleAxAgent();
        this.workflowGuidance = null;
        this.workflowAnchorIndex = 0;
        this.currentTypeTask = null;
        this.lastContextSnapshot = { app: '', window: '', recentActions: [] };
        this.browserAgent = null; // Instancia global inyectada desde main.js
        this.currentFocusApp = '';
        this.currentLaunchMode = 'native';
        this.currentTargetUrl = '';
        this.lastBrowserElement = null;
        this.currentExecutionState = null;
        this.lastExecutionStateKey = '';
        this.currentBrowserGoalProgress = null;
        this.lastAttentionSoundAt = 0;
    }

    setBrowserAgent(agent) {
        this.browserAgent = agent;
    }

    _playNotificationSound() {
        const now = Date.now();
        if (now - this.lastAttentionSoundAt < 1500) {
            return;
        }
        this.lastAttentionSoundAt = now;

        if (process.platform === 'darwin') {
            execFile('afplay', ['/System/Library/Sounds/Glass.aiff'], () => { });
            return;
        }

        try {
            process.stdout.write('\u0007');
        } catch (_) {
            // best effort only
        }
    }

    _notifyUserTurn(title, body, duration = 120000) {
        this._playNotificationSound();
        try {
            stickyFace.setFaceColor('#00ff00');
            stickyFace.setExpression('mild_attention');
            stickyFace.showMessage({ title, body }, duration);
        } catch (e) {
            // best effort only
        }
    }

    _appMappings() {
        return {
            'Calculadora': 'Calculator',
            'Calendario': 'Calendar',
            'Contactos': 'Contacts',
            'Notas': 'Notes',
            'Música': 'Music',
            'Fotos': 'Photos',
            'Mapas': 'Maps',
            'Recordatorios': 'Reminders',
            'Mail': 'Mail',
            'Mensajes': 'Messages',
            'FaceTime': 'FaceTime',
            'Safari': 'Safari',
            'Chrome': 'Google Chrome',
            'Google Chrome': 'Google Chrome',
            'Navegador': 'Google Chrome',
            'Browser': 'Google Chrome',
            'Predeterminado': 'Google Chrome',
            'Buscador': 'Finder',
            'Finder': 'Finder',
            'Terminal': 'Terminal',
            'MiniPRM': 'MiniPRM'
        };
    }

    _webAppMappings() {
        return {
            instagram: {
                name: 'Instagram',
                url: 'https://www.instagram.com/',
                domains: ['instagram.com'],
                aliases: ['instagram', 'insta']
            },
            whatsapp: {
                name: 'WhatsApp',
                url: 'https://web.whatsapp.com/',
                domains: ['web.whatsapp.com', 'whatsapp.com'],
                aliases: ['whatsapp', 'whatsapp web']
            },
            gmail: {
                name: 'Gmail',
                url: 'https://mail.google.com/',
                domains: ['mail.google.com', 'gmail.com'],
                aliases: ['gmail', 'google mail']
            },
            facebook: {
                name: 'Facebook',
                url: 'https://www.facebook.com/',
                domains: ['facebook.com'],
                aliases: ['facebook']
            },
            linkedin: {
                name: 'LinkedIn',
                url: 'https://www.linkedin.com/',
                domains: ['linkedin.com'],
                aliases: ['linkedin']
            },
            reddit: {
                name: 'Reddit',
                url: 'https://www.reddit.com/',
                domains: ['reddit.com'],
                aliases: ['reddit']
            },
            github: {
                name: 'GitHub',
                url: 'https://github.com/',
                domains: ['github.com'],
                aliases: ['github']
            },
            notion: {
                name: 'Notion',
                url: 'https://www.notion.so/',
                domains: ['notion.so'],
                aliases: ['notion']
            },
            slack: {
                name: 'Slack',
                url: 'https://app.slack.com/client',
                domains: ['slack.com'],
                aliases: ['slack']
            },
            spreadsheets: {
                name: 'Google Sheets',
                url: 'https://docs.google.com/spreadsheets/',
                domains: ['docs.google.com', 'sheets.google.com'],
                aliases: ['spreadsheets', 'spreadsheet', 'google sheets', 'sheets', 'hoja de calculo', 'hoja de cálculo']
            },
            youtube: {
                name: 'YouTube',
                url: 'https://www.youtube.com/',
                domains: ['youtube.com'],
                aliases: ['youtube']
            },
            x: {
                name: 'X',
                url: 'https://x.com/',
                domains: ['x.com', 'twitter.com'],
                aliases: ['x', 'twitter']
            }
        };
    }

    _sanitizeAppName(rawName) {
        const raw = String(rawName || '').trim();
        if (!raw) return '';

        const mappings = this._appMappings();
        if (mappings[raw]) return mappings[raw];

        // Keep only letters/numbers/spaces and try to map fuzzy input.
        const cleaned = raw
            .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (mappings[cleaned]) return mappings[cleaned];

        const lower = cleaned.toLowerCase();
        for (const [key, mapped] of Object.entries(mappings)) {
            const keyLower = key.toLowerCase();
            if (lower === keyLower || lower.startsWith(keyLower) || lower.includes(keyLower)) {
                return mapped;
            }
        }

        return cleaned || raw;
    }

    _looksLikeBrowserTarget(rawName) {
        const normalized = this._normalizeText(rawName);
        if (!normalized) return false;
        return normalized === 'browser' ||
            normalized.includes('chrome') ||
            normalized.includes('safari') ||
            normalized.includes('navegador') ||
            normalized.includes('web');
    }

    _extractDirectWebTarget(appName, goal = '', stepsHint = '') {
        return extractDirectWebTarget(appName, goal, stepsHint);
    }

    _getWebTargetConfig(appName, goal = '', stepsHint = '') {
        const directTarget = this._extractDirectWebTarget(appName, goal, stepsHint);
        if (directTarget) return directTarget;

        const haystack = this._normalizeText(`${appName} ${goal} ${stepsHint}`);
        if (!haystack) return null;
        const tokens = new Set(haystack.split(/\s+/).filter(Boolean));
        const appNameNorm = this._normalizeText(appName);

        for (const [key, config] of Object.entries(this._webAppMappings())) {
            const aliases = [key, ...(config.aliases || [])].map(alias => this._normalizeText(alias));
            const hasAliasMatch = aliases.some(alias => {
                if (!alias) return false;
                // Prevent single-letter aliases (e.g. "x") from matching random words like "explicit".
                if (alias.length <= 2) {
                    const shortAliasIntent = new RegExp(`\\b(?:abre|abrir|open|go to|ir a|ve a|entra a|navega a)\\s+${alias}\\b`, 'i');
                    return (appNameNorm === alias || appNameNorm.includes(alias)) ||
                        haystack.includes(`${alias}.com`) ||
                        shortAliasIntent.test(haystack);
                }
                return haystack.includes(alias);
            });
            if (!hasAliasMatch) continue;

            const resolved = {
                ...config,
                key
            };

            if (key === 'instagram') {
                const wantsInbox = /(mensaje|mensajes|direct|dm|inbox|bandeja|responder|leer)/i.test(`${appName} ${goal} ${stepsHint}`);
                if (wantsInbox) {
                    resolved.url = 'https://www.instagram.com/direct/inbox/';
                }
            }

            return resolved;
        }

        return null;
    }

    async _isInstalledMacApp(appName) {
        const normalized = this._sanitizeAppName(appName);
        if (!normalized) return false;
        const escaped = normalized.replace(/"/g, '\\"');

        return new Promise((resolve) => {
            execFile('osascript', ['-e', `POSIX path of (path to application "${escaped}")`], (err) => resolve(!err));
        });
    }

    async _resolveLaunchPlan(requestedApp, goal = '', stepsHint = '') {
        const requested = String(requestedApp || '').trim();
        const sanitized = this._sanitizeAppName(requested);
        const webTarget = this._getWebTargetConfig(requested, goal, stepsHint);
        const browserActive = !!this.browserAgent?.browserContext?.active;
        const activeBrowserUrl = this.browserAgent?.browserContext?.url || '';
        const wantsBrowser = this._looksLikeBrowserTarget(requested);

        let installedNativeApp = false;
        if (sanitized && !wantsBrowser) {
            installedNativeApp = await this._isInstalledMacApp(sanitized);
        }

        if (wantsBrowser) {
            return {
                mode: 'browser',
                semanticApp: webTarget?.name || 'Browser',
                focusApp: 'Google Chrome',
                url: webTarget?.url || activeBrowserUrl || ''
            };
        }

        if (installedNativeApp) {
            return {
                mode: 'native',
                semanticApp: sanitized,
                focusApp: sanitized,
                url: ''
            };
        }

        if (webTarget) {
            return {
                mode: 'browser',
                semanticApp: webTarget.name,
                focusApp: 'Google Chrome',
                url: webTarget.url || activeBrowserUrl || '',
                fallbackReason: `No encontré una app instalada llamada "${sanitized || requested}". Continuaré por navegador.`
            };
        }

        if (browserActive) {
            return {
                mode: 'browser',
                semanticApp: sanitized || requested || 'Browser',
                focusApp: 'Google Chrome',
                url: activeBrowserUrl,
                fallbackReason: `No encontré una app instalada llamada "${sanitized || requested}". Usaré el navegador que ya está activo.`
            };
        }

        return {
            mode: 'native',
            semanticApp: sanitized || requested,
            focusApp: sanitized || requested,
            url: ''
        };
    }

    async _openUrlInBrowser(url) {
        if (!url) {
            await ensureManagedChrome('', [], { source: 'ScreenAgent._openUrlInBrowser' });
            await focusManagedChromeInstance().catch(() => this._ensureFocus('Google Chrome'));
            return;
        }

        if (this.browserAgent?.openUrl) {
            this._notify('action-status', {
                phase: 'confirming',
                step: 'Abriendo el navegador...'
            });
            console.log('🌐 [ScreenAgent] Opening browser URL via BrowserAgent:', { url });
            await this.browserAgent.openUrl(url);
            console.log('🌐 [ScreenAgent] BrowserAgent openUrl completed:', { url });
            return;
        }

        await openManagedChromeUrl(url, [], {
            source: 'ScreenAgent._openUrlInBrowser',
            caller: `target=${url}`
        });
        await focusManagedChromeInstance().catch(() => this._ensureFocus('Google Chrome'));
    }

    async _activateLaunchPlan(plan) {
        if (!plan) return;

        this.currentApp = plan.semanticApp || '';
        this.currentFocusApp = plan.focusApp || plan.semanticApp || '';
        this.currentLaunchMode = plan.mode || 'native';
        this.currentTargetUrl = plan.url || '';

        if (plan.fallbackReason) {
            console.log(`🧭 [ScreenAgent] ${plan.fallbackReason}`);
        }

        if (plan.mode === 'browser') {
            const currentBrowserUrl = this.browserAgent?.browserContext?.url || '';
            const shouldReuseExistingBrowser =
                !!this.browserAgent?.browserContext?.active &&
                (!plan.url || this._urlsMatch(plan.url, currentBrowserUrl));

            if (shouldReuseExistingBrowser) {
                console.log(`🧭 [ScreenAgent] Reusing existing IU Chrome context instead of reopening`, {
                    targetUrl: plan.url || '',
                    currentBrowserUrl
                });
                if (this.browserAgent?.focusManagedChrome) {
                    await this.browserAgent.focusManagedChrome();
                } else {
                    await this._ensureFocus('Google Chrome');
                }
                return;
            }

            await this._openUrlInBrowser(plan.url || '');
            if (this.browserAgent && plan.url && !this.browserAgent.browserContext.active) {
                this.browserAgent.setBrowserContext(plan.url);
            }
            return;
        }

        await this._openApp(plan.focusApp || plan.semanticApp || '');
    }

    /**
     * Lazy-load nut-js (native module, load only when needed)
     */
    async _getNutJS() {
        if (!this.nutjs) {
            const { mouse, keyboard, screen: nutScreen, Button, Key, Point } = require('@nut-tree-fork/nut-js');
            mouse.config.autoDelayMs = 100;
            keyboard.config.autoDelayMs = 50;
            this.nutjs = { mouse, keyboard, screen: nutScreen, Button, Key, Point };
        }
        return this.nutjs;
    }

    /**
     * Get app-specific instructions for the LLM.
     * Crucial for messaging apps to force context reading.
     */
    _getAppSpecificInstructions(appName, elements = []) {
        if (!appName) return '';
        const normalized = appName.toLowerCase();
        const directUrl = `${this.currentTargetUrl || ''} ${this.browserAgent?.browserContext?.url || ''}`.toLowerCase();
        const isInstagramDirect = normalized.includes('instagram') && directUrl.includes('/direct/');

        if (normalized.includes('whatsapp') || normalized.includes('telegram') || normalized.includes('slack') || normalized.includes('messages') || normalized.includes('discord') || isInstagramDirect) {
            let contextInstruction = `\n\n⚠️ CONTEXTO DE CHAT (${appName}):\nAntes de actuar, LEE los mensajes visibles para entender la conversación.`;

            // USE WHATSAPP CONTEXT PARSER
            if (normalized.includes('whatsapp')) {
                const context = WhatsAppContext.parse(elements);
                const formattedHistory = WhatsAppContext.formatForPrompt(context);
                contextInstruction += `\n${formattedHistory}`;

                if (context.analysis.suggestion === 'SCROLL_UP') {
                    contextInstruction += `\n\n🛑 ALERTA DE CONTEXTO LIMITADO:
Parece que no hay suficientes mensajes anteriores para entender el contexto completo (o no se ve la fecha de hoy).
ACCIONES RECOMENDADAS:
1. Si el usuario pide "leer contexto" o responder coherentemente, PRIMERO haz scroll hacia arriba (key_press "pageup") para cargar más mensajes.
2. Luego, vuelve a leer.`;
                }
            } else {
                contextInstruction += `\nTu respuesta debe ser coherente con los últimos mensajes visibles.`;
            }

            return contextInstruction;
        }
        return '';
    }

    _shouldUseBrowserAgent(appName = '') {
        if (!this.browserAgent?.browserContext?.active) return false;

        const requestedNorm = this._normalizeText(appName || this.currentApp || '');
        const focusNorm = this._normalizeText(this.currentFocusApp || '');
        const browserAppNorm = this._normalizeText(this.browserAgent.browserContext.app || '');
        const browserUrlNorm = this._normalizeText(this.browserAgent.browserContext.url || '');
        const webTarget = this._getWebTargetConfig(appName || this.currentApp || '', '', '');

        if (this.currentLaunchMode === 'browser') return true;
        if (this._looksLikeBrowserTarget(requestedNorm)) return true;
        if (focusNorm.includes('chrome') || focusNorm === 'browser') return true;
        if (browserAppNorm && requestedNorm && (browserAppNorm.includes(requestedNorm) || requestedNorm.includes(browserAppNorm))) return true;
        if (webTarget && Array.isArray(webTarget.domains) && webTarget.domains.some(domain => browserUrlNorm.includes(this._normalizeText(domain)))) return true;

        return false;
    }

    _isLowSignalBrowserNode(element) {
        const label = this._normalizeText(element?.label || '');
        const type = this._normalizeText(element?.type || '');
        const bbox = element?.bbox || {};

        let y = Number(bbox.y || 0);
        if (y > 1) y = y / (this.screenHeight || 1);

        const toolbarRegion = y >= 0 && y < 0.13;
        const browserChromePatterns = [
            'back',
            'forward',
            'reload',
            'search tabs',
            'view site information',
            'new tab',
            'open tabs',
            'close tab',
            'extensions',
            'install ',
            'address and search bar',
            'toolbar'
        ];

        if (browserChromePatterns.some(pattern => label.includes(pattern))) return true;
        if (toolbarRegion && type === 'toolbar') return true;
        if (toolbarRegion && type === 'input' && (label.includes('.com') || label.includes('http'))) return true;
        if (toolbarRegion && ['group', 'checkbox', 'menu'].includes(type) && (!label || label === type || label.includes('google chrome'))) return true;

        return false;
    }

    _filterBrowserChromeNoise(elements, appName = '', detectedApp = '') {
        if (!Array.isArray(elements) || elements.length === 0) return elements;

        const detectedNorm = this._normalizeText(detectedApp);
        const shouldFilter = this.currentLaunchMode === 'browser' ||
            detectedNorm.includes('chrome') ||
            detectedNorm.includes('browser') ||
            this._shouldUseBrowserAgent(appName);

        if (!shouldFilter) return elements;

        const filtered = elements.filter(element => !this._isLowSignalBrowserNode(element));
        const denoised = filtered.filter(element => {
            const type = this._normalizeText(element?.type || '');
            const label = this._normalizeText(element?.label || '');
            return !(type === 'group' && (!label || label === 'group') && filtered.length > 12);
        });

        if (denoised.length >= 5) {
            const removed = elements.length - denoised.length;
            if (removed > 0) {
                console.log(`🧹 [ScreenAgent] Browser noise filtered: ${elements.length} -> ${denoised.length} nodes`);
            }
            return denoised;
        }

        return elements;
    }


    /**
     * Run AX Accessibility detection (JXA).
     * Returns standard elements list or null on failure.
     */
    /**
     * Public method to extract screen context (AX Tree).
     * Used by main.js for persistent context capture.
     */
    async extract(appName = null) {
        const detection = await this._runAxDetection(appName);
        if (!detection) return { app: null, window: null, tree: [], elements: [] };

        return {
            app: detection.app,
            window: detection.window,
            tree: detection.elements, // Standard format
            elements: detection.elements
        };
    }

    /**
     * Run intelligent AX detection using AxExtractionAgent

     * The agent will use GPT-4.1 to diagnose problems and search the web for solutions
     */
    async _runAxDetection(appName = null, focusAppName = null) {
        // Enrutador inteligente: BrowserAgent vs Native OS
        const semanticApp = appName || this.currentApp || '';
        const nativeFocusApp = focusAppName || this.currentFocusApp || this._sanitizeAppName(semanticApp);

        if (this._shouldUseBrowserAgent(semanticApp)) {
            if (VERBOSE_SCREEN_AGENT_LOGS) {
                console.log(`🌐 [ScreenAgent] Delegando extracción web a BrowserAgent para "${semanticApp}"`);
            }
            try {
                const bResult = await this.browserAgent.extractAffordances();
                if (bResult.elements && bResult.elements.length > 0) {
                    return {
                        elements: bResult.elements,
                        app: bResult.app || 'browser',
                        window: bResult.url || 'web',
                        source: bResult.source || 'BROWSER_CDP',
                        url: bResult.url || ''
                    };
                }
                console.warn('⚠️ [ScreenAgent] BrowserAgent no devolvió affordances útiles. Intentando AX nativo...');
            } catch (e) {
                console.warn('⚠️ [ScreenAgent] BrowserAgent falló en extracción, intentando fallback nativo...', e.message);
            }
        }

        try {
            const result = await this.axAgent.extract(nativeFocusApp);

            if (result.error || !result.snapshot || result.snapshot.length === 0) {
                console.warn('⚠️ [ScreenAgent] AX Agent (Native) returned error:', result.error);
                return null;
            }

            // Normalize elements to match expected format
            let elements = result.snapshot.map(e => ({
                id: e.id,
                type: e.type,
                label: e.label || e.type,
                confidence: 1.0,
                bbox: e.bbox, // already normalized by ax-reader.js
                center: {
                    x: e.bbox.x + e.bbox.w / 2,
                    y: e.bbox.y + e.bbox.h / 2
                }
            }));

            elements = this._filterBrowserChromeNoise(elements, semanticApp, result.app);

            return {
                elements,
                app: result.app,
                window: result.window,
                source: 'AX_ACCESSIBILITY'
            };

        } catch (e) {
            console.error('❌ [ScreenAgent] AX Agent failed:', e.message);
            return null;
        }
    }

    /**
     * Save the extracted graph to history for future training.
     */
    async _saveGraph(app, window, elements) {
        try {
            // In packaged apps, __dirname is inside asar (read-only)
            // Use app.getPath('userData') instead
            const { app: electronApp } = require('electron');
            const historyDir = path.join(electronApp.getPath('userData'), 'history', 'graphs');
            if (!fs.existsSync(historyDir)) {
                fs.mkdirSync(historyDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeAppName = (app || 'unknown').replace(/[^a-z0-9]/gi, '_');
            const filename = path.join(historyDir, `${safeAppName}_${timestamp}.json`);

            const data = {
                timestamp: new Date().toISOString(),
                app,
                window,
                elementCount: elements.length,
                elements
            };

            fs.writeFileSync(filename, JSON.stringify(data, null, 2));
            if (VERBOSE_SCREEN_AGENT_LOGS) {
                console.log(`💾 [ScreenAgent] Graph saved: ${filename}`);
            }

            // TODO: Pipe to Jetson here if needed

        } catch (e) {
            console.error('⚠️ [ScreenAgent] Failed to save graph:', e.message);
        }
    }

    // ... (rest of class) ...

    /**
     * Main action loop override to use hybrid AX/Vision approach.
     */
    async executeAction(goal, app, stepsHint, options = {}) {
        if (this.isRunning) {
            console.log('⚠️ [ScreenAgent] Already running an action');
            return { success: false, error: 'Already executing an action' };
        }

        this.isRunning = true;
        this.abortRequested = false;
        this.deferWindowRestore = false;
        this.currentTypeTask = null;
        this.lastBrowserElement = null;
        this.currentExecutionState = null;
        this.lastExecutionStateKey = '';
        this.currentBrowserGoalProgress = null;
        console.log('🖥️ [ScreenAgent] executeAction entered:', {
            goal: String(goal || '').slice(0, 180),
            app: app || '',
            stepsHint: String(stepsHint || '').slice(0, 180),
            sessionId: options.sessionId || null
        });
        this._notify('action-status', { phase: 'starting', goal, app });
        const launchPlan = await this._resolveLaunchPlan(app, goal, stepsHint);
        console.log('🧭 [ScreenAgent] Launch plan resolved:', launchPlan);
        this.currentApp = launchPlan.semanticApp || this._sanitizeAppName(app);
        this.currentFocusApp = launchPlan.focusApp || this.currentApp;
        this.currentLaunchMode = launchPlan.mode || 'native';
        this.currentTargetUrl = launchPlan.url || '';
        this.workflowGuidance = null;
        this.workflowAnchorIndex = 0;
        console.log(`🖥️ [ScreenAgent] Starting HYBRID action loop: "${goal}" in ${app}`);
        console.log(`🧭 [ScreenAgent] Launch plan → semantic="${this.currentApp}", focus="${this.currentFocusApp}", mode=${this.currentLaunchMode}${this.currentTargetUrl ? `, url=${this.currentTargetUrl}` : ''}`);

        // HIDE ALL OWN WINDOWS & SHOW STICKY FACE
        try {
            if (!this.windowsHiddenByAutomation) {
                this.hiddenWindows = [];
                console.log('🙈 [ScreenAgent] Hiding all windows for automation mode...');
                const allWindows = BrowserWindow.getAllWindows();
                for (const win of allWindows) {
                    if (!win.isDestroyed() && win.isVisible()) {
                        // Don't hide the sticky face window itself!
                        if (stickyFace.window && win.id === stickyFace.window.id) continue;

                        win.hide();
                        this.hiddenWindows.push(win);
                    }
                }
                this.windowsHiddenByAutomation = true;
            }

            stickyFace.start();
        } catch (e) {
            console.error('⚠️ [ScreenAgent] Failed to manage windows:', e);
        }

        try {
            const relevant = LearningAgent.findRelevantWorkflows(goal, 3);
            const appNorm = this._normalizeText(this.currentApp);
            const selectedWorkflow = relevant.find((wf) => {
                const apps = Array.isArray(wf?.apps) ? wf.apps : [];
                if (apps.length === 0) return false;
                return apps.some((a) => {
                    const wfApp = this._normalizeText(a);
                    return wfApp && appNorm && (wfApp.includes(appNorm) || appNorm.includes(wfApp));
                });
            });

            if (selectedWorkflow && Array.isArray(selectedWorkflow.anchors) && selectedWorkflow.anchors.length > 0) {
                this.workflowGuidance = selectedWorkflow;
                console.log(`🧭 [ScreenAgent] Using learned workflow guidance: ${selectedWorkflow.workflowName} (${selectedWorkflow.anchors.length} anchors)`);
                this._notify('action-status', {
                    phase: 'confirming',
                    step: `Perfecto, lo voy a hacer como me enseñaste en ${selectedWorkflow.workflowName}.`
                });
            }

            await this._activateLaunchPlan(launchPlan);
            await this._wait(500); // Reduced from 1500ms — app is already focused via AppleScript

            let iteration = 0;
            let goalReached = false;
            let actionResult = null;
            const actionHistory = [];


            // Store screen dimensions for denormalization
            const primaryDisplay = screen.getPrimaryDisplay();
            this.screenWidth = primaryDisplay.size.width;
            this.screenHeight = primaryDisplay.size.height;

            const somMessages = [
                {
                    role: "system",
                    content: `Eres un agente de automatización.
OBJETIVO: "${goal}"
APP INICIAL: "${app}"
PASOS SUGERIDOS: "${stepsHint}"

MODO HÍBRIDO (AX + Vision):
Recibirás una lista de elementos UI.
- Si la fuente es 'AX_ACCESSIBILITY', 'BROWSER_CDP' o 'BROWSER_CORE', los IDs y coordenadas son EXACTOS (Ground Truth). Confía plenamente en ellos.
- Si el objetivo incluye una URL o dominio explícito, ábrelo directamente. NO pidas permiso para navegar a esa URL.
- Si la fuente es 'VISION' (YOLO), los elementos son aproximados.

ACCIONES DISPONIBLES (ordenadas por preferencia):
1. perform_set_of_actions([...]): EJECUTA UNA SECUENCIA. Úsala SIEMPRE que se requiera más de un clic consecutivo o llenado de formularios.
2. switch_app("NombreApp"): Cambia de aplicación. También puedes usarlo para pasar a navegador si el objetivo es web.
3. request_user_input("pregunta"): Pausar y pedir datos faltantes al usuario.
Usa request_user_input tambien si llegas a un portal o pagina intermedia y la siguiente accion no es inequívoca.
4. goal_reached("Resumen"): Terminar la tarea.

REGLAS DE VELOCIDAD EXTREMA:
- NUNCA uses select_element, type_text o key_press individuales si la acción requiere varios pasos continuos VISIBLES; júntalos en perform_set_of_actions.
- RESTRICCIÓN VISUAL DE BATCH: ¡NUNCA agrupes acciones en un Batch si la siguiente acción requiere que la pantalla cargue o cambie para existir (ej. buscar un contacto y luego hacerle clik a un resultado hipotético)! Haz la búsqueda, termina la iteración y en el PRÓXIMO turno visual (cuando exista) le haces click.
- Mantén la "justificacion" MUY BREVE (máximo 15 palabras) para ahorrar milisegundos de inferencia. No divagues ni expliques de más.

IMPORTANTE SOBRE MULTI-APP:
Si la tarea requiere múltiples apps (ej: "Abrir X y luego Y"), usa 'switch_app' cuando termines con la primera.

REGLA DE NAVEGADOR:
Si el objetivo real vive dentro de una página web (Instagram, Gmail, Notion, etc.), prioriza SIEMPRE el contenido de la página.
Evita controles del navegador como tabs, barra de direcciones, extensiones, "Search tabs", Back, Forward o Reload salvo que el objetivo pida explícitamente usarlos.
Si el estado actual detectado indica un bloqueo real (login, archivo, confirmación del usuario), prioriza ESE bloqueo por encima del plan inicial.
NO pidas datos de etapas futuras si la interfaz actual aún no llegó a esa etapa.
Si llegas a un portal, dashboard o hub y el siguiente clic abriría una plataforma, curso, sección o flujo que el usuario NO especificó claramente, usa request_user_input en vez de adivinar.
Si dudas entre dos o más acciones plausibles, pregunta. NO inventes la siguiente ruta.
Para tareas de subida: no asumas Canvas, curso, tarea, sección, "Crear" o "Subir contenido" salvo que esté explícito por el usuario o sea inequívoco en la UI actual.
Si se requiere autenticación, NUNCA pidas contraseñas o credenciales al usuario por chat. Pídele que complete el login directamente en la página y luego continúa.
Si el usuario acaba de dar una instrucción clara de continuación, NO pidas confirmación redundante sobre esa misma instrucción.

IMPORTANTE SOBRE VELOCIDAD:
¡USA 'perform_set_of_actions' SIEMPRE QUE SEA SEGURO!
Si ves los botones [5], [+], [5]... ¡Oprímelos todos en un solo llamado! No hagas uno por uno.

CRÍTICO — NO LLAMES goal_reached PREMATURAMENTE:
Si en la iteración 1 ves una pantalla que "ya parece completada", NO es suficiente.
Puede ser un estado residual de sesiones anteriores. DEBES ejecutar las acciones tú mismo antes de declarar goal_reached.
Para tareas multi-app: NUNCA llames goal_reached hasta haber completado TODOS los pasos en TODAS las apps.

REGLA DE CONTINUIDAD:
No reinicies ni dupliques subobjetivos ya iniciados o completados dentro del mismo flujo.
Si el objetivo es singular ("crear un X", "enviar un mensaje"), ejecútalo una sola vez salvo instrucción explícita del usuario.
Si faltan datos del usuario para continuar (dictado pendiente), usa request_user_input y NO uses goal_reached.

PRIORIDAD DE CONTEXTO:
Si el estado visual actual (ventana/módulo) es más avanzado que el objetivo inicial, prioriza SIEMPRE el estado visual actual y continúa desde ahí; nunca retrocedas a etapas previas.
Si ya estás en una etapa posterior, NO pidas datos de una etapa anterior.`
                }
            ];

            let historyHint = '';

            // Loop detection: track element state changes
            let lastElementsHash = null;
            let sameStateCount = 0;
            const LOOP_THRESHOLD = 3; // 3 clicks without progress = loop

            while (iteration < this.maxIterations && !goalReached && !this.abortRequested) {
                iteration++;
                console.log(`🔄 [ScreenAgent] Iteration ${iteration}`);
                this._notify('action-status', { phase: 'analyzing', iteration });

                if (actionHistory.length > 0) {
                    historyHint = '\n\nAcciones realizadas hasta ahora:\n' + actionHistory.map(h => `  ${h.iteration}. ${h.summary}`).join('\n');
                }

                // 1. Take screenshot (DISABLED - always needed for context/fallback/debug - but DISABLED per user request)
                const screenshotPath = null; // await this._takeScreenshotToFile();

                // 2. Try AX Detection First (The "Effort Loop" extraction)
                this._notify('action-status', { phase: 'extracting_graph' });

                // Retry AX a few times if it fails
                let detectionResult = null;
                for (let i = 0; i < 3; i++) {
                    detectionResult = await this._runAxDetection(this.currentApp, this.currentFocusApp);
                    if (detectionResult && detectionResult.elements.length > 0) break;
                    console.log(`⏳ [ScreenAgent] AX Retry ${i + 1}/3...`);
                    await this._wait(1500);
                }

                if (detectionResult && detectionResult.elements.length > 0) {
                    console.log(`✅ [ScreenAgent] AX Graph extracted: ${detectionResult.elements.length} nodes`);
                    // Save the successful graph
                    this._saveGraph(detectionResult.app, detectionResult.window, detectionResult.elements);

                    // INTELLIGENT FOCUS: 
                    // After extraction is done, we don't need the target app focused anymore for a moment (LLM thinking).
                    // Refocus the Native Glass Bubble to enable the "Liquid" effect.
                    /* 
                    try {
                        console.log('🔮 [ScreenAgent] Refocusing Native Glass Bubble (Liquid Effect ON)');
                        nativeGlass.show(); // This triggers makeKeyAndOrderFront
                    } catch (e) {
                        console.warn('⚠️ [ScreenAgent] Failed to refocus bubble:', e);
                    }
                    */
                    // REMOVED FOR ISOLATION
                } else {
                    console.error(`🔴 [ScreenAgent] CRITICAL: AX Failed after 3 retries. Fallback DISABLED.`);
                    // FORCE AX: fallback DISABLED per user request
                    detectionResult = { elements: [], source: 'AX_FAILED' };
                }

                const elements = detectionResult?.elements || [];
                this.lastContextSnapshot = {
                    app: detectionResult?.app || this.currentApp || '',
                    window: detectionResult?.window || '',
                    recentActions: actionHistory.slice(-6).map(a => a.summary)
                };

                // 3. Loop detection: check if elements haven't changed
                const currentHash = this._hashElements(elements);
                let loopWarning = '';

                if (currentHash === lastElementsHash) {
                    sameStateCount++;
                    if (VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`⚠️ [ScreenAgent] Same state detected: ${sameStateCount}/${LOOP_THRESHOLD}`);
                    }

                    if (sameStateCount >= LOOP_THRESHOLD) {
                        loopWarning = `\n\n🔴 ADVERTENCIA CRÍTICA: No se detecta progreso en las últimas ${LOOP_THRESHOLD} iteraciones.
Los elementos en pantalla NO HAN CAMBIADO. Estás probablemente en un LOOP INFINITO.

Posibles causas:
- Estás clickeando contenido estático (fechas, números, texto) en vez de botones de acción
- El botón que buscas NO está en la lista de elementos detectados
- Necesitas usar otra estrategia: teclas (ESC para cerrar, Tab para navegar), o buscar "+", "Nuevo", "Crear"

ACCIÓN REQUERIDA: Cambia de estrategia INMEDIATAMENTE. NO sigas clickeando los mismos elementos.`;

                        console.warn(`🔴 [ScreenAgent] LOOP DETECTED! Same state for ${sameStateCount} iterations`);
                    }
                } else {
                    if (sameStateCount > 0 && VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`✅ [ScreenAgent] State changed! Loop counter reset.`);
                    }
                    sameStateCount = 0;
                }
                lastElementsHash = currentHash;

                // ... continue to LLM logic using 'elements' ...

                // 4. Update Persistent Memory & Optimize Tokens
                if (detectionResult.app && detectionResult.window) {
                    try {
                        PersistentMemory.update(detectionResult.app, detectionResult.window, elements);
                    } catch (e) {
                        console.warn('⚠️ [ScreenAgent] Failed to update persistent memory:', e.message);
                    }
                }

                // Optimization: Use GraphFormalizer for Semantic Zoom (LLM-friendly Graph)
                // A/B switch: disable by default while validating raw AX extraction quality.
                const enableFormalizer = process.env.IU_AX_FORMALIZER === '1';
                let llmElements = elements;
                if (elements.length > 0 && enableFormalizer) {
                    if (VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`🧠 [ScreenAgent] Formalizing graph with ${elements.length} raw nodes...`);
                    }
                    llmElements = GraphFormalizer.optimize(elements);
                    if (VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`📉 [ScreenAgent] Graph formalized: ${elements.length} -> ${llmElements.length} meaningful nodes`);
                    }
                } else if (elements.length > 0) {
                    if (VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`🧪 [ScreenAgent] Graph formalizer disabled (IU_AX_FORMALIZER!=1). Using raw AX nodes: ${elements.length}`);
                    }
                }

                const browserExecutionState = this.currentLaunchMode === 'browser'
                    ? detectBrowserExecutionState({
                        goal,
                        stepsHint,
                        url: detectionResult?.url || this.currentTargetUrl || this.browserAgent?.browserContext?.url || '',
                        elements: llmElements,
                        source: detectionResult?.source || ''
                    })
                    : null;

                const browserGoalProgress = this.currentLaunchMode === 'browser'
                    ? reduceBrowserGoalProgress({
                        goal,
                        stepsHint,
                        url: detectionResult?.url || this.currentTargetUrl || this.browserAgent?.browserContext?.url || '',
                        elements: llmElements,
                        source: detectionResult?.source || ''
                    })
                    : null;
                this.currentBrowserGoalProgress = browserGoalProgress;

                if (browserExecutionState) {
                    this._updateExecutionState(browserExecutionState);
                }

                if (browserExecutionState?.requiresUserTurn) {
                    actionResult = browserExecutionState.userMessage;
                    this.deferWindowRestore = true;
                    console.log(`🧭 [ScreenAgent] Browser state handoff → ${browserExecutionState.stage}: ${browserExecutionState.userMessage}`);
                    this._notifyUserTurn('Tu turno', browserExecutionState.userMessage, 120000);
                    iteration = this.maxIterations;
                    break;
                }

                // 5. Format elements list for LLM
                let elementsText = '  (No se detectaron elementos UI relevantes. La pantalla puede estar en blanco, cargando, o el sistema no pudo leerla. Si esperabas ver algo, intenta usar scroll, presionar tecla escape por si hay un modal trabado, o switch_app para asegurarte que estás en la aplicación correcta.)';
                if (llmElements.length > 0) {
                    elementsText = llmElements.map(e => `  #${e.id} [${e.label}] (${e.type}) bbox=[${e.bbox.x.toFixed(2)},${e.bbox.y.toFixed(2)}]`).join('\n');
                }

                // 6. Send element list to LLM (text-only, no image)
                const appInstructions = this._getAppSpecificInstructions(this.currentApp, elements);
                const runtimeContextHint = `\n\nContexto actual detectado:
- App: ${detectionResult?.app || this.currentApp || 'desconocida'}
- Foco del SO: ${this.currentFocusApp || this.currentApp || 'desconocido'}
- Ventana/Módulo: ${detectionResult?.window || 'desconocido'}
- URL objetivo: ${this.currentTargetUrl || this.browserAgent?.browserContext?.url || 'n/a'}
- Estado de ejecución: ${browserExecutionState?.stage || 'desconocido'}
- Bloqueo actual: ${browserExecutionState?.blocker || 'ninguno'}
- Turno actual: ${browserExecutionState?.turn || 'assistant'}
- Etapa actual (acciones recientes): ${(this.lastContextSnapshot.recentActions || []).slice(-4).join(' | ') || 'sin acciones previas'}${browserGoalProgress?.guidanceText || ''}`;

                somMessages.push({
                    role: "user",
                    content: `Iteración ${iteration}/${this.maxIterations}. Objetivo: "${goal}"

Elementos UI detectados en pantalla (${elements.length} total) [Fuente: ${detectionResult.source || 'VISION'}]:
${elementsText}${historyHint}${loopWarning}${appInstructions}${runtimeContextHint}

¿Qué acción ejecutar?`
                });

                console.log(`📤 [ScreenAgent] Sending to LLM: ${elements.length} elements, tool_choice=required`);
                if (VERBOSE_SCREEN_AGENT_LOGS) {
                    console.log(`📋 [ScreenAgent] Tools available: ${SOM_TOOLS.map(t => t.function.name).join(', ')}`);
                }

                const inferStartTime = Date.now();
                const somResponse = await this._retryWithBackoff(() => ModelSwitch.chatCompletion({
                    messages: somMessages,
                    tools: SOM_TOOLS,
                    tool_choice: "required",
                    max_tokens: 4096  // Increased for GPT-5-mini to generate complete tool calls
                }), 3);
                const inferElapsed = Date.now() - inferStartTime;

                if (VERBOSE_SCREEN_AGENT_LOGS) {
                    console.log(`📥 [ScreenAgent] LLM Response [${inferElapsed}ms]:`, JSON.stringify({
                        hasToolCalls: !!somResponse.choices[0]?.message?.tool_calls,
                        toolCallCount: somResponse.choices[0]?.message?.tool_calls?.length || 0,
                        finishReason: somResponse.choices[0]?.finish_reason,
                        messageContent: somResponse.choices[0]?.message?.content?.substring(0, 100)
                    }));
                }

                const somChoice = somResponse.choices[0];
                const toolCalls = somChoice.message.tool_calls;

                if (!toolCalls || toolCalls.length === 0) {
                    console.warn('⚠️ [ScreenAgent] No tool call returned from SoM');
                    break;
                }

                // Explicitly construct the assistant message to ensure tool_calls are preserved
                // and to avoid any reference/mutation issues.
                const assistantMsg = {
                    role: "assistant",
                    content: somChoice.message.content || null,
                    tool_calls: toolCalls.map(tc => ({
                        id: tc.id,
                        type: tc.type,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments // Keep as string for OpenAI format
                        }
                    }))
                };

                // Verify tool calls are present if we think they are
                if (toolCalls.length > 0 && (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)) {
                    console.error('🔴 [ScreenAgent] CRITICAL: Tool calls lost during message construction!');
                }

                somMessages.push(assistantMsg);

                // Iterate over all tool calls (BATCH EXECUTION)
                for (let i = 0; i < toolCalls.length; i++) {
                    if (this.abortRequested) break;
                    const toolCall = toolCalls[i];
                    const fnName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    let shouldWaitForUi = true;

                    console.log(`🎯 [ScreenAgent] SoM decision (${i + 1}/${toolCalls.length}): ${fnName}: ${JSON.stringify(args)}`);

                    // Handle goal_reached
                    if (fnName === 'goal_reached') {
                        goalReached = true;
                        actionResult = args.summary;
                        console.log(`✅ [ScreenAgent] Goal reached: ${args.summary}`);
                        this._notify('action-status', { phase: 'completed', goal, summary: args.summary });

                        // Push result and break inner loop
                        somMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: "OK",
                            _functionName: fnName
                        });
                        break;
                    }

                    // Handle dynamic user info request (pause flow without finishing)
                    if (fnName === 'request_user_input') {
                        const question = String(args.question || '').trim();
                        let missingFields = String(args.missing_fields || '').trim();
                        let msg = question || `Necesito estos datos para continuar: ${missingFields}`;
                        const normalizedRequest = this._normalizeText(`${msg} ${missingFields}`);
                        const normalizedStepsHint = this._normalizeText(String(stepsHint || ''));
                        const hasRecentExplicitContinuation = /ACLARACI[ÓO]N DEL USUARIO:/i.test(String(stepsHint || ''));
                        const looksLikeRouteQuestion =
                            normalizedRequest.includes('which link') ||
                            normalizedRequest.includes('what link') ||
                            normalizedRequest.includes('where') ||
                            normalizedRequest.includes('que enlace') ||
                            normalizedRequest.includes('cual enlace') ||
                            normalizedRequest.includes('donde') ||
                            normalizedRequest.includes('que opcion') ||
                            normalizedRequest.includes('cual opcion');
                        const actionVerbMatches = normalizedStepsHint.match(/\b(click|clic|abrir|open|luego|despues|then|entra|entrar|ir|ve)\b/g) || [];
                        const hasExplicitRouteInPlan =
                            /[>→]/.test(String(stepsHint || '')) ||
                            actionVerbMatches.length >= 3;

                        if (looksLikeRouteQuestion && hasExplicitRouteInPlan) {
                            const autoRoute = 'AUTO_RESUELTO: sigue la ruta explícita en PASOS SUGERIDOS; no se requiere pedir confirmación al usuario.';
                            console.log(`🧭 [ScreenAgent] Auto-resolving route clarification from explicit plan: ${msg}`);
                            somMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: autoRoute,
                                _functionName: fnName
                            });
                            shouldWaitForUi = false;
                            continue;
                        }

                        if (hasRecentExplicitContinuation && (
                            normalizedRequest.includes('confirma') ||
                            normalizedRequest.includes('confirmacion') ||
                            normalizedRequest.includes('responde si') ||
                            normalizedRequest.includes('si no')
                        )) {
                            const autoConfirmation = 'AUTO_CONFIRMADO: el usuario ya dio esta instrucción explícitamente en la continuación.';
                            console.log(`🧭 [ScreenAgent] Auto-confirming redundant request_user_input: ${msg}`);
                            somMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: autoConfirmation,
                                _functionName: fnName
                            });
                            shouldWaitForUi = false;
                            continue;
                        }

                        if (
                            normalizedRequest.includes('contrasena') ||
                            normalizedRequest.includes('password') ||
                            normalizedRequest.includes('credenciales') ||
                            normalizedRequest.includes('correo') ||
                            normalizedRequest.includes('email')
                        ) {
                            msg = 'Necesito que completes el inicio de sesión directamente en la página. Cuando estés dentro, yo continúo.';
                            missingFields = 'inicio_de_sesion';
                        }

                        actionResult = msg;
                        this.deferWindowRestore = true;
                        console.log(`📝 [ScreenAgent] Awaiting user input: ${msg} [missing: ${missingFields}]`);
                        this._notifyUserTurn('Necesito datos', msg, 120000);

                        somMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: `WAITING_USER_INPUT: ${msg}`,
                            _functionName: fnName
                        });
                        iteration = this.maxIterations; // exit outer loop quickly
                        break;
                    }


                    // Handle actions
                    let actionSummary = '';

                    if (fnName === 'select_element') {
                            let targetElement = elements.find(e => e.id == args.element_id);
                            const resolved = this._resolveElementByAnchor(elements, targetElement);
                            if (resolved) targetElement = resolved;
                            if (!targetElement) {
                                console.warn(`⚠️ [ScreenAgent] Element #${args.element_id} not found in detection results`);
                                actionSummary = `SELECT #${args.element_id} — NOT FOUND`;
                                shouldWaitForUi = false;
                            } else {
                                const skipDecision = this._shouldSkipBrowserProgressAction(targetElement);
                                if (skipDecision.skip) {
                                    console.log(`🧭 [ScreenAgent] Skipping redundant click on #${targetElement.id}: ${skipDecision.reason}`);
                                    actionSummary = `SELECT #${targetElement.id} — SKIPPED (${skipDecision.reason})`;
                                    shouldWaitForUi = false;
                                    somMessages.push({
                                        role: "tool",
                                        tool_call_id: toolCall.id,
                                        content: actionSummary,
                                        _functionName: fnName
                                });
                                continue;
                            }
                            let px, py;
                            if (targetElement.center) {
                                px = targetElement.center.x;
                                py = targetElement.center.y;
                            } else if (targetElement.bbox) {
                                px = targetElement.bbox.x * this.screenWidth + (targetElement.bbox.w * this.screenWidth / 2);
                                py = targetElement.bbox.y * this.screenHeight + (targetElement.bbox.h * this.screenHeight / 2);
                            }

                            if (px < 1 && py < 1) {
                                px = Math.round(px * this.screenWidth);
                                py = Math.round(py * this.screenHeight);
                            }

                            const revalidated = await this._revalidateBrowserClickTarget(targetElement);
                            if (revalidated.hash) {
                                lastElementsHash = revalidated.hash;
                            }

                            if (!revalidated.ok || !revalidated.element) {
                                console.warn(`⚠️ [ScreenAgent] Click aborted after fast revalidation: ${revalidated.reason}`);
                                actionSummary = `SELECT #${args.element_id} — STALE UI (${revalidated.reason})`;
                                shouldWaitForUi = false;
                            } else {
                                targetElement = revalidated.element;
                                const skipDecisionAfterRefresh = this._shouldSkipBrowserProgressAction(targetElement);
                                if (skipDecisionAfterRefresh.skip) {
                                    console.log(`🧭 [ScreenAgent] Skipping redundant click after refresh on #${targetElement.id}: ${skipDecisionAfterRefresh.reason}`);
                                    actionSummary = `SELECT #${targetElement.id} — SKIPPED (${skipDecisionAfterRefresh.reason})`;
                                    shouldWaitForUi = false;
                                } else if (this._isBrowserCoreElement(targetElement)) {
                                    await this._clickBrowserElement(targetElement);
                                    actionSummary = `SELECT #${targetElement.id} [${targetElement.label || targetElement.type}]`;
                                } else {
                                    const point = this._elementCenterPixels(targetElement);
                                    if (!point) {
                                        console.warn(`⚠️ [ScreenAgent] Click aborted: target revalidated but has no usable center`);
                                        actionSummary = `SELECT #${args.element_id} — NO CLICK POINT`;
                                        shouldWaitForUi = false;
                                    } else {
                                        px = point.x;
                                        py = point.y;
                                        const label = `${targetElement.label || targetElement.type}`;
                                        console.log(`🎯 [ScreenAgent] Click on #${targetElement.id} [${label}] at pixel (${px}, ${py})`);

                                        await this._executeToolDirect('click', { px, py, label });
                                        actionSummary = `SELECT #${targetElement.id} [${label}]`;
                                    }
                                }
                            }
                        }
                    }
                    else if (fnName === 'type_text') {
                        const typedViaBrowser = await this._typeIntoBrowserElement(this.lastBrowserElement, args.text).catch(() => false);
                        if (!typedViaBrowser) {
                            await this._executeTool('type_text', args);
                        }
                        actionSummary = `TYPE "${args.text}"`;
                    }
                    else if (fnName === 'key_press') {
                        const pressedViaBrowser = await this._pressBrowserKey(args.key).catch(() => false);
                        if (!pressedViaBrowser) {
                            await this._executeTool('key_press', args);
                        }
                        actionSummary = `KEY ${args.key}`;
                    }
                    else if (fnName === 'switch_app') {
                        console.log(`🔄 [ScreenAgent] Switching app to: "${args.app_name}"`);
                        try {
                            const switchPlan = await this._resolveLaunchPlan(args.app_name, goal, stepsHint);
                            await this._activateLaunchPlan(switchPlan);
                            await this._wait(1000); // Reduced from 2000ms — app opens/focuses faster now

                            this.currentApp = switchPlan.semanticApp || this._sanitizeAppName(args.app_name);
                            this.currentFocusApp = switchPlan.focusApp || this.currentApp;
                            this.currentLaunchMode = switchPlan.mode || 'native';
                            this.currentTargetUrl = switchPlan.url || '';
                            this.lastBrowserElement = null;
                            actionSummary = `SWITCH APP to "${args.app_name}"`;

                            lastElementsHash = null;
                            sameStateCount = 0;
                        } catch (e) {
                            console.error(`❌ [ScreenAgent] Failed to switch app: ${e.message}`);
                            actionSummary = `SWITCH APP FAILED: ${e.message}`;
                        }
                    }
                    else if (fnName === 'perform_set_of_actions') {
                        const subActions = Array.isArray(args.actions) ? args.actions : [];
                        console.log(`📦 [ScreenAgent] Batch executing ${subActions.length} actions...`);
                        const batchStartTime = Date.now();
                        let executedActions = 0;
                        let batchStoppedDueToStaleUi = false;
                        const reasoningStr = args.justificacion ? ` (${args.justificacion})` : '';

                        const fastBatch = await this._executeBrowserCoreBatchIfPossible(subActions, elements);
                        if (fastBatch.mode === 'executed') {
                            const actualExecuted = Number(fastBatch.executed || 0);
                            const skipped = Number(fastBatch.skipped || 0);
                            executedActions = Math.min(
                                subActions.length,
                                actualExecuted + skipped
                            );
                            if (actualExecuted > 0) {
                                lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 900, 120);
                            } else {
                                shouldWaitForUi = false;
                            }
                            const batchElapsed = Date.now() - batchStartTime;
                            const skippedStr = skipped > 0 ? `, ${skipped} skipped` : '';
                            actionSummary = `BATCH(BROWSER_CORE): Ran ${actualExecuted}/${subActions.length} actions in ${batchElapsed}ms${skippedStr}${reasoningStr}`;
                            console.log(`⚡ [ScreenAgent] Browser-core batch complete in ${batchElapsed}ms${skippedStr}${reasoningStr}`);
                        }
                        else if (fastBatch.mode === 'partial') {
                            const actualExecuted = Number(fastBatch.executed || 0);
                            const skipped = Number(fastBatch.skipped || 0);
                            executedActions = Math.min(
                                subActions.length,
                                actualExecuted + skipped
                            );
                            if (actualExecuted <= 0) {
                                shouldWaitForUi = false;
                            }
                            const batchElapsed = Date.now() - batchStartTime;
                            const firstError = Array.isArray(fastBatch.errors) && fastBatch.errors[0]
                                ? String(fastBatch.errors[0].error || fastBatch.errors[0].message || '')
                                : String(fastBatch.error || 'unknown_error');
                            actionSummary = `BATCH(BROWSER_CORE): Partial ${actualExecuted}/${subActions.length} actions in ${batchElapsed}ms${reasoningStr}. Error: ${firstError}`;
                            console.warn(`⚠️ [ScreenAgent] Browser-core batch partial after ${batchElapsed}ms: ${firstError}`);
                        }
                        else {
                            if (fastBatch.reason) {
                                console.log(`🧭 [ScreenAgent] Browser-core fast batch unavailable, using fallback: ${fastBatch.reason}`);
                            }

                            // Refocus ONCE before batch when using native/OS actions.
                            if (this.currentLaunchMode !== 'browser') {
                                await this._ensureFocus(this.currentFocusApp || this.currentApp);
                            }

                            for (let j = 0; j < subActions.length; j++) {
                                if (this.abortRequested) break;
                                const sub = subActions[j];
                                const stepStr = `Step ${j + 1}/${subActions.length}`;

                                if (sub.action === 'click') {
                                    let targetElement = elements.find(e => e.id == sub.element_id);
                                    const resolved = this._resolveElementByAnchor(elements, targetElement);
                                    if (resolved) targetElement = resolved;
                                    if (!targetElement) {
                                        console.warn(`⚠️ [ScreenAgent] ${stepStr}: Element #${sub.element_id} not found`);
                                        continue;
                                    }

                                    const skipDecision = this._shouldSkipBrowserProgressAction(targetElement);
                                    if (skipDecision.skip) {
                                        console.log(`🧭 [ScreenAgent] ${stepStr}: skipped redundant click on #${targetElement.id} (${skipDecision.reason})`);
                                        continue;
                                    }

                                    const revalidated = await this._revalidateBrowserClickTarget(targetElement);
                                    if (revalidated.hash) {
                                        lastElementsHash = revalidated.hash;
                                    }
                                    if (!revalidated.ok || !revalidated.element) {
                                        console.warn(`⚠️ [ScreenAgent] ${stepStr}: click aborted after revalidation (${revalidated.reason})`);
                                        batchStoppedDueToStaleUi = true;
                                        break;
                                    }

                                    targetElement = revalidated.element;
                                    const skipDecisionAfterRefresh = this._shouldSkipBrowserProgressAction(targetElement);
                                    if (skipDecisionAfterRefresh.skip) {
                                        console.log(`🧭 [ScreenAgent] ${stepStr}: skipped redundant click after refresh on #${targetElement.id} (${skipDecisionAfterRefresh.reason})`);
                                        continue;
                                    }
                                    if (this._isBrowserCoreElement(targetElement)) {
                                        await this._clickBrowserElement(targetElement);
                                    } else {
                                        const point = this._elementCenterPixels(targetElement);
                                        if (!point) {
                                            console.warn(`⚠️ [ScreenAgent] ${stepStr}: revalidated target has no usable center`);
                                            batchStoppedDueToStaleUi = true;
                                            break;
                                        }
                                        const px = point.x;
                                        const py = point.y;

                                        await this._executeToolDirect('click', { px, py, label: `Sequence #${sub.element_id}` }, true); // true = skipFocus
                                    }
                                    executedActions++;
                                    lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 1000, 150);
                                }
                                else if (sub.action === 'type') {
                                    const typedViaBrowser = await this._typeIntoBrowserElement(this.lastBrowserElement, sub.text).catch(() => false);
                                    if (!typedViaBrowser) {
                                        await this._executeTool('type_text', { text: sub.text }, true);
                                    }
                                    executedActions++;
                                    lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 800, 150);
                                }
                                else if (sub.action === 'key') {
                                    const pressedViaBrowser = await this._pressBrowserKey(sub.key).catch(() => false);
                                    if (!pressedViaBrowser) {
                                        await this._executeTool('key_press', { key: sub.key }, true);
                                    }
                                    executedActions++;
                                    lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 800, 150);
                                }
                            }
                            const batchElapsed = Date.now() - batchStartTime;
                            if (executedActions <= 0) {
                                shouldWaitForUi = false;
                            }
                            actionSummary = batchStoppedDueToStaleUi
                                ? `BATCH: Stopped after ${executedActions}/${subActions.length} actions due to stale UI${reasoningStr}`
                                : `BATCH: Executed ${subActions.length} actions in ${batchElapsed}ms${reasoningStr}`;
                            console.log(`⏱️ [ScreenAgent] Batch complete in ${batchElapsed}ms${reasoningStr}`);
                        }
                    }

                    if (actionSummary) {
                        actionHistory.push({ iteration, summary: actionSummary });
                        this._notify('action-status', { phase: 'acting', action: actionSummary });
                    }

                    somMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: actionSummary || "OK",
                        _functionName: fnName
                    });

                    // Wait between batched actions or sequentially
                    if (this.abortRequested) break;
                    if (!shouldWaitForUi) {
                        continue;
                    }
                    if (i < toolCalls.length - 1) {
                        lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 1000, 150);
                    } else {
                        lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 1500, 150);
                    }
                }

                this._trimSomMessages(somMessages);
                if (screenshotPath) {
                    try { fs.unlinkSync(screenshotPath); } catch (e) { }
                }
            }

            const waitingForUser = !!(this.deferWindowRestore && !goalReached && actionResult);

            if (this.abortRequested) {
                console.log('🛑 [ScreenAgent] Action loop interrupted by user');
                this._notify('action-status', { phase: 'stopped' });
            } else if (waitingForUser) {
                this._notify('action-status', {
                    phase: 'waiting_user',
                    summary: actionResult,
                    execution_state: this.currentExecutionState || null
                });
            } else if (!goalReached) {
                console.warn(`⚠️ [ScreenAgent] Stopped after ${iteration} iterations without reaching goal`);
                this._notify('action-status', { phase: 'incomplete', iterations: iteration });
            }

            return {
                success: goalReached && !this.abortRequested,
                iterations: iteration,
                summary: actionResult,
                aborted: this.abortRequested,
                awaitingUserInput: waitingForUser,
                executionState: this.currentExecutionState || null,
                runtimeContext: this.getRuntimeContextSnapshot(),
                interruption: this.getInterruptionSnapshot(),
                sessionId: options.sessionId || ''
            };


        } catch (e) {
            console.error('❌ [ScreenAgent] Action loop failed:', e);
            this._notify('action-status', { phase: 'error', error: e.message });
            return { success: false, error: e.message };
        } finally {
            this.isRunning = false;
            this.abortRequested = false;
            this.workflowGuidance = null;
            this.workflowAnchorIndex = 0;
            this.currentBrowserGoalProgress = null;

            // RESTORE WINDOWS & HIDE STICKY FACE (unless command-hold override requests hidden state)
            try {
                if (!this.deferWindowRestore) {
                    this._restoreHiddenWindows();
                } else {
                    console.log('🙈 [ScreenAgent] Keeping windows hidden after stop (command-hold override)');
                }
            } catch (e) {
                console.error('⚠️ [ScreenAgent] Failed to restore windows:', e);
            }
        }
    }

    /**
     * Visual fallback: one iteration with actual screenshot + coordinate-based tools.
     * Used when LLM calls need_visual_inspection.
     */
    async _visualFallbackIteration(screenshotPath, goal, app, stepsHint, actionHistory, iteration) {
        console.log(`👁️ [ScreenAgent] Running visual fallback iteration...`);

        // Read screenshot and add grid overlay
        let base64 = "";
        if (screenshotPath) {
            let imgBuffer = fs.readFileSync(screenshotPath);
            imgBuffer = await this._addReferenceGrid(imgBuffer, this.screenWidth, this.screenHeight);
            base64 = imgBuffer.toString('base64');
        }

        let historyHint = '';
        if (actionHistory.length > 0) {
            historyHint = '\n\nAcciones realizadas hasta ahora:\n' + actionHistory.map(h => `  ${h.iteration}. ${h.summary}`).join('\n');
        }

        const visualMessages = [
            {
                role: "system",
                content: `Eres un agente de automatización visual. Controlas el mouse y teclado de una Mac.
OBJETIVO: "${goal}" | APP: "${app}" | PANTALLA: ${this.screenWidth}x${this.screenHeight}px

El detector automático de UI no encontró el elemento que necesitas.
Ahora VES el screenshot real con una cuadrícula de referencia (líneas cada 10%).
Identifica el elemento visualmente y da coordenadas normalizadas (0.0-1.0) precisas.

CONTEXTO DE VENTANAS:
- La app "${app}" puede NO ocupar toda la pantalla.
- SOLO haz click en elementos dentro de la ventana de "${app}".
- Para elementos cerca de bordes (y>0.9 o y<0.1), verifica que pertenecen a "${app}".`
            },
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:image/png;base64,${base64}`, detail: "high" }
                    },
                    {
                        type: "text",
                        text: `Inspección visual. Ejecuta la siguiente acción para: "${goal}"${historyHint}`
                    }
                ]
            }
        ];

        const response = await this._retryWithBackoff(() => ModelSwitch.visionCompletion({
            messages: visualMessages,
            tools: VISUAL_TOOLS,
            tool_choice: "required",
            max_tokens: 500
        }), 3);

        const choice = response.choices[0];
        const toolCall = choice.message.tool_calls?.[0];
        if (!toolCall) return { goalReached: false, summary: null };

        const fnName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        console.log(`👁️ [ScreenAgent] Visual fallback: ${fnName}: ${JSON.stringify(args)}`);

        if (fnName === 'goal_reached') {
            console.log(`✅ [ScreenAgent] Goal reached (visual): ${args.summary}`);
            this._notify('action-status', { phase: 'completed', goal });
            return { goalReached: true, summary: args.summary };
        }

        let summary = '';
        if (fnName === 'click') {
            const px = Math.round(args.x * this.screenWidth);
            const py = Math.round(args.y * this.screenHeight);
            summary = `CLICK "${args.label}" at (${args.x.toFixed(3)}, ${args.y.toFixed(3)}) → pixel (${px}, ${py})`;
            await this._saveDebugScreenshot(base64, { x: px, y: py, label: args.label }, iteration);
        } else if (fnName === 'type_text') {
            summary = `TYPE "${args.text}" en "${args.label}"`;
        } else if (fnName === 'key_press') {
            summary = `KEY ${args.key} — ${args.label}`;
        }

        await this._executeTool(fnName, args);
        return { goalReached: false, summary };
    }

    /**
     * Take a screenshot and save to a temp file (for YOLO processing).
     * Returns the file path, or null on failure.
     */
    async _takeScreenshotToFile() {
        try {
            // Hide U window so it doesn't appear in screenshot
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.hide();
            }
            await this._wait(300);

            const { exec } = require('child_process');
            const tmpPath = path.join(require('electron').app.getPath('temp'), `u_screenshot_${Date.now()}.png`);

            await new Promise((resolve, reject) => {
                exec(`screencapture -x "${tmpPath}"`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Retina displays: downscale to logical resolution
            const primaryDisplay = screen.getPrimaryDisplay();
            const scaleFactor = primaryDisplay.scaleFactor || 1;
            const displaySize = primaryDisplay.size;

            if (scaleFactor > 1) {
                const meta = await sharp(tmpPath).metadata();
                await sharp(tmpPath).resize(displaySize.width, displaySize.height).png().toFile(tmpPath + '.tmp');
                fs.renameSync(tmpPath + '.tmp', tmpPath);
                console.log(`📐 [ScreenAgent] Downscaled ${meta.width}x${meta.height} → ${displaySize.width}x${displaySize.height}`);
            }

            console.log(`📸 [ScreenAgent] Screenshot saved to: ${tmpPath}`);
            return tmpPath;

        } catch (e) {
            console.error('❌ [ScreenAgent] Screenshot failed:', e);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
            }
            return null;
        }
    }

    /**
     * Run YOLO UI detection on a screenshot file.
     * Returns parsed JSON with elements and optional SoM overlay path.
     */
    async _runYoloDetection(screenshotPath) {
        return new Promise((resolve) => {
            if (!fs.existsSync(this.debugDir)) fs.mkdirSync(this.debugDir, { recursive: true });
            const somPath = path.join(this.debugDir, `som_${Date.now()}.png`);

            const args = [YOLO_SCRIPT, screenshotPath, '--confidence', '0.3', '--som', somPath];

            execFile(YOLO_PYTHON, args, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) {
                    console.error('❌ [ScreenAgent] YOLO detection failed:', err.message);
                    if (stderr) console.error('  stderr:', stderr.substring(0, 500));
                    resolve({ elements: [], image_size: { width: this.screenWidth, height: this.screenHeight } });
                    return;
                }
                try {
                    const result = JSON.parse(stdout);
                    // Normalize YOLO result to match AX format (normalized x,y,w,h)
                    const imgW = result.image_size.width;
                    const imgH = result.image_size.height;

                    result.elements = result.elements.map(e => {
                        // Original YOLO bbox is pixel coords {x1, y1, x2, y2}
                        // We need normalized {x, y, w, h}
                        const w = Math.abs(e.bbox.x2 - e.bbox.x1);
                        const h = Math.abs(e.bbox.y2 - e.bbox.y1);
                        const x = e.bbox.x1;
                        const y = e.bbox.y1;

                        return {
                            ...e,
                            bbox: {
                                x: x / imgW,
                                y: y / imgH,
                                w: w / imgW,
                                h: h / imgH,
                                // Keep original pixel coords for debug/direct if needed, but standard is now normalized
                                x1: e.bbox.x1, y1: e.bbox.y1, x2: e.bbox.x2, y2: e.bbox.y2
                            },
                            center: {
                                x: e.center.x,
                                y: e.center.y
                            }
                        };
                    });

                    resolve(result);
                } catch (parseErr) {
                    console.error('❌ [ScreenAgent] YOLO output parse failed:', parseErr.message);
                    resolve({ elements: [], image_size: { width: this.screenWidth, height: this.screenHeight } });
                }
            });
        });
    }



    /**
     * Move mouse cursor naturally with smooth acceleration/deceleration curves (Bezier).
     * Simulates human hand movement.
     */
    async _humanLikeMove(targetX, targetY, speedFactor = 1.0) {
        try {
            if (this.abortRequested) return;
            const { mouse, Point } = await this._getNutJS();
            const start = await mouse.getPosition();
            const startX = start.x;
            const startY = start.y;

            const dist = Math.hypot(targetX - startX, targetY - startY);
            if (dist < 5) {
                await mouse.setPosition(new Point(targetX, targetY));
                return;
            }

            // Duration: 300ms to 800ms depending on distance, scaled by speed
            const duration = Math.min(800, Math.max(300, dist * 0.6)) / speedFactor;
            const steps = Math.floor(duration / 12); // ~12ms per step for 60fps-ish feel

            // Bezier Control Point (Quadratic)
            // Add slight randomness/arc to path to avoid robotic straight lines
            const p0 = { x: startX, y: startY };
            const p2 = { x: targetX, y: targetY };

            // Control point P1 roughly between start and end, but offset
            const midX = (startX + targetX) / 2;
            const midY = (startY + targetY) / 2;
            // Random offset perpendicular-ish? Just random is fine for "human" jitter
            const offsetMagnitude = Math.min(dist / 3, 100);
            const offsetX = (Math.random() - 0.5) * offsetMagnitude;
            const offsetY = (Math.random() - 0.5) * offsetMagnitude;
            const p1 = { x: midX + offsetX, y: midY + offsetY };

            const delayPerStep = duration / steps;

            for (let i = 1; i <= steps; i++) {
                if (this.abortRequested) return;
                const t = i / steps;

                // Easing: EaseInOutQuad (smooth start and end)
                // t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                // Or slightly smoother cubic:
                const easeT = t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

                const invT = 1 - easeT;
                // Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                const bx = (invT * invT * p0.x) + (2 * invT * easeT * p1.x) + (easeT * easeT * p2.x);
                const by = (invT * invT * p0.y) + (2 * invT * easeT * p1.y) + (easeT * easeT * p2.y);

                await mouse.setPosition(new Point(bx, by));

                // Manual sleep for timing loop
                await new Promise(r => setTimeout(r, delayPerStep));
            }

            // Ensure final exact position
            if (!this.abortRequested) {
                await mouse.setPosition(new Point(targetX, targetY));
            }

        } catch (e) {
            console.warn('⚠️ [ScreenAgent] Human move failed:', e.message);
        }
    }

    /**
     * "Grab & Move" Strategy: physically drag the liquid bubble to a position near the target.
     * This forces the bubble to be focused (because we clicked it) and moves it to a relevant visual location.
     * REMOVED FOR ISOLATION
     */
    // async _dragBubbleTo(targetX, targetY) {
    //     // ... implementation removed ...
    // }

    /**
     * Execute a click at exact pixel coordinates (used by SoM select_element).
     * No normalization needed — coordinates come directly from YOLO bounding boxes.
     */
    async _executeToolDirect(fnName, args, skipFocus = false) {
        try {
            if (this.abortRequested) return;
            if (!skipFocus) await this._ensureFocus(this.currentFocusApp || this.currentApp);
            if (this.abortRequested) return;

            const { mouse, Button, Point } = await this._getNutJS();

            if (fnName === 'click') {
                // --- LIQUID BUBBLE LOGIC REMOVED ---
                /*
                // Before clicking, drag the bubble near the target
                // Calculate "safe" spot: 150px to the right of target, clamped to screen
                let bubbleX = args.px + 120;
                let bubbleY = args.py + 50;
    
                // Clamp to screen
                if (bubbleX > this.screenWidth - 50) bubbleX = args.px - 120; // Move to left if too far right
                if (bubbleY > this.screenHeight - 50) bubbleY = this.screenHeight - 50;
    
                await this._dragBubbleTo(bubbleX, bubbleY);
                await this._wait(100);
                */
                // --- LIQUID BUBBLE LOGIC END ---

                console.log(`🖱️ [ScreenAgent] Deterministic click "${args.label}" at pixel (${args.px}, ${args.py})`);
                // speedFactor 3.0 → duration = min(800,max(300,dist*0.6))/3.0 ≈ 100–267ms vs old 272–727ms
                await this._humanLikeMove(args.px, args.py, 3.0);
                if (this.abortRequested) return;
                await this._wait(30);
                if (this.abortRequested) return;
                await mouse.click(Button.LEFT);
            }
        } catch (e) {
            console.error('❌ [ScreenAgent] Execute direct tool failed:', e.message);
        }
    }

    /**
     * Trim SoM conversation to keep it manageable (keep last N user messages).
     * Ensures we don't break the conversation flow (User -> Assistant -> Tool).
     */
    _trimSomMessages(messages) {
        const maxUserMessages = 6; // keep last 6 iterations

        let userIndices = [];
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') {
                userIndices.push(i);
            }
        }

        const tokensToRemove = userIndices.length - maxUserMessages;

        if (tokensToRemove > 0) {
            // We need to keep the user message at index `userIndices[tokensToRemove]`
            // and remove everything before it (except System at 0).
            const cutOffIndex = userIndices[tokensToRemove];

            // Validate cutoff (must be > 1 to preserve system)
            if (cutOffIndex > 1) {
                // Remove from index 1 up to (but not including) cutOffIndex
                // deleteCount = cutOffIndex - 1
                messages.splice(1, cutOffIndex - 1);
                console.log(`✂️ [ScreenAgent] Trimmed history. New first user message was at index ${cutOffIndex}.`);
            }
        }
    }

    /**
     * Trim conversation to keep only the last N screenshot messages (save tokens).
     */
    _trimMessages(messages) {
        const maxScreenshots = 3;
        let screenshotCount = 0;
        // Count from end, mark old screenshots for removal
        for (let i = messages.length - 1; i >= 1; i--) { // skip system at 0
            const msg = messages[i];
            if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(c => c.type === 'image_url')) {
                screenshotCount++;
                if (screenshotCount > maxScreenshots) {
                    // Replace image with text summary to save tokens
                    const textPart = msg.content.find(c => c.type === 'text');
                    messages[i] = { role: "user", content: textPart?.text || '[screenshot removed]' };
                }
            }
        }
    }

    /**
     * Open an application by name (macOS)
     */
    async _openApp(appName) {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const normalizedApp = this._sanitizeAppName(appName);

            // Strategy: Open first heavily, then activate specifically
            // 1. 'open -a' (Launches or brings forward usually)
            const cmdOpen = `open -a "${normalizedApp}"`;

            // 2. 'osascript activate' (Forces focus if already running)
            const cmdActivate = `osascript -e 'tell application "${normalizedApp}" to activate'`;

            console.log(`📱 [ScreenAgent] Opening & Forcing Focus: "${normalizedApp}"`);

            exec(cmdOpen, (err) => {
                if (err) {
                    console.warn(`⚠️ [ScreenAgent] 'open' command failed for "${normalizedApp}":`, err.message);
                }

                // Wait briefly then force activate via AppleScript
                // 100ms is enough — open -a already brings it forward if not running;
                // activate is only needed to guarantee focus for already-running apps.
                setTimeout(() => {
                    exec(cmdActivate, (err2) => {
                        if (err2) {
                            console.warn(`⚠️ [ScreenAgent] 'activate' script failed for "${normalizedApp}":`, err2.message);
                        } else {
                            console.log(`👆 [ScreenAgent] Activated "${normalizedApp}" via AppleScript`);
                        }

                        // Reduced from 1000ms: AX native addon retries if window not ready yet
                        setTimeout(resolve, 400);
                    });
                }, 100);
            });
        });
    }

    /**
     * Fast focus switching (lighter than _openApp).
     * Uses AppleScript to activate the app without 'open -a' overhead.
     */
    async _ensureFocus(appName) {
        if (!appName) return;
        return new Promise((resolve) => {
            // console.log(`📱 [ScreenAgent] Ensuring focus (Fast): "${appName}"`);
            const { exec } = require('child_process');
            const normalized = this._sanitizeAppName(appName);

            exec(`osascript -e 'tell application "${normalized}" to activate'`, (err) => {
                if (err) console.warn(`⚠️ Focus failed for ${normalized}: ${err.message}`);
                // Small delay to allow window manager to catch up
                setTimeout(resolve, 200);
            });
        });
    }

    /**
     * Take a screenshot of the entire screen, hiding U's window first.
     * Returns base64-encoded PNG.
     */
    async _takeScreenshot() {
        try {
            // Hide U window so it doesn't appear in screenshot
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.hide();
            }

            // Small delay to let the window hide
            await this._wait(300);

            // Use Electron's desktopCapturer via native screenshot
            const { exec } = require('child_process');
            const tmpPath = path.join(require('electron').app.getPath('temp'), `u_screenshot_${Date.now()}.png`);

            await new Promise((resolve, reject) => {
                exec(`screencapture -x "${tmpPath}"`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            const rawBuffer = fs.readFileSync(tmpPath);
            fs.unlinkSync(tmpPath);

            // Retina displays: screencapture produces 2x images.
            // Downscale to logical resolution for cleaner image and smaller payload.
            const primaryDisplay = screen.getPrimaryDisplay();
            const scaleFactor = primaryDisplay.scaleFactor || 1;
            const displaySize = primaryDisplay.size; // logical size
            let imgBuffer = rawBuffer;
            if (scaleFactor > 1) {
                const meta = await sharp(rawBuffer).metadata();
                imgBuffer = await sharp(rawBuffer).resize(displaySize.width, displaySize.height).png().toBuffer();
                console.log(`📐 [ScreenAgent] Downscaled ${meta.width}x${meta.height} → ${displaySize.width}x${displaySize.height} (display logical size)`);
            }

            // Add subtle reference grid for better coordinate estimation
            imgBuffer = await this._addReferenceGrid(imgBuffer, displaySize.width, displaySize.height);

            const base64 = imgBuffer.toString('base64');
            console.log(`📸 [ScreenAgent] Screenshot taken (${Math.round(imgBuffer.length / 1024)}KB, with reference grid)`);
            return base64;

        } catch (e) {
            console.error('❌ [ScreenAgent] Screenshot failed:', e);
            // Show window again on failure
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
            }
            return null;
        }
    }

    /**
     * Add a subtle reference grid overlay to help the model estimate coordinates.
     * Draws thin semi-transparent lines at 10% intervals with labels on edges.
     */
    async _addReferenceGrid(imgBuffer, width, height) {
        try {
            const lines = [];
            const labels = [];
            const step = 0.1; // 10% intervals

            // Vertical lines (x-axis)
            for (let i = 1; i <= 9; i++) {
                const x = Math.round(i * step * width);
                lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="rgba(255,0,0,0.25)" stroke-width="1" stroke-dasharray="4,8"/>`);
                // Label at top
                labels.push(`<rect x="${x - 10}" y="0" width="24" height="13" fill="rgba(0,0,0,0.5)" rx="2"/>`);
                labels.push(`<text x="${x}" y="10" font-family="Helvetica" font-size="9" fill="#ff6666" text-anchor="middle">.${i}</text>`);
            }

            // Horizontal lines (y-axis)
            for (let i = 1; i <= 9; i++) {
                const y = Math.round(i * step * height);
                lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(255,0,0,0.25)" stroke-width="1" stroke-dasharray="4,8"/>`);
                // Label at left
                labels.push(`<rect x="0" y="${y - 7}" width="20" height="13" fill="rgba(0,0,0,0.5)" rx="2"/>`);
                labels.push(`<text x="10" y="${y + 4}" font-family="Helvetica" font-size="9" fill="#ff6666" text-anchor="middle">.${i}</text>`);
            }

            const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                ${lines.join('\n')}
                ${labels.join('\n')}
            </svg>`);

            const result = await sharp(imgBuffer)
                .composite([{ input: svg, top: 0, left: 0 }])
                .png()
                .toBuffer();

            return result;
        } catch (e) {
            console.warn('⚠️ [ScreenAgent] Grid overlay failed, using clean image:', e.message);
            return imgBuffer;
        }
    }

    /**
     * Execute a tool call from the unified model.
     * Click coordinates are normalized (0-1) and denormalized to pixel coords here.
     */
    async _executeTool(fnName, args, skipFocus = false) {
        try {
            if (this.abortRequested) return;
            if (!skipFocus) await this._ensureFocus(this.currentFocusApp || this.currentApp);
            if (this.abortRequested) return;

            const { mouse, keyboard, Button, Key, Point } = await this._getNutJS();

            if (fnName === 'click') {
                // Denormalize from 0-1 to pixel coordinates
                const px = Math.round(args.x * this.screenWidth);
                const py = Math.round(args.y * this.screenHeight);

                // --- LIQUID BUBBLE LOGIC REMOVED ---
                /*
                // Before clicking, drag the bubble near the target
                // Calculate "safe" spot: 150px to the right of target, clamped to screen
                let bubbleX = px + 120;
                let bubbleY = py + 50;
    
                // Clamp to screen
                if (bubbleX > this.screenWidth - 50) bubbleX = px - 120; // Move to left if too far right
                if (bubbleY > this.screenHeight - 50) bubbleY = this.screenHeight - 50;
    
                await this._dragBubbleTo(bubbleX, bubbleY);
                await this._wait(100);
                */
                // --- LIQUID BUBBLE LOGIC END ---

                console.log(`🖱️ [ScreenAgent] Clicking "${args.label}" at normalized (${args.x.toFixed(3)}, ${args.y.toFixed(3)}) → pixel (${px}, ${py})`);
                await this._humanLikeMove(px, py, 3.0);
                if (this.abortRequested) return;
                await this._wait(30);
                if (this.abortRequested) return;
                await mouse.click(Button.LEFT);

            } else if (fnName === 'type_text') {
                if (this.abortRequested) return;
                console.log(`⌨️ [ScreenAgent] Typing "${args.text.substring(0, 40)}${args.text.length > 40 ? '...' : ''}" into "${args.label}"`);
                await this._typeTextInterruptible(keyboard, args.text, args.label);

            } else if (fnName === 'key_press') {
                if (this.abortRequested) return;
                const keyMap = {
                    enter: Key.Enter, tab: Key.Tab, escape: Key.Escape,
                    backspace: Key.Backspace, delete: Key.Delete,
                    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
                    pageup: Key.PageUp, pagedown: Key.PageDown, home: Key.Home, end: Key.End
                };
                const key = keyMap[args.key];
                if (key) {
                    console.log(`⌨️ [ScreenAgent] Pressing key: ${args.key} — ${args.label}`);
                    await keyboard.pressKey(key);
                    await keyboard.releaseKey(key);
                } else {
                    console.warn(`⚠️ [ScreenAgent] Unknown key: ${args.key}`);
                }

            } else if (fnName === 'scroll') {
                if (this.abortRequested) return;
                const amountMap = { small: 100, medium: 500, large: 1500 };
                const pixels = amountMap[args.amount || 'medium'];
                const direction = args.direction === 'up' ? mouse.scrollUp(pixels) : mouse.scrollDown(pixels);

                console.log(`📜 [ScreenAgent] Scrolling ${args.direction} (${pixels}px)`);
                await direction;
            }

        } catch (e) {
            console.error('❌ [ScreenAgent] Execute tool failed:', e.message);
        }
    }

    async _typeTextInterruptible(keyboard, text, label = '') {
        const fullText = String(text || '');
        this.currentTypeTask = { text: fullText, typedChars: 0, label: label || '' };
        try {
            for (let i = 0; i < fullText.length; i++) {
                if (this.abortRequested) break;
                await keyboard.type(fullText[i]);
                this.currentTypeTask.typedChars = i + 1;
            }
        } finally {
            if (!this.abortRequested) {
                this.currentTypeTask = null;
            }
        }
    }

    getInterruptionSnapshot() {
        const snapshot = {
            pendingTypeText: '',
            pendingTypeLabel: ''
        };

        if (!this.currentTypeTask) return snapshot;
        const text = String(this.currentTypeTask.text || '');
        const typed = Number(this.currentTypeTask.typedChars || 0);
        if (typed < text.length) {
            snapshot.pendingTypeText = text.slice(typed);
            snapshot.pendingTypeLabel = String(this.currentTypeTask.label || '');
        }
        return snapshot;
    }

    getRuntimeContextSnapshot() {
        return {
            app: this.lastContextSnapshot?.app || this.currentApp || '',
            window: this.lastContextSnapshot?.window || '',
            recentActions: Array.isArray(this.lastContextSnapshot?.recentActions)
                ? this.lastContextSnapshot.recentActions.slice(-6)
                : []
        };
    }

    /**
     * Save a debug screenshot with a crosshair at the click point for calibration verification.
     */
    async _saveDebugScreenshot(screenshotBase64, action, iteration) {
        try {
            if (!fs.existsSync(this.debugDir)) fs.mkdirSync(this.debugDir, { recursive: true });

            const imgBuffer = Buffer.from(screenshotBase64, 'base64');
            const meta = await sharp(imgBuffer).metadata();
            const cx = action.x;
            const cy = action.y;

            // Draw crosshair + circle at click point
            const crosshair = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">
                <circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="#00ff00" stroke-width="3"/>
                <circle cx="${cx}" cy="${cy}" r="4" fill="#00ff00"/>
                <line x1="${cx - 30}" y1="${cy}" x2="${cx + 30}" y2="${cy}" stroke="#00ff00" stroke-width="2"/>
                <line x1="${cx}" y1="${cy - 30}" x2="${cx}" y2="${cy + 30}" stroke="#00ff00" stroke-width="2"/>
                <rect x="${cx + 25}" y="${cy - 20}" width="${String(action.label).length * 7 + 12}" height="18" fill="rgba(0,0,0,0.8)" rx="3"/>
                <text x="${cx + 31}" y="${cy - 6}" font-family="Helvetica" font-size="12" fill="#00ff00">${action.label}</text>
            </svg>`);

            const debugImg = await sharp(imgBuffer)
                .composite([{ input: crosshair, top: 0, left: 0 }])
                .png()
                .toBuffer();

            const debugPath = path.join(this.debugDir, `iter_${iteration}_${action.action}_${cx}_${cy}.png`);
            fs.writeFileSync(debugPath, debugImg);
            console.log(`🔎 [ScreenAgent] Debug screenshot saved: ${debugPath}`);
        } catch (e) {
            console.warn('⚠️ [ScreenAgent] Debug screenshot failed:', e.message);
        }
    }

    /**
     * Send event to renderer process.
     */
    _notify(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (channel === 'action-status' && data && !data.status && data.phase) {
                this.mainWindow.webContents.send(channel, {
                    ...data,
                    status: data.phase
                });
                return;
            }
            this.mainWindow.webContents.send(channel, data);
        }
    }

    /**
     * Retry an async function with exponential backoff.
     */
    async _retryWithBackoff(fn, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (e) {
                const isRetryable = e.status === 429 || e.status === 500 || e.status === 503 || e.code === 'ECONNRESET';
                if (attempt === maxRetries || !isRetryable) throw e;
                const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
                console.warn(`⏳ [ScreenAgent] Retry ${attempt}/${maxRetries} after ${delay}ms (${e.status || e.code})`);
                await this._wait(delay);
            }
        }
    }

    /**
     * Espera dinámicamente a que la UI cambie mediante polling rápido.
     */
    async _waitForUIChange(appName, oldHash = null, timeoutMs = 2500, pollIntervalMs = 150) {
        await this._wait(100); // Pausa mínima base para registrar el click/tecla
        let elapsed = 100;

        if (!oldHash) {
            const initialDet = await this._runAxDetection(appName);
            if (initialDet && initialDet.elements) {
                oldHash = this._hashElements(initialDet.elements);
            }
        }

        while (elapsed < timeoutMs) {
            const detection = await this._runAxDetection(appName);
            if (detection && detection.elements && detection.elements.length > 0) {
                const currentHash = this._hashElements(detection.elements);
                if (currentHash !== oldHash) {
                    if (VERBOSE_SCREEN_AGENT_LOGS) {
                        console.log(`⏱️ [ScreenAgent] Dynamic Wait: UI cambió en ${elapsed}ms`);
                    }
                    await this._wait(150); // Pausa extra para que se asienten animaciones post-cambio
                    return currentHash;
                }
            }
            await this._wait(pollIntervalMs);
            elapsed += pollIntervalMs;
        }

        if (VERBOSE_SCREEN_AGENT_LOGS) {
            console.log(`⏱️ [ScreenAgent] Dynamic Wait: Timeout (${timeoutMs}ms), UI no cambió o fue imperceptible.`);
        }
        return oldHash;
    }

    /**
     * Simple async wait.
     */
    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

    _isBrowserCoreElement(element) {
        return !!(element && element.browserRef && this.browserAgent?.act);
    }

    _canTypeIntoBrowserElement(element) {
        const role = this._normalizeText(element?.role || element?.type || '');
        return ['textbox', 'searchbox', 'combobox'].includes(role);
    }

    _toBrowserKey(key) {
        const normalized = this._normalizeText(key);
        const keyMap = {
            enter: 'Enter',
            tab: 'Tab',
            escape: 'Escape',
            backspace: 'Backspace',
            delete: 'Delete',
            up: 'ArrowUp',
            down: 'ArrowDown',
            left: 'ArrowLeft',
            right: 'ArrowRight',
            pageup: 'PageUp',
            pagedown: 'PageDown',
            home: 'Home',
            end: 'End'
        };
        return keyMap[normalized] || key;
    }

    async _executeBrowserCoreAction(request, profile = 'managed') {
        if (!this.browserAgent?.act) return null;
        const result = await this.browserAgent.act(request, profile);
        if (result?.url) {
            this.browserAgent.setBrowserContext(result.url, {
                targetId: result.targetId || request.targetId || '',
                wsUrl: result.url
            });
        }
        return result;
    }

    async _clickBrowserElement(element) {
        if (!this._isBrowserCoreElement(element)) return false;

        // Move OS mouse to the element's screen coordinates for visual UX feedback.
        // Fire-and-forget — does NOT block the actual browser click.
        const center = this._elementCenterPixels(element);
        if (center && Number.isFinite(center.x) && Number.isFinite(center.y) && center.x > 0 && center.y > 0) {
            this._humanLikeMove(center.x, center.y, 5.0).catch(() => {});
        }

        await this._executeBrowserCoreAction({
            kind: 'click',
            targetId: element.browserTargetId || this.browserAgent?.browserContext?.targetId || undefined,
            ref: element.browserRef
        }, element.browserProfile || 'managed');
        this.lastBrowserElement = element;
        return true;
    }

    async _typeIntoBrowserElement(element, text) {
        if (!this._isBrowserCoreElement(element) || !this._canTypeIntoBrowserElement(element)) return false;
        await this._executeBrowserCoreAction({
            kind: 'type',
            targetId: element.browserTargetId || this.browserAgent?.browserContext?.targetId || undefined,
            ref: element.browserRef,
            text: String(text || '')
        }, element.browserProfile || 'managed');
        this.lastBrowserElement = element;
        return true;
    }

    async _pressBrowserKey(key) {
        if (!this.browserAgent?.act) return false;
        await this._executeBrowserCoreAction({
            kind: 'press',
            targetId: this.browserAgent?.browserContext?.targetId || undefined,
            key: this._toBrowserKey(key)
        });
        return true;
    }

    _buildBrowserCoreBatchPlan(subActions, elements) {
        if (!Array.isArray(subActions) || subActions.length === 0) {
            return { ok: false, reason: 'empty_actions' };
        }

        const planned = [];
        let skipped = 0;
        let lastInteractionElement = this._isBrowserCoreElement(this.lastBrowserElement) ? this.lastBrowserElement : null;

        for (let index = 0; index < subActions.length; index++) {
            const sub = subActions[index] || {};
            const step = String(sub.action || '').trim().toLowerCase();

            if (step === 'click') {
                let targetElement = elements.find(e => e.id == sub.element_id);
                const resolved = this._resolveElementByAnchor(elements, targetElement);
                if (resolved) targetElement = resolved;
                if (!targetElement) {
                    return { ok: false, reason: `missing_element:${sub.element_id}` };
                }

                const skipDecision = this._shouldSkipBrowserProgressAction(targetElement);
                if (skipDecision.skip) {
                    skipped++;
                    continue;
                }

                if (!this._isBrowserCoreElement(targetElement)) {
                    return { ok: false, reason: `non_browser_element:${sub.element_id}` };
                }

                planned.push({
                    kind: 'click',
                    ref: targetElement.browserRef
                });
                lastInteractionElement = targetElement;
                continue;
            }

            if (step === 'type') {
                const typeTarget = this._canTypeIntoBrowserElement(lastInteractionElement)
                    ? lastInteractionElement
                    : (this._canTypeIntoBrowserElement(this.lastBrowserElement) ? this.lastBrowserElement : null);

                if (!typeTarget || !this._isBrowserCoreElement(typeTarget)) {
                    return { ok: false, reason: 'missing_type_target' };
                }

                planned.push({
                    kind: 'type',
                    ref: typeTarget.browserRef,
                    text: String(sub.text || '')
                });
                lastInteractionElement = typeTarget;
                continue;
            }

            if (step === 'key') {
                planned.push({
                    kind: 'press',
                    key: this._toBrowserKey(sub.key)
                });
                continue;
            }

            return { ok: false, reason: `unsupported_action:${step || 'unknown'}` };
        }

        return {
            ok: true,
            actions: planned,
            skipped,
            lastElement: this._isBrowserCoreElement(lastInteractionElement) ? lastInteractionElement : null
        };
    }

    async _executeBrowserCoreBatchIfPossible(subActions, elements) {
        if (!this._shouldUseBrowserAgent(this.currentApp) || !this.browserAgent?.act) {
            return { mode: 'fallback', reason: 'browser_mode_not_active' };
        }

        const plan = this._buildBrowserCoreBatchPlan(subActions, Array.isArray(elements) ? elements : []);
        if (!plan.ok) {
            return { mode: 'fallback', reason: plan.reason || 'batch_plan_unavailable' };
        }

        if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
            return {
                mode: 'executed',
                executed: 0,
                skipped: Number(plan.skipped || 0),
                total: Array.isArray(subActions) ? subActions.length : 0
            };
        }

        const targetId = this.browserAgent?.browserContext?.targetId || undefined;
        try {
            const result = await this._executeBrowserCoreAction({
                kind: 'batch',
                targetId,
                actions: plan.actions,
                stopOnError: true,
                timeoutMs: 8000
            });

            const details = result?.details || {};
            const executed = Number.isFinite(Number(details.executed)) ? Number(details.executed) : plan.actions.length;
            const errors = Array.isArray(details.errors) ? details.errors : [];
            if (plan.lastElement && this._isBrowserCoreElement(plan.lastElement)) {
                this.lastBrowserElement = plan.lastElement;
            }

            if (errors.length > 0) {
                return {
                    mode: 'partial',
                    executed,
                    skipped: Number(plan.skipped || 0),
                    total: Array.isArray(subActions) ? subActions.length : plan.actions.length,
                    errors
                };
            }

            return {
                mode: 'executed',
                executed,
                skipped: Number(plan.skipped || 0),
                total: Array.isArray(subActions) ? subActions.length : plan.actions.length
            };
        } catch (error) {
            return {
                mode: 'partial',
                executed: 0,
                skipped: Number(plan.skipped || 0),
                total: Array.isArray(subActions) ? subActions.length : plan.actions.length,
                error: error?.message || String(error)
            };
        }
    }

    _updateExecutionState(state) {
        this.currentExecutionState = state || null;
        const nextKey = state ? `${state.stage}:${state.blocker}:${state.turn}:${state.summary}` : '';
        if (!nextKey || nextKey === this.lastExecutionStateKey) return;
        this.lastExecutionStateKey = nextKey;
        this._notify('action-status', {
            phase: 'execution_state',
            turn: state.turn,
            browser_state: state
        });
    }

    _shouldSkipBrowserProgressAction(element) {
        if (this.currentLaunchMode !== 'browser') return { skip: false, reason: '' };
        return shouldSkipRedundantBrowserAction(element, this.currentBrowserGoalProgress);
    }

    _inferZoneFromBbox(bbox) {
        if (!bbox) return 'content';
        const cx = Number(bbox.x || 0) + (Number(bbox.w || 0) / 2);
        const cy = Number(bbox.y || 0) + (Number(bbox.h || 0) / 2);
        if (cy > 0.82) return 'bottom';
        if (cy < 0.17) return 'top';
        if (cx < 0.33) return 'sidebar';
        return 'content';
    }

    _tokens(text) {
        return this._normalizeText(text).split(' ').filter((t) => t.length > 2);
    }

    _labelScore(anchorLabel, candidateLabel) {
        const a = this._tokens(anchorLabel);
        const c = new Set(this._tokens(candidateLabel));
        if (a.length === 0) return 0;
        let overlap = 0;
        for (const token of a) {
            if (c.has(token)) overlap++;
        }
        const ratio = overlap / a.length;
        if (ratio >= 0.9) return 4;
        if (ratio >= 0.6) return 3;
        if (ratio >= 0.35) return 2;
        if (ratio > 0) return 1;
        return 0;
    }

    _resolveElementByAnchor(elements, llmTarget) {
        if (!this.workflowGuidance || !Array.isArray(this.workflowGuidance.anchors) || this.workflowGuidance.anchors.length === 0) {
            return llmTarget;
        }

        const appNorm = this._normalizeText(this.currentApp);
        let anchor = null;
        let anchorIdx = -1;
        for (let i = this.workflowAnchorIndex; i < this.workflowGuidance.anchors.length; i++) {
            const a = this.workflowGuidance.anchors[i];
            if (!a) continue;
            const aApp = this._normalizeText(a.app);
            if (!aApp || !appNorm || aApp.includes(appNorm) || appNorm.includes(aApp)) {
                anchor = a;
                anchorIdx = i;
                break;
            }
        }
        if (!anchor) return llmTarget;

        let best = null;
        let bestScore = -1;
        for (const el of elements) {
            let score = 0;
            score += this._labelScore(anchor.target, el.label || el.type || '');
            if (anchor.type && el.type && String(anchor.type).toLowerCase() === String(el.type).toLowerCase()) score += 2;
            if (anchor.zone && this._inferZoneFromBbox(el.bbox) === String(anchor.zone).toLowerCase()) score += 1;
            if (anchor.bbox && el.bbox) {
                const ax = Number(anchor.bbox.x || 0) + Number(anchor.bbox.w || 0) / 2;
                const ay = Number(anchor.bbox.y || 0) + Number(anchor.bbox.h || 0) / 2;
                const ex = Number(el.bbox.x || 0) + Number(el.bbox.w || 0) / 2;
                const ey = Number(el.bbox.y || 0) + Number(el.bbox.h || 0) / 2;
                const dist = Math.hypot(ax - ex, ay - ey);
                if (dist < 0.05) score += 2;
                else if (dist < 0.12) score += 1;
            }
            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        const llmId = llmTarget ? llmTarget.id : 'none';
        if (best && bestScore >= 5) {
            if (!llmTarget || best.id !== llmTarget.id) {
                console.log(`🧭 [ScreenAgent] Anchor override: #${llmId} -> #${best.id} (score=${bestScore}, target="${anchor.target}")`);
            } else {
                console.log(`🧭 [ScreenAgent] Anchor confirmed LLM target #${best.id} (score=${bestScore})`);
            }
            this.workflowAnchorIndex = anchorIdx + 1;
            return best;
        }

        return llmTarget;
    }

    _elementCenterPixels(element) {
        if (!element) return null;

        let x = Number(element?.center?.x);
        let y = Number(element?.center?.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            const bbox = element?.bbox || {};
            x = Number(bbox.x || 0) + (Number(bbox.w || 0) / 2);
            y = Number(bbox.y || 0) + (Number(bbox.h || 0) / 2);
        }

        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (x <= 1 && y <= 1) {
            return {
                x: Math.round(x * this.screenWidth),
                y: Math.round(y * this.screenHeight)
            };
        }

        return {
            x: Math.round(x),
            y: Math.round(y)
        };
    }

    _findFreshElementMatch(elements, targetElement) {
        if (!Array.isArray(elements) || elements.length === 0 || !targetElement) return null;

        const targetLabel = this._normalizeText(targetElement.label || targetElement.type || '');
        const targetType = this._normalizeText(targetElement.type || targetElement.role || '');
        const targetZone = this._inferZoneFromBbox(targetElement.bbox);
        const targetCenter = this._elementCenterPixels(targetElement);

        let best = null;
        let bestScore = -1;

        for (const candidate of elements) {
            const candidateLabel = this._normalizeText(candidate.label || candidate.type || '');
            const candidateType = this._normalizeText(candidate.type || candidate.role || '');
            const candidateZone = this._inferZoneFromBbox(candidate.bbox);
            const candidateCenter = this._elementCenterPixels(candidate);

            let score = 0;
            score += this._labelScore(targetLabel, candidateLabel) * 2;

            if (targetLabel && candidateLabel && targetLabel === candidateLabel) score += 4;
            if (targetType && candidateType && targetType === candidateType) score += 3;
            if (targetZone && candidateZone && targetZone === candidateZone) score += 1;

            if (targetCenter && candidateCenter) {
                const dist = Math.hypot(targetCenter.x - candidateCenter.x, targetCenter.y - candidateCenter.y);
                if (dist < 40) score += 4;
                else if (dist < 120) score += 3;
                else if (dist < 220) score += 2;
                else if (dist < 360) score += 1;
            }

            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }

        return best && bestScore >= 5 ? best : null;
    }

    async _revalidateBrowserClickTarget(targetElement) {
        if (!targetElement) {
            return { ok: false, reason: 'missing_target', element: null, hash: null };
        }

        if (!this._shouldUseBrowserAgent(this.currentApp) || !this.browserAgent?.browserContext?.active) {
            return { ok: true, reason: 'not_browser_mode', element: targetElement, hash: null };
        }

        const previousUrl = this.browserAgent.browserContext.url || '';
        await this.browserAgent.syncActiveTabContext(this.currentTargetUrl || previousUrl || '').catch(() => { });

        const detection = await this._runAxDetection(this.currentApp, this.currentFocusApp);
        const freshElements = Array.isArray(detection?.elements) ? detection.elements : [];
        const freshHash = freshElements.length > 0 ? this._hashElements(freshElements) : null;
        const matched = this._findFreshElementMatch(freshElements, targetElement);
        const latestUrl = detection?.url || this.browserAgent?.browserContext?.url || previousUrl || '';

        if (!matched) {
            return {
                ok: false,
                reason: latestUrl && previousUrl && latestUrl !== previousUrl
                    ? `browser_target_changed:${previousUrl}=>${latestUrl}`
                    : 'target_missing_in_fresh_snapshot',
                element: null,
                hash: freshHash,
                url: latestUrl
            };
        }

        return {
            ok: true,
            reason: latestUrl && previousUrl && latestUrl !== previousUrl ? 'target_relocated_after_tab_change' : 'target_confirmed',
            element: matched,
            hash: freshHash,
            url: latestUrl
        };
    }

    /**
     * Create a simple hash of elements list for loop detection.
     * Compares IDs, labels, and types to detect if screen state changed.
     */
    _hashElements(elements) {
        if (!elements || elements.length === 0) return 'empty';

        // Create a simple hash from element properties
        const signature = elements
            .map(e => `${e.id}:${e.label}:${e.type}`)
            .sort()
            .join('|');

        // Simple string hash (similar to Java's hashCode)
        let hash = 0;
        for (let i = 0; i < signature.length; i++) {
            const char = signature.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    _restoreHiddenWindows() {
        stickyFace.stop();
        if (this.hiddenWindows) {
            for (const win of this.hiddenWindows) {
                if (!win.isDestroyed()) win.show();
            }
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
        }
        this.windowsHiddenByAutomation = false;
        this.hiddenWindows = [];
    }

    /**
     * Stop the current action loop.
     */
    stop(options = {}) {
        const wasRunning = this.isRunning;
        this.abortRequested = true;
        this.deferWindowRestore = !!options.keepWindowsHidden;
        this.isRunning = false;
        console.log('🛑 [ScreenAgent] Action loop stopped by user');
        this._notify('action-status', { phase: 'stopped' });
        if (!wasRunning && !this.deferWindowRestore && this.windowsHiddenByAutomation) {
            try {
                this._restoreHiddenWindows();
            } catch (e) {
                console.error('⚠️ [ScreenAgent] Failed to restore hidden windows on direct stop:', e);
            }
        }
    }
}

module.exports = ScreenAgent;

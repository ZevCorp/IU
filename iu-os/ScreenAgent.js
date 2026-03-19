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
const WindowsCompanionClient = require('./WindowsCompanionClient');
const stickyFace = require('./StickyFaceController'); // Sticky Face Controller for Automation Mode
// const nativeGlass = require('./NativeGlassController'); // Controller for Native Bubble Window - REMOVING FOR ISOLATION

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
            description: "Use ONLY when the task cannot continue without specific data from the user (e.g., missing names, IDs, phone numbers, exact text). This pauses execution and asks the user for that missing data.",
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
        this.isWindows = process.platform === 'win32';
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
        this.screenOriginX = 0;
        this.screenOriginY = 0;
        this.windowsCompanion = null;
        // this.currentBubblePos = null; // Track bubble position for "drag & drop" focus strategy - REMOVED

        if (this.isWindows) {
            this.windowsCompanion = new WindowsCompanionClient();
            this.axAgent = {
                extract: async (appName = null) => this.windowsCompanion.extract(appName)
            };

            // Warm up companion asynchronously to reduce first-action latency.
            this.windowsCompanion.start().catch((e) => {
                console.warn(`⚠️ [ScreenAgent] Windows companion startup failed: ${e.message}`);
            });
        } else {
            // Use simple deterministic agent (fast and reliable)
            // For complex future scenarios, see AxExtractionAgent.js.future
            const SimpleAxAgent = require('./SimpleAxAgent');
            this.axAgent = new SimpleAxAgent();
        }

        this.workflowGuidance = null;
        this.workflowAnchorIndex = 0;
        this.currentTypeTask = null;
        this.lastSelectedElement = null;
        this.lastContextSnapshot = { app: '', window: '', recentActions: [] };
    }

    _updateScreenMetrics() {
        const displays = screen.getAllDisplays();
        if (!Array.isArray(displays) || displays.length === 0) {
            const primaryDisplay = screen.getPrimaryDisplay();
            this.screenOriginX = 0;
            this.screenOriginY = 0;
            this.screenWidth = primaryDisplay.size.width;
            this.screenHeight = primaryDisplay.size.height;
            return;
        }

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const display of displays) {
            const b = display.bounds || { x: 0, y: 0, width: 0, height: 0 };
            minX = Math.min(minX, Number(b.x || 0));
            minY = Math.min(minY, Number(b.y || 0));
            maxX = Math.max(maxX, Number(b.x || 0) + Number(b.width || 0));
            maxY = Math.max(maxY, Number(b.y || 0) + Number(b.height || 0));
        }

        this.screenOriginX = Number.isFinite(minX) ? minX : 0;
        this.screenOriginY = Number.isFinite(minY) ? minY : 0;
        this.screenWidth = Math.max(1, Math.round((Number.isFinite(maxX) ? maxX : 0) - this.screenOriginX));
        this.screenHeight = Math.max(1, Math.round((Number.isFinite(maxY) ? maxY : 0) - this.screenOriginY));
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
            'Buscador': 'Finder',
            'Finder': 'Finder',
            'Terminal': this.isWindows ? 'wt.exe' : 'Terminal',
            'Bloc de notas': 'notepad.exe',
            'Notepad': 'notepad.exe',
            'Explorador': this.isWindows ? 'explorer.exe' : 'Finder',
            'Explorer': this.isWindows ? 'explorer.exe' : 'Finder',
            'Calculator': 'Calculator',
            'MiniPRM': 'MiniPRM'
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

        if (normalized.includes('whatsapp') || normalized.includes('telegram') || normalized.includes('slack') || normalized.includes('messages') || normalized.includes('discord')) {
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
    async _runAxDetection(appName = null) {
        // console.log('🤖 [ScreenAgent] Running intelligent AX extraction...');

        try {
            const result = await this.axAgent.extract(appName);

            if (result.error || !result.snapshot || result.snapshot.length === 0) {
                console.warn('⚠️ [ScreenAgent] AX Agent returned error:', result.error);
                return null;
            }

            // Normalize and filter elements to keep actionable, stable nodes.
            const normalized = result.snapshot.map((e) => {
                const bbox = e && e.bbox ? {
                    x: Number(e.bbox.x || 0),
                    y: Number(e.bbox.y || 0),
                    w: Number(e.bbox.w || 0),
                    h: Number(e.bbox.h || 0)
                } : null;

                const centerX = (e && e.center && typeof e.center.x === 'number')
                    ? Number(e.center.x)
                    : (bbox ? Number(bbox.x + (bbox.w / 2)) : 0);
                const centerY = (e && e.center && typeof e.center.y === 'number')
                    ? Number(e.center.y)
                    : (bbox ? Number(bbox.y + (bbox.h / 2)) : 0);

                return {
                    id: e.id,
                    type: e.type,
                    label: e.label || e.type,
                    confidence: 1.0,
                    bbox,
                    center: { x: centerX, y: centerY },
                    actions: Array.isArray(e.actions) ? e.actions : [],
                    interactive: !!e.interactive,
                    nativeRef: e.nativeRef || null,
                    state: e.state || null
                };
            });

            const elements = normalized
                .filter((el) => this._isUsableDetectionElement(el))
                .sort((a, b) => this._elementPriorityScore(b) - this._elementPriorityScore(a));

            return {
                elements,
                app: result.app,
                window: result.window,
                source: this.isWindows ? 'UIA_WINDOWS' : 'AX_ACCESSIBILITY'
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
            console.log(`💾 [ScreenAgent] Graph saved: ${filename}`);

            // TODO: Pipe to Jetson here if needed

        } catch (e) {
            console.error('⚠️ [ScreenAgent] Failed to save graph:', e.message);
        }
    }

    // ... (rest of class) ...

    /**
     * Main action loop override to use hybrid AX/Vision approach.
     */
    async executeAction(goal, app, stepsHint) {
        if (this.isRunning) {
            console.log('⚠️ [ScreenAgent] Already running an action');
            return { success: false, error: 'Already executing an action' };
        }

        this.isRunning = true;
        this.abortRequested = false;
        this.deferWindowRestore = false;
        this.currentTypeTask = null;
        this.currentApp = this._sanitizeAppName(app); // Track current app context
        this.lastSelectedElement = null;
        this.workflowGuidance = null;
        this.workflowAnchorIndex = 0;
        console.log(`🖥️ [ScreenAgent] Starting HYBRID action loop: "${goal}" in ${app}`);

        this._notify('action-status', { phase: 'starting', goal, app });

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

            await this._openApp(app);
            await this._wait(500); // Reduced from 1500ms — app is already focused via AppleScript

            let iteration = 0;
            let goalReached = false;
            let actionResult = null;
            const actionHistory = [];


            // Store virtual screen dimensions for denormalization (multi-monitor safe).
            this._updateScreenMetrics();

            const somMessages = [
                {
                    role: "system",
                    content: `Eres un agente de automatización.
OBJETIVO: "${goal}"
APP INICIAL: "${app}"
PASOS SUGERIDOS: "${stepsHint}"

MODO HÍBRIDO (AX + Vision):
Recibirás una lista de elementos UI.
- Si la fuente es 'AX_ACCESSIBILITY', los IDs y coordenadas son EXACTOS (Ground Truth). Confía plenamente en ellos.
- Si la fuente es 'VISION' (YOLO), los elementos son aproximados.

ACCIONES DISPONIBLES (ordenadas por preferencia):
1. perform_set_of_actions([...]): EJECUTA UNA SECUENCIA. Úsala SIEMPRE que se requiera más de un clic consecutivo o llenado de formularios.
2. switch_app("NombreApp"): Cambia de aplicación.
3. request_user_input("pregunta"): Pausar y pedir datos faltantes al usuario.
4. goal_reached("Resumen"): Terminar la tarea.

REGLAS DE VELOCIDAD EXTREMA:
- NUNCA uses select_element, type_text o key_press individuales si la acción requiere varios pasos continuos VISIBLES; júntalos en perform_set_of_actions.
- RESTRICCIÓN VISUAL DE BATCH: ¡NUNCA agrupes acciones en un Batch si la siguiente acción requiere que la pantalla cargue o cambie para existir (ej. buscar un contacto y luego hacerle clik a un resultado hipotético)! Haz la búsqueda, termina la iteración y en el PRÓXIMO turno visual (cuando exista) le haces click.
- Mantén la "justificacion" MUY BREVE (máximo 15 palabras) para ahorrar milisegundos de inferencia. No divagues ni expliques de más.

IMPORTANTE SOBRE MULTI-APP:
Si la tarea requiere múltiples apps (ej: "Abrir X y luego Y"), usa 'switch_app' cuando termines con la primera.

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
                    detectionResult = await this._runAxDetection(this.currentApp); // Use currentApp dynamic context
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
                    console.log(`⚠️ [ScreenAgent] Same state detected: ${sameStateCount}/${LOOP_THRESHOLD}`);

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
                    if (sameStateCount > 0) {
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
                    console.log(`🧠 [ScreenAgent] Formalizing graph with ${elements.length} raw nodes...`);
                    llmElements = GraphFormalizer.optimize(elements);
                    console.log(`📉 [ScreenAgent] Graph formalized: ${elements.length} -> ${llmElements.length} meaningful nodes`);
                } else if (elements.length > 0) {
                    console.log(`🧪 [ScreenAgent] Graph formalizer disabled (IU_AX_FORMALIZER!=1). Using raw AX nodes: ${elements.length}`);
                }

                // 5. Format elements list for LLM
                let elementsText = '  (No se detectaron elementos UI relevantes. La pantalla puede estar en blanco, cargando, o el sistema no pudo leerla. Si esperabas ver algo, intenta usar scroll, presionar tecla escape por si hay un modal trabado, o switch_app para asegurarte que estás en la aplicación correcta.)';
                if (llmElements.length > 0) {
                    elementsText = llmElements.map((e) => {
                        const actions = Array.isArray(e.actions)
                            ? e.actions.filter((a) => String(a).toLowerCase() !== 'focus').slice(0, 5)
                            : [];
                        const actionText = actions.length > 0 ? actions.join('|') : 'none';
                        const stateText = e.state
                            ? `${e.state.enabled === false ? 'disabled' : 'enabled'}${e.state.focused ? ',focused' : ''}`
                            : 'unknown';
                        return `  #${e.id} [${e.label}] (${e.type}) bbox=[${e.bbox.x.toFixed(3)},${e.bbox.y.toFixed(3)},${e.bbox.w.toFixed(3)},${e.bbox.h.toFixed(3)}] actions=${actionText} state=${stateText}`;
                    }).join('\n');
                }

                // 6. Send element list to LLM (text-only, no image)
                const appInstructions = this._getAppSpecificInstructions(this.currentApp, elements);
                const runtimeContextHint = `\n\nContexto actual detectado:
- App: ${detectionResult?.app || this.currentApp || 'desconocida'}
- Ventana/Módulo: ${detectionResult?.window || 'desconocido'}
- Etapa actual (acciones recientes): ${(this.lastContextSnapshot.recentActions || []).slice(-4).join(' | ') || 'sin acciones previas'}`;

                somMessages.push({
                    role: "user",
                    content: `Iteración ${iteration}/${this.maxIterations}. Objetivo: "${goal}"

Elementos UI detectados en pantalla (${elements.length} total) [Fuente: ${detectionResult.source || 'VISION'}]:
${elementsText}${historyHint}${loopWarning}${appInstructions}${runtimeContextHint}

¿Qué acción ejecutar?`
                });

                console.log(`📤 [ScreenAgent] Sending to LLM: ${elements.length} elements, tool_choice=required`);
                console.log(`📋 [ScreenAgent] Tools available: ${SOM_TOOLS.map(t => t.function.name).join(', ')}`);

                const inferStartTime = Date.now();
                const somResponse = await this._retryWithBackoff(() => ModelSwitch.chatCompletion({
                    messages: somMessages,
                    tools: SOM_TOOLS,
                    tool_choice: "required",
                    max_tokens: 4096  // Increased for GPT-5-mini to generate complete tool calls
                }), 3);
                const inferElapsed = Date.now() - inferStartTime;

                console.log(`📥 [ScreenAgent] LLM Response [${inferElapsed}ms]:`, JSON.stringify({
                    hasToolCalls: !!somResponse.choices[0]?.message?.tool_calls,
                    toolCallCount: somResponse.choices[0]?.message?.tool_calls?.length || 0,
                    finishReason: somResponse.choices[0]?.finish_reason,
                    messageContent: somResponse.choices[0]?.message?.content?.substring(0, 100)
                }));

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
                        const missingFields = String(args.missing_fields || '').trim();
                        const msg = question || `Necesito estos datos para continuar: ${missingFields}`;
                        actionResult = msg;
                        this.deferWindowRestore = true;
                        console.log(`📝 [ScreenAgent] Awaiting user input: ${msg} [missing: ${missingFields}]`);
                        this._notify('action-status', {
                            phase: 'awaiting_user_input',
                            question: msg,
                            missing_fields: missingFields
                        });
                        try {
                            stickyFace.setFaceColor('#00ff00');
                            stickyFace.setExpression('mild_attention');
                            stickyFace.showMessage({ title: 'Necesito datos', body: msg }, 120000);
                        } catch (e) {
                            // best effort only
                        }

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
                        } else {
                            const label = `${targetElement.label || targetElement.type}`;
                            this.lastSelectedElement = targetElement;

                            const semantic = await this._executeWindowsSemanticForElement(targetElement, { preferred: 'invoke' });
                            if (semantic.success) {
                                actionSummary = `SELECT #${targetElement.id} [${label}] via ${semantic.action}`;
                            } else {
                                const { px, py } = this._getElementPixelCenter(targetElement);
                                console.log(`🎯 [ScreenAgent] Click on #${targetElement.id} [${label}] at pixel (${px}, ${py})`);
                                await this._executeToolDirect('click', { px, py, label });
                                actionSummary = `SELECT #${targetElement.id} [${label}]`;
                            }
                        }
                    }
                    else if (fnName === 'type_text') {
                        await this._executeTool('type_text', args);
                        actionSummary = `TYPE "${args.text}"`;
                    }
                    else if (fnName === 'key_press') {
                        await this._executeTool('key_press', args);
                        actionSummary = `KEY ${args.key}`;
                    }
                    else if (fnName === 'switch_app') {
                        console.log(`🔄 [ScreenAgent] Switching app to: "${args.app_name}"`);
                        try {
                            // Use existing _openApp method
                            await this._openApp(args.app_name);
                            await this._wait(1000); // Reduced from 2000ms — app opens/focuses faster now

                            this.currentApp = this._sanitizeAppName(args.app_name); // Update context with sanitized app name
                            this.lastSelectedElement = null;
                            actionSummary = `SWITCH APP to "${args.app_name}"`;

                            lastElementsHash = null;
                            sameStateCount = 0;
                        } catch (e) {
                            console.error(`❌ [ScreenAgent] Failed to switch app: ${e.message}`);
                            actionSummary = `SWITCH APP FAILED: ${e.message}`;
                        }
                    }
                    else if (fnName === 'perform_set_of_actions') {
                        const subActions = args.actions;
                        console.log(`📦 [ScreenAgent] Batch executing ${subActions.length} actions...`);
                        const batchStartTime = Date.now();

                        // Refocus ONCE before batch
                        await this._ensureFocus(this.currentApp);

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
                                this.lastSelectedElement = targetElement;
                                const semantic = await this._executeWindowsSemanticForElement(targetElement, { preferred: 'invoke' });
                                if (!semantic.success) {
                                    const { px, py } = this._getElementPixelCenter(targetElement);
                                    await this._executeToolDirect('click', { px, py, label: `Sequence #${sub.element_id}` }, true); // true = skipFocus
                                }
                                lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 1000, 150);
                            }
                            else if (sub.action === 'type') {
                                await this._executeTool('type_text', { text: sub.text }, true);
                                lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 800, 150);
                            }
                            else if (sub.action === 'key') {
                                await this._executeTool('key_press', { key: sub.key }, true);
                                lastElementsHash = await this._waitForUIChange(this.currentApp, lastElementsHash, 800, 150);
                            }
                        }
                        const batchElapsed = Date.now() - batchStartTime;
                        const reasoningStr = args.justificacion ? ` (${args.justificacion})` : '';
                        actionSummary = `BATCH: Executed ${subActions.length} actions in ${batchElapsed}ms${reasoningStr}`;
                        console.log(`⏱️ [ScreenAgent] Batch complete in ${batchElapsed}ms${reasoningStr}`);
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

            if (this.deferWindowRestore && !goalReached && actionResult) {
                this._notify('action-status', { phase: 'awaiting_user_input', question: actionResult });
            } else if (this.abortRequested) {
                console.log('🛑 [ScreenAgent] Action loop interrupted by user');
                this._notify('action-status', { phase: 'stopped' });
            } else if (!goalReached) {
                console.warn(`⚠️ [ScreenAgent] Stopped after ${iteration} iterations without reaching goal`);
                this._notify('action-status', { phase: 'incomplete', iterations: iteration });
            }

            return {
                success: goalReached && !this.abortRequested,
                iterations: iteration,
                summary: actionResult,
                aborted: this.abortRequested,
                awaitingUserInput: !!(this.deferWindowRestore && !goalReached && actionResult)
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
            const clickPoint = this._normalizedToPixel(Number(args.x), Number(args.y));
            summary = `CLICK "${args.label}" at (${args.x.toFixed(3)}, ${args.y.toFixed(3)}) → pixel (${clickPoint.px}, ${clickPoint.py})`;
            await this._saveDebugScreenshot(base64, { x: clickPoint.px, y: clickPoint.py, label: args.label }, iteration);
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
            if (!skipFocus) await this._ensureFocus(this.currentApp);
            if (this.abortRequested) return;

            const { mouse, Button, Point } = await this._getNutJS();

            if (fnName === 'click') {
                const clickPoint = this._clampPixelPoint(Number(args.px), Number(args.py));
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

                console.log(`🖱️ [ScreenAgent] Deterministic click "${args.label}" at pixel (${clickPoint.px}, ${clickPoint.py})`);
                // speedFactor 3.0 → duration = min(800,max(300,dist*0.6))/3.0 ≈ 100–267ms vs old 272–727ms
                await this._humanLikeMove(clickPoint.px, clickPoint.py, 3.0);
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
        const normalizedApp = this._sanitizeAppName(appName);
        if (this.isWindows && this.windowsCompanion) {
            try {
                await this.windowsCompanion.openApp(normalizedApp);
                await this._wait(300);
                await this.windowsCompanion.focusApp(normalizedApp);
                await this._wait(250);
                return;
            } catch (e) {
                console.warn(`⚠️ [ScreenAgent] Windows open/focus failed for "${normalizedApp}": ${e.message}`);
            }
        }

        return new Promise((resolve) => {
            const { exec } = require('child_process');

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
        if (this.isWindows && this.windowsCompanion) {
            try {
                await this.windowsCompanion.focusApp(this._sanitizeAppName(appName));
                await this._wait(100);
                return;
            } catch (e) {
                console.warn(`⚠️ [ScreenAgent] Windows focus failed for ${appName}: ${e.message}`);
            }
        }

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
            if (!skipFocus) await this._ensureFocus(this.currentApp);
            if (this.abortRequested) return;

            if (fnName === 'type_text' && this.isWindows) {
                const viaSemanticValue = await this._tryWindowsSetValue(args.text);
                if (viaSemanticValue) {
                    console.log(`⌨️ [ScreenAgent] setValue() aplicado por UIA`);
                    return;
                }
            }

            if (fnName === 'scroll' && this.isWindows) {
                const viaSemanticScroll = await this._tryWindowsScroll(args.direction, args.amount);
                if (viaSemanticScroll) {
                    console.log(`📜 [ScreenAgent] scroll() aplicado por UIA`);
                    return;
                }
            }

            const { mouse, keyboard, Button, Key } = await this._getNutJS();

            if (fnName === 'click') {
                // Denormalize from 0-1 to pixel coordinates
                const clickPoint = this._normalizedToPixel(Number(args.x), Number(args.y));

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

                console.log(`🖱️ [ScreenAgent] Clicking "${args.label}" at normalized (${args.x.toFixed(3)}, ${args.y.toFixed(3)}) → pixel (${clickPoint.px}, ${clickPoint.py})`);
                await this._humanLikeMove(clickPoint.px, clickPoint.py, 3.0);
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

    _isInteractiveElement(element) {
        if (!element) return false;
        if (element.interactive) return true;
        const actions = Array.isArray(element.actions) ? element.actions : [];
        const semanticActions = actions.filter((a) => String(a).toLowerCase() !== 'focus');
        if (semanticActions.length > 0) return true;
        const type = String(element.type || '').toLowerCase();
        return /(button|edit|menuitem|checkbox|radiobutton|tabitem|combobox|listitem|hyperlink)/.test(type);
    }

    _isUsableDetectionElement(element) {
        if (!element || !element.bbox) return false;
        const { x, y, w, h } = element.bbox;
        if (![x, y, w, h].every((n) => Number.isFinite(n))) return false;
        if (w <= 0 || h <= 0) return false;
        if (x < -0.001 || y < -0.001 || x > 1.001 || y > 1.001) return false;
        if (w > 1.001 || h > 1.001) return false;

        if (element.state && element.state.offscreen) return false;

        const area = w * h;
        if (area < 0.00002) return false;
        const interactive = this._isInteractiveElement(element);
        if (!interactive && area > 0.9) return false;

        if (!interactive) {
            const type = String(element.type || '').toLowerCase();
            const label = this._normalizeText(element.label || '');
            if (type === 'pane' && (label === '' || label === 'pane')) return false;
            if (type === 'window' && area > 0.7) return false;
        }
        return true;
    }

    _elementPriorityScore(element) {
        if (!element || !element.bbox) return 0;
        const actions = Array.isArray(element.actions)
            ? element.actions.map((a) => String(a).toLowerCase())
            : [];
        const semanticCount = actions.filter((a) => a !== 'focus').length;
        const area = Number(element.bbox.w || 0) * Number(element.bbox.h || 0);
        const interactiveBonus = this._isInteractiveElement(element) ? 10 : 0;
        const enabledBonus = element.state && element.state.enabled === false ? -6 : 0;
        return interactiveBonus + (semanticCount * 2) + enabledBonus - Math.min(4, area * 4);
    }

    _clampPixelPoint(px, py) {
        const minX = Number(this.screenOriginX || 0);
        const minY = Number(this.screenOriginY || 0);
        const maxX = minX + Math.max(1, Number(this.screenWidth || 1)) - 1;
        const maxY = minY + Math.max(1, Number(this.screenHeight || 1)) - 1;

        const safeX = Number.isFinite(px) ? px : minX;
        const safeY = Number.isFinite(py) ? py : minY;

        return {
            px: Math.round(Math.max(minX, Math.min(maxX, safeX))),
            py: Math.round(Math.max(minY, Math.min(maxY, safeY)))
        };
    }

    _normalizedToPixel(x, y) {
        const px = Number(this.screenOriginX || 0) + (Number(x || 0) * Number(this.screenWidth || 1));
        const py = Number(this.screenOriginY || 0) + (Number(y || 0) * Number(this.screenHeight || 1));
        return this._clampPixelPoint(px, py);
    }

    _getElementPixelCenter(targetElement) {
        if (!targetElement) {
            return this._clampPixelPoint(this.screenOriginX, this.screenOriginY);
        }

        let rawX = NaN;
        let rawY = NaN;

        if (targetElement.center && Number.isFinite(targetElement.center.x) && Number.isFinite(targetElement.center.y)) {
            rawX = Number(targetElement.center.x);
            rawY = Number(targetElement.center.y);
            const normalizedCenter = rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1;
            if (normalizedCenter) {
                return this._normalizedToPixel(rawX, rawY);
            }
            return this._clampPixelPoint(rawX, rawY);
        }

        if (targetElement.bbox) {
            const cx = Number(targetElement.bbox.x || 0) + (Number(targetElement.bbox.w || 0) / 2);
            const cy = Number(targetElement.bbox.y || 0) + (Number(targetElement.bbox.h || 0) / 2);
            return this._normalizedToPixel(cx, cy);
        }

        return this._clampPixelPoint(this.screenOriginX, this.screenOriginY);
    }

    async _executeWindowsSemanticForElement(element, options = {}) {
        if (!this.isWindows || !this.windowsCompanion || !element || !element.nativeRef) {
            return { success: false, error: 'NOT_AVAILABLE' };
        }

        const preferred = String(options.preferred || 'invoke');
        const available = Array.isArray(element.actions)
            ? element.actions.map((a) => String(a).toLowerCase())
            : [];

        const candidates = [];
        const pushCandidate = (name) => {
            const key = String(name || '').toLowerCase();
            if (!key) return;
            if (candidates.includes(key)) return;
            if (available.length === 0 || available.includes(key) || key === 'invoke' || key === 'focus' || key === 'click') {
                candidates.push(key);
            }
        };

        pushCandidate(preferred);
        if (preferred.toLowerCase() === 'invoke') {
            pushCandidate('invoke');
            pushCandidate('select');
            pushCandidate('toggle');
            pushCandidate('expand');
            pushCandidate('click');
            pushCandidate('focus');
        } else if (preferred.toLowerCase() === 'setvalue') {
            pushCandidate('setvalue');
            pushCandidate('focus');
        } else if (preferred.toLowerCase() === 'scroll') {
            pushCandidate('scroll');
            pushCandidate('focus');
        } else if (preferred.toLowerCase() === 'click') {
            pushCandidate('click');
            pushCandidate('focus');
        }

        let lastError = null;
        for (const action of candidates) {
            try {
                const payload = {
                    appName: this.currentApp,
                    element: element.nativeRef,
                    action
                };

                if (action === 'setvalue') {
                    payload.value = String(options.value || '');
                }
                if (action === 'scroll') {
                    payload.direction = options.direction || 'down';
                    payload.amount = options.amount || 'medium';
                }

                const result = await this.windowsCompanion.performAction(payload);
                if (result && result.success) {
                    return { success: true, action: result.action || action };
                }
            } catch (e) {
                lastError = e.message;
            }
        }

        return { success: false, error: lastError || 'SEMANTIC_ACTION_FAILED' };
    }

    async _tryWindowsSetValue(text) {
        if (!this.isWindows || !this.lastSelectedElement) return false;
        const result = await this._executeWindowsSemanticForElement(this.lastSelectedElement, {
            preferred: 'setValue',
            value: String(text || '')
        });
        return !!result.success;
    }

    async _tryWindowsScroll(direction = 'down', amount = 'medium') {
        if (!this.isWindows || !this.lastSelectedElement) return false;
        const result = await this._executeWindowsSemanticForElement(this.lastSelectedElement, {
            preferred: 'scroll',
            direction: direction || 'down',
            amount: amount || 'medium'
        });
        return !!result.success;
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
                    console.log(`⏱️ [ScreenAgent] Dynamic Wait: UI cambió en ${elapsed}ms`);
                    await this._wait(150); // Pausa extra para que se asienten animaciones post-cambio
                    return currentHash;
                }
            }
            await this._wait(pollIntervalMs);
            elapsed += pollIntervalMs;
        }

        console.log(`⏱️ [ScreenAgent] Dynamic Wait: Timeout (${timeoutMs}ms), UI no cambió o fue imperceptible.`);
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

    /**
     * Create a simple hash of elements list for loop detection.
     * Compares IDs, labels, and types to detect if screen state changed.
     */
    _hashElements(elements) {
        if (!elements || elements.length === 0) return 'empty';

        // Build a stable signature based on runtime reference + coarse geometry + state.
        const signature = elements
            .map((e) => {
                const runtime = String(e?.nativeRef?.runtimeId || '');
                const label = this._normalizeText(e?.label || '').slice(0, 40);
                const type = String(e?.type || '').toLowerCase();
                const bbox = e?.bbox
                    ? `${Number(e.bbox.x || 0).toFixed(3)},${Number(e.bbox.y || 0).toFixed(3)},${Number(e.bbox.w || 0).toFixed(3)},${Number(e.bbox.h || 0).toFixed(3)}`
                    : '0,0,0,0';
                const state = e?.state
                    ? `${e.state.enabled === false ? 0 : 1}${e.state.offscreen ? 1 : 0}${e.state.focused ? 1 : 0}`
                    : '100';
                return `${runtime}|${type}|${label}|${bbox}|${state}`;
            })
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

    async shutdown() {
        if (this.windowsCompanion) {
            await this.windowsCompanion.stop();
        }
    }
}

module.exports = ScreenAgent;

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

const { screen } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { execFile } = require('child_process');
const ModelSwitch = require('./ModelSwitch');
const PersistentMemory = require('./PersistentMemory');
const GraphFormalizer = require('./GraphFormalizer');
const WhatsAppContext = require('./WhatsAppContext');
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
                    element_id: { type: "number", description: "The #id number of the detected element to click" },
                    reasoning: { type: "string", description: "Why clicking this element advances the goal" }
                },
                required: ["element_id", "reasoning"]
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
            description: "Press a special key (Enter, Tab, Escape, etc). Use after typing to submit, or to navigate.",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", enum: ["enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right", "pageup", "pagedown", "home", "end"], description: "The key to press" },
                    label: { type: "string", description: "Short description of why pressing this key" },
                    reasoning: { type: "string", description: "Why this key press advances the goal" }
                },
                required: ["key", "label", "reasoning"]
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
                                key: { type: "string", description: "If action=key, the key to press" },
                                reasoning: { type: "string", description: "Why this action is needed" }
                            },
                            required: ["action", "reasoning"]
                        }
                    },
                    reasoning: { type: "string", description: "Reason for the entire batch" }
                },
                required: ["actions", "reasoning"]
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
                    app_name: { type: "string", description: "Name of the app to switch to (e.g. 'Calculator', 'Notes', 'Calendar')" },
                    reasoning: { type: "string", description: "Why switching apps helps achieve the goal" }
                },
                required: ["app_name", "reasoning"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "goal_reached",
            description: "Call this when the objective has been fully completed based on the detected elements and previous actions.",
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
            description: "Scroll the page up or down to reveal hidden content.",
            parameters: {
                type: "object",
                properties: {
                    direction: { type: "string", enum: ["up", "down"], description: "Direction to scroll" },
                    amount: { type: "string", enum: ["small", "medium", "large"], description: "Amount of scroll" },
                    reasoning: { type: "string", description: "Why scrolling is needed" }
                },
                required: ["direction", "reasoning"]
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
            description: "Call this when the objective has been fully completed.",
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
                    amount: { type: "string", enum: ["small", "medium", "large"] },
                    reasoning: { type: "string" }
                },
                required: ["direction", "reasoning"]
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
     * Run intelligent AX detection using AxExtractionAgent
     * The agent will use GPT-4.1 to diagnose problems and search the web for solutions
     */
    async _runAxDetection(appName = null) {
        console.log('🤖 [ScreenAgent] Running intelligent AX extraction...');

        try {
            const result = await this.axAgent.extract(appName);

            if (result.error || !result.snapshot || result.snapshot.length === 0) {
                console.warn('⚠️ [ScreenAgent] AX Agent returned error:', result.error);
                return null;
            }

            // Normalize elements to match expected format
            const elements = result.snapshot.map(e => ({
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
        this.currentApp = app; // Track current app context
        console.log(`🖥️ [ScreenAgent] Starting HYBRID action loop: "${goal}" in ${app}`);

        this._notify('action-status', { phase: 'starting', goal, app });

        try {
            await this._openApp(app);
            await this._wait(1500);

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
- Si la fuente es 'AX_ACCESSIBILITY', los IDs y coordenadas son EXACTOS (Ground Truth). Confía plenamente en ellos.
- Si la fuente es 'VISION' (YOLO), los elementos son aproximados.

ACCIONES DISPONIBLES (ordenadas por preferencia):
1. perform_set_of_actions([...]): EJECUTA UNA SECUENCIA. Úsalo siempre para acciones múltiples (ej: marcar dígitos, navegar menús). ES MUCHO MÁS RÁPIDO.
2. switch_app("NombreApp"): Cambia de aplicación. Úsalo si el objetivo requiere otra app.
3. select_element(#id): Click simple (paso a paso).
4. type_text("texto"): Escribir.
5. key_press("tecla"): Pulsar tecla especial (enter, escape, etc).
6. need_visual_inspection(reason): Fallback visual.

Prioriza siempre select_element (o perform_set_of_actions) sobre inspección visual.

IMPORTANTE SOBRE MULTI-APP:
Si la tarea requiere múltiples apps (ej: "Abrir X y luego Y"), usa 'switch_app' cuando termines con la primera.

IMPORTANTE SOBRE VELOCIDAD:
¡USA 'perform_set_of_actions' SIEMPRE QUE SEA SEGURO! 
Si ves los botones [5], [+], [5]... ¡Oprímelos todos en un solo llamado! No hagas uno por uno.`
                }
            ];

            let historyHint = '';

            // Loop detection: track element state changes
            let lastElementsHash = null;
            let sameStateCount = 0;
            const LOOP_THRESHOLD = 3; // 3 clicks without progress = loop

            while (iteration < this.maxIterations && !goalReached) {
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
                let llmElements = elements;
                if (elements.length > 0) {
                    console.log(`🧠 [ScreenAgent] Formalizing graph with ${elements.length} raw nodes...`);
                    llmElements = GraphFormalizer.optimize(elements);
                    console.log(`📉 [ScreenAgent] Graph formalized: ${elements.length} -> ${llmElements.length} meaningful nodes`);
                }

                // 5. Format elements list for LLM
                const elementsText = llmElements.length > 0
                    ? llmElements.map(e => `  #${e.id} [${e.label}] (${e.type}) bbox=[${e.bbox.x.toFixed(2)},${e.bbox.y.toFixed(2)}]`).join('\n')
                    : '  (No se detectaron elementos UI relevantes)';

                // 6. Send element list to LLM (text-only, no image)
                const appInstructions = this._getAppSpecificInstructions(this.currentApp, elements);

                somMessages.push({
                    role: "user",
                    content: `Iteración ${iteration}/${this.maxIterations}. Objetivo: "${goal}"

Elementos UI detectados en pantalla (${elements.length} total) [Fuente: ${detectionResult.source || 'VISION'}]:
${elementsText}${historyHint}${loopWarning}${appInstructions}

¿Qué acción ejecutar?`
                });

                console.log(`📤 [ScreenAgent] Sending to LLM: ${elements.length} elements, tool_choice=required`);
                console.log(`📋 [ScreenAgent] Tools available: ${SOM_TOOLS.map(t => t.function.name).join(', ')}`);

                const somResponse = await this._retryWithBackoff(() => ModelSwitch.chatCompletion({
                    messages: somMessages,
                    tools: SOM_TOOLS,
                    tool_choice: "required",
                    max_tokens: 4096  // Increased for GPT-5-mini to generate complete tool calls
                }), 3);

                console.log(`📥 [ScreenAgent] LLM Response:`, JSON.stringify({
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


                    // Handle actions
                    let actionSummary = '';

                    if (fnName === 'select_element') {
                        const targetElement = elements.find(e => e.id == args.element_id);
                        if (!targetElement) {
                            console.warn(`⚠️ [ScreenAgent] Element #${args.element_id} not found in detection results`);
                            actionSummary = `SELECT #${args.element_id} — NOT FOUND`;
                        } else {
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

                            const label = `${targetElement.label || targetElement.type} #${targetElement.id}`;
                            console.log(`🎯 [ScreenAgent] Click on #${targetElement.id} [${label}] at pixel (${px}, ${py})`);

                            await this._executeToolDirect('click', { px, py, label });
                            actionSummary = `SELECT #${targetElement.id} [${label}]`;
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
                            await this._wait(2000); // Wait for app to open/focus

                            this.currentApp = args.app_name; // Update context
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

                        // Refocus ONCE before batch
                        await this._ensureFocus(this.currentApp);

                        for (let j = 0; j < subActions.length; j++) {
                            const sub = subActions[j];
                            const stepStr = `Step ${j + 1}/${subActions.length}`;

                            if (sub.action === 'click') {
                                const targetElement = elements.find(e => e.id == sub.element_id);
                                if (!targetElement) {
                                    console.warn(`⚠️ [ScreenAgent] ${stepStr}: Element #${sub.element_id} not found`);
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
                                if (px < 1 && py < 1) { px = Math.round(px * this.screenWidth); py = Math.round(py * this.screenHeight); }

                                await this._executeToolDirect('click', { px, py, label: `Sequence #${sub.element_id}` }, true); // true = skipFocus
                                await this._wait(600); // Slightly faster in batch
                            }
                            else if (sub.action === 'type') {
                                await this._executeTool('type_text', { text: sub.text }, true);
                                await this._wait(300);
                            }
                            else if (sub.action === 'key') {
                                await this._executeTool('key_press', { key: sub.key }, true);
                                await this._wait(300);
                            }
                        }
                        actionSummary = `BATCH: Executed ${subActions.length} actions (${args.reasoning})`;
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

                    // Wait between batched actions
                    if (i < toolCalls.length - 1) {
                        await this._wait(500);
                    } else {
                        await this._wait(1000);
                    }
                }

                this._trimSomMessages(somMessages);
                if (screenshotPath) {
                    try { fs.unlinkSync(screenshotPath); } catch (e) { }
                }
            }

            if (!goalReached) {
                console.warn(`⚠️ [ScreenAgent] Stopped after ${iteration} iterations without reaching goal`);
                this._notify('action-status', { phase: 'incomplete', iterations: iteration });
            }

            return { success: goalReached, iterations: iteration, summary: actionResult };


        } catch (e) {
            console.error('❌ [ScreenAgent] Action loop failed:', e);
            this._notify('action-status', { phase: 'error', error: e.message });
            return { success: false, error: e.message };
        } finally {
            this.isRunning = false;
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
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
            await mouse.setPosition(new Point(targetX, targetY));

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
            if (!skipFocus) await this._ensureFocus(this.currentApp);

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
                // Use human-like move for the final approach too
                await this._humanLikeMove(args.px, args.py, 1.1); // slightly faster for click
                await this._wait(50);
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

            // Spanish to English app name mappings for macOS
            const appMappings = {
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
                'Terminal': 'Terminal'
            };

            // Normalize app name
            const normalizedApp = appMappings[appName] || appName;

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
                setTimeout(() => {
                    exec(cmdActivate, (err2) => {
                        if (err2) {
                            console.warn(`⚠️ [ScreenAgent] 'activate' script failed for "${normalizedApp}":`, err2.message);
                        } else {
                            console.log(`👆 [ScreenAgent] Activated "${normalizedApp}" via AppleScript`);
                        }

                        // Final delay to ensure UI animation completes
                        setTimeout(resolve, 1000);
                    });
                }, 500);
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

            // Map common names if needed (reuse _openApp mappings logic if moved to shared helper, 
            // but for now assume appName is correct or we use simple mapping)
            const appMappings = {
                'Calculadora': 'Calculator',
                'Calendario': 'Calendar',
                'Contactos': 'Contacts',
                'Notas': 'Notes',
                'Música': 'Music',
                'Fotos': 'Photos',
                'Mapas': 'Maps',
                'Terminal': 'Terminal'
            };
            const normalized = appMappings[appName] || appName;

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
            if (!skipFocus) await this._ensureFocus(this.currentApp);

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
                // Use human-like move
                await this._humanLikeMove(px, py, 1.1);
                await this._wait(50);
                await mouse.click(Button.LEFT);

            } else if (fnName === 'type_text') {
                console.log(`⌨️ [ScreenAgent] Typing "${args.text.substring(0, 40)}${args.text.length > 40 ? '...' : ''}" into "${args.label}"`);
                await keyboard.type(args.text);

            } else if (fnName === 'key_press') {
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
     * Simple async wait.
     */
    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    /**
     * Stop the current action loop.
     */
    stop() {
        this.isRunning = false;
        console.log('🛑 [ScreenAgent] Action loop stopped by user');
        this._notify('action-status', { phase: 'stopped' });
    }
}

module.exports = ScreenAgent;

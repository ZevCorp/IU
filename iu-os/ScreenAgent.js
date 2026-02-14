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
                    key: { type: "string", enum: ["enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right"], description: "The key to press" },
                    label: { type: "string", description: "Short description of why pressing this key" },
                    reasoning: { type: "string", description: "Why this key press advances the goal" }
                },
                required: ["key", "label", "reasoning"]
            }
        }
    },
    // TEMPORARILY DISABLED TO SAVE TOKENS - Need visual inspection fallback
    /*
    {
        type: "function",
        function: {
            name: "need_visual_inspection",
            description: "Request to see the actual screenshot when the detected elements list is incomplete or unclear. Use this when you suspect there are important UI elements not detected by the detector, or when you need to visually verify the current state of the screen. This will show you the real screenshot so you can provide precise coordinates.",
            parameters: {
                type: "object",
                properties: {
                    reason: { type: "string", description: "Why you need to see the screenshot (e.g., 'The search bar should be visible but is not in the detected elements')" }
                },
                required: ["reason"]
            }
        }
    },
    */
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
                    key: { type: "string", enum: ["enter", "tab", "escape", "backspace", "delete", "up", "down", "left", "right"], description: "The key to press" },
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
        console.log(`🖥️ [ScreenAgent] Starting HYBRID action loop: "${goal}" in ${app}`);

        this._notify('action-status', { phase: 'starting', goal, app });

        try {
            await this._openApp(app);
            await this._wait(1500);

            let iteration = 0;
            let goalReached = false;
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
APP: "${app}"
PASOS: "${stepsHint}"

MODO HÍBRIDO (AX + Vision):
Recibirás una lista de elementos UI.
- Si la fuente es 'AX_ACCESSIBILITY', los IDs y coordenadas son EXACTOS (Ground Truth). Confía plenamente en ellos.
- Si la fuente es 'VISION' (YOLO), los elementos son aproximados.

ACCIONES:
1. select_element(#id): Click exacto en el elemento.
2. type_text("texto"): Escribir en el foco actual.
3. need_visual_inspection(reason): Si no ves lo que buscas en la lista.

Prioriza siempre select_element sobre inspección visual si el elemento está en la lista.`
                }
            ];

            let historyHint = '';

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
                    detectionResult = await this._runAxDetection(app);
                    if (detectionResult && detectionResult.elements.length > 0) break;
                    console.log(`⏳ [ScreenAgent] AX Retry ${i + 1}/3...`);
                    await this._wait(1500);
                }

                if (detectionResult && detectionResult.elements.length > 0) {
                    console.log(`✅ [ScreenAgent] AX Graph extracted: ${detectionResult.elements.length} nodes`);
                    // Save the successful graph
                    this._saveGraph(detectionResult.app, detectionResult.window, detectionResult.elements);
                } else {
                    console.error(`🔴 [ScreenAgent] CRITICAL: AX Failed after 3 retries. Fallback DISABLED.`);
                    // FORCE AX: fallback DISABLED per user request
                    detectionResult = { elements: [], source: 'AX_FAILED' };
                }

                const elements = detectionResult?.elements || [];
                // ... continue to LLM logic using 'elements' ...

                // 5. Format elements list for LLM
                const elementsText = elements.length > 0
                    ? elements.map(e => `  #${e.id} [${e.label}] (${e.type}) bbox=[${e.bbox.x.toFixed(2)},${e.bbox.y.toFixed(2)}]`).join('\n')
                    : '  (No se detectaron elementos UI)';

                // 6. Send element list to LLM (text-only, no image)
                somMessages.push({
                    role: "user",
                    content: `Iteración ${iteration}/${this.maxIterations}. Objetivo: "${goal}"

Elementos UI detectados en pantalla (${elements.length} total) [Fuente: ${detectionResult.source || 'VISION'}]:
${elementsText}${historyHint}

¿Qué acción ejecutar?`
                });

                console.log(`📤 [ScreenAgent] Sending to LLM: ${elements.length} elements, tool_choice=required`);
                console.log(`📋 [ScreenAgent] Tools available: ${SOM_TOOLS.map(t => t.function.name).join(', ')}`);

                const somResponse = await this._retryWithBackoff(() => ModelSwitch.chatCompletion({
                    messages: somMessages,
                    tools: SOM_TOOLS,
                    tool_choice: "required",
                    max_tokens: 2000  // Increased for GPT-5-mini to generate complete tool calls
                }), 3);

                console.log(`📥 [ScreenAgent] LLM Response:`, JSON.stringify({
                    hasToolCalls: !!somResponse.choices[0]?.message?.tool_calls,
                    toolCallCount: somResponse.choices[0]?.message?.tool_calls?.length || 0,
                    finishReason: somResponse.choices[0]?.finish_reason,
                    messageContent: somResponse.choices[0]?.message?.content?.substring(0, 100)
                }));

                const somChoice = somResponse.choices[0];
                const somToolCall = somChoice.message.tool_calls?.[0];

                if (!somToolCall) {
                    console.warn('⚠️ [ScreenAgent] No tool call returned from SoM');
                    break;
                }

                somMessages.push(somChoice.message);

                const fnName = somToolCall.function.name;
                const args = JSON.parse(somToolCall.function.arguments);
                console.log(`🎯 [ScreenAgent] SoM decision: ${fnName}: ${JSON.stringify(args)}`);

                somMessages.push({
                    role: "tool",
                    tool_call_id: somToolCall.id,
                    content: "OK",
                    _functionName: fnName
                });

                // Handle goal_reached
                if (fnName === 'goal_reached') {
                    goalReached = true;
                    console.log(`✅ [ScreenAgent] Goal reached: ${args.summary}`);
                    this._notify('action-status', { phase: 'completed', goal });
                    break;
                }

                // DISABLED: Visual inspection fallback (saves tokens)
                /*
                if (fnName === 'need_visual_inspection') {
                    console.log(`👁️ [ScreenAgent] Visual inspection requested: ${args.reason}`);
                    const visualResult = await this._visualFallbackIteration(
                        screenshotPath, goal, app, stepsHint, actionHistory, iteration
                    );
                    if (visualResult.goalReached) {
                        goalReached = true;
                        break;
                    }
                    if (visualResult.summary) {
                        actionHistory.push({ iteration, summary: `[VISUAL] ${visualResult.summary}` });
                        somMessages.push({
                            role: "user",
                            content: `[Resultado de inspección visual]: Se ejecutó: ${visualResult.summary}`
                        });
                    }
                    await this._wait(1000);
                    this._trimSomMessages(somMessages);
                    // try { fs.unlinkSync(screenshotPath); } catch (e) { }
                    continue;
                }
                */

                // Handle select_element — deterministic click
                if (fnName === 'select_element') {
                    const targetElement = elements.find(e => e.id == args.element_id);
                    if (!targetElement) {
                        console.warn(`⚠️ [ScreenAgent] Element #${args.element_id} not found in detection results`);
                        actionHistory.push({ iteration, summary: `SELECT #${args.element_id} — NOT FOUND` });
                    } else {
                        // AX elements usually have 'center' pre-calculated
                        let px, py;
                        if (targetElement.center) {
                            px = targetElement.center.x;
                            py = targetElement.center.y;
                        } else if (targetElement.bbox) {
                            px = targetElement.bbox.x * this.screenWidth + (targetElement.bbox.w * this.screenWidth / 2);
                            py = targetElement.bbox.y * this.screenHeight + (targetElement.bbox.h * this.screenHeight / 2);
                        }

                        // Denormalize if normalized
                        if (px < 1 && py < 1) {
                            px = Math.round(px * this.screenWidth);
                            py = Math.round(py * this.screenHeight);
                        }

                        const label = `${targetElement.label || targetElement.type} #${targetElement.id}`;
                        console.log(`🎯 [ScreenAgent] Click on #${targetElement.id} [${label}] at pixel (${px}, ${py})`);

                        /*
                        await this._saveDebugScreenshot(
                            fs.readFileSync(screenshotPath).toString('base64'),
                            { x: px, y: py, label }, iteration
                        );
                        */
                        await this._executeToolDirect('click', { px, py, label });
                        actionHistory.push({ iteration, summary: `SELECT #${targetElement.id} [${label}]` });
                    }
                }
                // Handle type_text
                else if (fnName === 'type_text') {
                    await this._executeTool('type_text', args);
                    actionHistory.push({ iteration, summary: `TYPE "${args.text}"` });
                }
                // Handle key_press
                else if (fnName === 'key_press') {
                    await this._executeTool('key_press', args);
                    actionHistory.push({ iteration, summary: `KEY ${args.key}` });
                }

                this._notify('action-status', { phase: 'acting', action: actionHistory[actionHistory.length - 1]?.summary });
                await this._wait(fnName === 'select_element' ? 1000 : 800);
                this._trimSomMessages(somMessages);
                if (screenshotPath) {
                    try { fs.unlinkSync(screenshotPath); } catch (e) { }
                }
            }

            if (!goalReached) {
                console.warn(`⚠️ [ScreenAgent] Stopped after ${iteration} iterations without reaching goal`);
                this._notify('action-status', { phase: 'incomplete', iterations: iteration });
            }

            return { success: goalReached, iterations: iteration };

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
     * Execute a click at exact pixel coordinates (used by SoM select_element).
     * No normalization needed — coordinates come directly from YOLO bounding boxes.
     */
    async _executeToolDirect(fnName, args) {
        try {
            const { mouse, Button, Point } = await this._getNutJS();

            if (fnName === 'click') {
                console.log(`🖱️ [ScreenAgent] Deterministic click "${args.label}" at pixel (${args.px}, ${args.py})`);
                await mouse.setPosition(new Point(args.px, args.py));
                await this._wait(100);
                await mouse.click(Button.LEFT);
            }
        } catch (e) {
            console.error('❌ [ScreenAgent] Execute direct tool failed:', e.message);
        }
    }

    /**
     * Trim SoM conversation to keep it manageable (keep last N user messages).
     */
    _trimSomMessages(messages) {
        const maxUserMessages = 6; // keep last 6 iterations
        let userCount = 0;
        for (let i = messages.length - 1; i >= 1; i--) {
            if (messages[i].role === 'user') {
                userCount++;
                if (userCount > maxUserMessages) {
                    // Remove this message and everything before it (except system)
                    messages.splice(1, i);
                    break;
                }
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
                'FaceTime': 'FaceTime'
            };

            // Normalize app name
            const normalizedApp = appMappings[appName] || appName;

            const cmd = `open -a "${normalizedApp}"`;
            console.log(`📱 [ScreenAgent] Opening app: ${cmd}`);
            exec(cmd, (err) => {
                if (err) {
                    console.warn(`⚠️ [ScreenAgent] Could not open "${normalizedApp}":`, err.message);
                }
                resolve();
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
    async _executeTool(fnName, args) {
        try {
            const { mouse, keyboard, Button, Key, Point } = await this._getNutJS();

            if (fnName === 'click') {
                // Denormalize from 0-1 to pixel coordinates
                const px = Math.round(args.x * this.screenWidth);
                const py = Math.round(args.y * this.screenHeight);
                console.log(`🖱️ [ScreenAgent] Clicking "${args.label}" at normalized (${args.x.toFixed(3)}, ${args.y.toFixed(3)}) → pixel (${px}, ${py})`);
                await mouse.setPosition(new Point(px, py));
                await this._wait(100);
                await mouse.click(Button.LEFT);

            } else if (fnName === 'type_text') {
                console.log(`⌨️ [ScreenAgent] Typing "${args.text.substring(0, 40)}${args.text.length > 40 ? '...' : ''}" into "${args.label}"`);
                await keyboard.type(args.text);

            } else if (fnName === 'key_press') {
                const keyMap = {
                    enter: Key.Enter, tab: Key.Tab, escape: Key.Escape,
                    backspace: Key.Backspace, delete: Key.Delete,
                    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right
                };
                const key = keyMap[args.key];
                if (key) {
                    console.log(`⌨️ [ScreenAgent] Pressing key: ${args.key} — ${args.label}`);
                    await keyboard.pressKey(key);
                    await keyboard.releaseKey(key);
                } else {
                    console.warn(`⚠️ [ScreenAgent] Unknown key: ${args.key}`);
                }
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
     * Stop the current action loop.
     */
    stop() {
        this.isRunning = false;
        console.log('🛑 [ScreenAgent] Action loop stopped by user');
        this._notify('action-status', { phase: 'stopped' });
    }
}

module.exports = ScreenAgent;

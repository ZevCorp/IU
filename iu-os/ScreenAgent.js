/**
 * ScreenAgent.js
 * Unified visual action loop: screenshot → GPT-4.1-mini (vision + function calling) → execute → repeat
 * Single model sees the screen, reasons, and calls tools (click/type/done) in one shot.
 */

const { screen } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Function calling tools for the unified model
const ACTION_TOOLS = [
    {
        type: "function",
        function: {
            name: "click",
            description: "Click on a UI element at the given pixel coordinates. Use this to press buttons, select items, open menus, focus input fields, etc.",
            parameters: {
                type: "object",
                properties: {
                    x: { type: "number", description: "X coordinate in pixels (use the grid overlay for precision)" },
                    y: { type: "number", description: "Y coordinate in pixels (use the grid overlay for precision)" },
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
            description: "Type text into the currently focused input field. IMPORTANT: You must click on the input field FIRST in a previous iteration before typing. Do NOT click and type in the same iteration.",
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
    {
        type: "function",
        function: {
            name: "goal_reached",
            description: "Call this when the objective has been fully completed. Only call when you can visually confirm the goal is done.",
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
    constructor(openai, mainWindow) {
        this.openai = openai;
        this.mainWindow = mainWindow;
        this.isRunning = false;
        this.maxIterations = 15;
        this.nutjs = null;
        this.debugDir = path.join(require('os').homedir(), 'u_debug');
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
     * Main action loop. Single GPT-4.1-mini call per iteration: sees screen + calls tools.
     */
    async executeAction(goal, app, stepsHint) {
        if (this.isRunning) {
            console.log('⚠️ [ScreenAgent] Already running an action');
            return { success: false, error: 'Already executing an action' };
        }

        this.isRunning = true;
        console.log(`🖥️ [ScreenAgent] Starting action loop: "${goal}" in ${app}`);

        this._notify('action-status', { phase: 'starting', goal, app });

        try {
            await this._openApp(app);
            await this._wait(1500);

            let iteration = 0;
            let goalReached = false;
            const actionHistory = [];

            // Conversation history for the model (persists across iterations)
            const messages = [
                {
                    role: "system",
                    content: `Eres un agente de automatización de interfaces gráficas. Controlas el mouse y teclado de una Mac.

OBJETIVO: "${goal}"
APP: "${app}"
PASOS SUGERIDOS: "${stepsHint}"

En cada turno recibirás un screenshot de la pantalla con una cuadrícula de coordenadas superpuesta:
- Líneas rojas cada 100px, etiquetas amarillas cada 200px
- Borde superior: coordenadas X (0, 200, 400, ...)
- Borde izquierdo: coordenadas Y (200, 400, ...)
- Usa la cuadrícula para estimar coordenadas PRECISAS de los elementos.

REGLAS:
1. Llama UNA función por turno. Analiza la pantalla y decide la MEJOR acción siguiente.
2. Para escribir en un campo: primero CLICK en el campo (un turno), luego TYPE_TEXT (siguiente turno).
3. NUNCA hagas click en el mismo lugar dos veces seguidas sin razón. Pero SÍ reintenta si la acción anterior NO tuvo efecto visible.
4. Si el objetivo ya se cumplió visualmente, llama goal_reached.
5. Sé preciso con las coordenadas. Usa la cuadrícula como referencia.
6. Después de escribir texto, usa key_press con "enter" si necesitas enviar/confirmar.

VERIFICACIÓN OBLIGATORIA (MUY IMPORTANTE):
- ANTES de avanzar al siguiente paso, VERIFICA en el screenshot actual que tu acción ANTERIOR realmente tuvo efecto.
- Si hiciste CLICK en un chat/contacto: verifica que la conversación se abrió (debe verse el historial de mensajes y el campo de texto).
- Si hiciste CLICK en un campo de texto: verifica que el cursor está activo en ese campo.
- Si hiciste TYPE_TEXT: verifica que el texto aparece escrito en el campo.
- Si la acción anterior NO tuvo el efecto esperado (la pantalla se ve igual o diferente a lo esperado), REPITE la acción con coordenadas corregidas o intenta una alternativa.
- NUNCA asumas que una acción funcionó. SIEMPRE confirma visualmente en el screenshot.`
                }
            ];

            while (iteration < this.maxIterations && !goalReached) {
                iteration++;
                console.log(`🔄 [ScreenAgent] Iteration ${iteration}/${this.maxIterations}`);
                this._notify('action-status', { phase: 'analyzing', iteration });

                // Take screenshot
                const screenshotBase64 = await this._takeScreenshot();
                if (!screenshotBase64) {
                    console.error('❌ [ScreenAgent] Screenshot failed');
                    break;
                }

                // Build history hint
                let historyHint = '';
                if (actionHistory.length > 0) {
                    historyHint = '\n\nAcciones realizadas hasta ahora:\n' + actionHistory.map(h => `  ${h.iteration}. ${h.summary}`).join('\n');
                }

                // Add screenshot as user message
                messages.push({
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${screenshotBase64}`,
                                detail: "high"
                            }
                        },
                        {
                            type: "text",
                            text: `Iteración ${iteration}/${this.maxIterations}. Analiza la pantalla y ejecuta la siguiente acción para lograr: "${goal}"${historyHint}`
                        }
                    ]
                });

                // Single GPT-4.1-mini call with vision + function calling
                const response = await this.openai.chat.completions.create({
                    model: "gpt-4.1-mini",
                    messages,
                    tools: ACTION_TOOLS,
                    tool_choice: "required",
                    max_tokens: 500
                });

                const choice = response.choices[0];
                const toolCall = choice.message.tool_calls?.[0];

                if (!toolCall) {
                    console.warn('⚠️ [ScreenAgent] No tool call returned');
                    break;
                }

                // Add assistant response to conversation
                messages.push(choice.message);

                const fnName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🎯 [ScreenAgent] ${fnName}: ${JSON.stringify(args)}`);

                // Add tool result to conversation
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: "OK"
                });

                // Handle goal_reached
                if (fnName === 'goal_reached') {
                    goalReached = true;
                    console.log(`✅ [ScreenAgent] Goal reached: ${args.summary}`);
                    this._notify('action-status', { phase: 'completed', goal });
                    break;
                }

                // Track action
                let summary = '';
                if (fnName === 'click') summary = `CLICK "${args.label}" en (${args.x}, ${args.y})`;
                else if (fnName === 'type_text') summary = `TYPE "${args.text}" en "${args.label}"`;
                else if (fnName === 'key_press') summary = `KEY ${args.key} — ${args.label}`;
                actionHistory.push({ iteration, summary });

                // Save debug screenshot
                if (fnName === 'click') {
                    await this._saveDebugScreenshot(screenshotBase64, { x: args.x, y: args.y, label: args.label }, iteration);
                }

                // Execute the action
                this._notify('action-status', { phase: 'acting', action: summary });
                await this._executeTool(fnName, args);

                // Wait for UI to update
                await this._wait(fnName === 'click' ? 1000 : 800);

                // Trim old image messages to save tokens (keep last 3 screenshots)
                this._trimMessages(messages);
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
            // Try common app name mappings
            const cmd = `open -a "${appName}"`;
            console.log(`📱 [ScreenAgent] Opening app: ${cmd}`);
            exec(cmd, (err) => {
                if (err) {
                    console.warn(`⚠️ [ScreenAgent] Could not open "${appName}":`, err.message);
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
            // Downscale to logical resolution so grid coordinates match nut-js click coordinates.
            const primaryDisplay = screen.getPrimaryDisplay();
            const scaleFactor = primaryDisplay.scaleFactor || 1;
            const displaySize = primaryDisplay.size; // logical size
            let imgBuffer = rawBuffer;
            if (scaleFactor > 1) {
                const meta = await sharp(rawBuffer).metadata();
                // Use actual display logical size (not image/scaleFactor) for perfect calibration
                imgBuffer = await sharp(rawBuffer).resize(displaySize.width, displaySize.height).png().toBuffer();
                console.log(`📐 [ScreenAgent] Downscaled ${meta.width}x${meta.height} → ${displaySize.width}x${displaySize.height} (display logical size)`);
            }

            // Overlay coordinate grid for precise GPT-4V targeting
            const gridBuffer = await this._overlayGrid(imgBuffer);

            const base64 = gridBuffer.toString('base64');
            console.log(`📸 [ScreenAgent] Screenshot taken (${Math.round(gridBuffer.length / 1024)}KB, grid overlay applied)`);
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
     * Execute a tool call from the unified model.
     */
    async _executeTool(fnName, args) {
        try {
            const { mouse, keyboard, Button, Key, Point } = await this._getNutJS();

            if (fnName === 'click') {
                console.log(`🖱️ [ScreenAgent] Clicking "${args.label}" at (${args.x}, ${args.y})`);
                await mouse.setPosition(new Point(args.x, args.y));
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
     * Overlay a coordinate grid on the screenshot so GPT-4V can accurately locate pixel positions.
     * Draws lines every 100px, labels every 200px on edges.
     */
    async _overlayGrid(pngBuffer) {
        const meta = await sharp(pngBuffer).metadata();
        const w = meta.width;
        const h = meta.height;
        const step = 100;

        // Build SVG overlay with grid lines + coordinate labels
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;

        // Vertical lines + top labels (label every 200px, line every 100px)
        for (let x = 0; x <= w; x += step) {
            const isMajor = x % 200 === 0;
            svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,0,0,${isMajor ? '0.4' : '0.2'})" stroke-width="${isMajor ? 1 : 0.5}"/>`;
            if (isMajor) {
                svg += `<rect x="${x + 1}" y="1" width="${String(x).length * 8 + 6}" height="14" fill="rgba(0,0,0,0.7)" rx="2"/>`;
                svg += `<text x="${x + 4}" y="12" font-family="Helvetica" font-size="10" font-weight="bold" fill="#ff0" letter-spacing="0">${x}</text>`;
            }
        }

        // Horizontal lines + left labels (label every 200px, line every 100px)
        for (let y = 0; y <= h; y += step) {
            const isMajor = y % 200 === 0;
            svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,0,0,${isMajor ? '0.4' : '0.2'})" stroke-width="${isMajor ? 1 : 0.5}"/>`;
            if (isMajor && y > 0) {
                svg += `<rect x="1" y="${y + 1}" width="${String(y).length * 8 + 6}" height="14" fill="rgba(0,0,0,0.7)" rx="2"/>`;
                svg += `<text x="4" y="${y + 12}" font-family="Helvetica" font-size="10" font-weight="bold" fill="#ff0" letter-spacing="0">${y}</text>`;
            }
        }

        svg += `</svg>`;

        const gridOverlay = Buffer.from(svg);

        const result = await sharp(pngBuffer)
            .composite([{ input: gridOverlay, top: 0, left: 0 }])
            .png()
            .toBuffer();

        return result;
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

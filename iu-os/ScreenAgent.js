/**
 * ScreenAgent.js
 * Visual action loop: screenshot → GPT-4V (mark affordances) → GPT-5-Mini (choose click) → execute click → repeat
 * "El sistema no sabe hacer nada, pero lo puede hacer todo"
 */

const { screen } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

class ScreenAgent {
    constructor(openai, mainWindow) {
        this.openai = openai;
        this.mainWindow = mainWindow;
        this.isRunning = false;
        this.maxIterations = 15;
        this.nutjs = null;
        this.debugDir = path.join(require('electron').app.getPath('temp'), 'u_debug');
    }

    /**
     * Lazy-load nut-js (native module, load only when needed)
     */
    async _getNutJS() {
        if (!this.nutjs) {
            const { mouse, keyboard, screen: nutScreen, Button, Key, Point } = require('@nut-tree-fork/nut-js');
            // Configure nut-js
            mouse.config.autoDelayMs = 100;
            keyboard.config.autoDelayMs = 50;
            this.nutjs = { mouse, keyboard, screen: nutScreen, Button, Key, Point };
        }
        return this.nutjs;
    }

    /**
     * Main action loop. Runs until goal is reached or max iterations.
     */
    async executeAction(goal, app, stepsHint) {
        if (this.isRunning) {
            console.log('⚠️ [ScreenAgent] Already running an action');
            return { success: false, error: 'Already executing an action' };
        }

        this.isRunning = true;
        console.log(`🖥️ [ScreenAgent] Starting action loop: "${goal}" in ${app}`);

        // Notify renderer: U looks at screen
        this._notify('action-status', { phase: 'starting', goal, app });

        try {
            // Step 1: Open the app
            await this._openApp(app);
            await this._wait(1500);

            let iteration = 0;
            let goalReached = false;
            const actionHistory = []; // Track what we've done so far

            while (iteration < this.maxIterations && !goalReached) {
                iteration++;
                console.log(`🔄 [ScreenAgent] Iteration ${iteration}/${this.maxIterations}`);

                // Notify renderer: looking at screen
                this._notify('action-status', { phase: 'analyzing', iteration });

                // Step 2: Take screenshot (hide U window first)
                const screenshotBase64 = await this._takeScreenshot();
                if (!screenshotBase64) {
                    console.error('❌ [ScreenAgent] Screenshot failed');
                    break;
                }

                // Step 3: GPT-4V analyzes screenshot, marks affordances
                const analysis = await this._analyzeScreen(screenshotBase64, goal, app, stepsHint);
                if (!analysis) {
                    console.error('❌ [ScreenAgent] Screen analysis failed');
                    break;
                }

                // Check if goal is reached
                if (analysis.goal_reached) {
                    goalReached = true;
                    console.log('✅ [ScreenAgent] Goal reached!');
                    this._notify('action-status', { phase: 'completed', goal });
                    break;
                }

                if (!analysis.affordances || analysis.affordances.length === 0) {
                    console.warn('⚠️ [ScreenAgent] No affordances found');
                    break;
                }

                // Step 4: GPT-5-Mini chooses which affordance to interact with
                const action = await this._chooseAction(analysis.affordances, goal, stepsHint, iteration, actionHistory, analysis.current_state);
                if (!action) {
                    console.error('❌ [ScreenAgent] Action choice failed');
                    break;
                }

                // Track this action in history
                actionHistory.push({
                    iteration,
                    action: action.action,
                    label: action.label,
                    text: action.text || null,
                    x: action.x,
                    y: action.y
                });

                // Save debug screenshot with crosshair at click point
                await this._saveDebugScreenshot(screenshotBase64, action, iteration);

                // Step 5: Execute the action (click or type)
                this._notify('action-status', { phase: 'acting', action: action.label });
                await this._executeAction(action);

                // Wait for UI to update after action
                await this._wait(action.wait_after || 1000);
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
            // Show U window again
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show();
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
     * Send screenshot to GPT-4V to identify clickable affordances and their coordinates.
     */
    async _analyzeScreen(screenshotBase64, goal, app, stepsHint) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [
                    {
                        role: "system",
                        content: `Eres un analizador de interfaces gráficas. Tu trabajo es:
1. Mirar el screenshot de la pantalla del usuario.
2. Identificar TODOS los elementos clickeables visibles (botones, links, iconos, campos de texto, tabs, etc.) — estos son "affordances".
3. Para cada affordance, dar: label descriptivo, tipo (button/link/input/icon/tab/menu), coordenadas x,y del centro del elemento en píxeles.
4. Determinar si el objetivo del usuario YA se cumplió mirando el estado actual de la pantalla.

El objetivo del usuario es: "${goal}"
La app objetivo es: "${app}"
Pasos sugeridos: "${stepsHint}"

COORDENADAS — CUADRÍCULA DE REFERENCIA:
La imagen tiene una cuadrícula roja superpuesta con etiquetas de coordenadas cada 200 píxeles.
- En el borde superior: etiquetas X (0, 200, 400, 600, ...)
- En el borde izquierdo: etiquetas Y (200, 400, 600, ...)
- Usa estas líneas y etiquetas como referencia para dar coordenadas PRECISAS.
- Para encontrar la coordenada de un elemento, ubica las líneas de cuadrícula más cercanas y estima la posición exacta entre ellas.
- Ejemplo: si un botón está a mitad de camino entre la línea x=400 y x=600, su x es ~500.

Responde ÚNICAMENTE con JSON válido:
{
  "goal_reached": false,
  "current_state": "Descripción breve de lo que se ve en pantalla",
  "affordances": [
    { "id": 1, "label": "Botón Enviar", "type": "button", "x": 500, "y": 300 },
    { "id": 2, "label": "Campo de búsqueda", "type": "input", "x": 200, "y": 50 }
  ]
}

IMPORTANTE:
- USA LA CUADRÍCULA para dar coordenadas precisas en píxeles absolutos.
- Solo incluye affordances VISIBLES y RELEVANTES para el objetivo (máximo 15).
- Si el objetivo ya se cumplió (ej: el mensaje fue enviado, la app está abierta en la vista correcta), pon goal_reached: true.`
                    },
                    {
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
                                text: `Analiza esta pantalla. Objetivo: "${goal}". App: "${app}".`
                            }
                        ]
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 2000
            });

            const result = JSON.parse(response.choices[0].message.content);
            console.log(`🔍 [ScreenAgent] Analysis: ${result.affordances?.length || 0} affordances found. Goal reached: ${result.goal_reached}`);
            console.log(`📄 [ScreenAgent] State: ${result.current_state}`);
            return result;

        } catch (e) {
            console.error('❌ [ScreenAgent] Screen analysis failed:', e.message);
            return null;
        }
    }

    /**
     * GPT-5-Mini chooses which affordance to click/interact with.
     */
    async _chooseAction(affordances, goal, stepsHint, iteration, actionHistory = [], currentState = '') {
        try {
            // Build history summary for context
            let historyText = 'Ninguna (primera iteración)';
            if (actionHistory.length > 0) {
                historyText = actionHistory.map(h => {
                    if (h.action === 'type') return `  ${h.iteration}. TYPE "${h.text}" en "${h.label}"`;
                    return `  ${h.iteration}. CLICK en "${h.label}" (${h.x}, ${h.y})`;
                }).join('\n');
            }

            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1-mini",
                messages: [
                    {
                        role: "system",
                        content: `Eres un agente que decide qué acción tomar en una interfaz gráfica.
Recibes:
- El ESTADO ACTUAL de la pantalla (descripción de lo que se ve)
- Una lista de affordances (elementos interactuables) con sus coordenadas
- El historial de acciones que ya realizaste

Tu trabajo es elegir UNA acción que te acerque al objetivo.

REGLAS CRÍTICAS:
1. LEE EL ESTADO ACTUAL primero. Si el objetivo ya está parcialmente logrado (ej: el chat correcto ya está abierto), NO repitas pasos ya completados. Avanza al SIGUIENTE paso lógico.
2. Si ya hiciste CLICK en un campo de texto/input/búsqueda en la iteración anterior, la siguiente acción DEBE ser TYPE con el texto necesario.
3. Cuando la acción es "type", DEBES incluir el campo "text" con el texto a escribir.
4. NUNCA hagas click en el mismo elemento dos veces seguidas.
5. Si el chat/conversación correcta ya está abierta, busca el campo de mensaje y escribe directamente. NO busques el contacto de nuevo.
6. Piensa paso a paso: ¿qué paso me falta para completar el objetivo?

Responde ÚNICAMENTE con JSON:
{
  "affordance_id": 1,
  "label": "Nombre del elemento elegido",
  "action": "click" | "type",
  "text": "texto a escribir (OBLIGATORIO si action es type)",
  "x": 500,
  "y": 300,
  "reasoning": "Por qué elegí este elemento",
  "wait_after": 1000
}

- wait_after: ms a esperar (1000 default, 2000 si carga página).
- Para escribir en un campo: action="type", text="lo que quieres escribir", x e y del campo.`
                    },
                    {
                        role: "user",
                        content: `Objetivo: "${goal}"
Pasos sugeridos: "${stepsHint}"
Iteración actual: ${iteration}

📄 ESTADO ACTUAL DE LA PANTALLA:
${currentState}

📋 Historial de acciones previas:
${historyText}

🎯 Affordances disponibles:
${JSON.stringify(affordances, null, 2)}

Basándote en el ESTADO ACTUAL, ¿qué acción tomo ahora para avanzar hacia el objetivo? No repitas pasos ya logrados.`
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 500
            });

            const action = JSON.parse(response.choices[0].message.content);
            console.log(`🎯 [ScreenAgent] Chose: "${action.label}" (${action.action}) at (${action.x}, ${action.y}) — ${action.reasoning}`);
            return action;

        } catch (e) {
            console.error('❌ [ScreenAgent] Action choice failed:', e.message);
            return null;
        }
    }

    /**
     * Execute a click or type action using nut-js.
     */
    async _executeAction(action) {
        try {
            const { mouse, keyboard, Button, Key, Point } = await this._getNutJS();

            if (action.action === 'click') {
                console.log(`🖱️ [ScreenAgent] Clicking at (${action.x}, ${action.y})`);
                await mouse.setPosition(new Point(action.x, action.y));
                await this._wait(100);
                await mouse.click(Button.LEFT);

            } else if (action.action === 'type') {
                if (action.x && action.y) {
                    // Click on the field first
                    console.log(`🖱️ [ScreenAgent] Clicking field at (${action.x}, ${action.y})`);
                    await mouse.setPosition(new Point(action.x, action.y));
                    await this._wait(100);
                    await mouse.click(Button.LEFT);
                    await this._wait(200);
                }

                if (action.text) {
                    console.log(`⌨️ [ScreenAgent] Typing: "${action.text.substring(0, 40)}..."`);
                    await keyboard.type(action.text);
                }
            }

        } catch (e) {
            console.error('❌ [ScreenAgent] Execute action failed:', e.message);
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

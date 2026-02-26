const { screen, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ModelSwitch = require('./ModelSwitch');
const StickyFaceController = require('./StickyFaceController');

class LearningAgent {
    constructor() {
        this.isLearning = false;
        this.axAgent = null;
        this.currentWorkflow = {
            name: '',
            trigger: '',
            notes: [],
            steps: []
        };
        this.historyDir = path.join(app.getPath('userData'), 'workflows');
        this.screenshotsDir = path.join(this.historyDir, 'screenshots');

        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
        if (!fs.existsSync(this.screenshotsDir)) {
            fs.mkdirSync(this.screenshotsDir, { recursive: true });
        }
    }

    setup(axAgent) {
        this.axAgent = axAgent;
    }

    startLearning(workflowName = 'New Workflow') {
        this.isLearning = true;
        this.currentWorkflow = {
            name: workflowName,
            createdAt: new Date().toISOString(),
            notes: [],
            steps: []
        };
        console.log(`🎓 [LearningAgent] Started learning session: ${workflowName}`);

        // Appear as the floating face (work mode look)
        StickyFaceController.start();
        StickyFaceController.setExpression('thinking'); // Learning face
    }

    async recordCurrentState(description) {
        if (!this.isLearning) return null;

        const cursor = screen.getCursorScreenPoint();
        console.log(`🎓 [LearningAgent] Recording state for: "${description}" at (${cursor.x}, ${cursor.y})`);

        // Immediate visual acknowledgement: keep green until brain comment is ready.
        this.showCaptureFeedbackPending();

        // Take snapshot (Silent so user isn't disturbed)
        const shotName = `step_${Date.now()}.png`;
        const shotPath = path.join(this.screenshotsDir, shotName);
        try {
            exec(`screencapture -x "${shotPath}"`);
        } catch (e) {
            console.warn('⚠️ [LearningAgent] Screenshot failed');
        }

        let element = null;
        if (this.axAgent) {
            try {
                const result = await this.axAgent.hitTest(cursor.x, cursor.y);
                if (result && result.error) {
                    console.warn(`⚠️ [LearningAgent] Hit test error: ${result.error}`);
                }
                element = this.normalizeHitElement(result, cursor);

                // Fallback: if hit-test has no useful element, pick nearest from full AX snapshot.
                if (!element && this.axAgent.extract) {
                    const full = await this.axAgent.extract();
                    element = this.pickClosestElementFromSnapshot(full, cursor);
                    if (element) {
                        console.log(`🎯 [LearningAgent] Fallback nearest/inside element: ${element.label || 'sin label'} (${element.role || element.type || 'unknown'})`);
                    }
                }
                if (element) {
                    element = this.enrichElement(element, cursor);
                }

                if (element) {
                    console.log(`🎓 [LearningAgent] Hit UI Element: ${element.label || 'sin label'} -> ${element.canonicalLabel || 'sin canon'} (${element.role || element.type || 'unknown'}) [zone=${element.zone || 'n/a'} app=${element.app || 'Unknown'}]`);
                } else {
                    console.warn('⚠️ [LearningAgent] No AX element resolved for this click');
                }
            } catch (e) {
                console.warn(`⚠️ [LearningAgent] Hit test failed: ${e.message}`);
            }
        }

        // BRAIN INTERPRETATION
        // We wait for the LLM here, giving the "thinking" expression time to be seen
        const interpretation = await this.interpretInteraction(description, element);

        // End pending state when comment arrives.
        this.showCaptureFeedbackResolved(interpretation);

        return await this.addStep(description, cursor, element, shotPath, interpretation);
    }

    showCaptureFeedbackPending() {
        StickyFaceController.setFaceColor('#00ff00');
        StickyFaceController.setExpression('thinking');
    }

    showCaptureFeedbackResolved(interpretation) {
        StickyFaceController.setExpression('happy');
        StickyFaceController.showMessage(`🧠 ${interpretation}`);

        setTimeout(() => {
            if (!this.isLearning) return;
            StickyFaceController.setFaceColor('#ffffff');
            StickyFaceController.setExpression('thinking');
        }, 1500);
    }

    async interpretInteraction(description, element) {
        try {
            const elementLabel = (element && element.label ? String(element.label).trim() : '');
            const canonicalLabel = (element && element.canonicalLabel ? String(element.canonicalLabel).trim() : '');
            const elementRole = (element && element.role ? String(element.role).trim() : '');
            const elementType = (element && element.type ? String(element.type).trim() : '');
            const elementApp = (element && element.app ? String(element.app).trim() : '');
            const elementBbox = (element && element.bbox ? JSON.stringify(element.bbox) : '');
            const elementZone = (element && element.zone ? String(element.zone).trim() : '');
            const objectiveHint = (element && element.objectiveHint ? String(element.objectiveHint).trim() : '');

            const contextInfo = element
                ? `Elemento observado: label="${elementLabel || 'sin texto'}", label_canonic="${canonicalLabel || 'sin canon'}", rol="${elementRole || 'desconocido'}", tipo="${elementType || 'desconocido'}", zona="${elementZone || 'desconocida'}", app="${elementApp || 'desconocida'}", objective_hint="${objectiveHint || 'continuar el flujo'}", bbox=${elementBbox || '{}'}.`
                : `No se detectó un control específico en el hit test.`;

            const latestNotes = (this.currentWorkflow.notes || [])
                .slice(-3)
                .map((n, i) => `${i + 1}. ${n}`)
                .join('\n');

            const systemPrompt = `Eres un asistente en modo aprendizaje de interfaz.
Debes responder SIEMPRE una sola oración breve en español, nunca vacía.
Formato obligatorio exacto:
"Hiciste clic en <elemento> para <objetivo probable>."
Para <elemento>, prefiere label_canonic si existe.
Para <objetivo probable>, usa primero objective_hint si tiene sentido.
Si no puedes inferir objetivo, usa "continuar el flujo".
No uses comillas ni listas.`;

            const userPrompt = `Acción observada: "${description}".
${contextInfo}
Notas del usuario sobre el flujo:
${latestNotes || 'Sin notas adicionales.'}
Redacta la oración exacta en el formato obligatorio.`;

            const response = await ModelSwitch.chatCompletion({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 80,
                temperature: 0.1
            });

            const content = response.choices[0].message.content || "";
            const cleaned = content.replace(/"/g, '').replace(/\s+/g, ' ').trim();
            const finalInterpretation = cleaned || this.buildFallbackInterpretation(description, element);

            console.log(`🎓 [LearningBrain] Intent decoded: "${finalInterpretation}"`);
            return finalInterpretation;
        } catch (e) {
            console.error('❌ [LearningBrain] Interpretation failure:', e.message);
            return this.buildFallbackInterpretation(description, element);
        }
    }

    buildFallbackInterpretation(description, element) {
        const role = element && element.role ? String(element.role).toLowerCase() : '';
        const label = element && element.canonicalLabel
            ? String(element.canonicalLabel).trim()
            : (element && element.label ? String(element.label).trim() : '');
        const app = element && element.app ? String(element.app).trim() : '';
        const targetBase = label || (role ? `un ${role}` : 'un elemento de la interfaz');
        const target = app ? `${targetBase} en ${app}` : targetBase;
        const rawGoal = (element && element.objectiveHint)
            ? String(element.objectiveHint).trim()
            : 'continuar el flujo';
        return `Hiciste clic en ${target} para ${rawGoal}.`;
    }

    normalizeHitElement(result, cursor) {
        if (!result || !Array.isArray(result.snapshot) || result.snapshot.length === 0) return null;
        const raw = result.snapshot[0];
        const label = raw && raw.label ? String(raw.label).replace(/[\u200E\u200F\u202A-\u202E]/g, '').trim() : '';
        const role = raw && raw.role ? String(raw.role).trim() : '';
        const type = raw && raw.type ? String(raw.type).trim() : '';
        const app = raw && raw.app ? String(raw.app).trim() : (result.app || '');

        const unknownRole = !role || role === 'AXUnknown';
        const uselessLabel = !label || label === 'AXUnknown' || label.toLowerCase() === 'unknown';
        if (unknownRole && uselessLabel) {
            return null;
        }

        return {
            ...raw,
            label: label || null,
            role: role || null,
            type: type || null,
            app: app || null,
            click: { x: cursor.x, y: cursor.y }
        };
    }

    pickClosestElementFromSnapshot(result, cursor) {
        if (!result || !Array.isArray(result.snapshot) || result.snapshot.length === 0) return null;

        const screenSize = screen.getPrimaryDisplay().workAreaSize;
        const toPx = (bbox) => {
            if (!bbox) return null;
            const x = Number(bbox.x || 0) * screenSize.width;
            const y = Number(bbox.y || 0) * screenSize.height;
            const w = Number(bbox.w || 0) * screenSize.width;
            const h = Number(bbox.h || 0) * screenSize.height;
            return { x, y, w, h, cx: x + (w / 2), cy: y + (h / 2) };
        };

        let best = null;
        let bestDist = Infinity;
        let bestInside = null;
        let bestInsideArea = Infinity;
        for (const item of result.snapshot) {
            const rect = toPx(item.bbox);
            if (!rect) continue;
            const contains = cursor.x >= rect.x && cursor.x <= rect.x + rect.w && cursor.y >= rect.y && cursor.y <= rect.y + rect.h;
            if (contains) {
                const area = rect.w * rect.h;
                if (area < bestInsideArea) {
                    bestInsideArea = area;
                    bestInside = item;
                }
            }
            const dx = rect.cx - cursor.x;
            const dy = rect.cy - cursor.y;
            const dist = Math.hypot(dx, dy);
            if (dist < bestDist) {
                bestDist = dist;
                best = item;
            }
        }
        const chosen = bestInside || best;
        if (!chosen) return null;

        if (!bestInside && bestDist > 140) {
            const zone = this.inferZone(cursor.x, cursor.y);
            return {
                id: 'background',
                label: `fondo de ${zone}`,
                canonicalLabel: `fondo ${zone}`,
                role: 'AXGroup',
                type: 'group',
                app: result.app || null,
                bbox: null,
                click: { x: cursor.x, y: cursor.y },
                zone,
                objectiveHint: zone === 'sidebar' ? 'seleccionar un elemento en la lista' : 'enfocar la zona activa'
            };
        }

        return {
            ...chosen,
            app: (chosen.app || result.app || null),
            click: { x: cursor.x, y: cursor.y }
        };
    }

    enrichElement(element, cursor) {
        const canonicalLabel = this.normalizeLabel(element.label, element.role, element.type, element.app);
        const zone = this.inferZone(cursor.x, cursor.y);
        const objectiveHint = this.inferObjectiveFromElement({ ...element, canonicalLabel, zone });
        return {
            ...element,
            canonicalLabel,
            zone,
            objectiveHint
        };
    }

    normalizeLabel(label, role, type, app) {
        const raw = String(label || '')
            .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const lower = raw.toLowerCase();
        if (lower.includes('compose message') || lower.includes('write a message') || lower.includes('mensaje')) {
            return 'campo de mensaje';
        }
        if (lower.includes('search')) return 'campo de búsqueda';
        if (lower.includes('chat') && (type === 'menu' || type === 'button')) return 'chat en lista';
        if (lower.includes('your message') || lower.includes('delivered') || lower.includes('sent to')) {
            return 'mensaje en conversación';
        }
        if (!raw) {
            if (type === 'input') return 'campo de texto';
            if (type === 'button') return 'botón';
            if (type === 'menu') return 'elemento de lista';
            if (role) return String(role).replace(/^AX/, '').toLowerCase();
            return app ? `elemento en ${app}` : 'elemento de interfaz';
        }
        if (raw.length > 72) {
            const cut = raw.split(',')[0].trim();
            return cut || raw.slice(0, 72);
        }
        return raw;
    }

    inferZone(x, y) {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const xr = x / Math.max(1, width);
        const yr = y / Math.max(1, height);
        if (yr > 0.82) return 'bottom';
        if (yr < 0.17) return 'top';
        if (xr < 0.33) return 'sidebar';
        return 'content';
    }

    inferObjectiveFromElement(element) {
        const label = String(element.canonicalLabel || element.label || '').toLowerCase();
        const type = String(element.type || '').toLowerCase();
        const zone = String(element.zone || '').toLowerCase();

        if (type === 'input' || label.includes('campo de mensaje') || label.includes('campo de texto')) {
            return 'escribir texto';
        }
        if (zone === 'sidebar' || label.includes('chat en lista') || label.includes('contacto')) {
            return 'cambiar conversación';
        }
        if (label.includes('mensaje en conversación') || zone === 'content') {
            return 'enfocar la conversación activa';
        }
        if (zone === 'top') return 'abrir opciones de la vista';
        if (zone === 'bottom') return 'preparar entrada de texto';
        return 'continuar el flujo';
    }

    addTeachingNote(note) {
        if (!this.isLearning) return;
        const cleaned = String(note || '').trim();
        if (!cleaned) return;
        if (!this.currentWorkflow.notes) this.currentWorkflow.notes = [];
        this.currentWorkflow.notes.push(cleaned);
        console.log(`🎓 [LearningAgent] Teaching note added: "${cleaned.substring(0, 120)}"`);
    }

    async addStep(description, mousePos, element, screenshot = null, interpretation = null) {
        if (!this.isLearning) return;

        const step = {
            timestamp: new Date().toISOString(),
            description,
            mousePos,
            element: element || null,
            semantic: element ? {
                canonicalLabel: element.canonicalLabel || null,
                zone: element.zone || null,
                objectiveHint: element.objectiveHint || null
            } : null,
            screenshot,
            interpretation: interpretation || this.buildFallbackInterpretation(description, element),
            app: element ? element.app : 'Unknown'
        };

        this.currentWorkflow.steps.push(step);
        console.log(`🎓 [LearningAgent] Step added: ${description} at (${mousePos.x}, ${mousePos.y})`);

        return step;
    }

    async stopLearning() {
        if (!this.isLearning) return null;
        this.isLearning = false;

        StickyFaceController.setExpression('idle');
        setTimeout(() => StickyFaceController.stop(), 2000);

        const workflow = this.currentWorkflow;

        // Final synthesis using LLM to create logical rules/conditionals
        const synthesized = await this.synthesizeWorkflow(workflow);

        const fileName = `${workflow.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.json`;
        const filePath = path.join(this.historyDir, fileName);

        fs.writeFileSync(filePath, JSON.stringify(synthesized, null, 2));
        console.log(`🎓 [LearningAgent] Workflow saved and synthesized: ${filePath}`);

        return synthesized;
    }

    async synthesizeWorkflow(rawWorkflow) {
        console.log('🎓 [LearningAgent] Synthesizing workflow logic with LLM...');

        const systemPrompt = `Eres un experto en automatización de UI. 
Tu tarea es convertir una secuencia de "pasos enseñados por el usuario" en una "Receta de Automatización" (JSON) que el sistema pueda ejecutar después.

Analiza los pasos, las capturas de la interfaz y las explicaciones del usuario.
Identifica:
1. El ACTIVADOR (trigger): ¿Bajo qué condición debe ejecutarse esto?
2. Los PASOS LÓGICOS: Clics, escritura, esperas.
3. CONDICIONALES: "Si aparece X, haz Y".

Formatea el resultado como un JSON estructurado listo para ActionPlanner.`;

        const prompt = `Workflow Name: ${rawWorkflow.name}\nSteps recorded:\n${JSON.stringify(rawWorkflow.steps, null, 2)}`;

        try {
            const response = await ModelSwitch.chatCompletion({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                // We could use response_format: { type: "json_object" } if using newer models
            });

            const result = response.choices[0].message.content;
            // Attempt to parse JSON from result if possible, else return as is
            return {
                raw: rawWorkflow,
                synthesized: result
            };
        } catch (e) {
            console.error('❌ [LearningAgent] Synthesis failed:', e.message);
            return { raw: rawWorkflow, error: e.message };
        }
    }
}

module.exports = new LearningAgent();

const fs = require('fs');
const path = require('path');

const DEFAULT_TEMPLATES = [
    {
        id: 'blank',
        title: '+',
        body: ''
    },
    {
        id: 'app-flow',
        title: 'Trabajo',
        body: [
            'Vas a ayudarme a sacar mi trabajo hasta el final, hasta que quede en una version que pase con 10/0 basado en la rubrica.',
            '',
            'El flujo para acceder a los trabajos: Esic.co > clic en menu hamburguesa > clic en estudiantes > clic en ubeflex> inicia sesion (si es necesario) > clic en Canvas > seleccion la materia Business Intelligence > tareas > ahi accedes al trabajo que queramos entregar, hay trabajos por entregar y ya entregados, enfoque en los proximos a entregar, y al entrar al un trabajo encuentras la rubrica y requisitos con los que vas a hacerlo.',
            '',
            'Una vez tienes esta info, vas al GPT personalizado https://chatgpt.com/g/g-69bd155654588191a34b6c3e1eb2fae1-esic-worker y le das las instrucciones. La informacion estructurada para trabajo, Solo el trabajo, no el relleno de respuesta de chatgpt, copia ese contenido del trabajo y pegalo en el archivo https://docs.google.com/document/d/1Ik61OixqQ_9zIfPl4UMPSKn876gJ5W4vkseh5gxxTgU/edit?usp=sharing y constantemente copia el contenido del documento hacia el GPT para actualizarle la ultima version del trabajo y de vuelta copia las mejoras que nos de el GPT y pegalo en el documento, el gpt te dira exactamente que parrafos reemplazar con sus reemplazos exactos.'
        ].join('\n')
    }
];

const DYNAMIC_KEYWORDS = [
    'materia',
    'curso',
    'asignatura',
    'tema',
    'consigna',
    'trabajo',
    'actividad',
    'fecha',
    'limite',
    'entrega',
    'profesor',
    'docente',
    'rubrica',
    'archivo',
    'formato'
];

const STABLE_KEYWORDS = [
    'canvas',
    'acceso',
    'flujo',
    'estilo',
    'preferencia',
    'tono',
    'criterio',
    'objetivo base'
];

class NotebookExecutionManager {
    constructor(options = {}) {
        this.storageDir = options.storageDir || path.join(process.cwd(), '.chat-notebooks');
        this.storagePath = path.join(this.storageDir, 'notebooks.json');
        this.modelSwitch = options.modelSwitch || null;
        this.isModelReady = options.isModelReady || (() => false);
        this.templates = options.templates || DEFAULT_TEMPLATES;
        this.now = options.now || (() => Date.now());
        this.archiveRetentionMs = options.archiveRetentionMs || (7 * 24 * 60 * 60 * 1000);
        this.store = null;
    }

    bootstrap() {
        this._ensureLoaded();
        return this.getState();
    }

    getState() {
        this._ensureLoaded();
        const activeTabs = this.store.tabs.filter((tab) => !tab.archivedAt);
        const activeExecutions = this.store.executions.filter((execution) => !execution.archivedAt);
        return {
            tabs: activeTabs.map((tab) => this._clone(tab)),
            executions: activeExecutions
                .slice()
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((execution) => this._clone(execution)),
            activeTabId: this.store.activeTabId,
            activeExecutionId: this.store.activeExecutionId,
            templates: this.templates.map((template) => ({
                id: template.id,
                title: template.title
            }))
        };
    }

    createTab(options = {}) {
        this._ensureLoaded();
        const template = this._resolveTemplate(options.templateId);
        const nowIso = new Date(this.now()).toISOString();
        const nextTitle = options.title !== undefined
            ? String(options.title || '').trim()
            : String(template.title || '').trim();
        const tab = {
            id: this._id('tab'),
            title: nextTitle,
            body: String(options.body || template.body || '').replace(/\r\n/g, '\n'),
            templateId: template.id,
            createdAt: nowIso,
            updatedAt: nowIso,
            variables: [],
            archivedAt: null
        };

        this.store.tabs.unshift(tab);
        const execution = this._createExecutionRecord(tab.id, { title: `Chat · ${tab.title}` });
        this.store.executions.unshift(execution);
        this.store.activeTabId = tab.id;
        this.store.activeExecutionId = execution.id;
        this._save();

        return {
            tab: this._clone(tab),
            execution: this._clone(execution),
            state: this.getState()
        };
    }

    updateTab(tabId, patch = {}) {
        this._ensureLoaded();
        const tab = this._findTab(tabId);
        if (!tab) return null;

        if (patch.title !== undefined) {
            tab.title = String(patch.title || '').trim();
        }
        if (patch.body !== undefined) {
            tab.body = String(patch.body || '').replace(/\r\n/g, '\n');
        }
        if (patch.templateId !== undefined) {
            tab.templateId = String(patch.templateId || tab.templateId || 'blank');
        }
        tab.updatedAt = new Date(this.now()).toISOString();
        this._refreshExecutionTitles(tab.id);
        this._save();
        return this._clone(tab);
    }

    archiveTab(tabId) {
        this._ensureLoaded();
        const tab = this._findTab(tabId);
        if (!tab || tab.archivedAt) return this.getState();

        const archivedAt = new Date(this.now()).toISOString();
        tab.archivedAt = archivedAt;
        tab.updatedAt = archivedAt;
        this.store.executions.forEach((execution) => {
            if (execution.tabId === tabId) {
                execution.archivedAt = archivedAt;
            }
        });

        const visibleTabs = this.store.tabs.filter((item) => !item.archivedAt);
        if (visibleTabs.length === 0) {
            const created = this.createTab({ templateId: 'blank', title: '+' });
            return created.state;
        }

        if (this.store.activeTabId === tabId) {
            this.store.activeTabId = visibleTabs[0].id;
        }

        const visibleExecutions = this.store.executions.filter((execution) => !execution.archivedAt && execution.tabId === this.store.activeTabId);
        this.store.activeExecutionId = visibleExecutions[0]?.id || null;
        this._save();
        return this.getState();
    }

    setActiveTab(tabId) {
        this._ensureLoaded();
        const tab = this._findTab(tabId);
        if (!tab || tab.archivedAt) return null;
        this.store.activeTabId = tabId;
        const activeExecution = this._findExecution(this.store.activeExecutionId);
        if (!activeExecution || activeExecution.archivedAt) {
            const fallback = this._findPreferredExecutionForTab(tabId);
            this.store.activeExecutionId = fallback ? fallback.id : null;
        }
        this._save();
        return this.getState();
    }

    setActiveExecution(executionId) {
        this._ensureLoaded();
        const execution = this._findExecution(executionId);
        if (!execution || execution.archivedAt) return null;
        this.store.activeExecutionId = execution.id;
        this.store.activeTabId = execution.tabId;
        this._save();
        return this.getState();
    }

    createExecution(options = {}) {
        this._ensureLoaded();
        const tabId = options.tabId || this.store.activeTabId;
        if (!this._findTab(tabId)) return null;

        const execution = this._createExecutionRecord(tabId, options);
        this.store.executions.unshift(execution);
        this.store.activeExecutionId = execution.id;
        this.store.activeTabId = tabId;
        this._save();

        return {
            execution: this._clone(execution),
            state: this.getState()
        };
    }

    reassignExecution(executionId, tabId) {
        this._ensureLoaded();
        const execution = this._findExecution(executionId);
        const tab = this._findTab(tabId);
        if (!execution || !tab) return null;

        execution.tabId = tab.id;
        execution.lastUsedAt = this.now();
        execution.title = this._buildExecutionTitle(tab.id, execution.messages);
        this.store.activeExecutionId = execution.id;
        this.store.activeTabId = tab.id;
        this._save();

        return {
            execution: this._clone(execution),
            state: this.getState()
        };
    }

    appendMessage(executionId, message = {}) {
        this._ensureLoaded();
        const execution = this._findExecution(executionId);
        if (!execution) return null;

        const text = String(message.text || '').trim();
        if (!text) return this._clone(execution);

        execution.messages.push({
            id: this._id('msg'),
            role: String(message.role || 'assistant'),
            text,
            kind: String(message.kind || 'chat'),
            createdAt: new Date(this.now()).toISOString()
        });
        execution.lastUsedAt = this.now();
        execution.status = String(message.status || execution.status || 'active');
        execution.title = this._buildExecutionTitle(execution.tabId, execution.messages);
        this.store.activeExecutionId = execution.id;
        this._save();
        return this._clone(execution);
    }

    updateExecutionStatus(executionId, status) {
        this._ensureLoaded();
        const execution = this._findExecution(executionId);
        if (!execution) return null;
        execution.status = String(status || execution.status || 'active');
        execution.lastUsedAt = this.now();
        this._save();
        return this._clone(execution);
    }

    toggleVariablePersistence(options = {}) {
        this._ensureLoaded();
        const tab = this._findTab(options.tabId || this.store.activeTabId);
        const execution = this._findExecution(options.executionId || this.store.activeExecutionId);
        const key = this._normalizeKey(options.key);
        const persistent = Boolean(options.persistent);

        if (!tab || !execution || !key) return null;

        const existing =
            this._getVariableByKey(tab.variables, key) ||
            this._getVariableByKey(execution.resolvedVariables, key) || {
                key,
                label: this._humanizeKey(key),
                value: '',
                confidence: 0.25,
                source: 'user'
            };

        const next = {
            ...existing,
            persistent,
            source: 'user',
            manualPersistence: true,
            updatedAt: new Date(this.now()).toISOString()
        };

        tab.variables = tab.variables.filter((variable) => variable.key !== key);
        execution.resolvedVariables = execution.resolvedVariables.filter((variable) => variable.key !== key);

        if (persistent) {
            tab.variables.push(next);
        } else {
            execution.resolvedVariables.push(next);
        }

        tab.updatedAt = new Date(this.now()).toISOString();
        execution.lastUsedAt = this.now();
        this._save();

        return {
            variable: this._clone(next),
            state: this.getState()
        };
    }

    async analyzeVariables(options = {}) {
        this._ensureLoaded();
        const tab = this._findTab(options.tabId || this.store.activeTabId);
        const execution = this._findExecution(options.executionId || this.store.activeExecutionId);
        if (!tab || !execution) return null;

        if (options.title !== undefined || options.body !== undefined) {
            this.updateTab(tab.id, {
                title: options.title !== undefined ? options.title : tab.title,
                body: options.body !== undefined ? options.body : tab.body
            });
        }

        const freshTab = this._findTab(tab.id);
        const freshExecution = this._findExecution(execution.id);
        const noteVariables = this._extractVariablesFromNote(freshTab);
        const messageVariables = this._extractVariablesFromMessages(freshExecution.messages, noteVariables);
        let merged = this._mergeVariableSets({
            tabVariables: freshTab.variables,
            executionVariables: freshExecution.resolvedVariables,
            noteVariables,
            messageVariables
        });

        let llmResult = null;
        if (this.isModelReady() && this.modelSwitch && options.allowLlm !== false) {
            llmResult = await this._analyzeVariablesWithLLM(freshTab, freshExecution, merged, options.trigger);
            if (llmResult && Array.isArray(llmResult.variables) && llmResult.variables.length > 0) {
                merged = this._mergeVariableSets({
                    tabVariables: freshTab.variables,
                    executionVariables: freshExecution.resolvedVariables,
                    noteVariables,
                    messageVariables,
                    llmVariables: llmResult.variables
                });
            }
        }

        const clarification = this._determineClarification(merged, llmResult);
        const persistentVariables = merged.filter((variable) => variable.persistent);
        const contextualVariables = merged.filter((variable) => !variable.persistent);

        freshTab.variables = persistentVariables.map((variable) => this._clone(variable));
        freshExecution.resolvedVariables = contextualVariables.map((variable) => this._clone(variable));
        freshTab.updatedAt = new Date(this.now()).toISOString();
        freshExecution.lastUsedAt = this.now();
        this._save();

        return {
            variables: merged.map((variable) => this._clone(variable)),
            needsClarification: clarification.needsClarification,
            clarificationPrompt: clarification.clarificationPrompt,
            explanation: llmResult?.explanation || clarification.explanation || '',
            tab: this._clone(freshTab),
            execution: this._clone(freshExecution)
        };
    }

    buildChatPayload(options = {}) {
        this._ensureLoaded();
        const tab = this._findTab(options.tabId || this.store.activeTabId);
        const execution = this._findExecution(options.executionId || this.store.activeExecutionId);
        if (!tab || !execution) return null;

        const persistentVariables = (tab.variables || []).filter((variable) => variable.value);
        const contextualVariables = (execution.resolvedVariables || []).filter((variable) => variable.value);

        let systemPrompt = String(options.baseSystemPrompt || '').trim();
        systemPrompt += `\n\nGUIA CENTRAL DE ESTA EJECUCION:\nTitulo: ${tab.title}\n${tab.body}`;

        if (persistentVariables.length > 0) {
            systemPrompt += `\n\nVARIABLES PERSISTENTES DE LA HOJA:\n${this._formatVariablesForPrompt(persistentVariables)}`;
        }

        if (contextualVariables.length > 0) {
            systemPrompt += `\n\nVARIABLES CONTEXTUALES DE ESTA EJECUCION:\n${this._formatVariablesForPrompt(contextualVariables)}`;
        }

        if (options.learnedWorkflowsText) {
            systemPrompt += `\n\nAPRENDIZAJES RELEVANTES DEL USUARIO:\n${options.learnedWorkflowsText}`;
        }

        if (options.longTermContext) {
            systemPrompt += `\n\nMEMORIA A LARGO PLAZO:\n${options.longTermContext}`;
        }

        const history = execution.messages.slice(-12).map((message) => ({
            role: message.role,
            content: message.text
        }));

        return {
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...history
            ],
            tab: this._clone(tab),
            execution: this._clone(execution)
        };
    }

    _ensureLoaded() {
        if (this.store) return;
        fs.mkdirSync(this.storageDir, { recursive: true });
        if (fs.existsSync(this.storagePath)) {
            this.store = this._sanitizeStore(JSON.parse(fs.readFileSync(this.storagePath, 'utf8')));
            this._purgeArchived();
            this._repairActivePointers();
            return;
        }

        this.store = this._buildInitialStore();
        this._save();
    }

    _buildInitialStore() {
        const template = this._resolveTemplate('app-flow');
        const nowIso = new Date(this.now()).toISOString();
        const tab = {
            id: this._id('tab'),
            title: template.title,
            body: template.body,
            templateId: template.id,
            createdAt: nowIso,
            updatedAt: nowIso,
            variables: [],
            archivedAt: null
        };
        const execution = this._createExecutionRecord(tab.id, { title: `Chat · ${tab.title}` });
        return {
            version: 1,
            activeTabId: tab.id,
            activeExecutionId: execution.id,
            tabs: [tab],
            executions: [execution]
        };
    }

    _sanitizeStore(store) {
        const safe = store && typeof store === 'object' ? store : {};
        const tabs = Array.isArray(safe.tabs) ? safe.tabs : [];
        const executions = Array.isArray(safe.executions) ? safe.executions : [];
        return {
            version: 1,
            activeTabId: safe.activeTabId || tabs[0]?.id || null,
            activeExecutionId: safe.activeExecutionId || executions[0]?.id || null,
            tabs: tabs.map((tab) => ({
                id: String(tab.id || this._id('tab')),
                title: String(tab.title ?? ''),
                body: String(tab.body || ''),
                templateId: String(tab.templateId || 'blank'),
                createdAt: tab.createdAt || new Date(this.now()).toISOString(),
                updatedAt: tab.updatedAt || new Date(this.now()).toISOString(),
                variables: Array.isArray(tab.variables) ? tab.variables.map((variable) => this._normalizeVariable(variable)) : [],
                archivedAt: tab.archivedAt || null
            })),
            executions: executions.map((execution) => ({
                id: String(execution.id || this._id('exec')),
                tabId: String(execution.tabId || tabs[0]?.id || ''),
                title: String(execution.title || 'Chat'),
                messages: Array.isArray(execution.messages) ? execution.messages.map((message) => ({
                    id: String(message.id || this._id('msg')),
                    role: String(message.role || 'assistant'),
                    text: String(message.text || ''),
                    kind: String(message.kind || 'chat'),
                    createdAt: message.createdAt || new Date(this.now()).toISOString()
                })) : [],
                resolvedVariables: Array.isArray(execution.resolvedVariables)
                    ? execution.resolvedVariables.map((variable) => this._normalizeVariable(variable))
                    : [],
                lastUsedAt: Number(execution.lastUsedAt || this.now()),
                status: this._normalizeExecutionStatus(execution.status),
                archivedAt: execution.archivedAt || null
            }))
        };
    }

    _save() {
        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2));
    }

    _resolveTemplate(templateId) {
        return this.templates.find((template) => template.id === templateId) || this.templates[0];
    }

    _createExecutionRecord(tabId, options = {}) {
        return {
            id: this._id('exec'),
            tabId,
            title: String(options.title || this._buildExecutionTitle(tabId, [])),
            messages: [],
            resolvedVariables: [],
            lastUsedAt: this.now(),
            status: 'idle',
            archivedAt: null
        };
    }

    _findTab(tabId) {
        return this.store.tabs.find((tab) => tab.id === tabId) || null;
    }

    _findExecution(executionId) {
        return this.store.executions.find((execution) => execution.id === executionId) || null;
    }

    _findPreferredExecutionForTab(tabId) {
        return this.store.executions
            .filter((execution) => execution.tabId === tabId && !execution.archivedAt)
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0] || null;
    }

    _refreshExecutionTitles(tabId) {
        const tab = this._findTab(tabId);
        if (!tab) return;
        this.store.executions.forEach((execution) => {
            if (execution.tabId === tabId) {
                execution.title = this._buildExecutionTitle(tabId, execution.messages);
            }
        });
    }

    _buildExecutionTitle(tabId, messages = []) {
        const tab = this._findTab(tabId);
        const label = tab ? tab.title : 'Chat';
        const firstUserMessage = (messages || []).find((message) => message.role === 'user' && message.text);
        if (!firstUserMessage) {
            return `Chat · ${label}`;
        }

        const cleaned = String(firstUserMessage.text || '')
            .replace(/\s+/g, ' ')
            .replace(/[.!?]+$/g, '')
            .trim();
        const seed = cleaned.split(/[,:;\n]/)[0].trim() || cleaned;
        const shortened = seed.length > 34 ? `${seed.slice(0, 34).trim()}...` : seed;
        return shortened || `Chat · ${label}`;
    }

    _purgeArchived() {
        const threshold = this.now() - this.archiveRetentionMs;
        const keepTabIds = new Set(
            this.store.tabs
                .filter((tab) => !tab.archivedAt || new Date(tab.archivedAt).getTime() >= threshold)
                .map((tab) => tab.id)
        );

        this.store.tabs = this.store.tabs.filter((tab) => keepTabIds.has(tab.id));
        this.store.executions = this.store.executions.filter((execution) => {
            if (!keepTabIds.has(execution.tabId)) return false;
            if (!execution.archivedAt) return true;
            return new Date(execution.archivedAt).getTime() >= threshold;
        });
    }

    _repairActivePointers() {
        const visibleTabs = this.store.tabs.filter((tab) => !tab.archivedAt);
        if (visibleTabs.length === 0) {
            this.store = this._buildInitialStore();
            return;
        }

        this.store.executions.forEach((execution) => {
            execution.status = this._normalizeExecutionStatus(execution.status);
        });

        if (!visibleTabs.some((tab) => tab.id === this.store.activeTabId)) {
            this.store.activeTabId = visibleTabs[0].id;
        }

        const visibleExecutions = this.store.executions.filter((execution) => !execution.archivedAt);
        const sameTabExecutions = visibleExecutions.filter((execution) => execution.tabId === this.store.activeTabId);
        if (!sameTabExecutions.some((execution) => execution.id === this.store.activeExecutionId)) {
            this.store.activeExecutionId = sameTabExecutions[0]?.id || null;
        }
    }

    _normalizeExecutionStatus(status) {
        const normalized = String(status || 'idle');
        if (normalized === 'waiting_clarification') return 'answered';
        return normalized;
    }

    _extractVariablesFromNote(tab) {
        const lines = String(tab.body || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        const variables = [];
        for (const line of lines) {
            const match = line.match(/^([^:]{2,60}):\s*(.*)$/);
            if (!match) continue;
            const label = match[1].trim();
            const value = match[2].trim();
            const key = this._normalizeKey(label);
            if (!key) continue;

            variables.push(this._normalizeVariable({
                key,
                label,
                value,
                confidence: value ? 0.82 : 0.4,
                persistent: this._defaultPersistenceForLabel(label, value),
                source: 'note',
                missing: !value,
                critical: this._isCriticalLabel(label)
            }));
        }
        return variables;
    }

    _extractVariablesFromMessages(messages, referenceVariables) {
        if (!Array.isArray(messages) || messages.length === 0) return [];
        const userTexts = messages
            .filter((message) => message.role === 'user')
            .slice(-6)
            .map((message) => message.text);

        if (userTexts.length === 0) return [];

        const combinedText = userTexts.join('\n');
        const keys = new Map();
        for (const variable of referenceVariables) {
            const inferred = this._inferValueForKey(variable.key, variable.label, combinedText);
            if (!inferred) continue;
            keys.set(variable.key, this._normalizeVariable({
                key: variable.key,
                label: variable.label,
                value: inferred,
                confidence: 0.68,
                persistent: false,
                source: 'chat',
                missing: false,
                critical: Boolean(variable.critical)
            }));
        }

        const genericCandidates = [
            ['materia_actual', 'Materia actual'],
            ['tipo_de_trabajo', 'Tipo de trabajo'],
            ['tema_o_consigna', 'Tema o consigna'],
            ['formato_requerido', 'Formato requerido'],
            ['fecha_limite', 'Fecha limite']
        ];

        for (const [key, label] of genericCandidates) {
            if (keys.has(key)) continue;
            const inferred = this._inferValueForKey(key, label, combinedText);
            if (!inferred) continue;
            keys.set(key, this._normalizeVariable({
                key,
                label,
                value: inferred,
                confidence: 0.62,
                persistent: false,
                source: 'chat',
                missing: false,
                critical: true
            }));
        }

        return Array.from(keys.values());
    }

    _inferValueForKey(key, label, text) {
        const lowerKey = String(key || '').toLowerCase();
        const lowerLabel = String(label || '').toLowerCase();
        const patterns = [];
        const postProcess = (rawValue) => {
            let value = String(rawValue || '').trim().replace(/[.]+$/, '');
            if (!value) return '';

            if (lowerKey.includes('materia') || lowerLabel.includes('materia') || lowerLabel.includes('curso')) {
                value = value.split(/\s+y\s+(?:el|la)\s+/i)[0].trim();
            }

            if (lowerKey.includes('tipo') || lowerLabel.includes('trabajo')) {
                value = value.replace(/^(?:un|una|el|la)\s+/i, '').trim();
            }

            return value;
        };

        if (lowerKey.includes('materia') || lowerLabel.includes('materia') || lowerLabel.includes('curso')) {
            patterns.push(/(?:materia|curso|asignatura)(?: actual)?\s*(?:es|:)?\s*([^\n\.,]+)/i);
            patterns.push(/para\s+(?:la\s+)?(?:materia|clase|asignatura)\s+([^\n\.,]+)/i);
        }
        if (lowerKey.includes('tipo') || lowerLabel.includes('trabajo')) {
            patterns.push(/(?:tipo de trabajo|trabajo|actividad)\s*(?:es|:)?\s*([^\n\.,]+)/i);
            patterns.push(/\b(ensayo|presentacion|presentación|tarea|proyecto|informe|laboratorio|quiz|resumen)\b/i);
        }
        if (lowerKey.includes('tema') || lowerKey.includes('consigna') || lowerLabel.includes('tema')) {
            patterns.push(/(?:tema|consigna|sobre)\s*(?:es|:)?\s*([^\n]+)/i);
        }
        if (lowerKey.includes('formato') || lowerLabel.includes('formato')) {
            patterns.push(/(?:formato|required|required|entrega)\s*(?:es|:)?\s*([^\n\.,]+)/i);
            patterns.push(/\b(apa|mla|ieee|pdf|word|docx|powerpoint|ppt)\b/i);
        }
        if (lowerKey.includes('fecha') || lowerKey.includes('limite') || lowerLabel.includes('fecha')) {
            patterns.push(/(?:fecha limite|fecha de entrega|entrega|vence|deadline)\s*(?:es|:|para)?\s*([^\n\.,]+)/i);
        }
        if (lowerKey.includes('profesor') || lowerKey.includes('docente')) {
            patterns.push(/(?:profesor|profesora|docente)\s*(?:es|:)?\s*([^\n\.,]+)/i);
        }

        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patterns.push(new RegExp(`${escapedLabel}\\s*(?:es|:)?\\s*([^\\n]+)`, 'i'));

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const value = postProcess(match[1] || match[0] || '');
            if (value) return value;
        }

        return '';
    }

    _mergeVariableSets(groups = {}) {
        const merged = new Map();
        const order = [
            ...(groups.noteVariables || []),
            ...(groups.messageVariables || []),
            ...(groups.llmVariables || []),
            ...(groups.executionVariables || []),
            ...(groups.tabVariables || [])
        ];

        for (const candidate of order) {
            const normalized = this._normalizeVariable(candidate);
            if (!normalized.key) continue;
            const existing = merged.get(normalized.key);
            if (!existing) {
                merged.set(normalized.key, normalized);
                continue;
            }

            const manualPersistence = Boolean(existing.manualPersistence || normalized.manualPersistence);
            const next = {
                ...existing,
                ...normalized,
                label: existing.label || normalized.label,
                confidence: Math.max(existing.confidence || 0, normalized.confidence || 0),
                persistent: manualPersistence
                    ? existing.persistent
                    : Boolean(normalized.persistent),
                manualPersistence
            };

            if (existing.value && !normalized.value) {
                next.value = existing.value;
            }
            if (!existing.value && normalized.value) {
                next.value = normalized.value;
            }
            if (existing.value && normalized.value && existing.value !== normalized.value) {
                const keepExistingLongPersistent =
                    Boolean(existing.persistent) &&
                    String(existing.value || '').length > 80 &&
                    ['note', 'user'].includes(String(existing.source || ''));

                if (!keepExistingLongPersistent) {
                    next.conflict = true;
                    next.conflictValues = Array.from(new Set([existing.value, normalized.value]));
                    next.source = normalized.source || existing.source;
                    if ((normalized.confidence || 0) >= (existing.confidence || 0)) {
                        next.value = normalized.value;
                    }
                }
            }

            merged.set(normalized.key, next);
        }

        return Array.from(merged.values())
            .map((variable) => this._normalizeVariable(variable))
            .sort((a, b) => Number(b.persistent) - Number(a.persistent) || a.label.localeCompare(b.label));
    }

    _determineClarification(variables, llmResult) {
        return {
            needsClarification: false,
            clarificationPrompt: '',
            explanation: ''
        };
    }

    _buildShortClarification(label) {
        const normalized = this._normalizeKey(label);
        if (normalized.includes('materia')) return '¿Que materia debo usar?';
        if (normalized.includes('tema') || normalized.includes('consigna')) return '¿Cual es el tema exacto?';
        if (normalized.includes('tipo') || normalized.includes('trabajo')) return '¿Que tipo de trabajo es?';
        if (normalized.includes('formato')) return '¿Que formato debo seguir?';
        if (normalized.includes('fecha') || normalized.includes('limite')) return '¿Cual es la fecha limite?';
        return `¿Que debo usar para ${String(label || 'esto').toLowerCase()}?`;
    }

    _sanitizeClarificationPrompt(prompt) {
        const compact = String(prompt || '')
            .replace(/\s+/g, ' ')
            .replace(/^pregunta\s*\d*[:.-]?\s*/i, '')
            .trim();

        if (!compact) return '';

        const firstQuestion = compact.match(/[^?]+\?/);
        const base = (firstQuestion ? firstQuestion[0] : compact.split(/[.!]/)[0]).trim();
        if (!base) return '';
        if (base.length <= 95) return base;

        const shortened = base.split(':')[0].trim();
        if (shortened.length <= 95) return `${shortened}?`.replace(/\?\?+$/, '?');
        return '';
    }

    async _analyzeVariablesWithLLM(tab, execution, heuristicVariables, trigger) {
        try {
            const response = await this.modelSwitch.chatCompletion({
                messages: [
                    {
                        role: 'system',
                        content: [
                            'Analiza una hoja de instrucciones y el chat actual.',
                            'Responde SOLO JSON valido.',
                            'Debes devolver un objeto con esta forma exacta:',
                            '{"variables":[{"key":"materia_actual","label":"Materia actual","value":"Business Intelligence","persistent":false,"confidence":0.72,"source":"inferred","critical":true}],"needsClarification":false,"clarificationPrompt":"","explanation":"..."}',
                            'No inventes variables innecesarias.',
                            'Solo marca needsClarification=true si falta un dato critico o si hay conflicto real.',
                            'Si haces una pregunta, debe ser muy corta: maximo 12 palabras.'
                        ].join('\n')
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            trigger: trigger || 'manual',
                            tab: {
                                title: tab.title,
                                body: tab.body.slice(0, 2400)
                            },
                            recentMessages: execution.messages.slice(-6).map((message) => ({
                                role: message.role,
                                text: message.text
                            })),
                            heuristicVariables: heuristicVariables.map((variable) => ({
                                key: variable.key,
                                label: variable.label,
                                value: variable.value,
                                persistent: variable.persistent,
                                critical: variable.critical
                            }))
                        })
                    }
                ],
                max_tokens: 300
            });

            const raw = response?.choices?.[0]?.message?.content || '';
            const parsed = this._extractJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            return {
                variables: Array.isArray(parsed.variables) ? parsed.variables.map((variable) => this._normalizeVariable(variable)) : [],
                needsClarification: Boolean(parsed.needsClarification),
                clarificationPrompt: String(parsed.clarificationPrompt || '').trim(),
                explanation: String(parsed.explanation || '').trim()
            };
        } catch (error) {
            console.warn('⚠️ [NotebookExecutionManager] Variable LLM analysis failed:', error.message);
            return null;
        }
    }

    _extractJson(text) {
        const raw = String(text || '').trim();
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) { }
        const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
        if (fenced && fenced[1]) {
            try {
                return JSON.parse(fenced[1]);
            } catch (_) { }
        }
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch (_) { }
        }
        return null;
    }

    _normalizeVariable(variable) {
        const key = this._normalizeKey(variable.key || variable.label);
        return {
            key,
            label: String(variable.label || this._humanizeKey(key)).trim() || this._humanizeKey(key),
            value: String(variable.value || '').trim(),
            confidence: Number(variable.confidence || 0),
            persistent: Boolean(variable.persistent),
            source: String(variable.source || 'inferred'),
            missing: Boolean(variable.missing),
            critical: variable.critical === undefined ? this._isCriticalLabel(variable.label || key) : Boolean(variable.critical),
            manualPersistence: Boolean(variable.manualPersistence),
            conflict: Boolean(variable.conflict),
            conflictValues: Array.isArray(variable.conflictValues) ? variable.conflictValues.slice(0, 3).map((value) => String(value)) : [],
            updatedAt: variable.updatedAt || new Date(this.now()).toISOString()
        };
    }

    _formatVariablesForPrompt(variables) {
        return variables
            .map((variable) => `- ${variable.label}: ${variable.value}`)
            .join('\n');
    }

    _getVariableByKey(variables, key) {
        return (variables || []).find((variable) => variable.key === key) || null;
    }

    _defaultPersistenceForLabel(label, value) {
        const normalized = this._normalizeKey(label);
        if (!value && DYNAMIC_KEYWORDS.some((keyword) => normalized.includes(keyword))) return false;
        if (STABLE_KEYWORDS.some((keyword) => normalized.includes(this._normalizeKey(keyword)))) return true;
        return !DYNAMIC_KEYWORDS.some((keyword) => normalized.includes(keyword));
    }

    _isCriticalLabel(label) {
        const normalized = this._normalizeKey(label);
        return DYNAMIC_KEYWORDS.some((keyword) => normalized.includes(keyword));
    }

    _normalizeKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80);
    }

    _humanizeKey(key) {
        return String(key || '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Variable';
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    _id(prefix) {
        return `${prefix}-${this.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
}

module.exports = NotebookExecutionManager;

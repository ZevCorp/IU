const fs = require('fs');
const path = require('path');

function uniqueIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean)));
}

function sanitizeMoney(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100) / 100;
}

function sanitizePositiveInt(value, fallback = 4, min = 1, max = 52) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function makePocketId() {
    return `pocket_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
}

function getDefaultFinanceDescription() {
    return [
        'Objetivo central: llevar tus finanzas a un flujo de bienestar con tranquilidad, buscando superávit y margen de tiempo.',
        '',
        'Reglas base del agente de finanzas:',
        '- Mantén sincronizados los bolsillos con el dinero real disponible en bancos y apps.',
        '- Usa este texto como instrucciones vivas: agrega decisiones, hábitos, criterios y feedback diario del usuario.',
        '- Prioriza acciones que aumenten holgura temporal entre ventas, cobros y gastos comprometidos.',
        '- Si la brecha futura se acorta, empuja cobros y delega al asistente principal acciones de ventas o seguimiento cuando haga falta.'
    ].join('\n');
}

function sanitizeFinancePocket(pocket = {}) {
    return {
        id: String(pocket?.id || makePocketId()).trim(),
        name: String(pocket?.name || '').trim() || 'Bolsillo',
        bank: String(pocket?.bank || '').trim(),
        purpose: String(pocket?.purpose || '').trim(),
        balance: sanitizeMoney(pocket?.balance)
    };
}

function createDefaultFinanceState() {
    return {
        version: 1,
        currency: 'COP',
        pockets: [],
        forecast: {
            expectedIncome: 0,
            expectedExpenses: 0,
            horizonWeeks: 4
        },
        timeline: {
            currentLabel: 'Tiempo actual',
            futureLabel: 'Tiempo futuro'
        },
        agentProfile: {
            mode: 'specialized_finance_agent',
            architecture: 'main-agent-compatible',
            tools: [
                'update_finance_instructions',
                'create_finance_pocket',
                'update_finance_pocket',
                'delete_finance_pocket',
                'deposit_finance_pocket',
                'withdraw_finance_pocket',
                'move_money_between_finance_pockets',
                'update_finance_projection'
            ]
        }
    };
}

function sanitizeFinanceState(finance = {}) {
    const base = createDefaultFinanceState();
    return {
        version: 1,
        currency: String(finance?.currency || base.currency).trim() || base.currency,
        pockets: uniqueIds((Array.isArray(finance?.pockets) ? finance.pockets : []).map((pocket) => sanitizeFinancePocket(pocket).id))
            .map((id) => (Array.isArray(finance?.pockets) ? finance.pockets : []).find((pocket) => String(pocket?.id || '').trim() === id))
            .filter(Boolean)
            .map((pocket) => sanitizeFinancePocket(pocket)),
        forecast: {
            expectedIncome: sanitizeMoney(finance?.forecast?.expectedIncome),
            expectedExpenses: sanitizeMoney(finance?.forecast?.expectedExpenses),
            horizonWeeks: sanitizePositiveInt(finance?.forecast?.horizonWeeks, base.forecast.horizonWeeks)
        },
        timeline: {
            currentLabel: String(finance?.timeline?.currentLabel || base.timeline.currentLabel).trim() || base.timeline.currentLabel,
            futureLabel: String(finance?.timeline?.futureLabel || base.timeline.futureLabel).trim() || base.timeline.futureLabel
        },
        agentProfile: {
            mode: String(finance?.agentProfile?.mode || base.agentProfile.mode).trim() || base.agentProfile.mode,
            architecture: String(finance?.agentProfile?.architecture || base.agentProfile.architecture).trim() || base.agentProfile.architecture,
            tools: uniqueIds(finance?.agentProfile?.tools || base.agentProfile.tools)
        }
    };
}

function createFixedFinanceMeta() {
    return {
        id: 'meta_finanzas',
        kind: 'finance',
        isFixed: true,
        title: 'Finanzas',
        description: getDefaultFinanceDescription(),
        noteIds: [],
        manualNoteIds: [],
        agentNoteIds: [],
        excludedNoteIds: [],
        learningLinks: [],
        isSaved: true,
        executionConfig: { type: 'recurrent', whenText: '', enabled: false },
        executionPromptPending: false,
        agentStatus: 'idle',
        agentLogs: [],
        finance: createDefaultFinanceState()
    };
}

class KnowledgeService {
    constructor(options = {}) {
        this.notebookManager = options.notebookManager;
        this.storageDir = options.storageDir || path.join(process.cwd(), '.chat-notebooks');
        this.storagePath = options.storagePath || path.join(this.storageDir, 'knowledge.json');
        this.now = options.now || (() => Date.now());
        this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
        this.store = null;
    }

    bootstrap() {
        this._ensureLoaded();
        this._cleanupAgainstNotes();
        this._ensureFixedMetas();
        this._save();
        return this.getMetas();
    }

    getMetas() {
        this._ensureLoaded();
        this._cleanupAgainstNotes();
        this._ensureFixedMetas();
        return this.store.metas.map((meta) => this._clone(meta));
    }

    setMetas(rawMetas = []) {
        this._ensureLoaded();
        const validNoteIds = this._getValidNoteIds();
        this.store.metas = (Array.isArray(rawMetas) ? rawMetas : [])
            .map((meta) => this._sanitizeMeta(meta, validNoteIds))
            .filter((meta) => meta.id);
        this._ensureFixedMetas();
        this._save();
        this._notifyChange({
            entity: 'knowledge',
            action: 'replace_metas',
            source: 'chat_window',
            metas: this.getMetas()
        });
        return this.getMetas();
    }

    createMeta(payload = {}) {
        this._ensureLoaded();
        const validNoteIds = this._getValidNoteIds();
        const meta = this._sanitizeMeta({
            id: `meta_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
            title: payload.title,
            description: payload.description,
            kind: payload.kind,
            isFixed: payload.isFixed,
            noteIds: payload.noteIds || [],
            manualNoteIds: payload.manualNoteIds || payload.noteIds || [],
            agentNoteIds: payload.agentNoteIds || [],
            excludedNoteIds: payload.excludedNoteIds || [],
            learningLinks: payload.learningLinks || [],
            isSaved: payload.isSaved !== undefined ? Boolean(payload.isSaved) : true,
            executionConfig: payload.executionConfig || { type: 'recurrent', whenText: '', enabled: false },
            executionPromptPending: Boolean(payload.executionPromptPending),
            agentStatus: payload.agentStatus || 'idle',
            agentLogs: payload.agentLogs || [],
            finance: payload.finance
        }, validNoteIds);
        this.store.metas.unshift(meta);
        this._ensureFixedMetas();
        this._save();
        const cloned = this._clone(meta);
        this._notifyChange({
            entity: 'meta',
            action: 'create',
            source: String(payload.source || 'unknown').trim() || 'unknown',
            runId: String(payload.runId || '').trim(),
            meta: cloned
        });
        return cloned;
    }

    updateMeta(metaId, patch = {}) {
        this._ensureLoaded();
        const idx = this.store.metas.findIndex((meta) => meta.id === String(metaId || '').trim());
        if (idx < 0) return null;
        const validNoteIds = this._getValidNoteIds();
        const source = String(patch.source || 'unknown').trim() || 'unknown';
        const runId = String(patch.runId || '').trim();
        const current = this.store.metas[idx];
        const merged = this._sanitizeMeta({
            ...current,
            ...patch,
            title: current?.isFixed ? current.title : patch.title !== undefined ? patch.title : current.title,
            kind: current?.kind || patch.kind,
            isFixed: current?.isFixed || Boolean(patch.isFixed),
            source: undefined,
            runId: undefined
        }, validNoteIds);
        this.store.metas[idx] = merged;
        this._ensureFixedMetas();
        this._save();
        const cloned = this._clone(merged);
        this._notifyChange({
            entity: 'meta',
            action: 'update',
            source,
            runId,
            meta: cloned
        });
        return cloned;
    }

    deleteMeta(metaId, options = {}) {
        this._ensureLoaded();
        const id = String(metaId || '').trim();
        const removed = this.store.metas.find((meta) => meta.id === id) || null;
        if (removed?.isFixed) return false;
        const before = this.store.metas.length;
        this.store.metas = this.store.metas.filter((meta) => meta.id !== id);
        const changed = this.store.metas.length !== before;
        if (changed) {
            this._ensureFixedMetas();
            this._save();
            this._notifyChange({
                entity: 'meta',
                action: 'delete',
                source: String(options.source || 'unknown').trim() || 'unknown',
                runId: String(options.runId || '').trim(),
                meta: removed ? this._clone(removed) : { id }
            });
        }
        return changed;
    }

    attachNoteToMeta(metaId, noteId, options = {}) {
        this._ensureLoaded();
        const meta = this.store.metas.find((item) => item.id === String(metaId || '').trim());
        if (!meta) return null;
        const nId = String(noteId || '').trim();
        if (!nId || !this._getValidNoteIds().has(nId)) return null;
        const source = String(options.source || 'manual').trim().toLowerCase();
        if (source === 'agent') {
            meta.agentNoteIds = uniqueIds([...(meta.agentNoteIds || []), nId]);
        } else {
            meta.manualNoteIds = uniqueIds([...(meta.manualNoteIds || []), nId]);
        }
        meta.excludedNoteIds = (meta.excludedNoteIds || []).filter((id) => id !== nId);
        meta.noteIds = this._recomputeMetaNoteIds(meta);
        this._save();
        const cloned = this._clone(meta);
        this._notifyChange({
            entity: 'meta',
            action: 'attach_note',
            source: String(options.source || 'manual').trim() || 'manual',
            runId: String(options.runId || '').trim(),
            meta: cloned,
            noteId: nId
        });
        return cloned;
    }

    detachNoteFromMeta(metaId, noteId, options = {}) {
        this._ensureLoaded();
        const meta = this.store.metas.find((item) => item.id === String(metaId || '').trim());
        if (!meta) return null;
        const nId = String(noteId || '').trim();
        meta.manualNoteIds = (meta.manualNoteIds || []).filter((id) => id !== nId);
        meta.agentNoteIds = (meta.agentNoteIds || []).filter((id) => id !== nId);
        meta.excludedNoteIds = uniqueIds([...(meta.excludedNoteIds || []), nId]);
        meta.learningLinks = (meta.learningLinks || []).filter((link) => link.sourceNoteId !== nId && link.linkedNoteId !== nId);
        meta.noteIds = this._recomputeMetaNoteIds(meta);
        this._save();
        const cloned = this._clone(meta);
        this._notifyChange({
            entity: 'meta',
            action: 'detach_note',
            source: String(options.source || 'manual').trim() || 'manual',
            runId: String(options.runId || '').trim(),
            meta: cloned,
            noteId: nId
        });
        return cloned;
    }

    createNote(payload = {}) {
        if (!this.notebookManager) return null;
        const created = this.notebookManager.createTab({
            templateId: String(payload.templateId || 'blank').trim() || 'blank',
            title: String(payload.title || '').trim()
        });
        const noteId = created?.tab?.id || created?.state?.activeTabId;
        if (noteId && payload.body !== undefined) {
            this.notebookManager.updateTab(noteId, {
                title: String(payload.title || '').trim(),
                body: String(payload.body || '')
            });
        }
        const state = this.getKnowledgeState();
        const note = this._findNoteById(noteId);
        const result = {
            tab: note,
            execution: created?.execution || null,
            note,
            state
        };
        if (note?.id) {
            this._notifyChange({
                entity: 'note',
                action: 'create',
                source: String(payload.source || 'unknown').trim() || 'unknown',
                runId: String(payload.runId || '').trim(),
                note: this._clone(note)
            });
        }
        return result;
    }

    updateNote(noteId, patch = {}) {
        if (!this.notebookManager) return null;
        const source = String(patch.source || 'unknown').trim() || 'unknown';
        const runId = String(patch.runId || '').trim();
        const updated = this.notebookManager.updateTab(String(noteId || '').trim(), {
            title: patch.title,
            body: patch.body
        });
        if (!updated) return null;
        const cloned = this._clone(updated);
        this._notifyChange({
            entity: 'note',
            action: 'update',
            source,
            runId,
            note: cloned
        });
        return {
            note: cloned,
            state: this.getKnowledgeState()
        };
    }

    deleteNote(noteId, options = {}) {
        if (!this.notebookManager) return null;
        const id = String(noteId || '').trim();
        const note = this._findNoteById(id);
        this.notebookManager.archiveTab(id);
        this._detachNoteEverywhere(id);
        this._notifyChange({
            entity: 'note',
            action: 'delete',
            source: String(options.source || 'unknown').trim() || 'unknown',
            runId: String(options.runId || '').trim(),
            note: note ? this._clone(note) : { id }
        });
        return { state: this.getKnowledgeState() };
    }

    getKnowledgeState() {
        const notebookState = this.notebookManager ? this.notebookManager.getState() : { tabs: [], executions: [], activeTabId: null, activeExecutionId: null };
        return {
            ...notebookState,
            metas: this.getMetas()
        };
    }

    importKnowledgeState(nextState = {}, options = {}) {
        this._ensureLoaded();

        if (this.notebookManager && typeof this.notebookManager.replaceState === 'function') {
            this.notebookManager.replaceState({
                tabs: Array.isArray(nextState.tabs) ? nextState.tabs : [],
                executions: Array.isArray(nextState.executions) ? nextState.executions : [],
                activeTabId: nextState.activeTabId || null,
                activeExecutionId: nextState.activeExecutionId || null
            });
        }

        const validNoteIds = this._getValidNoteIds();
        this.store.metas = (Array.isArray(nextState.metas) ? nextState.metas : [])
            .map((meta) => this._sanitizeMeta(meta, validNoteIds))
            .filter((meta) => meta.id);
        this._ensureFixedMetas();
        this._save();
        this._notifyChange({
            entity: 'knowledge',
            action: 'import_state',
            source: String(options.source || 'remote_sync').trim() || 'remote_sync',
            metas: this.getMetas()
        });
        return this.getKnowledgeState();
    }

    updateFinanceInstructions(metaId, instructions, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        return this.updateMeta(meta.id, {
            description: String(instructions || ''),
            source: options.source,
            runId: options.runId
        });
    }

    createFinancePocket(metaId, payload = {}, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState(meta.finance);
        finance.pockets.push(sanitizeFinancePocket(payload));
        return this._commitFinance(meta.id, finance, 'create_pocket', options, {
            pocket: finance.pockets[finance.pockets.length - 1]
        });
    }

    updateFinancePocket(metaId, pocketId, patch = {}, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState(meta.finance);
        const idx = finance.pockets.findIndex((pocket) => pocket.id === String(pocketId || '').trim());
        if (idx < 0) return null;
        finance.pockets[idx] = sanitizeFinancePocket({
            ...finance.pockets[idx],
            ...patch,
            id: finance.pockets[idx].id
        });
        return this._commitFinance(meta.id, finance, 'update_pocket', options, {
            pocket: finance.pockets[idx]
        });
    }

    deleteFinancePocket(metaId, pocketId, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState(meta.finance);
        const before = finance.pockets.length;
        const removed = finance.pockets.find((pocket) => pocket.id === String(pocketId || '').trim()) || null;
        finance.pockets = finance.pockets.filter((pocket) => pocket.id !== String(pocketId || '').trim());
        if (finance.pockets.length === before) return null;
        return this._commitFinance(meta.id, finance, 'delete_pocket', options, { pocket: removed });
    }

    adjustFinancePocket(metaId, pocketId, amount, direction = 'deposit', options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState(meta.finance);
        const idx = finance.pockets.findIndex((pocket) => pocket.id === String(pocketId || '').trim());
        if (idx < 0) return null;
        const numericAmount = Math.abs(sanitizeMoney(amount));
        if (!numericAmount) return null;
        const delta = String(direction || '').trim().toLowerCase() === 'withdraw' ? -numericAmount : numericAmount;
        finance.pockets[idx] = sanitizeFinancePocket({
            ...finance.pockets[idx],
            balance: sanitizeMoney(finance.pockets[idx].balance + delta)
        });
        return this._commitFinance(meta.id, finance, delta < 0 ? 'withdraw_pocket' : 'deposit_pocket', options, {
            pocket: finance.pockets[idx],
            amount: numericAmount
        });
    }

    moveMoneyBetweenFinancePockets(metaId, fromPocketId, toPocketId, amount, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState(meta.finance);
        const fromIdx = finance.pockets.findIndex((pocket) => pocket.id === String(fromPocketId || '').trim());
        const toIdx = finance.pockets.findIndex((pocket) => pocket.id === String(toPocketId || '').trim());
        const numericAmount = Math.abs(sanitizeMoney(amount));
        if (fromIdx < 0 || toIdx < 0 || !numericAmount) return null;
        finance.pockets[fromIdx] = sanitizeFinancePocket({
            ...finance.pockets[fromIdx],
            balance: sanitizeMoney(finance.pockets[fromIdx].balance - numericAmount)
        });
        finance.pockets[toIdx] = sanitizeFinancePocket({
            ...finance.pockets[toIdx],
            balance: sanitizeMoney(finance.pockets[toIdx].balance + numericAmount)
        });
        return this._commitFinance(meta.id, finance, 'move_between_pockets', options, {
            amount: numericAmount,
            fromPocketId: finance.pockets[fromIdx].id,
            toPocketId: finance.pockets[toIdx].id
        });
    }

    updateFinanceProjection(metaId, patch = {}, options = {}) {
        const meta = this._findFinanceMeta(metaId);
        if (!meta) return null;
        const finance = sanitizeFinanceState({
            ...meta.finance,
            forecast: {
                ...(meta.finance?.forecast || {}),
                ...patch
            },
            timeline: {
                ...(meta.finance?.timeline || {}),
                currentLabel: patch.currentLabel !== undefined ? patch.currentLabel : meta.finance?.timeline?.currentLabel,
                futureLabel: patch.futureLabel !== undefined ? patch.futureLabel : meta.finance?.timeline?.futureLabel
            }
        });
        return this._commitFinance(meta.id, finance, 'update_projection', options);
    }

    _detachNoteEverywhere(noteId) {
        const id = String(noteId || '').trim();
        if (!id) return;
        this._ensureLoaded();
        this.store.metas = this.store.metas.map((meta) => {
            const next = {
                ...meta,
                manualNoteIds: (meta.manualNoteIds || []).filter((v) => v !== id),
                agentNoteIds: (meta.agentNoteIds || []).filter((v) => v !== id),
                excludedNoteIds: uniqueIds([...(meta.excludedNoteIds || []), id]),
                learningLinks: (meta.learningLinks || []).filter((link) => link.sourceNoteId !== id && link.linkedNoteId !== id)
            };
            next.noteIds = this._recomputeMetaNoteIds(next);
            return next;
        });
        this._save();
    }

    _findNoteById(noteId) {
        if (!this.notebookManager) return null;
        const state = this.notebookManager.getState();
        return (state.tabs || []).find((tab) => tab.id === noteId) || null;
    }

    _getValidNoteIds() {
        if (!this.notebookManager) return new Set();
        const state = this.notebookManager.getState();
        return new Set((state.tabs || []).map((tab) => String(tab?.id || '').trim()).filter(Boolean));
    }

    _ensureLoaded() {
        if (this.store) return;
        fs.mkdirSync(this.storageDir, { recursive: true });
        if (!fs.existsSync(this.storagePath)) {
            this.store = { version: 1, metas: [] };
            this._ensureFixedMetas();
            this._save();
            return;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
            const validNoteIds = this._getValidNoteIds();
            this.store = {
                version: 1,
                metas: Array.isArray(parsed?.metas)
                    ? parsed.metas.map((meta) => this._sanitizeMeta(meta, validNoteIds)).filter((meta) => meta.id)
                    : []
            };
            this._ensureFixedMetas();
        } catch (_) {
            this.store = { version: 1, metas: [] };
            this._ensureFixedMetas();
        }
    }

    _save() {
        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2));
    }

    _notifyChange(change = {}) {
        if (!this.onChange) return;
        try {
            this.onChange({
                timestamp: this.now(),
                ...change,
                state: this.getKnowledgeState()
            });
        } catch (_) {
            // No-op. UI sync should never break persistence.
        }
    }

    _sanitizeMeta(meta, validNoteIds) {
        const legacyNoteIds = uniqueIds(meta?.noteIds).filter((id) => validNoteIds.has(id));
        const hasStructuredIds = Array.isArray(meta?.manualNoteIds) || Array.isArray(meta?.agentNoteIds);
        const manualNoteIds = (hasStructuredIds ? uniqueIds(meta?.manualNoteIds) : legacyNoteIds).filter((id) => validNoteIds.has(id));
        const agentNoteIds = uniqueIds(meta?.agentNoteIds).filter((id) => validNoteIds.has(id));
        const excludedNoteIds = uniqueIds(meta?.excludedNoteIds).filter((id) => validNoteIds.has(id));
        const links = Array.isArray(meta?.learningLinks) ? meta.learningLinks : [];
        const learningLinks = links
            .map((link) => ({
                id: String(link?.id || ''),
                sourceNoteId: String(link?.sourceNoteId || ''),
                linkedNoteId: String(link?.linkedNoteId || ''),
                keyword: String(link?.keyword || '').trim(),
                noteTitle: String(link?.noteTitle || '').trim()
            }))
            .filter((link) => link.id && link.sourceNoteId && link.linkedNoteId && link.keyword)
            .filter((link) => String(link.sourceNoteId).startsWith('meta:') || validNoteIds.has(String(link.sourceNoteId)))
            .filter((link) => validNoteIds.has(String(link.linkedNoteId)));

        const executionType = String(meta?.executionConfig?.type || 'recurrent').trim().toLowerCase();
        const normalizedType = (executionType === 'dynamic' || executionType === 'oneoff') ? executionType : 'recurrent';

        const normalized = {
            id: String(meta?.id || ''),
            kind: String(meta?.kind || '').trim().toLowerCase() === 'finance' ? 'finance' : 'generic',
            isFixed: Boolean(meta?.isFixed),
            title: String(meta?.title || meta?.name || '').trim(),
            description: String(meta?.description || '').trim(),
            noteIds: legacyNoteIds,
            manualNoteIds,
            agentNoteIds,
            excludedNoteIds,
            learningLinks,
            isSaved: Boolean(meta?.isSaved),
            executionConfig: {
                type: normalizedType,
                whenText: String(meta?.executionConfig?.whenText || '').trim(),
                enabled: Boolean(meta?.executionConfig?.enabled)
            },
            executionPromptPending: Boolean(meta?.executionPromptPending),
            agentStatus: String(meta?.agentStatus || 'idle'),
            agentLogs: Array.isArray(meta?.agentLogs)
                ? meta.agentLogs
                    .map((log) => ({
                        id: String(log?.id || ''),
                        phase: String(log?.phase || 'info'),
                        message: String(log?.message || '').trim()
                    }))
                    .filter((log) => log.message)
                    .slice(-24)
                : [],
            finance: String(meta?.kind || '').trim().toLowerCase() === 'finance'
                ? sanitizeFinanceState(meta?.finance)
                : null
        };
        if (normalized.kind === 'finance') {
            normalized.id = 'meta_finanzas';
            normalized.isFixed = true;
            normalized.title = 'Finanzas';
            if (!normalized.description) {
                normalized.description = getDefaultFinanceDescription();
            }
        }
        normalized.noteIds = this._recomputeMetaNoteIds(normalized);
        return normalized;
    }

    _recomputeMetaNoteIds(meta) {
        const excluded = new Set(uniqueIds(meta?.excludedNoteIds));
        return uniqueIds([...(meta?.manualNoteIds || []), ...(meta?.agentNoteIds || [])]).filter((id) => !excluded.has(id));
    }

    _cleanupAgainstNotes() {
        const validNoteIds = this._getValidNoteIds();
        this.store.metas = this.store.metas
            .map((meta) => this._sanitizeMeta(meta, validNoteIds))
            .filter((meta) => meta.id);
        this._ensureFixedMetas();
    }

    _findFinanceMeta(metaId) {
        const requestedId = String(metaId || '').trim();
        const metas = this.getMetas();
        if (requestedId) {
            return metas.find((meta) => meta.id === requestedId && meta.kind === 'finance') || null;
        }
        return metas.find((meta) => meta.kind === 'finance') || null;
    }

    _commitFinance(metaId, finance, action, options = {}, extra = {}) {
        const meta = this.updateMeta(metaId, {
            finance: sanitizeFinanceState(finance),
            source: options.source,
            runId: options.runId
        });
        if (!meta?.id) return null;
        meta.lastFinanceAction = {
            action: String(action || '').trim(),
            ...this._clone(extra)
        };
        return meta;
    }

    _ensureFixedMetas() {
        if (!this.store) return;
        const validNoteIds = this._getValidNoteIds();
        const current = Array.isArray(this.store.metas) ? this.store.metas.slice() : [];
        const financeIndex = current.findIndex((meta) => meta?.kind === 'finance' || String(meta?.id || '').trim() === 'meta_finanzas');
        const financeMeta = financeIndex >= 0
            ? this._sanitizeMeta({
                ...createFixedFinanceMeta(),
                ...current[financeIndex],
                description: String(current[financeIndex]?.description || '').trim() || getDefaultFinanceDescription(),
                finance: sanitizeFinanceState(current[financeIndex]?.finance)
            }, validNoteIds)
            : this._sanitizeMeta(createFixedFinanceMeta(), validNoteIds);
        const next = current.filter((meta, index) => index !== financeIndex);
        this.store.metas = [financeMeta, ...next];
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
}

module.exports = KnowledgeService;

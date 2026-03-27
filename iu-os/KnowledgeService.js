const fs = require('fs');
const path = require('path');

function uniqueIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean)));
}

class KnowledgeService {
    constructor(options = {}) {
        this.notebookManager = options.notebookManager;
        this.storageDir = options.storageDir || path.join(process.cwd(), '.chat-notebooks');
        this.storagePath = options.storagePath || path.join(this.storageDir, 'knowledge.json');
        this.now = options.now || (() => Date.now());
        this.store = null;
    }

    bootstrap() {
        this._ensureLoaded();
        this._cleanupAgainstNotes();
        this._save();
        return this.getMetas();
    }

    getMetas() {
        this._ensureLoaded();
        this._cleanupAgainstNotes();
        return this.store.metas.map((meta) => this._clone(meta));
    }

    setMetas(rawMetas = []) {
        this._ensureLoaded();
        const validNoteIds = this._getValidNoteIds();
        this.store.metas = (Array.isArray(rawMetas) ? rawMetas : [])
            .map((meta) => this._sanitizeMeta(meta, validNoteIds))
            .filter((meta) => meta.id);
        this._save();
        return this.getMetas();
    }

    createMeta(payload = {}) {
        this._ensureLoaded();
        const validNoteIds = this._getValidNoteIds();
        const meta = this._sanitizeMeta({
            id: `meta_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
            title: payload.title,
            description: payload.description,
            noteIds: payload.noteIds || [],
            manualNoteIds: payload.manualNoteIds || payload.noteIds || [],
            agentNoteIds: payload.agentNoteIds || [],
            excludedNoteIds: payload.excludedNoteIds || [],
            learningLinks: payload.learningLinks || [],
            isSaved: payload.isSaved !== undefined ? Boolean(payload.isSaved) : true,
            executionConfig: payload.executionConfig || { type: 'recurrent', whenText: '', enabled: false },
            executionPromptPending: Boolean(payload.executionPromptPending),
            agentStatus: payload.agentStatus || 'idle',
            agentLogs: payload.agentLogs || []
        }, validNoteIds);
        this.store.metas.unshift(meta);
        this._save();
        return this._clone(meta);
    }

    updateMeta(metaId, patch = {}) {
        this._ensureLoaded();
        const idx = this.store.metas.findIndex((meta) => meta.id === String(metaId || '').trim());
        if (idx < 0) return null;
        const validNoteIds = this._getValidNoteIds();
        const merged = this._sanitizeMeta({
            ...this.store.metas[idx],
            ...patch
        }, validNoteIds);
        this.store.metas[idx] = merged;
        this._save();
        return this._clone(merged);
    }

    deleteMeta(metaId) {
        this._ensureLoaded();
        const id = String(metaId || '').trim();
        const before = this.store.metas.length;
        this.store.metas = this.store.metas.filter((meta) => meta.id !== id);
        const changed = this.store.metas.length !== before;
        if (changed) this._save();
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
        return this._clone(meta);
    }

    detachNoteFromMeta(metaId, noteId) {
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
        return this._clone(meta);
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
        return {
            tab: this._findNoteById(noteId),
            execution: created?.execution || null,
            note: this._findNoteById(noteId),
            state
        };
    }

    updateNote(noteId, patch = {}) {
        if (!this.notebookManager) return null;
        const updated = this.notebookManager.updateTab(String(noteId || '').trim(), {
            title: patch.title,
            body: patch.body
        });
        if (!updated) return null;
        return {
            note: this._clone(updated),
            state: this.getKnowledgeState()
        };
    }

    deleteNote(noteId) {
        if (!this.notebookManager) return null;
        const id = String(noteId || '').trim();
        this.notebookManager.archiveTab(id);
        this._detachNoteEverywhere(id);
        return { state: this.getKnowledgeState() };
    }

    getKnowledgeState() {
        const notebookState = this.notebookManager ? this.notebookManager.getState() : { tabs: [], executions: [], activeTabId: null, activeExecutionId: null };
        return {
            ...notebookState,
            metas: this.getMetas()
        };
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
        } catch (_) {
            this.store = { version: 1, metas: [] };
        }
    }

    _save() {
        fs.mkdirSync(this.storageDir, { recursive: true });
        fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2));
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
                : []
        };
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
    }

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
}

module.exports = KnowledgeService;

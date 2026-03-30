const META_VIEW_MODE_KEY = 'iu_meta_view_mode_v1';

const state = {
  tabs: [],
  executions: [],
  activeTabId: null,
  activeExecutionId: null,
  mode: 'projects',
  metas: [],
  activeMetaId: null,
  draggingMetaId: null,
  draggingNoteId: null,
  metaViewMode: 'expanded',
  metaActionsMenuMetaId: null,
  metaNotesMenuMetaId: null,
  metaNotesMenuAnchor: 'section',
  executionModalMetaId: null,
  newNoteModalMetaId: null,
  existingNoteModalMetaId: null,
  existingNoteSelection: [],
  livePresentation: null
};

const refs = {
  modeNotesBtn: document.getElementById('mode-notes-btn'),
  modeProjectsBtn: document.getElementById('mode-projects-btn'),
  notesView: document.getElementById('notes-view'),
  projectsView: document.getElementById('projects-view'),
  noteTabs: document.getElementById('note-tabs'),
  noteTabAdd: document.getElementById('note-tab-add'),
  noteTitle: document.getElementById('note-title'),
  noteBody: document.getElementById('note-body'),
  noteMarkers: document.getElementById('note-markers'),
  newGroupPlus: document.getElementById('new-group-plus'),
  projectGroups: document.getElementById('project-groups'),
  metaModalRoot: document.getElementById('meta-modal-root')
};

let saveTimer = null;
let lastEditorSyncTabId = null;
const META_SOURCE_PREFIX = 'meta:';
const FIXED_FINANCE_META_ID = 'meta_finanzas';
const metaFeedUiState = new Map();
const tabsScrollState = {
  notes: 0,
  metas: 0
};
let livePresentationTimer = null;
let livePresentationClearTimer = null;

function emitUiUx(event, data = {}) {
  if (!window.uChat?.logUiUx) return;
  window.uChat.logUiUx({
    scope: 'chat_notas_metas',
    event,
    data
  });
}

function tabLabel(tab) {
  const live = getLiveNotePresentation(tab?.id);
  const title = String(live?.title ?? tab?.title ?? '').trim();
  return title || 'Nueva nota';
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTheme(value) {
  return String(value || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

function normalizeMetaViewMode(value) {
  return String(value || '').trim().toLowerCase() === 'compact' ? 'compact' : 'expanded';
}

function normalizeExecutionType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'dynamic' || raw === 'oneoff') return raw;
  return 'recurrent';
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

function formatMoney(value, currency = 'COP') {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: String(currency || 'COP').trim() || 'COP',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  } catch (_) {
    return `${Number(value || 0).toFixed(0)} ${currency || 'COP'}`;
  }
}

function sanitizeFinancePocket(pocket = {}) {
  const id = String(pocket.id || `pocket_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`).trim();
  return {
    id,
    name: String(pocket.name || '').trim() || 'Bolsillo',
    bank: String(pocket.bank || '').trim(),
    purpose: String(pocket.purpose || '').trim(),
    balance: sanitizeMoney(pocket.balance)
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
  const rawPockets = Array.isArray(finance.pockets) ? finance.pockets : [];
  const seen = new Set();
  const pockets = [];
  for (const rawPocket of rawPockets) {
    const pocket = sanitizeFinancePocket(rawPocket);
    if (seen.has(pocket.id)) continue;
    seen.add(pocket.id);
    pockets.push(pocket);
  }
  return {
    version: 1,
    currency: String(finance.currency || base.currency).trim() || base.currency,
    pockets,
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

function isFinanceMeta(meta) {
  return String(meta?.kind || '').trim().toLowerCase() === 'finance' || String(meta?.id || '').trim() === FIXED_FINANCE_META_ID;
}

function getFinanceSummary(meta) {
  const finance = sanitizeFinanceState(meta?.finance);
  const currentTotal = finance.pockets.reduce((sum, pocket) => sum + Number(pocket.balance || 0), 0);
  const expectedIncome = Number(finance.forecast.expectedIncome || 0);
  const expectedExpenses = Number(finance.forecast.expectedExpenses || 0);
  const net = expectedIncome - expectedExpenses;
  const futureTotal = currentTotal + net;
  const weeklyExpense = finance.forecast.horizonWeeks > 0 ? expectedExpenses / finance.forecast.horizonWeeks : 0;
  const runwayWeeks = weeklyExpense > 0 ? currentTotal / weeklyExpense : null;
  return {
    currentTotal,
    futureTotal,
    net,
    expectedIncome,
    expectedExpenses,
    horizonWeeks: finance.forecast.horizonWeeks,
    runwayWeeks
  };
}

function loadMetaViewMode() {
  try {
    const raw = localStorage.getItem(META_VIEW_MODE_KEY);
    return normalizeMetaViewMode(raw);
  } catch (_) {
    return 'expanded';
  }
}

function saveMetaViewMode(mode) {
  const normalized = normalizeMetaViewMode(mode);
  state.metaViewMode = normalized;
  localStorage.setItem(META_VIEW_MODE_KEY, normalized);
}

function getInverseTheme(baseTheme) {
  return normalizeTheme(baseTheme) === 'light' ? 'dark' : 'light';
}

function applyInvertedTheme(baseTheme) {
  const inverseTheme = getInverseTheme(baseTheme);
  document.documentElement.setAttribute('data-inverse-theme', inverseTheme);
}

async function initThemeSync() {
  if (!window.uChat?.getUiTheme) {
    applyInvertedTheme('light');
    return;
  }

  try {
    const payload = await window.uChat.getUiTheme();
    applyInvertedTheme(payload?.theme);
  } catch (_) {
    applyInvertedTheme('light');
  }

  if (window.uChat?.onUiThemeChanged) {
    window.uChat.onUiThemeChanged((payload) => {
      applyInvertedTheme(payload?.theme);
    });
  }
}

function decodeDragPayload(rawValue, prefix) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (!raw.startsWith(`${prefix}:`)) return '';
  return raw.slice(prefix.length + 1).trim();
}

function getDraggedMetaIdFromEvent(event) {
  if (state.draggingMetaId) return state.draggingMetaId;
  const fromNative = event?.dataTransfer?.getData('text/meta-id');
  if (fromNative) return String(fromNative).trim();
  const fallback = decodeDragPayload(event?.dataTransfer?.getData('text/plain'), 'meta');
  return String(fallback || '').trim();
}

function getDraggedNoteIdFromEvent(event) {
  if (state.draggingNoteId) return state.draggingNoteId;
  const fromNative = event?.dataTransfer?.getData('text/note-id');
  if (fromNative) return String(fromNative).trim();
  const fallback = decodeDragPayload(event?.dataTransfer?.getData('text/plain'), 'note');
  return String(fallback || '').trim();
}

function autoResizeNoteBody() {
  if (!refs.noteBody) return;
  refs.noteBody.style.height = 'auto';
  const next = Math.max(420, refs.noteBody.scrollHeight);
  refs.noteBody.style.height = `${next}px`;
  refs.noteMarkers.style.height = `${next}px`;
}

function rememberTabsScroll(kind, element) {
  if (!element) return;
  tabsScrollState[kind] = element.scrollLeft;
}

function restoreTabsScroll(kind, element) {
  if (!element) return;
  const target = Math.max(0, Number(tabsScrollState[kind] || 0));
  requestAnimationFrame(() => {
    element.scrollLeft = target;
  });
}

function reorderMetas(metaId, targetMetaId, position = 'before') {
  const sourceIndex = state.metas.findIndex((meta) => meta.id === metaId);
  const targetIndex = state.metas.findIndex((meta) => meta.id === targetMetaId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

  const next = state.metas.slice();
  const [moved] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertIndex = position === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, moved);
  state.metas = next;
  saveMetas();
  renderMetasView();
}

function moveMetaToIndex(metaId, index) {
  const sourceIndex = state.metas.findIndex((meta) => meta.id === metaId);
  if (sourceIndex < 0) return;

  const next = state.metas.slice();
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, moved);
  state.metas = next;
  saveMetas();
  renderMetasView();
}

function removeMeta(metaId) {
  const meta = state.metas.find((item) => item.id === metaId);
  if (meta?.isFixed) return;
  const next = state.metas.filter((meta) => meta.id !== metaId);
  if (next.length === state.metas.length) return;

  if (state.metaNotesMenuMetaId === metaId) {
    state.metaNotesMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
  }
  if (state.metaActionsMenuMetaId === metaId) state.metaActionsMenuMetaId = null;
  if (state.executionModalMetaId === metaId) state.executionModalMetaId = null;
  if (state.newNoteModalMetaId === metaId) state.newNoteModalMetaId = null;
  if (state.existingNoteModalMetaId === metaId) {
    state.existingNoteModalMetaId = null;
    state.existingNoteSelection = [];
  }

  state.metas = next;
  if (state.activeMetaId === metaId) {
    state.activeMetaId = next[0]?.id || null;
  }
  saveMetas();
  renderMetasView();
  renderNoteMarkers();
}

function sanitizeMeta(meta) {
  const legacyNoteIds = Array.from(new Set((Array.isArray(meta.noteIds) ? meta.noteIds : []).map(String)));
  const hasStructuredIds = Array.isArray(meta.manualNoteIds) || Array.isArray(meta.agentNoteIds);
  const manualNoteIds = hasStructuredIds
    ? Array.from(new Set((Array.isArray(meta.manualNoteIds) ? meta.manualNoteIds : []).map(String)))
    : legacyNoteIds;
  const agentNoteIds = Array.from(new Set((Array.isArray(meta.agentNoteIds) ? meta.agentNoteIds : []).map(String)));

  const rawLinks = Array.isArray(meta.learningLinks) ? meta.learningLinks : [];
  const learningLinks = rawLinks
    .map((link) => ({
      id: String(link.id || ''),
      sourceNoteId: String(link.sourceNoteId || ''),
      linkedNoteId: String(link.linkedNoteId || ''),
      keyword: String(link.keyword || '').trim(),
      noteTitle: String(link.noteTitle || '').trim()
    }))
    .filter((link) => link.id && link.sourceNoteId && link.linkedNoteId && link.keyword);

  return {
    id: String(meta.id || ''),
    kind: isFinanceMeta(meta) ? 'finance' : 'generic',
    isFixed: Boolean(meta.isFixed) || isFinanceMeta(meta),
    title: String(meta.title || meta.name || '').trim(),
    description: String(meta.description || '').trim(),
    noteIds: legacyNoteIds,
    manualNoteIds,
    agentNoteIds,
    excludedNoteIds: Array.from(new Set((Array.isArray(meta.excludedNoteIds) ? meta.excludedNoteIds : []).map(String))),
    learningLinks,
    isSaved: Boolean(meta.isSaved),
    executionConfig: {
      type: normalizeExecutionType(meta.executionConfig?.type),
      whenText: String(meta.executionConfig?.whenText || '').trim(),
      enabled: Boolean(meta.executionConfig?.enabled)
    },
    executionPromptPending: Boolean(meta.executionPromptPending),
    agentStatus: String(meta.agentStatus || 'idle'),
    agentLogs: Array.isArray(meta.agentLogs)
      ? meta.agentLogs.map((log) => ({
        id: String(log.id || ''),
        phase: String(log.phase || 'info'),
        message: String(log.message || '').trim()
      })).filter((log) => log.message).slice(-24)
      : [],
    finance: isFinanceMeta(meta) ? sanitizeFinanceState(meta.finance) : null
  };
}

function saveMetas() {
  if (!window.uChat?.saveMetas) return;
  window.uChat.saveMetas(state.metas).catch((error) => {
    console.error('[chat] saveMetas failed', error);
  });
}

function cleanupMetasAgainstTabs() {
  const validIds = new Set(state.tabs.map((tab) => tab.id));
  let changed = false;
  state.metas = state.metas.map((meta) => {
    const next = {
      ...meta,
      manualNoteIds: meta.manualNoteIds.filter((id) => validIds.has(id)),
      agentNoteIds: meta.agentNoteIds.filter((id) => validIds.has(id)),
      excludedNoteIds: meta.excludedNoteIds.filter((id) => validIds.has(id)),
      learningLinks: (meta.learningLinks || []).filter((link) => (String(link.sourceNoteId || '').startsWith(META_SOURCE_PREFIX) || validIds.has(link.sourceNoteId)) && validIds.has(link.linkedNoteId))
    };
    const normalized = { ...next, noteIds: recomputeMetaNoteIds(next) };
    if (
      normalized.noteIds.length !== meta.noteIds.length ||
      normalized.manualNoteIds.length !== meta.manualNoteIds.length ||
      normalized.agentNoteIds.length !== meta.agentNoteIds.length ||
      normalized.excludedNoteIds.length !== meta.excludedNoteIds.length ||
      normalized.learningLinks.length !== (meta.learningLinks || []).length
    ) {
      changed = true;
    }
    return normalized;
  });
  if (changed) saveMetas();
}

function uniqueIds(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean)));
}

function recomputeMetaNoteIds(meta) {
  const excluded = new Set(uniqueIds(meta.excludedNoteIds));
  return uniqueIds([...(meta.manualNoteIds || []), ...(meta.agentNoteIds || [])]).filter((id) => !excluded.has(id));
}

function bindMetaFeedUi(metaId, feedElement, running) {
  const key = String(metaId || '');
  if (!key || !feedElement) return;

  requestAnimationFrame(() => {
    const previous = metaFeedUiState.get(key) || { autoStick: true, scrollTop: 0 };
    const maxScroll = Math.max(0, feedElement.scrollHeight - feedElement.clientHeight);
    if (previous.autoStick || running) {
      feedElement.scrollTop = maxScroll;
    } else {
      feedElement.scrollTop = Math.min(previous.scrollTop, maxScroll);
    }
  });

  feedElement.addEventListener('scroll', () => {
    const nearBottom = feedElement.scrollTop + feedElement.clientHeight >= feedElement.scrollHeight - 8;
    metaFeedUiState.set(key, {
      autoStick: nearBottom,
      scrollTop: feedElement.scrollTop
    });
  });
}

function getMetaForNote(noteId) {
  if (state.activeMetaId) {
    const active = state.metas.find((meta) => meta.id === state.activeMetaId);
    if (active?.noteIds?.includes(noteId)) return active;
  }

  const direct = state.metas.find((meta) => meta.noteIds.includes(noteId));
  if (direct) return direct;

  if (state.activeMetaId) {
    const active = state.metas.find((meta) => meta.id === state.activeMetaId);
    if (active) return active;
  }

  if (state.metas.length === 1) {
    return state.metas[0];
  }

  return null;
}

function isPromptAgentSource(source) {
  return String(source || '').trim().toLowerCase() === 'prompt_agent';
}

function clearLivePresentation(options = {}) {
  clearInterval(livePresentationTimer);
  livePresentationTimer = null;
  clearTimeout(livePresentationClearTimer);
  livePresentationClearTimer = null;
  if (options.keepState) return;
  state.livePresentation = null;
  refs.notesView.classList.remove('live-focus-view');
  refs.projectsView.classList.remove('live-focus-view');
  refs.noteTitle.classList.remove('live-writing');
  refs.noteBody.classList.remove('live-writing');
}

function scheduleLivePresentationClear(snapshot = null) {
  clearTimeout(livePresentationClearTimer);
  livePresentationClearTimer = setTimeout(() => {
    const live = state.livePresentation;
    if (!live) return;
    clearLivePresentation();
    if (live.kind === 'meta') {
      renderMetasView();
      renderNoteMarkers();
      return;
    }
    renderNoteTabs();
    if (snapshot) {
      applySnapshot(snapshot, { syncEditor: true });
    } else {
      syncEditorFromState(true);
      renderNoteMarkers();
    }
  }, 1400);
}

function getStreamStep(text, index) {
  const total = String(text || '').length;
  if (total <= index) return 0;
  return Math.max(1, Math.min(8, Math.ceil((total - index) / 14)));
}

function renderLivePresentationFrame() {
  const live = state.livePresentation;
  if (!live) return;
  if (live.kind === 'meta') {
    renderMetasView();
    renderNoteMarkers();
    return;
  }
  renderNoteTabs();
  syncEditorFromState(true);
  renderNoteMarkers();
}

function startLivePresentation(payload = {}) {
  const kind = String(payload.kind || '').trim();
  const id = String(payload.id || '').trim();
  if (!kind || !id) return;

  clearLivePresentation();
  state.livePresentation = {
    kind,
    action: String(payload.action || 'update').trim(),
    id,
    title: String(payload.title || '').trim(),
    description: String(payload.description || ''),
    body: String(payload.body || ''),
    titleIndex: 0,
    descriptionIndex: 0,
    bodyIndex: 0,
    streaming: true,
    startedAt: Date.now()
  };

  if (kind === 'meta') {
    state.activeMetaId = id;
    state.metaViewMode = 'expanded';
    refs.projectsView.classList.add('live-focus-view');
    setMode('projects');
  } else {
    state.activeTabId = id;
    refs.notesView.classList.add('live-focus-view');
    setMode('notes');
  }

  renderLivePresentationFrame();

  livePresentationTimer = setInterval(() => {
    const live = state.livePresentation;
    if (!live) {
      clearLivePresentation();
      return;
    }

    let changed = false;
    if (live.titleIndex < live.title.length) {
      live.titleIndex = Math.min(live.title.length, live.titleIndex + getStreamStep(live.title, live.titleIndex));
      changed = true;
    }
    if (live.descriptionIndex < live.description.length) {
      live.descriptionIndex = Math.min(live.description.length, live.descriptionIndex + getStreamStep(live.description, live.descriptionIndex));
      changed = true;
    }
    if (live.bodyIndex < live.body.length) {
      live.bodyIndex = Math.min(live.body.length, live.bodyIndex + getStreamStep(live.body, live.bodyIndex));
      changed = true;
    }

    renderLivePresentationFrame();

    if (!changed) {
      live.streaming = false;
      clearInterval(livePresentationTimer);
      livePresentationTimer = null;
      scheduleLivePresentationClear();
    }
  }, 34);
}

function getLiveMetaPresentation(metaId) {
  const live = state.livePresentation;
  if (!live || live.kind !== 'meta' || live.id !== String(metaId || '').trim()) return null;
  return {
    title: live.title.slice(0, live.titleIndex),
    description: live.description.slice(0, live.descriptionIndex),
    streaming: live.streaming !== false
  };
}

function getLiveNotePresentation(noteId) {
  const live = state.livePresentation;
  if (!live || live.kind !== 'note' || live.id !== String(noteId || '').trim()) return null;
  return {
    title: live.title.slice(0, live.titleIndex),
    body: live.body.slice(0, live.bodyIndex),
    streaming: live.streaming !== false
  };
}

function applyLiveNotePresentation() {
  const live = getLiveNotePresentation(state.activeTabId);
  const active = Boolean(live);
  refs.noteTitle.classList.toggle('live-writing', active);
  refs.noteBody.classList.toggle('live-writing', active);
  refs.notesView.classList.toggle('live-focus-view', active);
  if (!live) return false;
  refs.noteTitle.value = live.title;
  refs.noteBody.value = live.body;
  autoResizeNoteBody();
  refs.noteMarkers.scrollTop = refs.noteBody.scrollTop;
  refs.noteMarkers.scrollLeft = refs.noteBody.scrollLeft;
  return true;
}

function handleAgentToolStart(payload = {}) {
  if (String(payload.type || '').trim() !== 'tool_call' || String(payload.phase || '').trim() !== 'start') return;
  const toolName = String(payload.toolName || '').trim();
  const args = payload.args && typeof payload.args === 'object' ? payload.args : {};
  const financeToolNames = new Set([
    'update_finance_instructions',
    'create_finance_pocket',
    'update_finance_pocket',
    'delete_finance_pocket',
    'deposit_finance_pocket',
    'withdraw_finance_pocket',
    'move_money_between_finance_pockets',
    'update_finance_projection'
  ]);

  if (toolName === 'create_meta' || toolName === 'update_meta') {
    if (args.meta_id) state.activeMetaId = String(args.meta_id).trim();
    state.metaViewMode = 'expanded';
    refs.projectsView.classList.add('live-focus-view');
    setMode('projects');
    renderMetasView();
    return;
  }

  if (toolName === 'create_note' || toolName === 'update_note' || toolName === 'append_to_note' || toolName === 'replace_in_note') {
    if (args.note_id) state.activeTabId = String(args.note_id).trim();
    refs.notesView.classList.add('live-focus-view');
    setMode('notes');
    renderNoteTabs();
    syncEditorFromState(true);
  }

  if (financeToolNames.has(toolName)) {
    if (args.meta_id) state.activeMetaId = String(args.meta_id).trim();
    state.metaViewMode = 'expanded';
    refs.projectsView.classList.add('live-focus-view');
    setMode('projects');
    renderMetasView();
  }
}

function startLivePresentationFromChange(change = {}) {
  if (!isPromptAgentSource(change.source)) return;

  if (change.entity === 'meta' && (change.action === 'create' || change.action === 'update')) {
    const meta = change.meta;
    if (!meta?.id) return;
    startLivePresentation({
      kind: 'meta',
      action: change.action,
      id: meta.id,
      title: meta.title || '',
      description: meta.description || ''
    });
    return;
  }

  if (change.entity === 'note' && (change.action === 'create' || change.action === 'update')) {
    const note = change.note;
    if (!note?.id) return;
    startLivePresentation({
      kind: 'note',
      action: change.action,
      id: note.id,
      title: note.title || '',
      body: note.body || ''
    });
  }
}

function handleKnowledgeStateChanged(payload = {}) {
  if (!payload?.state) return;
  if (String(payload?.change?.source || '').trim().toLowerCase() === 'chat_window') return;
  applySnapshot(payload.state, { syncEditor: true });
  startLivePresentationFromChange(payload.change || {});
}

function applySnapshot(snapshot, options = {}) {
  if (!snapshot) return;

  state.tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : state.tabs;
  state.executions = Array.isArray(snapshot.executions) ? snapshot.executions : state.executions;
  if (Array.isArray(snapshot.metas)) {
    state.metas = snapshot.metas.map(sanitizeMeta).filter((meta) => meta.id);
  }
  state.activeTabId = snapshot.activeTabId || state.activeTabId;
  state.activeExecutionId = snapshot.activeExecutionId || state.activeExecutionId;

  if (!state.activeTabId && state.tabs[0]) {
    state.activeTabId = state.tabs[0].id;
  }

  cleanupMetasAgainstTabs();
  renderNoteTabs();

  if (options.syncEditor || !lastEditorSyncTabId || state.activeTabId !== lastEditorSyncTabId) {
    syncEditorFromState(true);
  }

  renderMetasView();
  renderNoteMarkers();
}

function setMode(mode) {
  state.mode = mode === 'projects' ? 'projects' : 'notes';
  const inNotes = state.mode === 'notes';
  emitUiUx('mode_changed', { mode: state.mode });

  refs.notesView.classList.toggle('active', inNotes);
  refs.projectsView.classList.toggle('active', !inNotes);
  refs.modeNotesBtn.classList.toggle('active', inNotes);
  refs.modeProjectsBtn.classList.toggle('active', !inNotes);
  refs.modeNotesBtn.setAttribute('aria-selected', inNotes ? 'true' : 'false');
  refs.modeProjectsBtn.setAttribute('aria-selected', inNotes ? 'false' : 'true');

  if (!inNotes) renderMetasView();
}

function setMetaViewMode(mode) {
  saveMetaViewMode(mode);
  state.metaActionsMenuMetaId = null;
  state.metaNotesMenuMetaId = null;
  state.metaNotesMenuAnchor = 'section';
  state.executionModalMetaId = null;
  renderMetasView();
}

function closeMetaOverlays() {
  state.metaActionsMenuMetaId = null;
  state.metaNotesMenuMetaId = null;
  state.metaNotesMenuAnchor = 'section';
  state.executionModalMetaId = null;
  state.newNoteModalMetaId = null;
  state.existingNoteModalMetaId = null;
  state.existingNoteSelection = [];
}

async function closeTabWithoutSaving(tabId) {
  clearTimeout(saveTimer);
  const next = await window.uChat.archiveTab({ tabId, source: 'chat_window' });
  applySnapshot(next, { syncEditor: true });
}

function renderNoteTabs() {
  rememberTabsScroll('notes', refs.noteTabs);
  refs.noteTabs.innerHTML = '';

  for (const tab of state.tabs) {
    const root = document.createElement('div');
    root.className = `note-tab${tab.id === state.activeTabId ? ' active' : ''}${getLiveNotePresentation(tab.id) ? ' live-focus-tab' : ''}`;

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'note-tab-label-btn';
    openBtn.textContent = tabLabel(tab);
    openBtn.addEventListener('click', async () => {
      const next = await window.uChat.setActiveTab(tab.id);
      applySnapshot(next, { syncEditor: true });
      setMode('notes');
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'note-tab-close-btn';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await closeTabWithoutSaving(tab.id);
    });

    root.appendChild(openBtn);
    root.appendChild(closeBtn);
    refs.noteTabs.appendChild(root);
  }

  restoreTabsScroll('notes', refs.noteTabs);
}

function syncEditorFromState(force = false) {
  const tab = getActiveTab();
  if (!tab) return;

  if (force || lastEditorSyncTabId !== tab.id) {
    refs.noteTitle.value = String(tab.title || '').trim();
    refs.noteBody.value = tab.body || '';
    autoResizeNoteBody();
    refs.noteMarkers.scrollTop = refs.noteBody.scrollTop;
    refs.noteMarkers.scrollLeft = refs.noteBody.scrollLeft;
    lastEditorSyncTabId = tab.id;
  }

  applyLiveNotePresentation();
}

function findKeywordMatches(text, links) {
  const lowerText = text.toLowerCase();
  const occupied = [];
  const matches = [];

  const sorted = [...links].sort((a, b) => String(b.keyword || '').length - String(a.keyword || '').length);
  for (const link of sorted) {
    const keyword = String(link.keyword || '').trim();
    if (!keyword) continue;

    const idx = lowerText.indexOf(keyword.toLowerCase());
    if (idx < 0) continue;

    const start = idx;
    const end = idx + keyword.length;
    const overlaps = occupied.some((range) => !(end <= range.start || start >= range.end));
    if (overlaps) continue;

    occupied.push({ start, end });
    matches.push({ start, end, link });
  }

  return matches.sort((a, b) => a.start - b.start);
}

function getLearningLinksForActiveNote() {
  const activeTab = getActiveTab();
  if (!activeTab) return [];

  const meta = getMetaForNote(activeTab.id);
  if (!meta) return [];

  const links = (meta.learningLinks || []).filter((link) => link.sourceNoteId === activeTab.id);
  return links.map((link) => {
    const target = state.tabs.find((tab) => tab.id === link.linkedNoteId);
    const ready = Boolean(String(target?.body || '').trim());
    return { ...link, ready };
  });
}

function openLinkedNote(noteId) {
  return window.uChat.setActiveTab(noteId).then((next) => {
    applySnapshot(next, { syncEditor: true });
    setMode('notes');
  });
}

function renderNoteMarkers() {
  const text = refs.noteBody.value || '';
  if (!text) {
    refs.noteMarkers.innerHTML = '';
    return;
  }

  const links = getLearningLinksForActiveNote();
  const matches = findKeywordMatches(text, links);

  if (matches.length === 0) {
    refs.noteMarkers.textContent = text;
    return;
  }

  let cursor = 0;
  let html = '';
  for (const match of matches) {
    html += escapeHtml(text.slice(cursor, match.start));
    const className = match.link.ready ? 'ready' : 'pending';
    html += `<button type="button" class="learning-link ${className}" data-note-id="${escapeHtml(match.link.linkedNoteId)}" title="${escapeHtml(match.link.noteTitle || tabLabel(state.tabs.find((tab) => tab.id === match.link.linkedNoteId)))}">${escapeHtml(text.slice(match.start, match.end))}</button>`;
    cursor = match.end;
  }
  html += escapeHtml(text.slice(cursor));
  refs.noteMarkers.innerHTML = html;

  for (const button of refs.noteMarkers.querySelectorAll('.learning-link')) {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const noteId = event.currentTarget.getAttribute('data-note-id');
      if (!noteId) return;
      openLinkedNote(noteId);
    });
  }
}

async function saveTabSoon() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    const tab = getActiveTab();
    if (!tab) return;

    try {
      await window.uChat.updateTab({
        tabId: tab.id,
        title: refs.noteTitle.value,
        body: refs.noteBody.value,
        source: 'chat_window'
      });
      renderNoteTabs();
      renderMetasView();
      renderNoteMarkers();
    } catch (error) {
      console.error(error);
    }
  }, 200);
}

function addNotesToMeta(metaId, noteIds) {
  const ids = uniqueIds(noteIds);
  if (!ids.length) return;
  emitUiUx('meta_notes_added', { metaId, count: ids.length });
  state.activeMetaId = metaId;
  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const next = {
      ...meta,
      manualNoteIds: uniqueIds([...(meta.manualNoteIds || []), ...ids]),
      excludedNoteIds: (meta.excludedNoteIds || []).filter((id) => !ids.includes(id))
    };
    return { ...next, noteIds: recomputeMetaNoteIds(next) };
  });
  saveMetas();
  renderMetasView();
  renderNoteMarkers();
}

function removeNoteFromMeta(metaId, noteId) {
  emitUiUx('meta_note_removed', { metaId, noteId });
  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const next = {
      ...meta,
      manualNoteIds: (meta.manualNoteIds || []).filter((id) => id !== noteId),
      agentNoteIds: (meta.agentNoteIds || []).filter((id) => id !== noteId),
      excludedNoteIds: uniqueIds([...(meta.excludedNoteIds || []), noteId]),
      learningLinks: (meta.learningLinks || []).filter((link) => link.sourceNoteId !== noteId && link.linkedNoteId !== noteId)
    };
    return { ...next, noteIds: recomputeMetaNoteIds(next) };
  });
  saveMetas();
  renderMetasView();
  renderNoteMarkers();
}

function createNotePill(tab, options = {}) {
  const pill = document.createElement('div');
  pill.className = 'note-pill';
  const label = document.createElement('span');
  label.className = 'note-pill-label';
  label.textContent = tabLabel(tab);
  pill.appendChild(label);
  pill.draggable = options.draggable !== false;

  if (pill.draggable) {
    pill.addEventListener('dragstart', (event) => {
      state.draggingNoteId = tab.id;
      event.dataTransfer.setData('text/note-id', tab.id);
      event.dataTransfer.setData('text/plain', `note:${tab.id}`);
      event.dataTransfer.effectAllowed = 'move';
    });
    pill.addEventListener('dragend', () => {
      state.draggingNoteId = null;
    });
  }

  pill.addEventListener('dblclick', async () => {
    const next = await window.uChat.setActiveTab(tab.id);
    applySnapshot(next, { syncEditor: true });
    setMode('notes');
  });

  if (typeof options.onRemove === 'function') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'note-pill-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onRemove();
    });
    pill.appendChild(closeBtn);
  }

  return pill;
}

function updateMeta(metaId, patch = {}, rerender = false) {
  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const next = { ...meta, ...patch };
    if (meta.isFixed) {
      next.title = meta.title;
      next.kind = meta.kind;
      next.isFixed = true;
    }
    if (isFinanceMeta(next)) {
      next.finance = sanitizeFinanceState(next.finance);
    }
    return next;
  });
  saveMetas();
  if (rerender) renderMetasView();
}

function appendMetaAgentLog(metaId, phase, message) {
  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const line = {
      id: `log_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      phase: String(phase || 'info'),
      message: String(message || '').trim()
    };
    return { ...meta, agentLogs: [...(meta.agentLogs || []), line].slice(-24) };
  });
  saveMetas();
  renderMetasView();
}

function applyMetaAgentProgress(payload = {}) {
  const metaId = String(payload.metaId || '').trim();
  if (!metaId) return;
  const phase = String(payload.phase || 'info').trim();
  const message = String(payload.message || '').trim();
  if (!message) return;

  appendMetaAgentLog(metaId, phase, message);
  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const status = phase === 'error' ? 'error' : (phase === 'done' ? 'done' : 'running');
    return { ...meta, agentStatus: status };
  });
  saveMetas();
  renderMetasView();
}

function findReusableDepthNote(meta, keyword, noteTitle) {
  const key = normalizeKey(keyword);
  const titleKey = normalizeKey(noteTitle);
  const links = (meta.learningLinks || []).filter((link) => String(link.sourceNoteId || '').startsWith(META_SOURCE_PREFIX));
  for (const link of links) {
    if ((key && normalizeKey(link.keyword) === key) || (titleKey && normalizeKey(link.noteTitle) === titleKey)) {
      return link.linkedNoteId;
    }
  }
  return null;
}

async function runMetaAgentForMeta(metaId, title, description) {
  if (!window.uChat?.runMetaAgent) return;
  emitUiUx('meta_agent_started', {
    metaId,
    titleLength: String(title || '').length,
    descriptionLength: String(description || '').length
  });

  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    return { ...meta, agentStatus: 'running', agentLogs: [] };
  });
  saveMetas();
  renderMetasView();

  appendMetaAgentLog(metaId, 'planning', 'Iniciaré análisis de meta');
  const result = await window.uChat.runMetaAgent({ metaId, title, description });

  if (!result?.success) {
    emitUiUx('meta_agent_failed', {
      metaId,
      error: String(result?.error || '').substring(0, 140)
    });
    appendMetaAgentLog(metaId, 'error', formatMetaAgentErrorMessage(result?.error));
    state.metas = state.metas.map((meta) => (meta.id === metaId ? { ...meta, agentStatus: 'error' } : meta));
    saveMetas();
    renderMetasView();
    return;
  }

  const existingIds = uniqueIds(result.existingNoteIds || []);
  const depth = Array.isArray(result.depthNotes) ? result.depthNotes : [];

  const targetMeta = state.metas.find((meta) => meta.id === metaId);
  if (!targetMeta) return;

  const newLinks = [];
  const pendingBySignature = new Map();
  for (const item of depth) {
    const keyword = String(item.keyword || '').trim();
    const noteTitle = String(item.noteTitle || '').trim();
    if (!keyword || !noteTitle) continue;

    const signature = `${normalizeKey(keyword)}::${normalizeKey(noteTitle)}`;
    const reusedPending = pendingBySignature.get(signature);
    const reusedId = reusedPending || findReusableDepthNote(targetMeta, keyword, noteTitle);
    const linkedNoteId = reusedId || await createLinkedBlankNote(noteTitle);
    if (!linkedNoteId) continue;
    pendingBySignature.set(signature, linkedNoteId);

    newLinks.push({
      id: `link_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      sourceNoteId: `${META_SOURCE_PREFIX}${metaId}`,
      linkedNoteId,
      keyword,
      noteTitle
    });
  }

  state.metas = state.metas.map((meta) => {
    if (meta.id !== metaId) return meta;
    const keptLinks = (meta.learningLinks || []).filter((link) => !String(link.sourceNoteId || '').startsWith(META_SOURCE_PREFIX));
    const executionConfig = meta.executionConfig || { type: 'recurrent', whenText: '', enabled: false };
    const next = {
      ...meta,
      agentStatus: 'done',
      executionConfig,
      executionPromptPending: !executionConfig.enabled,
      agentNoteIds: uniqueIds([...existingIds, ...newLinks.map((link) => link.linkedNoteId)]),
      learningLinks: [...keptLinks, ...newLinks]
    };
    return { ...next, noteIds: recomputeMetaNoteIds(next) };
  });
  saveMetas();
  renderMetasView();
  renderNoteMarkers();
  emitUiUx('meta_agent_completed', {
    metaId,
    existingCount: existingIds.length,
    depthCount: newLinks.length
  });
}

function getEditIconSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
}

function getCheckIconSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
}

function getDragHandleSvg() {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M5 3.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm8 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM5 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 5 8Zm8 0a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 13 8ZM5 12.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm8 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"/></svg>';
}

function getMoreIconSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
}

function getPlayIconSvg() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 6.5v11l9-5.5-9-5.5Z"/></svg>';
}

function getMetaById(metaId) {
  return state.metas.find((meta) => meta.id === metaId) || null;
}

function ensureActiveMeta() {
  if (state.activeMetaId && getMetaById(state.activeMetaId)) return;
  state.activeMetaId = state.metas[0]?.id || null;
}

function getMetaStatusMessage(meta) {
  if (isFinanceMeta(meta)) {
    const summary = getFinanceSummary(meta);
    return `Disponible ahora: ${formatMoney(summary.currentTotal, meta?.finance?.currency || 'COP')}`;
  }
  const lines = Array.isArray(meta?.agentLogs) ? meta.agentLogs : [];
  const lastLog = String(lines[lines.length - 1]?.message || '').trim();
  if (meta?.agentStatus === 'running') return lastLog;
  if (meta?.executionPromptPending) return 'Añadir ejecución autónoma';
  if (meta?.executionConfig?.enabled) {
    const whenText = String(meta.executionConfig.whenText || '').trim();
    if (whenText) return `Ejecución autónoma: ${whenText}`;
    return 'Ejecución autónoma configurada';
  }
  return lastLog;
}

function shouldGlowMetaStatus(meta, message) {
  if (meta?.agentStatus === 'running') return true;
  return String(message || '').toLowerCase().includes('ejecución autónoma');
}

function getMetaTabTinyMessage(meta) {
  if (isFinanceMeta(meta)) {
    const summary = getFinanceSummary(meta);
    const netLabel = summary.net >= 0 ? 'superávit' : 'déficit';
    return `${meta?.finance?.timeline?.futureLabel || 'Tiempo futuro'}: ${formatMoney(summary.futureTotal, meta?.finance?.currency || 'COP')} · ${netLabel}`;
  }
  if (meta?.executionPromptPending) return 'Añadir ejecución autónoma';
  if (meta?.executionConfig?.enabled) {
    const whenText = String(meta.executionConfig.whenText || '').trim();
    if (!whenText) return 'Ejecución autónoma activa';
    const maxLen = 48;
    return whenText.length > maxLen ? `${whenText.slice(0, maxLen - 1)}…` : whenText;
  }
  return '';
}

function createMetaAgentFeed(meta) {
  const agentFeed = document.createElement('div');
  agentFeed.className = `meta-agent-feed${meta.agentStatus === 'running' ? ' running' : ''}`;
  const message = getMetaStatusMessage(meta);
  const row = document.createElement('div');
  row.className = `meta-agent-line${shouldGlowMetaStatus(meta, message) ? ' live' : ''}`;
  row.textContent = message || '';
  if (meta.executionPromptPending || meta.executionConfig?.enabled) {
    row.classList.add('actionable');
    row.title = 'Configurar ejecución autónoma';
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      state.executionModalMetaId = meta.id;
      state.metaActionsMenuMetaId = null;
      state.metaNotesMenuMetaId = null;
      renderMetasView();
    });
  }
  agentFeed.appendChild(row);
  return agentFeed;
}

function formatMetaAgentErrorMessage(rawError) {
  const raw = String(rawError || '').trim();
  if (!raw) return 'No se pudo completar';
  const compact = raw.toLowerCase();
  if (compact.includes('429') || compact.includes('quota') || compact.includes('billing')) {
    return 'Límite de cuota alcanzado. Revisa tu plan o facturación.';
  }
  return raw;
}

function createMetaNotesAddMenu(meta) {
  const menu = document.createElement('div');
  menu.className = 'meta-notes-add-menu';

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'meta-notes-add-option';
  newBtn.textContent = 'Nueva';
  newBtn.addEventListener('click', () => {
    state.metaNotesMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
    state.metaActionsMenuMetaId = null;
    state.newNoteModalMetaId = meta.id;
    state.existingNoteModalMetaId = null;
    state.existingNoteSelection = [];
    renderMetasView();
  });

  const existingBtn = document.createElement('button');
  existingBtn.type = 'button';
  existingBtn.className = 'meta-notes-add-option';
  existingBtn.textContent = 'Existente';
  existingBtn.addEventListener('click', () => {
    state.metaNotesMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
    state.metaActionsMenuMetaId = null;
    state.existingNoteModalMetaId = meta.id;
    state.newNoteModalMetaId = null;
    state.existingNoteSelection = [];
    renderMetasView();
  });

  menu.appendChild(newBtn);
  menu.appendChild(existingBtn);
  return menu;
}

function createMetaNotesSection(meta) {
  const notesInMeta = state.tabs.filter((tab) => meta.noteIds.includes(tab.id));
  if (!notesInMeta.length) return null;

  const shell = document.createElement('div');
  shell.className = 'meta-notes-shell';

  const notesGrid = document.createElement('div');
  notesGrid.className = 'meta-notes-grid';

  for (const tab of notesInMeta) {
    notesGrid.appendChild(createNotePill(tab, {
      draggable: true,
      onRemove: () => removeNoteFromMeta(meta.id, tab.id)
    }));
  }

  const noteActions = document.createElement('div');
  noteActions.className = 'meta-notes-actions';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'meta-notes-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Agregar notas';
  addBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.metaActionsMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
    state.metaNotesMenuMetaId = state.metaNotesMenuMetaId === meta.id ? null : meta.id;
    renderMetasView();
  });

  noteActions.appendChild(addBtn);

  if (state.metaNotesMenuMetaId === meta.id && state.metaNotesMenuAnchor === 'section') {
    noteActions.appendChild(createMetaNotesAddMenu(meta));
  }

  shell.appendChild(notesGrid);
  shell.appendChild(noteActions);
  return shell;
}

async function createAndAttachNoteToMeta(metaId, title, body) {
  const noteTitle = String(title || '').trim();
  const noteBody = String(body || '');
  if (!noteTitle && !noteBody.trim()) return;

  const sourceTabId = state.activeTabId;
  const created = await window.uChat.createTab({ templateId: 'blank', title: noteTitle, source: 'chat_window' });
  applySnapshot(created?.state || null, { syncEditor: false });

  let newTabId = created?.state?.activeTabId || null;
  if (!newTabId && noteTitle) {
    const fresh = state.tabs.find((tab) => normalizeKey(tab.title) === normalizeKey(noteTitle) && !String(tab.body || '').trim());
    newTabId = fresh?.id || null;
  }
  if (!newTabId) return;

  const updated = await window.uChat.updateTab({
    tabId: newTabId,
    title: noteTitle,
    body: noteBody,
    source: 'chat_window'
  });
  applySnapshot(updated?.state || null, { syncEditor: false });

  addNotesToMeta(metaId, [newTabId]);

  if (sourceTabId) {
    const restored = await window.uChat.setActiveTab(sourceTabId);
    applySnapshot(restored, { syncEditor: false });
  }
}

function renderMetaModal() {
  if (!refs.metaModalRoot) return;
  refs.metaModalRoot.innerHTML = '';

  if (state.executionModalMetaId) {
    const meta = getMetaById(state.executionModalMetaId);
    if (!meta) {
      state.executionModalMetaId = null;
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'meta-modal-backdrop';
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      state.executionModalMetaId = null;
      renderMetasView();
    });

    const panel = document.createElement('form');
    panel.className = 'meta-modal-panel';
    panel.innerHTML = `
      <h3 class="meta-modal-title">Ejecución autónoma</h3>
      <div class="meta-execution-types">
        <label class="meta-execution-type"><input type="radio" name="type" value="recurrent" checked />Recurrente</label>
        <label class="meta-execution-type"><input type="radio" name="type" value="dynamic" />Dinámica</label>
        <label class="meta-execution-type"><input type="radio" name="type" value="oneoff" />Única</label>
      </div>
      <textarea class="meta-modal-textarea" name="whenText" placeholder="Ej: Todos los días a las 4 PM revisar finanzas"></textarea>
      <div class="meta-modal-actions">
        <button type="button" class="meta-modal-btn subtle">Cancelar</button>
        <button type="submit" class="meta-modal-btn">Guardar</button>
      </div>
    `;

    const currentType = normalizeExecutionType(meta.executionConfig?.type);
    const typeInput = panel.querySelector(`input[name="type"][value="${currentType}"]`);
    if (typeInput) typeInput.checked = true;
    const textInput = panel.querySelector('textarea[name="whenText"]');
    textInput.value = String(meta.executionConfig?.whenText || '').trim();

    panel.querySelector('.meta-modal-btn.subtle').addEventListener('click', () => {
      state.executionModalMetaId = null;
      renderMetasView();
    });

    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(panel);
      const type = normalizeExecutionType(form.get('type'));
      const whenText = String(form.get('whenText') || '').trim();
      if (!whenText) return;
      updateMeta(meta.id, {
        executionConfig: { type, whenText, enabled: true },
        executionPromptPending: false
      }, false);
      appendMetaAgentLog(meta.id, 'execution', 'Ejecución autónoma configurada');
      state.executionModalMetaId = null;
      renderMetasView();
    });

    modal.appendChild(panel);
    refs.metaModalRoot.appendChild(modal);
    return;
  }

  if (state.newNoteModalMetaId) {
    const modal = document.createElement('div');
    modal.className = 'meta-modal-backdrop';
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      state.newNoteModalMetaId = null;
      renderMetasView();
    });

    const panel = document.createElement('form');
    panel.className = 'meta-modal-panel';
    panel.innerHTML = `
      <h3 class="meta-modal-title">Nueva nota</h3>
      <input class="meta-modal-input" name="title" type="text" placeholder="Titulo" required />
      <textarea class="meta-modal-textarea" name="body" placeholder="Descripcion"></textarea>
      <div class="meta-modal-actions">
        <button type="button" class="meta-modal-btn subtle">Cancelar</button>
        <button type="submit" class="meta-modal-btn">Crear</button>
      </div>
    `;

    panel.querySelector('.meta-modal-btn.subtle').addEventListener('click', () => {
      state.newNoteModalMetaId = null;
      renderMetasView();
    });

    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(panel);
      const title = String(form.get('title') || '').trim();
      const body = String(form.get('body') || '');
      if (!title) return;
      const targetMetaId = state.newNoteModalMetaId;
      state.newNoteModalMetaId = null;
      renderMetasView();
      await createAndAttachNoteToMeta(targetMetaId, title, body);
    });

    modal.appendChild(panel);
    refs.metaModalRoot.appendChild(modal);
    return;
  }

  if (state.existingNoteModalMetaId) {
    const meta = getMetaById(state.existingNoteModalMetaId);
    const selected = new Set(state.existingNoteSelection || []);

    const modal = document.createElement('div');
    modal.className = 'meta-modal-backdrop';
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      state.existingNoteModalMetaId = null;
      state.existingNoteSelection = [];
      renderMetasView();
    });

    const panel = document.createElement('div');
    panel.className = 'meta-modal-panel';

    const title = document.createElement('h3');
    title.className = 'meta-modal-title';
    title.textContent = 'Agregar nota existente';

    const list = document.createElement('div');
    list.className = 'meta-existing-list';

    for (const tab of state.tabs) {
      const row = document.createElement('label');
      row.className = 'meta-existing-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selected.has(tab.id);
      input.addEventListener('change', () => {
        if (input.checked) selected.add(tab.id);
        else selected.delete(tab.id);
        state.existingNoteSelection = Array.from(selected);
      });
      const label = document.createElement('span');
      label.textContent = tabLabel(tab);
      row.appendChild(input);
      row.appendChild(label);
      list.appendChild(row);
    }

    if (state.tabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-inline';
      empty.textContent = 'No hay notas disponibles';
      list.appendChild(empty);
    }

    const actions = document.createElement('div');
    actions.className = 'meta-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'meta-modal-btn subtle';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => {
      state.existingNoteModalMetaId = null;
      state.existingNoteSelection = [];
      renderMetasView();
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'meta-modal-btn';
    addBtn.textContent = 'Agregar';
    addBtn.addEventListener('click', () => {
      const ids = Array.from(selected);
      if (meta && ids.length) {
        addNotesToMeta(meta.id, ids);
      }
      state.existingNoteModalMetaId = null;
      state.existingNoteSelection = [];
      renderMetasView();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(addBtn);
    panel.appendChild(title);
    panel.appendChild(list);
    panel.appendChild(actions);
    modal.appendChild(panel);
    refs.metaModalRoot.appendChild(modal);
  }
}

function patchFinanceMeta(metaId, updater, rerender = false) {
  const targetMeta = getMetaById(metaId);
  if (!targetMeta || !isFinanceMeta(targetMeta)) return null;
  const base = sanitizeFinanceState(targetMeta.finance);
  const nextFinance = typeof updater === 'function'
    ? sanitizeFinanceState(updater(base) || base)
    : sanitizeFinanceState({ ...base, ...(updater || {}) });
  updateMeta(metaId, { finance: nextFinance, isSaved: false }, rerender);
  return nextFinance;
}

function mutateFinancePocket(metaId, pocketId, updater, rerender = false) {
  return patchFinanceMeta(metaId, (finance) => {
    const pockets = finance.pockets.map((pocket) => {
      if (pocket.id !== pocketId) return pocket;
      const nextPocket = typeof updater === 'function' ? updater({ ...pocket }) : { ...pocket, ...(updater || {}) };
      return sanitizeFinancePocket({ ...nextPocket, id: pocket.id });
    });
    return { ...finance, pockets };
  }, rerender);
}

function createFinancePocketCard(meta, pocket) {
  const card = document.createElement('div');
  card.className = 'finance-pocket-card';

  const top = document.createElement('div');
  top.className = 'finance-pocket-top';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'finance-pocket-input finance-pocket-name';
  nameInput.placeholder = 'Nombre del bolsillo';
  nameInput.value = String(pocket.name || '');
  nameInput.addEventListener('input', () => {
    mutateFinancePocket(meta.id, pocket.id, { name: nameInput.value }, false);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'finance-pocket-delete';
  removeBtn.textContent = 'Eliminar';
  removeBtn.addEventListener('click', () => {
    patchFinanceMeta(meta.id, (finance) => ({
      ...finance,
      pockets: finance.pockets.filter((item) => item.id !== pocket.id)
    }), true);
  });

  top.appendChild(nameInput);
  top.appendChild(removeBtn);

  const bankInput = document.createElement('input');
  bankInput.type = 'text';
  bankInput.className = 'finance-pocket-input';
  bankInput.placeholder = 'Banco o app';
  bankInput.value = String(pocket.bank || '');
  bankInput.addEventListener('input', () => {
    mutateFinancePocket(meta.id, pocket.id, { bank: bankInput.value }, false);
  });

  const purposeInput = document.createElement('input');
  purposeInput.type = 'text';
  purposeInput.className = 'finance-pocket-input';
  purposeInput.placeholder = 'Uso de este bolsillo';
  purposeInput.value = String(pocket.purpose || '');
  purposeInput.addEventListener('input', () => {
    mutateFinancePocket(meta.id, pocket.id, { purpose: purposeInput.value }, false);
  });

  const balanceRow = document.createElement('div');
  balanceRow.className = 'finance-pocket-balance-row';

  const balanceLabel = document.createElement('span');
  balanceLabel.className = 'finance-pocket-balance-label';
  balanceLabel.textContent = 'Saldo';

  const balanceInput = document.createElement('input');
  balanceInput.type = 'number';
  balanceInput.step = '1000';
  balanceInput.className = 'finance-pocket-balance-input';
  balanceInput.value = String(Number(pocket.balance || 0));
  balanceInput.addEventListener('input', () => {
    mutateFinancePocket(meta.id, pocket.id, { balance: sanitizeMoney(balanceInput.value) }, false);
  });

  balanceRow.appendChild(balanceLabel);
  balanceRow.appendChild(balanceInput);

  const amountRow = document.createElement('div');
  amountRow.className = 'finance-pocket-amount-row';

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '1000';
  amountInput.className = 'finance-pocket-amount-input';
  amountInput.placeholder = 'Monto';

  const depositBtn = document.createElement('button');
  depositBtn.type = 'button';
  depositBtn.className = 'finance-pocket-action positive';
  depositBtn.textContent = 'Cargar';
  depositBtn.addEventListener('click', () => {
    const amount = Math.abs(sanitizeMoney(amountInput.value));
    if (!amount) return;
    mutateFinancePocket(meta.id, pocket.id, (current) => ({
      ...current,
      balance: sanitizeMoney(current.balance + amount)
    }), true);
  });

  const withdrawBtn = document.createElement('button');
  withdrawBtn.type = 'button';
  withdrawBtn.className = 'finance-pocket-action negative';
  withdrawBtn.textContent = 'Descargar';
  withdrawBtn.addEventListener('click', () => {
    const amount = Math.abs(sanitizeMoney(amountInput.value));
    if (!amount) return;
    mutateFinancePocket(meta.id, pocket.id, (current) => ({
      ...current,
      balance: sanitizeMoney(current.balance - amount)
    }), true);
  });

  amountRow.appendChild(amountInput);
  amountRow.appendChild(depositBtn);
  amountRow.appendChild(withdrawBtn);

  const currentBalance = document.createElement('div');
  currentBalance.className = 'finance-pocket-balance-pill';
  currentBalance.textContent = formatMoney(pocket.balance, meta?.finance?.currency || 'COP');

  card.appendChild(top);
  card.appendChild(bankInput);
  card.appendChild(purposeInput);
  card.appendChild(balanceRow);
  card.appendChild(amountRow);
  card.appendChild(currentBalance);
  return card;
}

function createFinancePocketsSection(meta) {
  const section = document.createElement('section');
  section.className = 'finance-section';

  const header = document.createElement('div');
  header.className = 'finance-section-header';

  const title = document.createElement('h4');
  title.className = 'finance-section-title';
  title.textContent = 'Bolsillos';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'finance-section-add';
  addBtn.textContent = '+ Agregar bolsillo';
  addBtn.addEventListener('click', () => {
    patchFinanceMeta(meta.id, (finance) => ({
      ...finance,
      pockets: [...finance.pockets, sanitizeFinancePocket({ name: `Bolsillo ${finance.pockets.length + 1}` })]
    }), true);
  });

  header.appendChild(title);
  header.appendChild(addBtn);

  const grid = document.createElement('div');
  grid.className = 'finance-pocket-grid';
  const pockets = Array.isArray(meta?.finance?.pockets) ? meta.finance.pockets : [];
  for (const pocket of pockets) {
    grid.appendChild(createFinancePocketCard(meta, pocket));
  }

  if (!pockets.length) {
    const empty = document.createElement('div');
    empty.className = 'finance-pocket-empty';
    empty.textContent = 'Aún no hay bolsillos. Crea el primero para empezar a distribuir el dinero real.';
    grid.appendChild(empty);
  }

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function createFinanceTimelineSection(meta) {
  const section = document.createElement('section');
  section.className = 'finance-section finance-time-section';
  const finance = sanitizeFinanceState(meta.finance);
  const summary = getFinanceSummary(meta);
  const commitProjection = (rerender) => {
    patchFinanceMeta(meta.id, {
      ...finance,
      timeline: {
        ...finance.timeline,
        currentLabel: currentLabelInput.value,
        futureLabel: futureLabelInput.value
      },
      forecast: {
        expectedIncome: sanitizeMoney(incomeInput.value),
        expectedExpenses: sanitizeMoney(expenseInput.value),
        horizonWeeks: sanitizePositiveInt(horizonInput.value, finance.forecast.horizonWeeks)
      }
    }, rerender);
  };

  const header = document.createElement('div');
  header.className = 'finance-section-header';

  const title = document.createElement('h4');
  title.className = 'finance-section-title';
  title.textContent = 'Tiempo actual y futuro';
  header.appendChild(title);

  const cards = document.createElement('div');
  cards.className = 'finance-time-cards';

  const currentCard = document.createElement('div');
  currentCard.className = 'finance-time-card current';
  currentCard.innerHTML = `
    <span class="finance-time-label">${escapeHtml(finance.timeline.currentLabel)}</span>
    <strong class="finance-time-value">${escapeHtml(formatMoney(summary.currentTotal, finance.currency))}</strong>
    <span class="finance-time-sub">Saldo distribuido hoy en bolsillos</span>
  `;

  const futureCard = document.createElement('div');
  const tone = summary.futureTotal >= 0 ? 'positive' : 'negative';
  futureCard.className = `finance-time-card future ${tone}`;
  futureCard.innerHTML = `
    <span class="finance-time-label">${escapeHtml(finance.timeline.futureLabel)}</span>
    <strong class="finance-time-value">${escapeHtml(formatMoney(summary.futureTotal, finance.currency))}</strong>
    <span class="finance-time-sub">Proyección a ${escapeHtml(String(finance.forecast.horizonWeeks))} semanas</span>
  `;

  cards.appendChild(currentCard);
  cards.appendChild(futureCard);

  const inputs = document.createElement('div');
  inputs.className = 'finance-time-inputs';

  const currentLabelInput = document.createElement('input');
  currentLabelInput.type = 'text';
  currentLabelInput.className = 'finance-time-input';
  currentLabelInput.placeholder = 'Etiqueta actual';
  currentLabelInput.value = finance.timeline.currentLabel;
  currentLabelInput.addEventListener('input', () => commitProjection(false));
  currentLabelInput.addEventListener('change', () => commitProjection(true));

  const futureLabelInput = document.createElement('input');
  futureLabelInput.type = 'text';
  futureLabelInput.className = 'finance-time-input';
  futureLabelInput.placeholder = 'Etiqueta futura';
  futureLabelInput.value = finance.timeline.futureLabel;
  futureLabelInput.addEventListener('input', () => commitProjection(false));
  futureLabelInput.addEventListener('change', () => commitProjection(true));

  const incomeInput = document.createElement('input');
  incomeInput.type = 'number';
  incomeInput.step = '1000';
  incomeInput.className = 'finance-time-input';
  incomeInput.placeholder = 'Ingresos previstos';
  incomeInput.value = String(finance.forecast.expectedIncome || 0);
  incomeInput.addEventListener('input', () => commitProjection(false));
  incomeInput.addEventListener('change', () => commitProjection(true));

  const expenseInput = document.createElement('input');
  expenseInput.type = 'number';
  expenseInput.step = '1000';
  expenseInput.className = 'finance-time-input';
  expenseInput.placeholder = 'Gastos previstos';
  expenseInput.value = String(finance.forecast.expectedExpenses || 0);
  expenseInput.addEventListener('input', () => commitProjection(false));
  expenseInput.addEventListener('change', () => commitProjection(true));

  const horizonInput = document.createElement('input');
  horizonInput.type = 'number';
  horizonInput.min = '1';
  horizonInput.max = '52';
  horizonInput.className = 'finance-time-input';
  horizonInput.placeholder = 'Semanas';
  horizonInput.value = String(finance.forecast.horizonWeeks || 4);
  horizonInput.addEventListener('input', () => commitProjection(false));
  horizonInput.addEventListener('change', () => commitProjection(true));

  inputs.appendChild(currentLabelInput);
  inputs.appendChild(futureLabelInput);
  inputs.appendChild(incomeInput);
  inputs.appendChild(expenseInput);
  inputs.appendChild(horizonInput);

  const signal = document.createElement('div');
  signal.className = `finance-signal ${summary.net >= 0 ? 'positive' : 'negative'}`;
  signal.textContent = summary.net >= 0
    ? `Proyección con superávit de ${formatMoney(summary.net, finance.currency)}`
    : `Proyección con déficit de ${formatMoney(Math.abs(summary.net), finance.currency)}`;

  section.appendChild(header);
  section.appendChild(cards);
  section.appendChild(inputs);
  section.appendChild(signal);
  if (summary.runwayWeeks !== null) {
    const runway = document.createElement('div');
    runway.className = 'finance-runway';
    runway.textContent = `Holgura estimada: ${summary.runwayWeeks.toFixed(1)} semanas de cobertura con el saldo actual.`;
    section.appendChild(runway);
  }
  return section;
}

function createMetaCard(meta, options = {}) {
  const expanded = options.expanded === true;
  const financeMeta = isFinanceMeta(meta);
  const liveMeta = getLiveMetaPresentation(meta.id);
  const displayTitle = liveMeta ? liveMeta.title : meta.title;
  const displayDescription = liveMeta ? liveMeta.description : meta.description;
  const card = document.createElement('div');
  card.className = `group-drop ${expanded ? 'meta-expanded-card' : 'meta-compact-card'}${state.activeMetaId === meta.id ? ' active-meta' : ''}${meta.isSaved ? ' saved-meta' : ''}${liveMeta ? ' live-focus-card' : ''}${financeMeta ? ' finance-meta-card' : ''}`;
  card.addEventListener('mousedown', (event) => {
    if (event.target.closest('input, textarea, button, [draggable="true"]')) return;
    if (state.activeMetaId !== meta.id) {
      state.activeMetaId = meta.id;
      renderMetasView();
      renderNoteMarkers();
    }
  });

  if (!expanded && state.metas.length > 1 && !meta.isFixed) {
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'meta-drag-handle';
    dragHandle.draggable = true;
    dragHandle.innerHTML = getDragHandleSvg();
    dragHandle.title = 'Arrastrar meta';
    dragHandle.addEventListener('dragstart', (event) => {
      state.draggingMetaId = meta.id;
      state.draggingNoteId = null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/meta-id', meta.id);
      event.dataTransfer.setData('text/plain', `meta:${meta.id}`);
    });
    dragHandle.addEventListener('dragend', () => {
      state.draggingMetaId = null;
      renderMetasView();
    });
    card.appendChild(dragHandle);
  }

  const body = document.createElement('div');
  body.className = 'meta-body';

  const top = document.createElement('div');
  top.className = 'meta-saved-top';

  const actions = document.createElement('div');
  actions.className = 'meta-actions';

  let titleInput = null;
  let descriptionInput = null;
  let saveBtn = null;
  const alwaysEditable = expanded;

  if (!alwaysEditable && meta.isSaved) {
    const savedTitle = document.createElement('div');
    savedTitle.className = 'meta-saved-title';
    savedTitle.textContent = displayTitle || 'Meta sin titulo';
    top.appendChild(savedTitle);

    if (financeMeta) {
      const badge = document.createElement('span');
      badge.className = 'finance-fixed-badge';
      badge.textContent = 'Meta fija';
      top.appendChild(badge);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'meta-save-btn saved';
    editBtn.innerHTML = getEditIconSvg();
    editBtn.title = 'Editar meta';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.activeMetaId = meta.id;
      updateMeta(meta.id, { isSaved: false }, true);
      setMetaViewMode('expanded');
      renderNoteMarkers();
      requestAnimationFrame(() => {
        focusActiveMetaEditor();
      });
    });
    actions.appendChild(editBtn);
  } else {
    if (financeMeta) {
      const financeHeader = document.createElement('div');
      financeHeader.className = 'finance-fixed-header';
      const financeTitle = document.createElement('div');
      financeTitle.className = 'meta-saved-title';
      financeTitle.textContent = 'Finanzas';
      const financeSub = document.createElement('div');
      financeSub.className = 'finance-fixed-subtitle';
      financeSub.textContent = 'Agente especializado con bolsillos, instrucciones y lectura temporal.';
      financeHeader.appendChild(financeTitle);
      financeHeader.appendChild(financeSub);
      top.appendChild(financeHeader);
    } else {
      titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'meta-title-input';
      titleInput.placeholder = 'Titulo de meta';
      titleInput.value = displayTitle || '';
      titleInput.classList.toggle('live-writing', Boolean(liveMeta));
      titleInput.addEventListener('input', () => {
        updateMeta(meta.id, { title: titleInput.value, isSaved: false }, false);
      });
      top.appendChild(titleInput);
    }

    if (expanded) {
      descriptionInput = document.createElement('textarea');
      descriptionInput.className = 'meta-description-input';
      descriptionInput.placeholder = financeMeta
        ? 'Instrucciones vivas del agente financiero. Aquí se anotan reglas, decisiones del usuario, criterios por banco y feedback diario.'
        : 'Descripcion de meta';
      descriptionInput.value = displayDescription || '';
      descriptionInput.classList.toggle('live-writing', Boolean(liveMeta));
      descriptionInput.addEventListener('input', () => {
        updateMeta(meta.id, { description: descriptionInput.value, isSaved: false }, false);
      });
    }

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = `meta-save-btn${meta.isSaved ? ' saved' : ''}`;
    saveBtn.innerHTML = getCheckIconSvg();
    saveBtn.title = 'Guardar meta';
    saveBtn.addEventListener('click', async () => {
      const nextTitle = financeMeta ? 'Finanzas' : String(titleInput?.value || '').trim();
      const nextDescription = descriptionInput ? String(descriptionInput.value || '') : String(meta.description || '');
      state.activeMetaId = meta.id;
      updateMeta(meta.id, {
        title: nextTitle,
        description: nextDescription,
        isSaved: true
      }, true);
      await runMetaAgentForMeta(meta.id, nextTitle, nextDescription);
      renderNoteMarkers();
    });
  }

  const moreShell = document.createElement('div');
  moreShell.className = 'meta-actions-menu-shell';

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'meta-more-btn';
  moreBtn.innerHTML = getMoreIconSvg();
  moreBtn.title = 'Más opciones';
  moreBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.metaNotesMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
    state.metaActionsMenuMetaId = state.metaActionsMenuMetaId === meta.id ? null : meta.id;
    renderMetasView();
  });
  moreShell.appendChild(moreBtn);

  if (state.metaActionsMenuMetaId === meta.id) {
    const menu = document.createElement('div');
    menu.className = 'meta-actions-menu';

    const viewModeBtn = document.createElement('button');
    viewModeBtn.type = 'button';
    viewModeBtn.className = 'meta-actions-option';
    viewModeBtn.textContent = expanded ? 'Minimizar' : 'Enfocar';
    viewModeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.metaActionsMenuMetaId = null;
      state.metaNotesMenuMetaId = null;
      state.metaNotesMenuAnchor = 'section';
      setMetaViewMode(expanded ? 'compact' : 'expanded');
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meta-actions-option';
    removeBtn.textContent = 'Eliminar';
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.metaActionsMenuMetaId = null;
      state.metaNotesMenuMetaId = null;
      state.metaNotesMenuAnchor = 'section';
      removeMeta(meta.id);
    });

    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'meta-actions-option';
    attachBtn.textContent = 'Anidar nota';
    attachBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.metaActionsMenuMetaId = null;
      state.metaNotesMenuAnchor = 'actions';
      state.metaNotesMenuMetaId = meta.id;
      renderMetasView();
    });

    menu.appendChild(viewModeBtn);
    if (!meta.isFixed) {
      menu.appendChild(removeBtn);
    }
    menu.appendChild(attachBtn);
    moreShell.appendChild(menu);
  }

  if (state.metaNotesMenuMetaId === meta.id && state.metaNotesMenuAnchor === 'actions') {
    const addMenu = createMetaNotesAddMenu(meta);
    addMenu.classList.add('from-actions');
    moreShell.appendChild(addMenu);
  }

  if (saveBtn) {
    actions.appendChild(moreShell);
    actions.appendChild(saveBtn);
    if (meta.isSaved && meta.agentStatus === 'done') {
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'meta-play-btn';
      playBtn.innerHTML = getPlayIconSvg();
      playBtn.title = 'Próximamente';
      playBtn.disabled = true;
      actions.appendChild(playBtn);
    }
  } else {
    actions.appendChild(moreShell);
  }

  top.appendChild(actions);
  body.appendChild(top);

  card.addEventListener('dragover', (event) => {
    const draggedMetaId = getDraggedMetaIdFromEvent(event);
    const draggedNoteId = getDraggedNoteIdFromEvent(event);
    if (!draggedMetaId && !draggedNoteId) return;
    if (draggedMetaId) {
      if (expanded) return;
      if (draggedMetaId === meta.id) return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-over');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('drag-over');
    event.stopPropagation();

    const draggedMetaId = getDraggedMetaIdFromEvent(event);
    if (draggedMetaId) {
      if (expanded) return;
      if (draggedMetaId === meta.id) return;
      const rect = card.getBoundingClientRect();
      const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      reorderMetas(draggedMetaId, meta.id, position);
      state.draggingMetaId = null;
      return;
    }

    const noteId = getDraggedNoteIdFromEvent(event);
    if (!noteId) return;
    addNotesToMeta(meta.id, [noteId]);
    state.draggingNoteId = null;
  });

  const agentFeed = createMetaAgentFeed(meta);
  body.appendChild(agentFeed);

  if (expanded && descriptionInput) {
    body.appendChild(descriptionInput);
  }

  if (expanded && financeMeta) {
    body.appendChild(createFinancePocketsSection(meta));
    body.appendChild(createFinanceTimelineSection(meta));
  }

  const notesSection = createMetaNotesSection(meta);
  if (notesSection) {
    body.appendChild(notesSection);
  }

  card.appendChild(body);
  return card;
}

function createExpandedMetaTabs() {
  const row = document.createElement('div');
  row.className = 'tabs-row meta-tabs-row';

  const tabs = document.createElement('div');
  tabs.className = 'meta-expand-tabs note-tabs';
  for (const meta of state.metas) {
    const liveMeta = getLiveMetaPresentation(meta.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `meta-expand-tab note-tab${meta.id === state.activeMetaId ? ' active' : ''}${liveMeta ? ' live-focus-tab' : ''}`;

    const title = document.createElement('span');
    title.className = 'meta-expand-tab-title';
    title.textContent = liveMeta?.title || meta.title || 'Meta sin titulo';
    button.appendChild(title);

    if (meta.id === state.activeMetaId) {
      const tiny = getMetaTabTinyMessage(meta);
      if (tiny) {
        const sub = document.createElement('span');
        sub.className = 'meta-expand-tab-sub';
        sub.textContent = tiny;
        button.appendChild(sub);
      }
    }

    button.addEventListener('click', () => {
      state.activeMetaId = meta.id;
      renderMetasView();
    });
    tabs.appendChild(button);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tab-add-btn meta-tab-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Nueva meta';
  addBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    addMeta();
  });

  row.appendChild(tabs);
  row.appendChild(addBtn);
  restoreTabsScroll('metas', tabs);
  return row;
}

function renderMetasView() {
  ensureActiveMeta();
  rememberTabsScroll('metas', refs.projectGroups.querySelector('.meta-expand-tabs'));
  refs.projectGroups.innerHTML = '';
  refs.projectGroups.classList.remove('compact-layout', 'expanded-layout');
  refs.projectsView.classList.toggle('has-metas', state.metas.length > 0);
  refs.projectsView.classList.toggle('meta-view-expanded', state.metaViewMode === 'expanded');
  refs.projectsView.classList.toggle('meta-view-compact', state.metaViewMode === 'compact');
  const shouldShowPrimaryPlus = state.metas.length === 0 || state.metaViewMode === 'compact';
  refs.newGroupPlus.style.display = shouldShowPrimaryPlus ? '' : 'none';

  refs.projectGroups.ondragover = null;
  refs.projectGroups.ondrop = null;

  if (!state.metas.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-inline';
    empty.textContent = 'Crea una meta con +';
    refs.projectGroups.appendChild(empty);
    renderMetaModal();
    return;
  }

  if (state.metaViewMode === 'expanded') {
    refs.projectGroups.classList.add('expanded-layout');
    refs.projectGroups.appendChild(createExpandedMetaTabs());
    const activeMeta = getMetaById(state.activeMetaId) || state.metas[0];
    if (activeMeta) {
      refs.projectGroups.appendChild(createMetaCard(activeMeta, { expanded: true }));
    }
  } else {
    refs.projectGroups.classList.add('compact-layout');
    refs.projectGroups.ondragover = (event) => {
      if (!getDraggedMetaIdFromEvent(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };

    refs.projectGroups.ondrop = (event) => {
      const draggedMetaId = getDraggedMetaIdFromEvent(event);
      if (!draggedMetaId) return;
      const card = event.target.closest('.group-drop');
      if (card) return;
      event.preventDefault();
      moveMetaToIndex(draggedMetaId, state.metas.length - 1);
      state.draggingMetaId = null;
    };

    for (const meta of state.metas) {
      refs.projectGroups.appendChild(createMetaCard(meta, { expanded: false }));
    }
  }

  renderMetaModal();
}

function addMeta() {
  clearLivePresentation();
  closeMetaOverlays();
  const id = `meta_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
  emitUiUx('meta_created', { metaId: id });
  state.activeMetaId = id;
  state.metas.unshift({
    id,
    kind: 'generic',
    isFixed: false,
    title: '',
    description: '',
    noteIds: [],
    manualNoteIds: [],
    agentNoteIds: [],
    excludedNoteIds: [],
    learningLinks: [],
    isSaved: false,
    executionConfig: { type: 'recurrent', whenText: '', enabled: false },
    executionPromptPending: false,
    agentStatus: 'idle',
    agentLogs: [],
    finance: null
  });
  saveMetas();
  renderMetasView();
  requestAnimationFrame(() => {
    focusActiveMetaEditor();
  });
}

function focusActiveMetaEditor() {
  const activeCard = refs.projectGroups.querySelector('.group-drop.active-meta');
  if (!activeCard) return;
  activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const titleInput = activeCard.querySelector('.meta-title-input');
  if (titleInput) {
    titleInput.focus();
    const end = titleInput.value.length;
    titleInput.setSelectionRange(end, end);
    return;
  }
  const descriptionInput = activeCard.querySelector('.meta-description-input');
  if (descriptionInput) {
    descriptionInput.focus();
    const end = descriptionInput.value.length;
    descriptionInput.setSelectionRange(end, end);
  }
}

async function createLinkedBlankNote(noteTitle) {
  const sourceSnapshot = getActiveTab();
  const created = await window.uChat.createTab({ templateId: 'blank', title: noteTitle || '', source: 'chat_window' });
  applySnapshot(created?.state || null, { syncEditor: false });

  const newTab = state.tabs.find((tab) => normalizeKey(tab.title) === normalizeKey(noteTitle) && !String(tab.body || '').trim());
  const linkedId = created?.state?.activeTabId || newTab?.id || null;

  if (sourceSnapshot?.id) {
    const next = await window.uChat.setActiveTab(sourceSnapshot.id);
    applySnapshot(next, { syncEditor: true });
  }

  console.log('[LearningNote] Created blank note', { noteTitle, linkedId });
  emitUiUx('linked_blank_note_created', {
    noteTitleLength: String(noteTitle || '').length,
    linkedId
  });
  return linkedId;
}

function bindEvents() {
  refs.modeNotesBtn.addEventListener('click', () => setMode('notes'));
  refs.modeProjectsBtn.addEventListener('click', () => setMode('projects'));

  refs.noteTabAdd.addEventListener('click', async () => {
    emitUiUx('note_created_from_plus');
    const created = await window.uChat.createTab({ templateId: 'blank', title: '', source: 'chat_window' });
    applySnapshot(created?.state || null, { syncEditor: true });
    setMode('notes');
  });

  refs.noteTitle.addEventListener('input', () => {
    const tab = getActiveTab();
    if (tab) tab.title = refs.noteTitle.value || '';
    renderNoteTabs();
    renderMetasView();
    saveTabSoon();
  });

  refs.noteBody.addEventListener('input', () => {
    autoResizeNoteBody();
    saveTabSoon();
    renderNoteMarkers();
  });

  refs.noteBody.addEventListener('scroll', () => {
    refs.noteMarkers.scrollTop = refs.noteBody.scrollTop;
    refs.noteMarkers.scrollLeft = refs.noteBody.scrollLeft;
  });

  refs.newGroupPlus.addEventListener('click', addMeta);

  document.addEventListener('mousedown', (event) => {
    const clickedInsideMenus = event.target.closest('.meta-notes-actions, .meta-actions-menu-shell');
    if (clickedInsideMenus) return;
    if (!state.metaNotesMenuMetaId && !state.metaActionsMenuMetaId) return;
    state.metaNotesMenuMetaId = null;
    state.metaNotesMenuAnchor = 'section';
    state.metaActionsMenuMetaId = null;
    renderMetasView();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!state.newNoteModalMetaId && !state.existingNoteModalMetaId && !state.metaNotesMenuMetaId && !state.metaActionsMenuMetaId && !state.executionModalMetaId) return;
    closeMetaOverlays();
    renderMetasView();
  });
}

async function init() {
  await initThemeSync();
  state.metaViewMode = loadMetaViewMode();
  bindEvents();

  if (window.uChat?.onKnowledgeStateChanged) {
    window.uChat.onKnowledgeStateChanged((payload) => {
      handleKnowledgeStateChanged(payload);
    });
  }

  if (window.uChat?.onAgentProgress) {
    window.uChat.onAgentProgress((payload) => {
      handleAgentToolStart(payload);
    });
  }

  if (window.uChat?.onMetaAgentProgress) {
    window.uChat.onMetaAgentProgress((payload) => {
      applyMetaAgentProgress(payload);
    });
  }

  try {
    const snapshot = await window.uChat.bootstrap();
    applySnapshot(snapshot, { syncEditor: true });
    autoResizeNoteBody();
    emitUiUx('bootstrap_ok', {
      tabs: Array.isArray(snapshot?.tabs) ? snapshot.tabs.length : 0,
      executions: Array.isArray(snapshot?.executions) ? snapshot.executions.length : 0
    });
  } catch (error) {
    console.error(error);
    emitUiUx('bootstrap_error', {
      error: String(error?.message || error || '').substring(0, 140)
    });
  }

  setMode('projects');
}

init();

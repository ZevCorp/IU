const METAS_STORAGE_KEY = 'iu_metas_v4';
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
  existingNoteSelection: []
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
const metaFeedUiState = new Map();

function emitUiUx(event, data = {}) {
  if (!window.uChat?.logUiUx) return;
  window.uChat.logUiUx({
    scope: 'chat_notas_metas',
    event,
    data
  });
}

function tabLabel(tab) {
  const title = String(tab?.title || '').trim();
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
      : []
  };
}

function loadMetas() {
  try {
    const raw = localStorage.getItem(METAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeMeta).filter((meta) => meta.id);
  } catch (_) {
    return [];
  }
}

function saveMetas() {
  localStorage.setItem(METAS_STORAGE_KEY, JSON.stringify(state.metas));
}

function cleanupMetasAgainstTabs() {
  const validIds = new Set(state.tabs.map((tab) => tab.id));
  state.metas = state.metas.map((meta) => {
    const next = {
      ...meta,
      manualNoteIds: meta.manualNoteIds.filter((id) => validIds.has(id)),
      agentNoteIds: meta.agentNoteIds.filter((id) => validIds.has(id)),
      excludedNoteIds: meta.excludedNoteIds.filter((id) => validIds.has(id)),
      learningLinks: (meta.learningLinks || []).filter((link) => (String(link.sourceNoteId || '').startsWith(META_SOURCE_PREFIX) || validIds.has(link.sourceNoteId)) && validIds.has(link.linkedNoteId))
    };
    return { ...next, noteIds: recomputeMetaNoteIds(next) };
  });
  saveMetas();
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

function applySnapshot(snapshot, options = {}) {
  if (!snapshot) return;

  state.tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : state.tabs;
  state.executions = Array.isArray(snapshot.executions) ? snapshot.executions : state.executions;
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
  const next = await window.uChat.archiveTab(tabId);
  applySnapshot(next, { syncEditor: true });
}

function renderNoteTabs() {
  refs.noteTabs.innerHTML = '';

  for (const tab of state.tabs) {
    const root = document.createElement('div');
    root.className = `note-tab${tab.id === state.activeTabId ? ' active' : ''}`;

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
        body: refs.noteBody.value
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
    return { ...meta, ...patch };
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
  const created = await window.uChat.createTab({ templateId: 'blank', title: noteTitle });
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
    body: noteBody
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

function createMetaCard(meta, options = {}) {
  const expanded = options.expanded === true;
  const card = document.createElement('div');
  card.className = `group-drop ${expanded ? 'meta-expanded-card' : 'meta-compact-card'}${state.activeMetaId === meta.id ? ' active-meta' : ''}${meta.isSaved ? ' saved-meta' : ''}`;
  card.addEventListener('mousedown', (event) => {
    if (event.target.closest('input, textarea, button, [draggable="true"]')) return;
    if (state.activeMetaId !== meta.id) {
      state.activeMetaId = meta.id;
      renderMetasView();
      renderNoteMarkers();
    }
  });

  if (!expanded && state.metas.length > 1) {
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
    savedTitle.textContent = meta.title || 'Meta sin titulo';
    top.appendChild(savedTitle);

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
    titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'meta-title-input';
    titleInput.placeholder = 'Titulo de meta';
    titleInput.value = meta.title || '';
    titleInput.addEventListener('input', () => {
      updateMeta(meta.id, { title: titleInput.value, isSaved: false }, false);
    });
    top.appendChild(titleInput);

    if (expanded) {
      descriptionInput = document.createElement('textarea');
      descriptionInput.className = 'meta-description-input';
      descriptionInput.placeholder = 'Descripcion de meta';
      descriptionInput.value = meta.description || '';
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
      const nextTitle = String(titleInput?.value || '').trim();
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
    menu.appendChild(removeBtn);
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `meta-expand-tab note-tab${meta.id === state.activeMetaId ? ' active' : ''}`;

    const title = document.createElement('span');
    title.className = 'meta-expand-tab-title';
    title.textContent = meta.title || 'Meta sin titulo';
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
  return row;
}

function renderMetasView() {
  ensureActiveMeta();
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
  closeMetaOverlays();
  const id = `meta_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
  emitUiUx('meta_created', { metaId: id });
  state.activeMetaId = id;
  state.metas.unshift({
    id,
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
    agentLogs: []
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
  if (!titleInput) return;
  titleInput.focus();
  const end = titleInput.value.length;
  titleInput.setSelectionRange(end, end);
}

async function createLinkedBlankNote(noteTitle) {
  const sourceSnapshot = getActiveTab();
  const created = await window.uChat.createTab({ templateId: 'blank', title: noteTitle || '' });
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
    const created = await window.uChat.createTab({ templateId: 'blank', title: '' });
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
  state.metas = loadMetas();
  if (state.metas[0]) {
    state.activeMetaId = state.metas[0].id;
  }
  bindEvents();

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

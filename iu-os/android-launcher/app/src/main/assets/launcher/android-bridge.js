(function () {
  const KEYS = {
    snapshot: 'iu_launcher_snapshot_v2',
    theme: 'iu_launcher_theme_v1',
    notifications: 'iu_launcher_notifications_v2',
    syncRoom: 'iu_launcher_sync_room_v1',
    syncDeviceId: 'iu_launcher_sync_device_id_v1',
    syncServer: 'iu_launcher_sync_server_v1'
  };

  const DEFAULT_SYNC_SERVER = 'wss://iu-rw9m.onrender.com';
  const listeners = new Map();

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(callback);
  }

  function emit(event, payload) {
    const callbacks = listeners.get(event) || [];
    callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[android-bridge] listener error', event, error);
      }
    });
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getSyncServerUrl() {
    return String(localStorage.getItem(KEYS.syncServer) || DEFAULT_SYNC_SERVER).trim() || DEFAULT_SYNC_SERVER;
  }

  function getOrCreateDeviceId() {
    let stored = String(localStorage.getItem(KEYS.syncDeviceId) || '').trim();
    if (!stored) {
      stored = `android-launcher-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEYS.syncDeviceId, stored);
    }
    return stored;
  }

  function getRoomId() {
    return String(localStorage.getItem(KEYS.syncRoom) || '').trim();
  }

  function setRoomId(roomId) {
    const next = String(roomId || '').trim();
    if (!next) {
      localStorage.removeItem(KEYS.syncRoom);
      emit('syncRoomChanged', { roomId: '', connected: false });
      syncManager.disconnect();
      return '';
    }

    localStorage.setItem(KEYS.syncRoom, next);
    emit('syncRoomChanged', { roomId: next, connected: syncManager.isConnected() });
    syncManager.connect();
    return next;
  }

  function normalizeSnapshot(snapshot) {
    const now = Date.now();
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs.map((tab) => ({
      id: String(tab.id || createId('tab')).trim(),
      title: String(tab.title || '').trim(),
      body: String(tab.body || ''),
      updatedAt: Number(tab.updatedAt || now)
    })) : [];

    const metas = Array.isArray(snapshot?.metas) ? snapshot.metas.map((meta) => ({
      id: String(meta.id || createId('meta')).trim(),
      title: String(meta.title || '').trim(),
      description: String(meta.description || '').trim(),
      noteIds: Array.isArray(meta.noteIds) ? Array.from(new Set(meta.noteIds.map(String))) : [],
      manualNoteIds: Array.isArray(meta.manualNoteIds) ? Array.from(new Set(meta.manualNoteIds.map(String))) : [],
      agentNoteIds: Array.isArray(meta.agentNoteIds) ? Array.from(new Set(meta.agentNoteIds.map(String))) : [],
      excludedNoteIds: Array.isArray(meta.excludedNoteIds) ? Array.from(new Set(meta.excludedNoteIds.map(String))) : [],
      learningLinks: Array.isArray(meta.learningLinks) ? meta.learningLinks.map((link) => ({
        id: String(link.id || createId('link')).trim(),
        sourceNoteId: String(link.sourceNoteId || '').trim(),
        linkedNoteId: String(link.linkedNoteId || '').trim(),
        keyword: String(link.keyword || '').trim(),
        noteTitle: String(link.noteTitle || '').trim()
      })) : [],
      kind: String(meta.kind || 'generic').trim() || 'generic',
      isSaved: Boolean(meta.isSaved),
      executionConfig: meta.executionConfig || { type: 'recurrent', whenText: '', enabled: false },
      executionPromptPending: Boolean(meta.executionPromptPending),
      agentStatus: String(meta.agentStatus || 'idle'),
      agentLogs: Array.isArray(meta.agentLogs) ? meta.agentLogs : [],
      finance: meta.finance || null
    })) : [];

    const activeTabId = String(snapshot?.activeTabId || tabs[0]?.id || '').trim();
    return {
      tabs,
      executions: Array.isArray(snapshot?.executions) ? snapshot.executions : [],
      activeTabId,
      activeExecutionId: snapshot?.activeExecutionId || null,
      metas,
      updatedAt: Number(snapshot?.updatedAt || Math.max(
        now,
        ...tabs.map((tab) => Number(tab.updatedAt || 0)),
        ...metas.map((meta) => Number(meta.updatedAt || 0))
      ))
    };
  }

  function ensureSnapshot() {
    const existing = readJson(KEYS.snapshot);
    if (existing && Array.isArray(existing.tabs) && Array.isArray(existing.metas)) {
      const normalized = normalizeSnapshot(existing);
      writeJson(KEYS.snapshot, normalized);
      return normalized;
    }

    const seeded = normalizeSnapshot({
      tabs: [
        {
          id: createId('tab'),
          title: 'Launcher Android',
          body: 'Base rapida para iterar la UI movil.\n\nRostro central, lockscreen como capa y editor de notas/metas.',
          updatedAt: Date.now()
        }
      ],
      executions: [],
      activeTabId: null,
      activeExecutionId: null,
      metas: [
        {
          id: createId('meta'),
          title: 'Time Manager Android',
          description: 'Convertir el launcher en el hogar movil del asistente con rostro, lockscreen y editor central.',
          noteIds: [],
          manualNoteIds: [],
          agentNoteIds: [],
          excludedNoteIds: [],
          kind: 'generic',
          isSaved: true
        }
      ]
    });
    seeded.activeTabId = seeded.tabs[0].id;
    writeJson(KEYS.snapshot, seeded);
    return seeded;
  }

  function normalizeNotifications(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      id: String(item.id || createId('notif')).trim(),
      sourceApp: String(item.sourceApp || 'App').trim(),
      title: String(item.title || '').trim(),
      body: String(item.body || ''),
      status: String(item.status || 'held').trim() || 'held',
      trigger: String(item.trigger || 'manual').trim() || 'manual',
      importance: Number(item.importance || 50),
      createdAt: Number(item.createdAt || Date.now())
    }));
  }

  function ensureNotifications() {
    const existing = readJson(KEYS.notifications);
    if (Array.isArray(existing) && existing.length > 0) {
      const normalized = normalizeNotifications(existing);
      writeJson(KEYS.notifications, normalized);
      return normalized;
    }

    const seeded = normalizeNotifications([
      {
        id: createId('notif'),
        sourceApp: 'WhatsApp',
        title: 'Maria',
        body: 'Cuando llegues me avisas',
        status: 'held',
        trigger: 'carro / transito',
        importance: 78,
        createdAt: Date.now() - 1000 * 60 * 12
      },
      {
        id: createId('notif'),
        sourceApp: 'Slack',
        title: 'Product',
        body: 'Need a quick review on the Android launcher',
        status: 'scheduled',
        trigger: 'abrir app de trabajo',
        importance: 86,
        createdAt: Date.now() - 1000 * 60 * 24
      }
    ]);
    writeJson(KEYS.notifications, seeded);
    return seeded;
  }

  function broadcastKnowledgeState(state, changeSource) {
    syncManager.send({
      type: 'knowledge_state_sync',
      payload: {
        state,
        source: String(changeSource || 'android_launcher').trim() || 'android_launcher'
      }
    });
  }

  function broadcastNotificationsState(items, source) {
    syncManager.send({
      type: 'notifications_state_sync',
      payload: {
        items,
        source: String(source || 'android_launcher').trim() || 'android_launcher'
      }
    });
  }

  function persistSnapshot(next, source = 'android_launcher', options = {}) {
    const normalized = normalizeSnapshot(next);
    writeJson(KEYS.snapshot, normalized);
    emit('knowledgeStateChanged', {
      state: normalized,
      change: { source }
    });
    if (options.broadcast !== false) {
      broadcastKnowledgeState(normalized, source);
    }
    return normalized;
  }

  function updateSnapshot(mutator, options = {}) {
    const current = ensureSnapshot();
    const next = normalizeSnapshot(mutator(clone(current)) || current);
    next.updatedAt = Date.now();
    return persistSnapshot(next, options.source || 'android_launcher', options);
  }

  function replaceSnapshot(nextState, source = 'remote_sync', options = {}) {
    const localState = ensureSnapshot();
    const incoming = normalizeSnapshot(nextState);
    if (!options.force && Number(incoming.updatedAt || 0) < Number(localState.updatedAt || 0)) {
      return localState;
    }
    return persistSnapshot(incoming, source, { broadcast: false });
  }

  function setNotifications(nextItems, options = {}) {
    const normalized = normalizeNotifications(nextItems);
    writeJson(KEYS.notifications, normalized);
    emit('notificationsChanged', {
      items: normalized,
      source: String(options.source || 'android_launcher').trim() || 'android_launcher'
    });
    if (options.broadcast !== false) {
      broadcastNotificationsState(normalized, options.source || 'android_launcher');
    }
  }

  function getTheme() {
    return String(localStorage.getItem(KEYS.theme) || 'light').trim() === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme, options = {}) {
    const nextTheme = String(theme || 'light').trim() === 'dark' ? 'dark' : 'light';
    localStorage.setItem(KEYS.theme, nextTheme);
    emit('uiThemeChanged', { theme: nextTheme });
    if (options.broadcast !== false) {
      syncManager.send({
        type: 'shared_state',
        payload: { theme: nextTheme }
      });
    }
    return nextTheme;
  }

  function buildAssistantReply(prompt) {
    const text = String(prompt || '').trim();
    const lower = text.toLowerCase();
    if (lower.includes('meta') || lower.includes('nota')) {
      return 'Te llevo al nivel de metas y notas para trabajarlo ahi.';
    }
    if (lower.includes('notificacion') || lower.includes('mensaje')) {
      return 'Lo tengo. El launcher seguira actuando como filtro y la cola retenida vive en el tercer nivel.';
    }
    return 'Launcher Android listo para iterar. Lockscreen como capa, rostro central y editor de notas/metas.';
  }

  function bridgeSwitchLevel(level) {
    if (window.AndroidHost && typeof window.AndroidHost.switchLevel === 'function') {
      window.AndroidHost.switchLevel(level);
    }
  }

  const syncManager = {
    ws: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    deviceId: getOrCreateDeviceId(),
    connectedDevices: new Map(),

    connect() {
      const roomId = getRoomId();
      if (!roomId) {
        emit('syncConnectionChanged', { connected: false, devices: [], roomId: '' });
        return;
      }

      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        this.ws = new WebSocket(getSyncServerUrl());
      } catch (error) {
        console.error('[android-bridge] sync connect failed', error);
        this.scheduleReconnect();
        return;
      }

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.connectedDevices.clear();
        this.send({
          type: 'register',
          payload: { deviceType: 'mobile_launcher', roomId }
        });
        this.send({
          type: 'join_room',
          payload: { roomId }
        });
        broadcastKnowledgeState(ensureSnapshot(), 'android_launcher_bootstrap');
        broadcastNotificationsState(ensureNotifications(), 'android_launcher_bootstrap');
        emit('syncConnectionChanged', { connected: true, devices: this.getConnectedDevices(), roomId });
      };

      this.ws.onmessage = (event) => {
        try {
          this.handleMessage(JSON.parse(event.data));
        } catch (error) {
          console.error('[android-bridge] sync parse failed', error);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        emit('syncConnectionChanged', { connected: false, devices: this.getConnectedDevices(), roomId: getRoomId() });
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // close event handles retries/state.
      };
    },

    disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.connectedDevices.clear();
      emit('syncConnectionChanged', { connected: false, devices: [], roomId: getRoomId() });
    },

    scheduleReconnect() {
      const roomId = getRoomId();
      if (!roomId) return;
      if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
      this.reconnectAttempts += 1;
      const waitMs = Math.min(1500 * Math.pow(2, this.reconnectAttempts - 1), 12000);
      setTimeout(() => this.connect(), waitMs);
    },

    send(message) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({
        ...message,
        deviceId: this.deviceId,
        timestamp: Date.now()
      }));
    },

    handleMessage(message) {
      if (!message || message.deviceId === this.deviceId) return;

      switch (message.type) {
        case 'register':
          this.connectedDevices.set(message.deviceId, {
            deviceId: message.deviceId,
            deviceType: message.payload?.deviceType || 'unknown',
            connected: true,
            lastSeen: Number(message.timestamp || Date.now())
          });
          emit('syncConnectionChanged', {
            connected: true,
            devices: this.getConnectedDevices(),
            roomId: getRoomId()
          });
          break;
        case 'knowledge_state_sync':
          if (message.payload?.state) {
            replaceSnapshot(message.payload.state, message.payload?.source || 'remote_sync');
          }
          break;
        case 'notifications_state_sync':
          if (Array.isArray(message.payload?.items)) {
            setNotifications(message.payload.items, {
              source: message.payload?.source || 'remote_sync',
              broadcast: false
            });
          }
          break;
        case 'shared_state':
          if (message.payload?.theme) {
            setTheme(message.payload.theme, { broadcast: false });
          }
          break;
        default:
          break;
      }
    },

    isConnected() {
      return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
    },

    getConnectedDevices() {
      return Array.from(this.connectedDevices.values());
    },

    getConnectionUrl() {
      const roomId = getRoomId();
      if (!roomId) return '';
      const serverUrl = getSyncServerUrl();
      const httpBase = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const params = new URLSearchParams({
        connect: this.deviceId,
        room: roomId,
        server: serverUrl
      });
      return `${httpBase}/phone?${params.toString()}`;
    }
  };

  window.IUSyncManager = {
    connect: () => syncManager.connect(),
    disconnect: () => syncManager.disconnect(),
    setRoomId,
    getRoomId,
    isConnected: () => syncManager.isConnected(),
    getConnectedDevices: () => syncManager.getConnectedDevices(),
    getConnectionUrl: () => syncManager.getConnectionUrl(),
    getDeviceId: () => syncManager.deviceId,
    sendSharedState: (state) => syncManager.send({ type: 'shared_state', payload: state || {} }),
    onConnectionChange: (callback) => on('syncConnectionChanged', callback),
    onRoomChange: (callback) => on('syncRoomChanged', callback)
  };

  if (getRoomId()) {
    syncManager.connect();
  }

  window.iuOS = new Proxy({
    platform: 'android',
    turnTakingLogsEnabled: false,
    getUiTheme: async () => ({ theme: getTheme() }),
    setUiTheme: async (theme) => ({ theme: setTheme(theme) }),
    getLoggingMode: async () => ({ mode: 'uiux' }),
    setLoggingMode: async (mode) => ({ mode: mode || 'uiux' }),
    logUiUx: (payload) => {
      if (window.AndroidHost?.log) {
        window.AndroidHost.log(JSON.stringify(payload || {}));
      }
    },
    toggleChatWindow: async () => {
      bridgeSwitchLevel(1);
      return { success: true };
    },
    promptAgentRun: async ({ prompt }) => {
      const reply = buildAssistantReply(prompt);
      emit('promptAgentProgress', {
        type: 'status',
        phase: 'execution',
        message: 'Pensando en modo launcher movil...'
      });
      if (String(prompt || '').toLowerCase().includes('notific')) {
        const items = ensureNotifications();
        items.unshift({
          id: createId('notif'),
          sourceApp: 'Launcher',
          title: 'Nueva simulacion',
          body: String(prompt || '').trim(),
          status: 'held',
          trigger: 'decision por Time Manager',
          importance: 64,
          createdAt: Date.now()
        });
        setNotifications(items, { source: 'android_launcher_prompt' });
      }
      return {
        success: true,
        runId: createId('prompt_run'),
        assistantReply: reply,
        userMessages: []
      };
    },
    onPromptAgentProgress: (callback) => on('promptAgentProgress', callback),
    sampleBgLuminance: async () => ({ isDark: true }),
    setChatGPTSyntheticWait: async () => ({ ok: true }),
    forceChatGPTInterrupt: async () => ({ ok: true }),
    getPicovoiceConfig: async () => ({ accessKey: null, heyKeywordPath: null }),
    conversationControl: async (action) => {
      emit('voiceStateChanged', action === 'stop' ? 'idle' : 'thinking');
      return { ok: true };
    },
    activateThinkingMode: async () => ({ ok: true }),
    getIntentPredictions: async () => ({
      predictions: [
        { label: 'Abrir metas activas', category: 'notes', confidence: 0.88 },
        { label: 'Volver al rostro', category: 'focus', confidence: 0.73 }
      ]
    }),
    requestAttention: async () => ({ ok: true }),
    onSystemReady: (callback) => {
      on('systemReady', callback);
      setTimeout(() => callback(), 90);
    },
    onUiThemeChanged: (callback) => on('uiThemeChanged', callback),
    onVoiceStateChanged: (callback) => on('voiceStateChanged', callback),
    onConversationText: (callback) => on('conversationText', callback),
    onActionConfirmRequest: () => {},
    onActionStatus: () => {},
    onVoiceText: () => {},
    onVoiceActivityHint: () => {},
    onMemoryStatus: () => {},
    onTaskUpdate: () => {},
    onExplicitPredictions: () => {},
    onLearningStatus: () => {},
    onBrowserAgentStatus: () => {},
    onBgLuminanceChanged: () => {},
    onHandsFrame: () => {},
    onGestureWakeSound: () => {},
    onGestureSleep: () => {},
    onBrowserContextChanged: () => {},
    onUpdateAvailable: () => {},
    onUpdateDownloaded: () => {}
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return () => {};
      }
      return async () => ({ ok: true });
    }
  });

  window.uChat = new Proxy({
    bootstrap: async () => ensureSnapshot(),
    createTab: async (payload = {}) => {
      const state = updateSnapshot((snapshot) => {
        const tab = {
          id: createId('tab'),
          title: String(payload.title || '').trim(),
          body: String(payload.body || ''),
          updatedAt: Date.now()
        };
        snapshot.tabs.unshift(tab);
        snapshot.activeTabId = tab.id;
        return snapshot;
      }, { source: payload.source || 'android_launcher' });
      return { state };
    },
    updateTab: async (payload = {}) => {
      const state = updateSnapshot((snapshot) => {
        snapshot.tabs = snapshot.tabs.map((tab) => {
          if (tab.id !== payload.tabId) return tab;
          return {
            ...tab,
            title: payload.title !== undefined ? String(payload.title || '') : tab.title,
            body: payload.body !== undefined ? String(payload.body || '') : tab.body,
            updatedAt: Date.now()
          };
        });
        return snapshot;
      }, { source: payload.source || 'android_launcher' });
      return { state };
    },
    setActiveTab: async (tabId) => updateSnapshot((snapshot) => {
      snapshot.activeTabId = String(tabId || snapshot.activeTabId || '').trim();
      return snapshot;
    }, { source: 'chat_window', broadcast: false }),
    archiveTab: async ({ tabId, source } = {}) => updateSnapshot((snapshot) => {
      snapshot.tabs = snapshot.tabs.filter((tab) => tab.id !== tabId);
      if (!snapshot.tabs.length) {
        snapshot.tabs.push({
          id: createId('tab'),
          title: '',
          body: '',
          updatedAt: Date.now()
        });
      }
      snapshot.activeTabId = snapshot.tabs[0].id;
      return snapshot;
    }, { source: source || 'android_launcher' }),
    saveMetas: async (metas) => {
      updateSnapshot((snapshot) => {
        snapshot.metas = Array.isArray(metas) ? metas : snapshot.metas;
        return snapshot;
      }, { source: 'chat_window' });
      return { ok: true };
    },
    getMetas: async () => ensureSnapshot().metas,
    getUiTheme: async () => ({ theme: getTheme() }),
    logUiUx: (payload) => window.iuOS.logUiUx(payload),
    onUiThemeChanged: (callback) => on('uiThemeChanged', callback),
    onMetaAgentProgress: () => {},
    onKnowledgeStateChanged: (callback) => on('knowledgeStateChanged', callback),
    onAgentProgress: () => {},
    requestInference: async () => ({ ok: true }),
    suggestNotesForMeta: async () => [],
    inferLearningLinks: async () => ({ links: [] }),
    runMetaAgent: async ({ metaId, title, description, source } = {}) => {
      const state = updateSnapshot((snapshot) => {
        snapshot.metas = snapshot.metas.map((meta) => {
          if (meta.id !== metaId) return meta;
          return {
            ...meta,
            title: String(title || meta.title || '').trim(),
            description: String(description || meta.description || '').trim()
          };
        });
        return snapshot;
      }, { source: source || 'android_launcher' });
      return { ok: true, state };
    },
    close: () => bridgeSwitchLevel(0)
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return async () => ({ ok: true });
    }
  });

  window.IULauncherBridge = {
    ensureNotifications,
    setNotifications,
    getNotifications: ensureNotifications,
    getSyncRoomId: getRoomId,
    setSyncRoomId: setRoomId,
    getSyncConnectionUrl: () => syncManager.getConnectionUrl(),
    isSyncConnected: () => syncManager.isConnected(),
    getSyncDevices: () => syncManager.getConnectedDevices(),
    onSyncConnectionChanged: (callback) => on('syncConnectionChanged', callback),
    onNotificationsChanged: (callback) => on('notificationsChanged', callback)
  };
})();

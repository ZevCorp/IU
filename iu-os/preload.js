/**
 * IÜ OS - Preload Script (CommonJS)
 */
console.log('🔗 [Preload] Loading bridge...');


const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('iuOS', {
    turnTakingLogsEnabled: process.env.IU_TURN_TAKING_LOGS === '1',
    // Screen information
    getScreenSize: () => ipcRenderer.invoke('get-screen-size'),

    // Window control
    setClickThrough: (enabled) => ipcRenderer.send('set-click-through', enabled),
    requestAttention: () => ipcRenderer.send('request-attention'),

    // Platform info
    platform: process.platform,
    getEnvDeviceId: () => ipcRenderer.invoke('get-env-device-id'),
    getPicovoiceConfig: () => ipcRenderer.invoke('get-picovoice-config'),

    // Performance monitoring
    getPerformanceMetrics: () => ({
        memory: process.memoryUsage(),
        uptime: process.uptime()
    }),

    // Conversation Control
    conversationControl: (action, options) => ipcRenderer.invoke('conversation-control', action, options),
    getIntentPredictions: (data) => ipcRenderer.invoke('get-intent-predictions', data),
    activateThinkingMode: () => ipcRenderer.invoke('activate-thinking-mode'),

    // Screen Context (macOS Accessibility)
    getScreenContext: (gazeDirection) => ipcRenderer.invoke('get-screen-context', gazeDirection),

    // Background luminance detection (for face color contrast in SMALL mode)
    sampleBgLuminance: () => ipcRenderer.invoke('sample-bg-luminance'),
    onBgLuminanceChanged: (callback) => ipcRenderer.on('bg-luminance-changed', (event, data) => callback(data)),
    setUiTheme: (theme) => ipcRenderer.invoke('set-ui-theme', { theme }),
    getUiTheme: () => ipcRenderer.invoke('get-ui-theme'),
    getLoggingMode: () => ipcRenderer.invoke('logging-get-mode'),
    setLoggingMode: (mode) => ipcRenderer.invoke('logging-set-mode', { mode }),
    logUiUx: (payload) => ipcRenderer.send('uiux-log', payload),

    // Event Listeners
    onConversationText: (callback) => ipcRenderer.on('conversation-text', (event, text) => callback(text)),
    onMemoryStatus: (callback) => ipcRenderer.on('memory-status', (event, status) => callback(status)),
    onTaskUpdate: (callback) => ipcRenderer.on('task-update', (event, tasks) => callback(tasks)),
    onSystemReady: (callback) => ipcRenderer.on('system-ready', () => callback()),
    onExplicitPredictions: (callback) => ipcRenderer.on('explicit-predictions', (event, predictions) => callback(predictions)),
    onVoiceStateChanged: (callback) => ipcRenderer.on('voice-state-changed', (event, state) => callback(state)),
    onVoiceText: (callback) => ipcRenderer.on('voice-text', (event, data) => callback(data)),
    onVoiceActivityHint: (callback) => ipcRenderer.on('voice-activity-hint', (event, data) => callback(data)),
    setChatGPTSyntheticWait: (payload) => ipcRenderer.invoke('chatgpt-set-synthetic-wait', payload),
    forceChatGPTInterrupt: () => ipcRenderer.invoke('chatgpt-force-interrupt'),

    // Prompt Chat + Notes/Metas window
    toggleChatWindow: () => ipcRenderer.invoke('toggle-chat-window'),
    notesBootstrap: () => ipcRenderer.invoke('notes-bootstrap'),
    promptAgentRun: (payload) => ipcRenderer.invoke('prompt-agent-run', payload),
    onPromptAgentProgress: (callback) => ipcRenderer.on('prompt-agent-progress', (event, payload) => callback(payload)),
    timeManagerDecide: (payload) => ipcRenderer.invoke('time-manager-decide', payload),
    timeManagerGetState: () => ipcRenderer.invoke('time-manager-get-state'),
    onTimeManagerProgress: (callback) => ipcRenderer.on('time-manager-progress', (event, payload) => callback(payload)),
    onTimeManagerDecision: (callback) => ipcRenderer.on('time-manager-decision', (event, payload) => callback(payload)),
    toggleHandWindow: () => ipcRenderer.invoke('toggle-hand-window'),
    getHandWindowState: () => ipcRenderer.invoke('get-hand-window-state'),
    toggleHandMeshWindow: () => ipcRenderer.invoke('toggle-hand-mesh-window'),
    activateNarrationSpace: () => ipcRenderer.invoke('activate-narration-space'),
    closeNarrationSpace: () => ipcRenderer.send('close-narration-space'),
    synthesizeNarration: (timeline) => ipcRenderer.invoke('synthesize-narration', { timeline }),

    // Action System
    executeExplicitAction: (userText) => ipcRenderer.invoke('execute-explicit-action', userText),
    executeImplicitAction: (contextText, suggestion) => ipcRenderer.invoke('execute-implicit-action', contextText, suggestion),
    confirmAction: (plan) => ipcRenderer.invoke('confirm-action', plan),
    stopAction: () => ipcRenderer.invoke('stop-action'),
    onActionConfirmRequest: (callback) => ipcRenderer.on('action-confirm-request', (event, data) => callback(data)),
    onActionStatus: (callback) => ipcRenderer.on('action-status', (event, data) => callback(data)),

    // OpenClaw setup and bootstrap state
    getOpenClawState: () => ipcRenderer.invoke('openclaw-get-state'),
    saveOpenClawSettings: (payload) => ipcRenderer.invoke('openclaw-save-settings', payload),
    runOpenClawSetup: (payload) => ipcRenderer.invoke('openclaw-run-setup', payload),
    onOpenClawStateChanged: (callback) => ipcRenderer.on('openclaw-state-changed', (event, data) => callback(data)),

    // Brain / Disconnection Mode
    startDisconnectionMode: (duration) => ipcRenderer.invoke('start-disconnection-mode', duration),
    stopDisconnectionMode: () => ipcRenderer.invoke('stop-disconnection-mode'),
    getBrainStatus: () => ipcRenderer.invoke('get-brain-status'),
    onBrainWakeUp: (callback) => ipcRenderer.on('brain-wake-up', (event, data) => callback(data)),
    brainConfirmTask: (taskId) => ipcRenderer.invoke('brain-confirm-task', taskId),
    brainScheduleTask: (task, minutes) => ipcRenderer.invoke('brain-schedule-task', task, minutes),

    // Auto-updater APIs
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info)),

    // Window Mode Control
    setWindowMode: (mode) => ipcRenderer.send('set-window-mode', mode),
    onWindowModeChanged: (callback) => ipcRenderer.on('window-mode-changed', (event, mode) => callback(mode)),
    moveWindowViaTrackpadSwipe: (payload) => ipcRenderer.send('move-window-via-trackpad-swipe', payload),
    startDrag: () => ipcRenderer.send('window-drag-start'),
    windowMove: (pos) => ipcRenderer.send('window-move', pos),

    // Hand tracking bridge (for floating hand window + future Ü integration)
    publishHandsFrame: (payload) => ipcRenderer.send('hands-frame', payload),
    onHandsFrame: (callback) => ipcRenderer.on('hands-frame', (event, payload) => callback(payload)),
    publishHandsPresence: (present) => ipcRenderer.send('hands-presence', present),
    pinchDragMainWindow: (payload) => ipcRenderer.send('main-window-pinch-drag', payload),
    publishHandsLandmarks: (payload) => ipcRenderer.send('hands-landmarks', payload),
    onHandsLandmarks: (callback) => ipcRenderer.on('hands-landmarks', (event, payload) => callback(payload)),

    // Gesture sleep / wake (fist hold = sleep, open hand hold = wake)
    onGestureSleep: (callback) => ipcRenderer.on('gesture-sleep', (event, isSleeping) => callback(isSleeping)),
    gestureSleep: () => ipcRenderer.send('gesture-request-sleep'),
    onGestureWakeSound: (callback) => ipcRenderer.on('gesture-wake-sound', () => callback()),

    // Gesture voice control (open palm 2s = start, strict fist 2s = stop)
    onGestureVoiceToggle: (callback) => ipcRenderer.on('gesture-voice-toggle', (event, action) => callback(action)),

    // Hand mesh style switcher
    getHandMeshStyle: () => ipcRenderer.invoke('get-hand-mesh-style'),
    setHandMeshStyle: (style) => ipcRenderer.invoke('set-hand-mesh-style', style),

    // Hand gesture element selection (AX-based)
    getAxSnapshot: () => ipcRenderer.invoke('get-ax-snapshot'),

    // "Mirar juntos" mode — single-hand attentional focus
    toggleMirarJuntos: (on) => ipcRenderer.invoke('toggle-mirar-juntos', on),
    onMirarJuntosMode: (callback) => ipcRenderer.on('mirar-juntos-mode', (event, on) => callback(on)),
    onHandElementFocused: (callback) => ipcRenderer.on('hand-element-focused', (event, el) => callback(el)),
    handElementFocused: (payload) => ipcRenderer.send('hand-element-focused', payload),

    // ── Browser Agent (control transversal de páginas web + AgarIO) ──────────
    // Establece el contexto del browser activo (URL del tab actual)
    browserSetContext: (payload) => ipcRenderer.invoke('browser-set-context', payload),
    // Lanza AgarIO: abre browser, escribe nickname, hace click en Play, espera anuncio
    browserLaunchAgarIO: (payload) => ipcRenderer.invoke('browser-launch-agario', payload),
    // Extrae los affordances DOM/ARIA de la tab activa (para uso agéntico futuro)
    browserGetAffordances: () => ipcRenderer.invoke('browser-get-affordances'),
    // Estado actual del BrowserAgent
    browserGetStatus: () => ipcRenderer.invoke('browser-get-status'),
    browserGetProfiles: () => ipcRenderer.invoke('browser-get-profiles'),
    browserGetTabs: (payload) => ipcRenderer.invoke('browser-get-tabs', payload),
    browserOpen: (payload) => ipcRenderer.invoke('browser-open', payload),
    browserSnapshot: (payload) => ipcRenderer.invoke('browser-snapshot', payload),
    browserAct: (payload) => ipcRenderer.invoke('browser-act', payload),
    browserScreenshot: (payload) => ipcRenderer.invoke('browser-screenshot', payload),
    browserGetConsole: (payload) => ipcRenderer.invoke('browser-get-console', payload),
    browserGetNetwork: (payload) => ipcRenderer.invoke('browser-get-network', payload),
    // Evento: cambio de contexto del browser (activo/inactivo, app detectada)
    onBrowserContextChanged: (callback) => ipcRenderer.on('browser-context-changed', (event, data) => callback(data)),
    // Evento: estado del BrowserAgent durante el lanzamiento de AgarIO
    onBrowserAgentStatus: (callback) => ipcRenderer.on('browser-agent-status', (event, data) => callback(data)),
    // Inception onboarding de primera ejecucion
    getInceptionOnboardingState: () => ipcRenderer.invoke('inception-onboarding-get-state'),
    startInceptionOnboarding: () => ipcRenderer.invoke('inception-onboarding-start'),
    dismissInceptionOnboarding: () => ipcRenderer.invoke('inception-onboarding-dismiss'),
    onInceptionOnboardingStatus: (callback) => ipcRenderer.on('inception-onboarding-status', (event, data) => callback(data)),
    // 🎓 Learning Mode
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    onLearningStatus: (callback) => ipcRenderer.on('learning-status', (event, data) => callback(data)),
    listLearnedWorkflows: () => ipcRenderer.invoke('learning-list-workflows'),

    // Phone Bridge: notify main process of the current room ID
    notifyPhoneBridgeRoom: (roomId) => ipcRenderer.send('phone-bridge-room', { roomId }),
});


console.log('✅ IÜ OS preload ready');

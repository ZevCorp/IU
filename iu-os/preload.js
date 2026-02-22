/**
 * IÜ OS - Preload Script (CommonJS)
 */
console.log('🔗 [Preload] Loading bridge...');


const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('iuOS', {
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

    // Event Listeners
    onConversationText: (callback) => ipcRenderer.on('conversation-text', (event, text) => callback(text)),
    onMemoryStatus: (callback) => ipcRenderer.on('memory-status', (event, status) => callback(status)),
    onTaskUpdate: (callback) => ipcRenderer.on('task-update', (event, tasks) => callback(tasks)),
    onSystemReady: (callback) => ipcRenderer.on('system-ready', () => callback()),
    onExplicitPredictions: (callback) => ipcRenderer.on('explicit-predictions', (event, predictions) => callback(predictions)),
    onVoiceStateChanged: (callback) => ipcRenderer.on('voice-state-changed', (event, state) => callback(state)),

    // Chat Window
    toggleChatWindow: () => ipcRenderer.invoke('toggle-chat-window'),
    toggleHandWindow: () => ipcRenderer.invoke('toggle-hand-window'),
    getHandWindowState: () => ipcRenderer.invoke('get-hand-window-state'),
    toggleHandMeshWindow: () => ipcRenderer.invoke('toggle-hand-mesh-window'),

    // Action System
    executeExplicitAction: (userText) => ipcRenderer.invoke('execute-explicit-action', userText),
    executeImplicitAction: (contextText, suggestion) => ipcRenderer.invoke('execute-implicit-action', contextText, suggestion),
    confirmAction: (plan) => ipcRenderer.invoke('confirm-action', plan),
    stopAction: () => ipcRenderer.invoke('stop-action'),
    onActionConfirmRequest: (callback) => ipcRenderer.on('action-confirm-request', (event, data) => callback(data)),
    onActionStatus: (callback) => ipcRenderer.on('action-status', (event, data) => callback(data)),

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
});


console.log('✅ IÜ OS preload ready');

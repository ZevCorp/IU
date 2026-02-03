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

    // Event Listeners
    onConversationText: (callback) => ipcRenderer.on('conversation-text', (event, text) => callback(text)),
    onMemoryStatus: (callback) => ipcRenderer.on('memory-status', (event, status) => callback(status)),
    onTaskUpdate: (callback) => ipcRenderer.on('task-update', (event, tasks) => callback(tasks)),
    onSystemReady: (callback) => ipcRenderer.on('system-ready', () => callback()),
    onExplicitPredictions: (callback) => ipcRenderer.on('explicit-predictions', (event, predictions) => callback(predictions)),
    onVoiceStateChanged: (callback) => ipcRenderer.on('voice-state-changed', (event, state) => callback(state)),
});


console.log('✅ IÜ OS preload ready');

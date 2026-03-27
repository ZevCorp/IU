/**
 * Preload for the notebook-driven chat window.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uChat', {
    bootstrap: () => ipcRenderer.invoke('chat-bootstrap'),
    createTab: (payload) => ipcRenderer.invoke('chat-create-tab', payload),
    updateTab: (payload) => ipcRenderer.invoke('chat-update-tab', payload),
    setActiveTab: (tabId) => ipcRenderer.invoke('chat-set-active-tab', { tabId }),
    archiveTab: (tabId) => ipcRenderer.invoke('chat-archive-tab', { tabId }),
    createExecution: (payload) => ipcRenderer.invoke('chat-create-execution', payload),
    setActiveExecution: (executionId) => ipcRenderer.invoke('chat-set-active-execution', { executionId }),
    moveExecution: (payload) => ipcRenderer.invoke('chat-move-execution', payload),
    requestInference: (payload) => ipcRenderer.invoke('chat-request-inference', payload),
    suggestNotesForMeta: (payload) => ipcRenderer.invoke('meta-suggest-notes', payload),
    inferLearningLinks: (payload) => ipcRenderer.invoke('note-infer-learning-links', payload),
    runMetaAgent: (payload) => ipcRenderer.invoke('meta-agent-run', payload),
    getMetas: () => ipcRenderer.invoke('chat-get-metas'),
    saveMetas: (metas) => ipcRenderer.invoke('chat-save-metas', { metas }),
    getUiTheme: () => ipcRenderer.invoke('get-ui-theme'),
    getLoggingMode: () => ipcRenderer.invoke('logging-get-mode'),
    setLoggingMode: (mode) => ipcRenderer.invoke('logging-set-mode', { mode }),
    logUiUx: (payload) => ipcRenderer.send('uiux-log', payload),
    toggleVariablePersistence: (payload) => ipcRenderer.invoke('chat-toggle-variable-persistence', payload),
    sendMessage: (payload) => ipcRenderer.invoke('chat-send-message', payload),
    onVoiceText: (callback) => ipcRenderer.on('voice-text', (event, data) => callback(data)),
    onVoiceState: (callback) => ipcRenderer.on('voice-state', (event, state) => callback(state)),
    onMetaAgentProgress: (callback) => ipcRenderer.on('meta-agent-progress', (event, payload) => callback(payload)),
    onUiThemeChanged: (callback) => ipcRenderer.on('chat-ui-theme', (event, payload) => callback(payload)),
    close: () => ipcRenderer.send('chat-close')
});

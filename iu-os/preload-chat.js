/**
 * Preload for U Chat Window
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uChat', {
    sendMessage: (text) => ipcRenderer.send('chat-send-message', text),
    onResponse: (callback) => ipcRenderer.on('chat-response', (event, data) => callback(data)),
    onVoiceText: (callback) => ipcRenderer.on('voice-text', (event, data) => callback(data)),
    onVoiceState: (callback) => ipcRenderer.on('voice-state', (event, state) => callback(state)),
    close: () => ipcRenderer.send('chat-close'),
});

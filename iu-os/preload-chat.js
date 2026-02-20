/**
 * Preload for U Chat Window
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uChat', {
    sendMessage: (text) => ipcRenderer.send('chat-send-message', text),
    onResponse: (callback) => ipcRenderer.on('chat-response', (event, data) => callback(data)),
    close: () => ipcRenderer.send('chat-close'),
});

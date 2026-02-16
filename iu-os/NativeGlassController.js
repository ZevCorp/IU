
const { spawn } = require('child_process');
const path = require('path');
const { app } = require('electron');

class NativeGlassController {
    constructor() {
        this.process = null;
        this.isVisible = false;
        // Logic removed for isolation
    }

    start() {
        // Disabled/Stand-by
        // console.log('🔮 Native Glass Window: Disabled/Stand-by');
    }

    stop() {
        // Did nothing
    }

    isActive() {
        return false;
    }

    sendCommand(cmd) {
        // No-op
    }

    show() {
        // No-op
    }

    hide() {
        // No-op
    }

    setExpression(state) {
        // No-op
    }

    lookAt(x, y) {
        // No-op
    }
}

module.exports = new NativeGlassController();

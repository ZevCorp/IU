/**
 * DeviceSync.js
 * 
 * Handles real-time synchronization between devices.
 * Connects to the Render WebSocket server.
 */

const RENDER_WS_URL = 'wss://iu-rw9m.onrender.com';
const RENDER_APP_URL = 'https://xn--i-eha.space';

class DeviceSync {
    constructor() {
        this.deviceId = this.getOrCreateDeviceId();
        this.deviceType = 'desktop'; // Electron is always desktop
        this.ws = null;
        this.serverUrl = RENDER_WS_URL;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.connectedDevices = new Map();
        this.roomId = null;

        // Callbacks
        this.onConnectionChange = null;
        this.onFaceReceived = null;
        this.onSharedStateChange = null;
        this.onRoleChange = null;

        // Device role: 'pc' | 'sensors' | null
        this.deviceRole = null;
        this.remoteRoles = new Map(); // deviceId -> role
    }

    getOrCreateDeviceId() {
        let stored = localStorage.getItem('iu-os-device-id');
        if (!stored) {
            stored = `electron-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('iu-os-device-id', stored);
        }
        return stored;
    }

    getRoomId() {
        if (this.roomId) return this.roomId;

        // Check URL params first
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room');
        if (roomFromUrl) {
            this.roomId = roomFromUrl;
            return this.roomId;
        }

        // Create new room
        this.roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        return this.roomId;
    }

    async connect() {
        return new Promise((resolve) => {
            try {
                console.log(`[DeviceSync] Connecting to: ${this.serverUrl}`);
                this.ws = new WebSocket(this.serverUrl);

                const timeout = setTimeout(() => {
                    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                        console.log('[DeviceSync] Connection timeout');
                        this.ws.close();
                        resolve(false);
                    }
                }, 10000);

                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    console.log('[DeviceSync] ✅ Connected to Render server!');
                    this.reconnectAttempts = 0;
                    this.registerDevice();
                    this.joinRoom();

                    if (this.onConnectionChange) {
                        this.onConnectionChange(true, Array.from(this.connectedDevices.values()));
                    }
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };

                this.ws.onclose = (e) => {
                    clearTimeout(timeout);
                    console.log(`[DeviceSync] Disconnected: ${e.code} ${e.reason}`);
                    this.handleDisconnect();
                };

                this.ws.onerror = (e) => {
                    clearTimeout(timeout);
                    console.error('[DeviceSync] WebSocket error:', e);
                    resolve(false);
                };
            } catch (error) {
                console.error('[DeviceSync] Connection error:', error);
                resolve(false);
            }
        });
    }

    handleDisconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[DeviceSync] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), this.reconnectDelay);
        }

        if (this.onConnectionChange) {
            this.onConnectionChange(false, []);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    registerDevice() {
        this.sendMessage({
            type: 'register',
            deviceId: this.deviceId,
            payload: {
                deviceType: this.deviceType,
                roomId: this.getRoomId()
            },
            timestamp: Date.now()
        });
    }

    joinRoom() {
        const roomId = this.getRoomId();
        console.log(`[DeviceSync] Joining room: ${roomId}`);

        this.sendMessage({
            type: 'join_room',
            deviceId: this.deviceId,
            payload: { roomId },
            timestamp: Date.now()
        });
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    handleMessage(message) {
        if (message.deviceId === this.deviceId) return;

        switch (message.type) {
            case 'register':
                this.handleDeviceRegister(message);
                break;
            case 'transfer_start':
                this.handleTransferStart(message);
                break;
            case 'shared_state':
                this.handleSharedState(message);
                break;
            case 'request_face':
                this.handleRequestFace(message);
                break;
            case 'role_change':
                this.handleRoleChange(message);
                break;
        }
    }

    handleDeviceRegister(message) {
        const payload = message.payload || {};

        this.connectedDevices.set(message.deviceId, {
            deviceId: message.deviceId,
            deviceType: payload.deviceType || 'unknown',
            connected: true,
            lastSeen: message.timestamp
        });

        if (this.onConnectionChange) {
            this.onConnectionChange(true, Array.from(this.connectedDevices.values()));
        }

        console.log(`[DeviceSync] Device connected: ${message.deviceId}`);
    }

    handleTransferStart(message) {
        const payload = message.payload || {};

        if (payload.targetDevice !== this.deviceId && payload.targetDevice !== 'any') return;

        console.log(`[DeviceSync] Received face transfer from ${message.deviceId}`);

        if (this.onFaceReceived) {
            this.onFaceReceived(payload.state, payload.direction);
        }
    }

    handleSharedState(message) {
        const payload = message.payload || {};
        console.log('[DeviceSync] Received shared state:', payload);

        if (this.onSharedStateChange) {
            this.onSharedStateChange(payload);
        }
    }

    handleRequestFace(message) {
        console.log(`[DeviceSync] Face requested by ${message.deviceId}`);
        // If we have the face (implied by this app instance receiving the request), send it!
        // We need a callback or just expose a method to trigger this from app.js
        if (this.onRequestFace) {
            this.onRequestFace(message.deviceId);
        }
    }

    startTransfer(direction, state) {
        this.sendMessage({
            type: 'transfer_start',
            deviceId: this.deviceId,
            payload: {
                state,
                direction,
                targetDevice: 'any'
            },
            timestamp: Date.now()
        });

        console.log(`[DeviceSync] Started transfer: ${direction}`);
    }

    requestFace() {
        this.sendMessage({
            type: 'request_face',
            deviceId: this.deviceId,
            timestamp: Date.now()
        });
        console.log('[DeviceSync] Requesting face from other devices...');
    }

    broadcastSharedState(state) {
        this.sendMessage({
            type: 'shared_state',
            deviceId: this.deviceId,
            payload: state,
            timestamp: Date.now()
        });
    }

    syncState(state) {
        this.sendMessage({
            type: 'state',
            deviceId: this.deviceId,
            payload: state,
            timestamp: Date.now()
        });
    }

    getConnectionUrl() {
        const roomId = this.getRoomId();
        const params = new URLSearchParams({
            connect: this.deviceId,
            room: roomId,
            server: this.serverUrl
        });

        // Point to iü.space web app with connection params
        return `${RENDER_APP_URL}?${params.toString()}`;
    }

    isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    getConnectedDevices() {
        return Array.from(this.connectedDevices.values());
    }

    setOnConnectionChange(callback) {
        this.onConnectionChange = callback;
    }

    setOnFaceReceived(callback) {
        this.onFaceReceived = callback;
    }

    setOnSharedStateChange(callback) {
        this.onSharedStateChange = callback;
    }

    setOnRequestFace(callback) {
        this.onRequestFace = callback;
    }

    // ============================================
    // Device Role Management (PC / Sensors)
    // ============================================

    setDeviceRole(role) {
        this.deviceRole = role;
        this.sendMessage({
            type: 'role_change',
            deviceId: this.deviceId,
            payload: { role },
            timestamp: Date.now()
        });
        console.log(`[DeviceSync] Set local role to: ${role || 'none'}`);
    }

    handleRoleChange(message) {
        const payload = message.payload || {};
        const remoteRole = payload.role;

        this.remoteRoles.set(message.deviceId, remoteRole);
        console.log(`[DeviceSync] Device ${message.deviceId} changed role to: ${remoteRole || 'none'}`);

        if (this.onRoleChange) {
            this.onRoleChange(message.deviceId, remoteRole, this.getRemoteRoles());
        }
    }

    setOnRoleChange(callback) {
        this.onRoleChange = callback;
    }

    getDeviceRole() {
        return this.deviceRole;
    }

    getRemoteRoles() {
        return Object.fromEntries(this.remoteRoles);
    }

    // Check if any device has a specific role
    hasRemoteRole(role) {
        for (const [deviceId, deviceRole] of this.remoteRoles) {
            if (deviceRole === role) return true;
        }
        return false;
    }
}

// Singleton
let deviceSyncInstance = null;

function getDeviceSync() {
    if (!deviceSyncInstance) {
        deviceSyncInstance = new DeviceSync();
    }
    return deviceSyncInstance;
}

// Export for use in app.js
window.DeviceSync = DeviceSync;
window.getDeviceSync = getDeviceSync;

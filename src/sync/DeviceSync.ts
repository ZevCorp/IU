/**
 * DeviceSync.ts
 * 
 * Handles real-time synchronization between devices (computer ↔ phone).
 * Uses WebSocket for real-time communication and manages the face transition
 * animation when swiping the face between devices.
 */

import { faceEventBus } from '../events/FaceEventBus';
import { FaceState } from '../face/FaceState';

// =====================================================
// Types
// =====================================================

export type DeviceType = 'desktop' | 'mobile';
export type TransferDirection = 'left' | 'right';

interface DeviceInfo {
    deviceId: string;
    deviceType: DeviceType;
    connected: boolean;
    lastSeen: number;
}

interface SyncMessage {
    type: 'state' | 'transfer_start' | 'transfer_complete' | 'transfer_cancel' | 'ping' | 'pong' | 'register' | 'shared_state';
    deviceId: string;
    payload?: unknown;
    timestamp: number;
}

interface TransferState {
    isTransferring: boolean;
    direction: TransferDirection | null;
    progress: number; // 0 to 1
    fromDevice: string | null;
    toDevice: string | null;
}

// =====================================================
// DeviceSync Class
// =====================================================

export class DeviceSync {
    private deviceId: string;
    private deviceType: DeviceType;
    private ws: WebSocket | null = null;
    private serverUrl: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 2000;
    private connectedDevices: Map<string, DeviceInfo> = new Map();

    // Transfer state
    private transferState: TransferState = {
        isTransferring: false,
        direction: null,
        progress: 0,
        fromDevice: null,
        toDevice: null
    };

    // Callbacks
    private onFaceReceived: ((state: FaceState, direction: TransferDirection) => void) | null = null;
    private onTransferProgress: ((progress: number, direction: TransferDirection) => void) | null = null;
    private onConnectionChange: ((connected: boolean, devices: DeviceInfo[]) => void) | null = null;
    private onSharedStateChange: ((state: Record<string, unknown>) => void) | null = null;

    // Current face state (to sync)
    private _currentFaceState: FaceState | null = null;

    constructor(serverUrl: string = '') {
        // Generate unique device ID
        this.deviceId = this.getOrCreateDeviceId();
        this.deviceType = this.detectDeviceType();

        // Default to local WebSocket server
        this.serverUrl = serverUrl || this.getDefaultServerUrl();
    }

    // =====================================================
    // Initialization
    // =====================================================

    private getOrCreateDeviceId(): string {
        const stored = localStorage.getItem('drifting-sagan-device-id');
        if (stored) return stored;

        const newId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('drifting-sagan-device-id', newId);
        return newId;
    }

    private detectDeviceType(): DeviceType {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        return isMobile ? 'mobile' : 'desktop';
    }

    private getDefaultServerUrl(): string {
        // Check for server URL in query params (from QR scan)
        const params = new URLSearchParams(window.location.search);
        const serverParam = params.get('server');
        if (serverParam) {
            return serverParam;
        }

        // Default to local WebSocket server
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.hostname}:3001`;
    }

    /**
     * Set the WebSocket server URL and reconnect if already connected/connecting
     */
    setServerUrl(url: string): void {
        if (this.serverUrl === url) return;

        console.log(`[DeviceSync] Updating server URL to: ${url}`);
        this.serverUrl = url;

        // If we have an active connection or are trying to connect, reconnect
        if (this.ws || this.reconnectAttempts > 0) {
            this.disconnect();
            this.reconnectAttempts = 0;
            this.connect();
        }
    }

    // =====================================================
    // Connection Management
    // =====================================================

    /**
     * Connect to the sync server
     */
    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                this.logToServer(`Attempting to connect to: ${this.serverUrl}`);

                this.ws = new WebSocket(this.serverUrl);

                // Set a timeout for connection
                const connectionTimeout = setTimeout(() => {
                    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                        this.logToServer('Connection timeout, using fallback');
                        this.ws.close();
                        this.setupBroadcastChannel();
                        resolve(true);
                    }
                }, 5000); // Increased timeout to 5s

                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    this.logToServer('Connected to WebSocket server!');
                    this.reconnectAttempts = 0;

                    // Register device and join room
                    this.registerDevice();
                    this.joinRoom();

                    if (this.onConnectionChange) {
                        this.onConnectionChange(true, Array.from(this.connectedDevices.values()));
                    }

                    faceEventBus.emit('system:connected', { device: 'sync-server' });
                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };

                this.ws.onclose = (e) => {
                    clearTimeout(connectionTimeout);
                    this.logToServer(`Disconnected from server code=${e.code} reason=${e.reason}`);
                    this.handleDisconnect();
                };

                this.ws.onerror = (e) => {
                    clearTimeout(connectionTimeout);
                    this.logToServer('WebSocket error', { type: e.type });
                    // Fallback to BroadcastChannel for same-browser testing
                    this.setupBroadcastChannel();
                    resolve(true);
                };

            } catch (error) {
                this.logToServer('Connection error exception', error);
                this.setupBroadcastChannel();
                resolve(true);
            }
        });
    }

    private useFallbackChannel(): boolean {
        // Only use fallback if WebSocket fails
        return typeof BroadcastChannel !== 'undefined';
    }

    private broadcastChannel: BroadcastChannel | null = null;

    private setupBroadcastChannel(): void {
        if (this.broadcastChannel) return;

        console.log('[DeviceSync] Using BroadcastChannel fallback');
        this.broadcastChannel = new BroadcastChannel('drifting-sagan-sync');

        this.broadcastChannel.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        // Register this device
        this.registerDevice();

        if (this.onConnectionChange) {
            this.onConnectionChange(true, Array.from(this.connectedDevices.values()));
        }
    }

    private handleDisconnect(): void {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[DeviceSync] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), this.reconnectDelay);
        } else {
            console.log('[DeviceSync] Max reconnect attempts reached, using fallback');
            this.setupBroadcastChannel();
        }

        if (this.onConnectionChange) {
            this.onConnectionChange(false, []);
        }

        faceEventBus.emit('system:disconnected', { device: 'sync-server' });
    }

    /**
     * Disconnect from the sync server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.broadcastChannel) {
            this.broadcastChannel.close();
            this.broadcastChannel = null;
        }
    }

    // =====================================================
    // Message Handling
    // =====================================================

    private registerDevice(): void {
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

    private joinRoom(): void {
        const roomId = this.getRoomId();
        console.log(`[DeviceSync] Joining room: ${roomId}`);

        this.sendMessage({
            type: 'join_room' as SyncMessage['type'],
            deviceId: this.deviceId,
            payload: {
                roomId
            },
            timestamp: Date.now()
        });
    }

    private sendMessage(message: SyncMessage): void {
        const msgStr = JSON.stringify(message);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msgStr);
        } else if (this.broadcastChannel) {
            this.broadcastChannel.postMessage(message);
        }
    }

    private handleMessage(message: SyncMessage): void {
        // Ignore messages from self
        if (message.deviceId === this.deviceId) return;

        switch (message.type) {
            case 'register':
                this.handleDeviceRegister(message);
                break;
            case 'state':
                this.handleStateSync(message);
                break;
            case 'transfer_start':
                this.handleTransferStart(message);
                break;
            case 'transfer_complete':
                this.handleTransferComplete(message);
                break;
            case 'transfer_cancel':
                this.handleTransferCancel(message);
                break;
            case 'ping':
                this.sendMessage({
                    type: 'pong',
                    deviceId: this.deviceId,
                    timestamp: Date.now()
                });
                break;
            case 'shared_state':
                this.handleSharedState(message);
                break;
        }
    }

    private handleDeviceRegister(message: SyncMessage): void {
        const payload = message.payload as { deviceType: DeviceType };

        this.connectedDevices.set(message.deviceId, {
            deviceId: message.deviceId,
            deviceType: payload.deviceType,
            connected: true,
            lastSeen: message.timestamp
        });

        if (this.onConnectionChange) {
            this.onConnectionChange(true, Array.from(this.connectedDevices.values()));
        }

        console.log(`[DeviceSync] Device registered: ${message.deviceId} (${payload.deviceType})`);
    }

    private handleStateSync(_message: SyncMessage): void {
        // State sync without transfer animation
        // Note: Full state sync could be implemented here
        if (this.onFaceReceived && !this.transferState.isTransferring) {
            // Just sync state, no animation
        }
    }

    private handleSharedState(message: SyncMessage): void {
        const payload = message.payload as Record<string, unknown>;
        console.log('[DeviceSync] Received shared state:', payload);

        if (this.onSharedStateChange) {
            this.onSharedStateChange(payload);
        }
    }

    private handleTransferStart(message: SyncMessage): void {
        const payload = message.payload as {
            state: FaceState;
            direction: TransferDirection;
            targetDevice: string;
        };

        // Only handle if we're the target
        if (payload.targetDevice !== this.deviceId && payload.targetDevice !== 'any') return;

        console.log(`[DeviceSync] Transfer started: ${payload.direction}`);

        this.transferState = {
            isTransferring: true,
            direction: payload.direction,
            progress: 0,
            fromDevice: message.deviceId,
            toDevice: this.deviceId
        };

        // Animate face entering from the opposite edge
        if (this.onFaceReceived) {
            this.onFaceReceived(payload.state, payload.direction);
        }
    }

    private handleTransferComplete(message: SyncMessage): void {
        if (this.transferState.fromDevice === message.deviceId) {
            console.log('[DeviceSync] Transfer complete');
            this.transferState = {
                isTransferring: false,
                direction: null,
                progress: 0,
                fromDevice: null,
                toDevice: null
            };
        }
    }

    private handleTransferCancel(message: SyncMessage): void {
        if (this.transferState.fromDevice === message.deviceId) {
            console.log('[DeviceSync] Transfer cancelled');
            this.transferState = {
                isTransferring: false,
                direction: null,
                progress: 0,
                fromDevice: null,
                toDevice: null
            };
        }
    }

    // =====================================================
    // Transfer API
    // =====================================================

    /**
     * Start transferring the face to another device
     * @param direction 'left' = send to desktop, 'right' = send to mobile
     */
    startTransfer(direction: TransferDirection, state: FaceState): void {
        this.transferState = {
            isTransferring: true,
            direction,
            progress: 0,
            fromDevice: this.deviceId,
            toDevice: null
        };

        this.sendMessage({
            type: 'transfer_start',
            deviceId: this.deviceId,
            payload: {
                state,
                direction,
                targetDevice: 'any' // Any connected device
            },
            timestamp: Date.now()
        });

        console.log(`[DeviceSync] Started transfer: ${direction}`);
    }

    /**
     * Update transfer progress (called during swipe animation)
     */
    updateTransferProgress(progress: number): void {
        this.transferState.progress = progress;

        if (this.onTransferProgress && this.transferState.direction) {
            this.onTransferProgress(progress, this.transferState.direction);
        }
    }

    /**
     * Complete the transfer
     */
    completeTransfer(): void {
        this.sendMessage({
            type: 'transfer_complete',
            deviceId: this.deviceId,
            timestamp: Date.now()
        });

        this.transferState = {
            isTransferring: false,
            direction: null,
            progress: 0,
            fromDevice: null,
            toDevice: null
        };
    }

    /**
     * Cancel the transfer (swipe didn't complete)
     */
    cancelTransfer(): void {
        this.sendMessage({
            type: 'transfer_cancel',
            deviceId: this.deviceId,
            timestamp: Date.now()
        });

        this.transferState = {
            isTransferring: false,
            direction: null,
            progress: 0,
            fromDevice: null,
            toDevice: null
        };
    }

    // =====================================================
    // State Sync
    // =====================================================

    /**
     * Sync the current face state to all connected devices
     */
    syncState(state: FaceState): void {
        this._currentFaceState = state;

        // Don't sync during transfer
        if (this.transferState.isTransferring) return;

        this.sendMessage({
            type: 'state',
            deviceId: this.deviceId,
            payload: state,
            timestamp: Date.now()
        });
    }

    // =====================================================
    // Callbacks
    // =====================================================

    setOnFaceReceived(callback: (state: FaceState, direction: TransferDirection) => void): void {
        this.onFaceReceived = callback;
    }

    setOnTransferProgress(callback: (progress: number, direction: TransferDirection) => void): void {
        this.onTransferProgress = callback;
    }

    setOnConnectionChange(callback: (connected: boolean, devices: DeviceInfo[]) => void): void {
        this.onConnectionChange = callback;
    }

    setOnSharedStateChange(callback: (state: Record<string, unknown>) => void): void {
        this.onSharedStateChange = callback;
    }

    /**
     * Broadcast shared state to all connected devices in the room
     */
    broadcastSharedState(state: Record<string, unknown>): void {
        this.sendMessage({
            type: 'shared_state',
            deviceId: this.deviceId,
            payload: state,
            timestamp: Date.now()
        });
    }

    // =====================================================
    // Getters
    // =====================================================

    getDeviceId(): string {
        return this.deviceId;
    }

    getDeviceType(): DeviceType {
        return this.deviceType;
    }

    isConnected(): boolean {
        return (this.ws !== null && this.ws.readyState === WebSocket.OPEN) ||
            this.broadcastChannel !== null;
    }

    getConnectedDevices(): DeviceInfo[] {
        return Array.from(this.connectedDevices.values());
    }

    getTransferState(): TransferState {
        return { ...this.transferState };
    }

    private publicServerUrl: string | null = null;
    private publicAppUrl: string | null = null;

    /**
     * Set the public URL for the WebSocket server (e.g. from localtunnel)
     * This ensures the QR code directs the phone to the accessible public URL
     */
    setPublicServerUrl(url: string): void {
        this.publicServerUrl = url;
    }

    /**
     * Set the public URL for the application (the web client)
     */
    setPublicAppUrl(url: string): void {
        this.publicAppUrl = url;
    }

    /**
     * Generate the connection URL for QR code
     * Includes all necessary params for phone to connect
     */
    getConnectionUrl(): string {
        // Use public app URL if set, otherwise current origin
        const baseUrl = this.publicAppUrl || window.location.origin;
        const roomId = this.getRoomId();

        // Build params for phone connection
        const params = new URLSearchParams({
            connect: this.deviceId,
            room: roomId
        });

        // Use public server URL if available, otherwise current connection
        if (this.publicServerUrl) {
            params.set('server', this.publicServerUrl);
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            params.set('server', this.serverUrl);
        }

        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Get or create a room ID for this session
     * Checks URL params first (for phone connecting via QR)
     */
    private getRoomId(): string {
        // First check URL params (phone connecting via QR)
        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');
        if (roomFromUrl) {
            sessionStorage.setItem('drifting-sagan-room', roomFromUrl);
            return roomFromUrl;
        }

        // Otherwise use/create session room
        let roomId = sessionStorage.getItem('drifting-sagan-room');
        if (!roomId) {
            roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            sessionStorage.setItem('drifting-sagan-room', roomId);
        }
        return roomId;
    }

    /**
     * Send log to server for debugging
     */
    private logToServer(message: string, data?: unknown): void {
        console.log(`[DeviceSync] ${message}`, data || '');

        try {
            const serverToUse = this.publicServerUrl || this.serverUrl;
            // Convert ws/wss to http/https and strip trailing slashes
            const httpUrl = serverToUse.replace(/^ws/, 'http').replace(/\/$/, '');

            fetch(`${httpUrl}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: `${this.deviceId} (${this.deviceType}): ${message} ${data ? JSON.stringify(data) : ''}`
            }).catch(() => { /* mute logging errors */ });
        } catch (e) {
            // mute
        }
    }
}

// =====================================================
// Singleton Export
// =====================================================

let deviceSyncInstance: DeviceSync | null = null;

export function getDeviceSync(): DeviceSync {
    if (!deviceSyncInstance) {
        deviceSyncInstance = new DeviceSync();
    }
    return deviceSyncInstance;
}

export function initDeviceSync(): DeviceSync {
    const sync = getDeviceSync();
    sync.connect();
    return sync;
}

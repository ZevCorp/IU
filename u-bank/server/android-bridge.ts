/**
 * Android Bridge — WebSocket handler for Ü Bank Android connections.
 * 
 * Same pattern as jetson-bridge.ts but for Android devices.
 * Routes messages between Android ↔ Jetson through the Render relay.
 * 
 * Protocol:
 *   1. Android connects with X-Android-Auth header
 *   2. Server stores connection and routes messages
 *   3. Voice commands → Jetson for SLM processing
 *   4. Execution plans ← Jetson back to Android
 *   5. Graph updates → Jetson for compilation
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';

// ============================================
// Configuration
// ============================================

const ANDROID_AUTH_SECRET = process.env.ANDROID_SECRET || 'u-bank-android-dev';
const ACTION_TIMEOUT = 30000; // 30s timeout per action step

// ============================================
// Types
// ============================================

interface AndroidClient {
    ws: WebSocket;
    deviceId: string;
    app: string;
    connectedAt: number;
}

// ============================================
// Android Bridge
// ============================================

export class AndroidBridge {
    private clients: Map<string, AndroidClient> = new Map();

    /**
     * Handle incoming WebSocket connection.
     * Returns true if this was an Android Ü Bank connection.
     */
    handleConnection(ws: WebSocket, req: IncomingMessage): boolean {
        const authHeader = req.headers['x-android-auth'];

        if (authHeader !== ANDROID_AUTH_SECRET) {
            return false;
        }

        const deviceId = (req.headers['x-device-id'] as string) || `android-${Date.now()}`;
        console.log(`[AndroidBridge] 📱 Android connected: ${deviceId}`);

        // Close previous connection from same device
        const existing = this.clients.get(deviceId);
        if (existing) {
            console.log(`[AndroidBridge] Closing previous connection for ${deviceId}`);
            existing.ws.close();
        }

        const client: AndroidClient = {
            ws,
            deviceId,
            app: 'u-bank',
            connectedAt: Date.now()
        };

        this.clients.set(deviceId, client);

        // Handle messages from Android
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleAndroidMessage(client, message);
            } catch (error) {
                console.error('[AndroidBridge] Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            console.log(`[AndroidBridge] 📱 Android disconnected: ${deviceId}`);
            this.clients.delete(deviceId);
        });

        ws.on('error', (error) => {
            console.error(`[AndroidBridge] WebSocket error (${deviceId}):`, error);
        });

        return true;
    }

    /**
     * Handle message from Android — route to Jetson or handle locally
     */
    private handleAndroidMessage(client: AndroidClient, message: any): void {
        const { type } = message;

        // Messages that need to go to Jetson
        const jetsonRouted = [
            'voice_command',
            'graph_update',
            'ui_state',
            'action_result',
            'explore_complete'
        ];

        if (jetsonRouted.includes(type)) {
            // Forward to Jetson via the jetson bridge
            this.forwardToJetson(message);
            return;
        }

        switch (type) {
            case 'register':
                client.deviceId = message.deviceId || client.deviceId;
                client.app = message.payload?.app || client.app;
                console.log(`[AndroidBridge] Registered: ${client.deviceId} (${client.app})`);
                this.sendToClient(client, {
                    type: 'registered',
                    deviceId: client.deviceId,
                    timestamp: Date.now()
                });
                break;

            case 'ping':
                this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
                break;

            default:
                console.log(`[AndroidBridge] Unknown message type: ${type}`);
        }
    }

    /**
     * Forward a message to the Jetson bridge.
     * This is called by the server's message routing.
     */
    forwardToJetson(message: any): void {
        // This will be wired up in server.js to call jetsonBridge.send()
        // For now, emit an event that server.js can listen to
        if (this.onJetsonMessage) {
            this.onJetsonMessage(message);
        }
    }

    /**
     * Receive a message from Jetson destined for Android.
     * Routes to the appropriate Android client.
     */
    sendFromJetson(message: any): void {
        const targetDevice = message.targetDevice;

        // Messages from Jetson that go to Android
        const androidRouted = [
            'execute_plan',
            'intent_confirmed',
            'explore_request',
            'plan_complete',
            'plan_error',
            'graph_ack'
        ];

        if (!androidRouted.includes(message.type)) {
            return;
        }

        if (targetDevice && this.clients.has(targetDevice)) {
            this.sendToClient(this.clients.get(targetDevice)!, message);
        } else {
            // Broadcast to all Android clients
            for (const client of this.clients.values()) {
                this.sendToClient(client, message);
            }
        }
    }

    /**
     * Send message to a specific Android client
     */
    private sendToClient(client: AndroidClient, message: any): void {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Check if any Android device is connected
     */
    isConnected(): boolean {
        return this.clients.size > 0;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected(),
            clientCount: this.clients.size,
            clients: Array.from(this.clients.values()).map(c => ({
                deviceId: c.deviceId,
                app: c.app,
                connectedAt: c.connectedAt
            }))
        };
    }

    // Callback for routing messages to Jetson
    onJetsonMessage: ((message: any) => void) | null = null;
}

// ============================================
// Singleton
// ============================================

export const androidBridge = new AndroidBridge();

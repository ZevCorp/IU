/**
 * Jetson Bridge - WebSocket handler for HRM connection
 * JavaScript version for 'node server.js'
 */

import { WebSocket } from 'ws';

// ============================================
// Configuration
// ============================================

const JETSON_AUTH_SECRET = process.env.JETSON_SECRET || 'dev-secret-change-in-prod';
const JETSON_TIMEOUT = 30000; // 30s timeout

// ============================================
// Jetson Bridge Class
// ============================================

export class JetsonBridge {
    constructor() {
        this.jetsonSocket = null;
        this.pendingRequests = new Map();
        this.requestCounter = 0;
        this.lastPing = 0;
        this.latencyMs = 0;
    }

    /**
     * Handle incoming WebSocket connection
     */
    handleConnection(ws, req) {
        const authHeader = req.headers['x-jetson-auth'];

        if (authHeader !== JETSON_AUTH_SECRET) {
            return false; // Not a Jetson connection
        }

        console.log('[JetsonBridge] 🤖 Jetson connected');

        // Close previous connection if any
        if (this.jetsonSocket) {
            console.log('[JetsonBridge] Closing previous Jetson connection');
            this.jetsonSocket.close();
        }

        this.jetsonSocket = ws;
        this.lastPing = Date.now();

        // Handle messages from Jetson
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleJetsonMessage(message);
            } catch (error) {
                console.error('[JetsonBridge] Error parsing message:', error);
            }
        });

        ws.on('pong', () => {
            this.latencyMs = Date.now() - this.lastPing;
            console.log(`[JetsonBridge] Latency: ${this.latencyMs}ms`);
        });

        ws.on('close', () => {
            console.log('[JetsonBridge] 🤖 Jetson disconnected');
            this.jetsonSocket = null;
            this.pendingRequests.forEach((request) => {
                clearTimeout(request.timeout);
                request.reject(new Error('Jetson disconnected'));
            });
            this.pendingRequests.clear();
        });

        ws.on('error', (error) => {
            console.error('[JetsonBridge] WebSocket error:', error);
        });

        return true;
    }

    handleJetsonMessage(message) {
        switch (message.type) {
            case 'solution':
                this.handleSolution(message);
                break;
            case 'pong':
                break;
            case 'status':
                console.log(`[JetsonBridge] Jetson status: ${JSON.stringify(message)}`);
                break;
            case 'error':
                console.error(`[JetsonBridge] Jetson error: ${message.message}`);
                if (message.requestId) {
                    const pending = this.pendingRequests.get(message.requestId);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        pending.reject(new Error(message.message));
                        this.pendingRequests.delete(message.requestId);
                    }
                }
                break;
            default:
                console.log(`[JetsonBridge] Unknown message type: ${message.type}`);
        }
    }

    handleSolution(response) {
        const pending = this.pendingRequests.get(response.requestId);
        if (!pending) {
            console.warn(`[JetsonBridge] Received solution for unknown request: ${response.requestId}`);
            return;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.requestId);

        console.log(`[JetsonBridge] Solution received: success=${response.success}, path length=${response.path?.length || 0}`);
        pending.resolve(response);
    }

    async solve(grid, width, height) {
        if (!this.isConnected()) {
            throw new Error('Jetson not connected');
        }

        const requestId = `req-${++this.requestCounter}-${Date.now()}`;
        const request = {
            type: 'solve',
            requestId,
            grid,
            width,
            height
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('HRM inference timeout'));
            }, JETSON_TIMEOUT);

            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            this.jetsonSocket.send(JSON.stringify(request));
            console.log(`[JetsonBridge] Sent solve request: ${requestId}`);
        });
    }

    isConnected() {
        return this.jetsonSocket !== null && this.jetsonSocket.readyState === WebSocket.OPEN;
    }
}


export const jetsonBridge = new JetsonBridge();

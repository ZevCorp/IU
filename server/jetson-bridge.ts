/**
 * Jetson Bridge - WebSocket handler for HRM connection
 * 
 * The Jetson Orin Nano initiates an OUTBOUND WebSocket connection to Render
 * This avoids NAT/firewall issues since the connection originates from Jetson
 * 
 * Protocol:
 *   1. Jetson connects with X-Jetson-Auth header
 *   2. Server validates and stores the connection
 *   3. When navigation needs HRM, server sends grid to Jetson
 *   4. Jetson runs HRM inference and returns path
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';

// ============================================
// Configuration
// ============================================

const JETSON_AUTH_SECRET = process.env.JETSON_SECRET || 'dev-secret-change-in-prod';
const JETSON_TIMEOUT = 30000; // 30s timeout for HRM inference

// ============================================
// Types
// ============================================

interface HRMRequest {
    type: 'solve';
    requestId: string;
    grid: number[];
    width: number;
    height: number;
}

interface HRMResponse {
    type: 'solution';
    requestId: string;
    path: [number, number][];
    success: boolean;
    inferenceTimeMs?: number;
}

type PendingRequest = {
    resolve: (response: HRMResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

// ============================================
// Jetson Bridge Class
// ============================================

export class JetsonBridge {
    private jetsonSocket: WebSocket | null = null;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private requestCounter = 0;
    private lastPing = 0;
    private latencyMs = 0;

    /**
     * Handle incoming WebSocket connection
     * Returns true if this was a Jetson connection
     */
    handleConnection(ws: WebSocket, req: IncomingMessage): boolean {
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

        // Handle pong
        ws.on('pong', () => {
            this.latencyMs = Date.now() - this.lastPing;
            console.log(`[JetsonBridge] Latency: ${this.latencyMs}ms`);
        });

        // Handle close
        ws.on('close', () => {
            console.log('[JetsonBridge] 🤖 Jetson disconnected');
            this.jetsonSocket = null;

            // Reject all pending requests
            this.pendingRequests.forEach((request, id) => {
                clearTimeout(request.timeout);
                request.reject(new Error('Jetson disconnected'));
            });
            this.pendingRequests.clear();
        });

        // Handle error
        ws.on('error', (error) => {
            console.error('[JetsonBridge] WebSocket error:', error);
        });

        return true;
    }

    /**
     * Handle message from Jetson
     */
    private handleJetsonMessage(message: any): void {
        switch (message.type) {
            case 'solution':
                this.handleSolution(message as HRMResponse);
                break;

            case 'pong':
                // Handled via ws.on('pong')
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

    /**
     * Handle solution response from Jetson
     */
    private handleSolution(response: HRMResponse): void {
        const pending = this.pendingRequests.get(response.requestId);

        if (!pending) {
            console.warn(`[JetsonBridge] Received solution for unknown request: ${response.requestId}`);
            return;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.requestId);

        console.log(`[JetsonBridge] Solution received: success=${response.success}, ` +
            `path length=${response.path?.length || 0}, ` +
            `inference=${response.inferenceTimeMs}ms`);

        pending.resolve(response);
    }

    /**
     * Send grid to Jetson for HRM inference
     */
    async solve(grid: number[], width: number, height: number): Promise<HRMResponse> {
        if (!this.isConnected()) {
            throw new Error('Jetson not connected');
        }

        const requestId = `req-${++this.requestCounter}-${Date.now()}`;

        const request: HRMRequest = {
            type: 'solve',
            requestId,
            grid,
            width,
            height
        };

        return new Promise((resolve, reject) => {
            // Set timeout
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('HRM inference timeout'));
            }, JETSON_TIMEOUT);

            // Store pending request
            this.pendingRequests.set(requestId, { resolve, reject, timeout });

            // Send to Jetson
            this.jetsonSocket!.send(JSON.stringify(request));

            console.log(`[JetsonBridge] Sent solve request: ${requestId} (${grid.length} tokens)`);
        });
    }

    /**
     * Check if Jetson is connected
     */
    isConnected(): boolean {
        return this.jetsonSocket !== null &&
            this.jetsonSocket.readyState === WebSocket.OPEN;
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected(),
            lastPing: this.lastPing,
            latencyMs: this.latencyMs,
            pendingRequests: this.pendingRequests.size
        };
    }

    /**
     * Ping Jetson to check connection
     */
    ping(): void {
        if (this.isConnected()) {
            this.lastPing = Date.now();
            this.jetsonSocket!.ping();
        }
    }
}

// ============================================
// Singleton Instance
// ============================================

export const jetsonBridge = new JetsonBridge();

// ============================================
// Integration Helper
// ============================================

/**
 * Integrate Jetson bridge with existing WebSocket server
 * Call this in your main server setup after creating WSS
 */
export function integrateJetsonBridge(wss: WebSocketServer): void {
    const originalOnConnection = wss.listeners('connection')[0] as Function;

    // Remove existing listener
    wss.removeAllListeners('connection');

    // Add new listener that checks for Jetson first
    wss.on('connection', (ws, req) => {
        // Check if this is a Jetson connection
        if (jetsonBridge.handleConnection(ws, req)) {
            return; // Jetson connection handled
        }

        // Not Jetson, use original handler
        if (originalOnConnection) {
            originalOnConnection(ws, req);
        }
    });

    console.log('[JetsonBridge] Integrated with WebSocket server');
}

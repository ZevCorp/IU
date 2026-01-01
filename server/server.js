/**
 * Drifting Sagan - WebSocket Sync Server
 * 
 * Simple WebSocket server for real-time device synchronization.
 * Handles face transfer between computer and phone.
 * 
 * Usage:
 *   cd server
 *   npm install
 *   npm start
 * 
 * Then use ngrok or similar to expose for phone access:
 *   ngrok http 3001
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

// =====================================================
// Configuration
// =====================================================

const PORT = process.env.PORT || 3001;
const PING_INTERVAL = 30000; // 30 seconds

// =====================================================
// Room Management
// =====================================================

/**
 * @typedef {Object} Client
 * @property {WebSocket} ws
 * @property {string} deviceId
 * @property {string} deviceType
 * @property {string} roomId
 * @property {boolean} isAlive
 */

/** @type {Map<string, Map<string, Client>>} */
const rooms = new Map();

/** @type {Map<WebSocket, Client>} */
const clients = new Map();

// =====================================================
// Server Setup
// =====================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create HTTP server (for health checks and logging)
const httpServer = http.createServer((req, res) => {
    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            rooms: rooms.size,
            clients: clients.size,
            uptime: process.uptime()
        }));
        return;
    }

    if (req.url === '/log' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const entry = `[${new Date().toISOString()}] ${body}\n`;
                fs.appendFileSync(path.join(__dirname, '..', 'debug_logs.txt'), entry);
                res.writeHead(200);
                res.end('ok');
            } catch (e) {
                console.error('Logging failed', e);
                res.writeHead(500);
                res.end('error');
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Drifting Sagan Sync Server - Use WebSocket to connect');
});

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// =====================================================
// WebSocket Handlers
// =====================================================

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[Server] New connection from ${clientIp}`);

    // Initialize client
    const client = {
        ws,
        deviceId: '',
        deviceType: 'unknown',
        roomId: '',
        isAlive: true
    };

    clients.set(ws, client);

    // Handle messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(client, message);
        } catch (error) {
            console.error('[Server] Error parsing message:', error);
        }
    });

    // Handle pong (for keep-alive)
    ws.on('pong', () => {
        client.isAlive = true;
    });

    // Handle close
    ws.on('close', () => {
        handleDisconnect(client);
    });

    // Handle error
    ws.on('error', (error) => {
        console.error('[Server] WebSocket error:', error);
        handleDisconnect(client);
    });
});

// =====================================================
// Message Handling
// =====================================================

/**
 * @param {Client} client
 * @param {Object} message
 */
function handleMessage(client, message) {
    const { type, deviceId, payload, timestamp } = message;

    switch (type) {
        case 'register':
            handleRegister(client, deviceId, payload);
            break;

        case 'join_room':
            handleJoinRoom(client, payload.roomId);
            break;

        case 'state':
        case 'transfer_start':
        case 'transfer_complete':
        case 'transfer_cancel':
        case 'shared_state':
            // Broadcast to room
            broadcastToRoom(client, message);
            break;

        case 'ping':
            // Respond with pong
            send(client.ws, {
                type: 'pong',
                deviceId: 'server',
                timestamp: Date.now()
            });
            break;

        default:
            console.log(`[Server] Unknown message type: ${type}`);
    }
}

/**
 * Register a new device
 * @param {Client} client
 * @param {string} deviceId
 * @param {Object} payload
 */
function handleRegister(client, deviceId, payload) {
    client.deviceId = deviceId;
    client.deviceType = payload?.deviceType || 'unknown';

    console.log(`[Server] Device registered: ${deviceId} (${client.deviceType})`);

    // If room is specified in payload, join it
    if (payload?.roomId) {
        handleJoinRoom(client, payload.roomId);
    }

    // Send confirmation
    send(client.ws, {
        type: 'registered',
        deviceId: 'server',
        payload: {
            yourDeviceId: deviceId,
            serverTime: Date.now()
        },
        timestamp: Date.now()
    });
}

/**
 * Join a room
 * @param {Client} client
 * @param {string} roomId
 */
function handleJoinRoom(client, roomId) {
    // Leave current room if any
    if (client.roomId) {
        leaveRoom(client);
    }

    // Join new room
    client.roomId = roomId;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
        console.log(`[Server] Room created: ${roomId}`);
    }

    const room = rooms.get(roomId);
    room.set(client.deviceId, client);

    console.log(`[Server] ${client.deviceId} joined room ${roomId} (${room.size} clients)`);

    // Notify other clients in room
    broadcastToRoom(client, {
        type: 'register',
        deviceId: client.deviceId,
        payload: {
            deviceType: client.deviceType
        },
        timestamp: Date.now()
    });

    // Send list of existing clients to the new client
    room.forEach((other, otherId) => {
        if (otherId !== client.deviceId) {
            send(client.ws, {
                type: 'register',
                deviceId: other.deviceId,
                payload: {
                    deviceType: other.deviceType
                },
                timestamp: Date.now()
            });
        }
    });
}

/**
 * Leave current room
 * @param {Client} client
 */
function leaveRoom(client) {
    if (!client.roomId) return;

    const room = rooms.get(client.roomId);
    if (room) {
        room.delete(client.deviceId);

        // Notify others
        room.forEach((other) => {
            send(other.ws, {
                type: 'device_left',
                deviceId: client.deviceId,
                timestamp: Date.now()
            });
        });

        // Clean up empty rooms
        if (room.size === 0) {
            rooms.delete(client.roomId);
            console.log(`[Server] Room deleted: ${client.roomId}`);
        }
    }

    client.roomId = '';
}

/**
 * Broadcast message to all clients in the same room
 * @param {Client} sender
 * @param {Object} message
 */
function broadcastToRoom(sender, message) {
    if (!sender.roomId) return;

    const room = rooms.get(sender.roomId);
    if (!room) return;

    room.forEach((client) => {
        // Don't send to self
        if (client.deviceId !== sender.deviceId) {
            send(client.ws, message);
        }
    });
}

/**
 * Handle client disconnect
 * @param {Client} client
 */
function handleDisconnect(client) {
    console.log(`[Server] Client disconnected: ${client.deviceId || 'unknown'}`);

    leaveRoom(client);
    clients.delete(client.ws);
}

/**
 * Send message to client
 * @param {WebSocket} ws
 * @param {Object} message
 */
function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// =====================================================
// Keep-Alive (Ping/Pong)
// =====================================================

const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        const client = clients.get(ws);
        if (!client) return;

        if (!client.isAlive) {
            console.log(`[Server] Terminating inactive client: ${client.deviceId}`);
            return ws.terminate();
        }

        client.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);

wss.on('close', () => {
    clearInterval(pingInterval);
});

// =====================================================
// Start Server
// =====================================================

httpServer.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║     Drifting Sagan - Sync Server               ║');
    console.log('╠════════════════════════════════════════════════╣');
    console.log(`║  WebSocket: ws://localhost:${PORT}               ║`);
    console.log(`║  Health:    http://localhost:${PORT}/health       ║`);
    console.log('╠════════════════════════════════════════════════╣');
    console.log('║  To expose for phone access, use:              ║');
    console.log(`║  npx localtunnel --port ${PORT}                   ║`);
    console.log('║  or: ngrok http ${PORT}                           ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');

    wss.clients.forEach((ws) => {
        ws.close();
    });

    httpServer.close(() => {
        console.log('[Server] Goodbye!');
        process.exit(0);
    });
});

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
import { handleCustomGptHttp } from './custom-gpt-server.js';

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

/** @type {Map<string, Array>} Room conversation contexts */
const roomContexts = new Map();

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
    const maybePromise = handleCustomGptHttp(req, res);
    if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then((handled) => {
            if (!handled) {
                handleDefaultHttp(req, res);
            }
        }).catch((error) => {
            console.error('[Server] Custom GPT HTTP handler failed:', error);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Custom GPT HTTP handler failed' }));
        });
        return;
    }

    if (maybePromise) {
        return;
    }

    handleDefaultHttp(req, res);
});

function handleDefaultHttp(req, res) {
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

    // Installer endpoint - serves PowerShell script for Windows installation
    if (req.url === '/install') {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
        });

        // Inline PowerShell script (no need for separate file)
        const installScript = `# IU OS - Windows Installer
# Usage: irm https://iu.space/install | iex

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   IU OS - Installer" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$AppName = "IU"
$Owner = "ZevCorp"
$Repo = "IU"
$InstallDir = "$env:LOCALAPPDATA\\Programs\\$AppName"

Write-Host "[1/4] Fetching latest release..." -ForegroundColor Yellow
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/latest" -ErrorAction Stop
    $Version = $Release.tag_name
    Write-Host "      Found version: $Version" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[ERROR] Could not fetch release info." -ForegroundColor Red
    Write-Host "        Make sure there is a release at:" -ForegroundColor Red
    Write-Host "        https://github.com/$Owner/$Repo/releases" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "        Error: $_" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

$Asset = $Release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
if (-not $Asset) {
    Write-Host ""
    Write-Host "[ERROR] No .exe found in the release." -ForegroundColor Red
    Write-Host "        Please upload IU.OS.exe to the release." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

$DownloadUrl = $Asset.browser_download_url
$FileName = $Asset.name

Write-Host "[2/4] Creating install directory..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-Host "      Location: $InstallDir" -ForegroundColor Green

Write-Host "[3/4] Downloading $FileName..." -ForegroundColor Yellow
$TempFile = "$env:TEMP\\$FileName"
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing
    Write-Host "      Downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[ERROR] Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[4/4] Installing..." -ForegroundColor Yellow
$ExePath = "$InstallDir\\$AppName.exe"

# Close existing IU process if running
$proc = Get-Process -Name "IU" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "      Closing existing IU process..." -ForegroundColor DarkGray
    Stop-Process -Name "IU" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Remove old exe if exists
if (Test-Path $ExePath) {
    Remove-Item -Path $ExePath -Force -ErrorAction SilentlyContinue
}

# Move new exe
Move-Item -Path $TempFile -Destination $ExePath -Force
Write-Host "      Installed to: $ExePath" -ForegroundColor Green

try {
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\\Desktop\\$AppName.lnk")
    $Shortcut.TargetPath = $ExePath
    $Shortcut.Save()
    Write-Host "      Desktop shortcut created" -ForegroundColor Green
} catch {
    Write-Host "      Could not create shortcut (non-critical)" -ForegroundColor DarkGray
}

# Step 5: API Key Configuration
Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   OpenAI API Key Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "IU needs an OpenAI API key for voice features." -ForegroundColor White
Write-Host "Get yours at: https://platform.openai.com/api-keys" -ForegroundColor Yellow
Write-Host ""

$EnvPath = "$InstallDir\\.env"
$ExistingKey = ""

# Check if .env already exists
if (Test-Path $EnvPath) {
    $content = Get-Content $EnvPath -Raw
    if ($content -match "OPENAI_API_KEY=(.+)") {
        $ExistingKey = $matches[1].Trim()
        Write-Host "Existing API key found: $($ExistingKey.Substring(0,10))..." -ForegroundColor Green
        $useExisting = Read-Host "Use this key? (Y/n)"
        if ($useExisting -ne "n" -and $useExisting -ne "N") {
            Write-Host "Using existing API key." -ForegroundColor Green
        } else {
            $ExistingKey = ""
        }
    }
}

if (-not $ExistingKey) {
    $ApiKey = Read-Host "Enter your OpenAI API Key (starts with sk-)"
    
    if ($ApiKey -and $ApiKey.StartsWith("sk-")) {
        "OPENAI_API_KEY=$ApiKey" | Out-File -FilePath $EnvPath -Encoding UTF8
        Write-Host "API Key saved!" -ForegroundColor Green
    } else {
        Write-Host "No valid API key provided. Voice features will be disabled." -ForegroundColor Yellow
        Write-Host "You can add it later by editing: $EnvPath" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   Installation Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting IU..." -ForegroundColor Yellow

Start-Process $ExePath
`;
        res.end(installScript);
        return;
    }

    // ── Phone Client Static Files ──────────────────────────────────
    // Serve the phone remote UI from server/public/
    const PHONE_FILES = {
        '/phone': { file: 'phone.html', type: 'text/html' },
        '/phone.html': { file: 'phone.html', type: 'text/html' },
        '/phone.css': { file: 'phone.css', type: 'text/css' },
        '/phone.js': { file: 'phone.js', type: 'application/javascript' }
    };

    const phoneRoute = PHONE_FILES[req.url.split('?')[0]];
    if (phoneRoute) {
        const filePath = path.join(__dirname, 'public', phoneRoute.file);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            res.writeHead(200, {
                'Content-Type': `${phoneRoute.type}; charset=utf-8`,
                'Cache-Control': 'no-cache'
            });
            res.end(content);
        } catch (e) {
            res.writeHead(404);
            res.end(`File not found: ${phoneRoute.file}`);
        }
        return;
    }
    // ─────────────────────────────────────────────────────────────────

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Drifting Sagan Sync Server - Use WebSocket to connect');
}

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// =====================================================
// Jetson Bridge Integration
// =====================================================

import { jetsonBridge } from './jetson-bridge.js';

// =====================================================
// WebSocket Handlers
// =====================================================

wss.on('connection', (ws, req) => {
    // FIRST: Check if this is a Jetson connection
    if (jetsonBridge.handleConnection(ws, req)) {
        // This was a Jetson connection, handled by the bridge
        return;
    }

    // NOT a Jetson connection, handle as normal client
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
        case 'face_state':
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

        case 'navigation_request':
            // Handle HRM navigation request
            handleNavigationRequest(client, message);
            break;

        // ── Phone ↔ Mac Bridge ──────────────────────────────────
        case 'phone_chat':
        case 'phone_voice':
        case 'phone_voice_toggle':
            // Forward to all other devices in the room (Mac Electron will pick it up)
            broadcastToRoom(client, message);
            // Store chat messages in room context
            if (type === 'phone_chat' && payload?.text) {
                storeContextMessage(client.roomId, { role: 'user', text: payload.text, source: 'phone', timestamp: Date.now() });
            }
            break;

        case 'phone_reply':
            // Response from Mac → broadcast to all (phone will pick it up)
            broadcastToRoom(client, message);
            // Store assistant replies in room context
            if (payload?.reply) {
                storeContextMessage(client.roomId, { role: 'assistant', text: payload.reply, source: 'mac', timestamp: Date.now() });
            }
            break;

        case 'context_request':
            // Phone requesting conversation history on connect
            handleContextRequest(client);
            break;

        case 'context_sync':
            // Mac sending full context to server for storage
            if (payload?.history && client.roomId) {
                roomContexts.set(client.roomId, payload.history);
                console.log(`[Server] Context synced for room ${client.roomId}: ${payload.history.length} messages`);
            }
            break;
        // ────────────────────────────────────────────────────────

        default:
            console.log(`[Server] Unknown message type: ${type}`);
    }
}

// =====================================================
// Phone Context Helpers
// =====================================================

const MAX_CONTEXT_PER_ROOM = 100;

function storeContextMessage(roomId, msg) {
    if (!roomId) return;
    if (!roomContexts.has(roomId)) {
        roomContexts.set(roomId, []);
    }
    const ctx = roomContexts.get(roomId);
    ctx.push(msg);
    if (ctx.length > MAX_CONTEXT_PER_ROOM) ctx.shift();
}

function handleContextRequest(client) {
    const ctx = roomContexts.get(client.roomId) || [];
    send(client.ws, {
        type: 'context_sync',
        deviceId: 'server',
        payload: { history: ctx },
        timestamp: Date.now()
    });
    console.log(`[Server] Sent ${ctx.length} context messages to ${client.deviceId}`);
}

/**
 * Handle navigation request from web client
 * Forwards to Jetson HRM for processing
 */
async function handleNavigationRequest(client, message) {
    const { requestId, payload } = message;

    console.log(`[Server] Navigation request: ${requestId}`);
    console.log(`  From: ${payload.currentScreen} → To: ${payload.targetScreen}`);

    try {
        // Check if Jetson is connected
        if (!jetsonBridge.isConnected()) {
            console.error('[Server] Jetson not connected, cannot process navigation');
            send(client.ws, {
                type: 'navigation_result',
                requestId,
                payload: {
                    success: false,
                    error: 'Jetson HRM not connected'
                }
            });
            return;
        }

        // Extract grid from UI state
        const grid = payload.uiState?.grid || [];
        const width = payload.uiState?.width || 0;
        const height = payload.uiState?.height || 0;

        console.log(`[Server] Forwarding to Jetson: ${grid.length} tokens (${width}x${height})`);

        // Send to Jetson for HRM processing
        const solution = await jetsonBridge.solve(grid, width, height);

        console.log(`[Server] Jetson returned path: ${solution.path?.length || 0} steps`);

        // Send result back to client
        send(client.ws, {
            type: 'navigation_result',
            requestId,
            payload: {
                success: solution.success,
                path: solution.path,
                inferenceTimeMs: solution.inferenceTimeMs
            }
        });

    } catch (error) {
        console.error('[Server] Navigation request failed:', error);
        send(client.ws, {
            type: 'navigation_result',
            requestId,
            payload: {
                success: false,
                error: error.message
            }
        });
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

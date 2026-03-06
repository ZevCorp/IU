/**
 * HRM Navigation Controller - Playwright Edition
 * 
 * Navega el EMR en Hostinger usando Playwright
 * Conecta a Render → Jetson para HRM processing
 * 
 * Arquitectura:
 * - Playwright: Abre browser, lee DOM, ejecuta acciones
 * - Render: WebSocket relay
 * - Jetson: HRM inference
 * 
 * Uso:
 *   npx ts-node src/medical-demo/hrm-controller.ts
 */

import { chromium, Page, Browser } from 'playwright';
import WebSocket from 'ws';
import { extractInteractiveElements, normalizeDOM, hashState, getScreenName } from './formalizer';

// ============================================
// Configuration
// ============================================

// Try different URL formats for iü.space
const EMR_URL = 'https://iü.space/medical/';  // IDN domain
const RENDER_WS_URL = 'wss://iu-rw9m.onrender.com';
const NAVIGATION_TIMEOUT = 30000;

// ============================================
// Types
// ============================================

interface MazeState {
    id: string;
    name: string;
    page: string;
    row: number;
    col: number;
}

interface UIGrid {
    grid: number[][];
    width: number;
    height: number;
    currentPos: [number, number];
    targetPos: [number, number];
    stateToPosition: Map<string, [number, number]>;
    positionToState: Map<string, string>;
}

interface NavigationResult {
    success: boolean;
    path?: [number, number][];
    error?: string;
    inferenceTimeMs?: number;
}

// ============================================
// Maze Builder (Universal format)
// ============================================

const STATES: MazeState[] = [
    { id: 'state-login', name: 'Login', page: 'index', row: 1, col: 1 },
    { id: 'state-dashboard', name: 'Dashboard', page: 'dashboard', row: 1, col: 3 },
    { id: 'state-patients', name: 'Patients', page: 'patients', row: 1, col: 5 },
    { id: 'state-patient-detail', name: 'Patient Detail', page: 'patient-detail', row: 3, col: 5 },
    { id: 'state-orders', name: 'Orders', page: 'orders', row: 3, col: 1 }
];

const EDGES = [
    { from: 'state-login', to: 'state-dashboard', selector: '#loginBtn' },
    { from: 'state-dashboard', to: 'state-patients', selector: '#nav-patients' },
    { from: 'state-dashboard', to: 'state-orders', selector: '#nav-orders' },
    { from: 'state-patients', to: 'state-patient-detail', selector: '#patient-row-1' },
    { from: 'state-patients', to: 'state-dashboard', selector: '#nav-dashboard' },
    { from: 'state-orders', to: 'state-dashboard', selector: '#nav-dashboard' },
    { from: 'state-patient-detail', to: 'state-patients', selector: '#nav-patients' },
];

function buildMaze(currentPage: string, targetPage: string): UIGrid {
    const gridSize = 7;
    const grid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));

    const stateToPosition = new Map<string, [number, number]>();
    const positionToState = new Map<string, string>();
    let currentPos: [number, number] = [0, 0];
    let targetPos: [number, number] = [0, 0];

    // Place states
    STATES.forEach(state => {
        grid[state.row][state.col] = 1; // WALKABLE
        stateToPosition.set(state.id, [state.row, state.col]);
        positionToState.set(`${state.row},${state.col}`, state.id);

        if (state.page === currentPage) {
            grid[state.row][state.col] = 2; // CURRENT
            currentPos = [state.row, state.col];
        }
        if (state.page === targetPage) {
            grid[state.row][state.col] = 3; // TARGET
            targetPos = [state.row, state.col];
        }
    });

    // Draw paths between connected states
    EDGES.forEach(edge => {
        const fromPos = stateToPosition.get(edge.from);
        const toPos = stateToPosition.get(edge.to);

        if (fromPos && toPos) {
            const [r1, c1] = fromPos;
            const [r2, c2] = toPos;

            // Horizontal path
            for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
                if (grid[r1][c] === 0) grid[r1][c] = 1;
            }
            // Vertical path
            for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
                if (grid[r][c2] === 0) grid[r][c2] = 1;
            }
        }
    });

    return {
        grid,
        width: gridSize,
        height: gridSize,
        currentPos,
        targetPos,
        stateToPosition,
        positionToState
    };
}

// ============================================
// WebSocket Client to Render
// ============================================

class HRMClient {
    private ws: WebSocket | null = null;
    private pendingRequests = new Map<string, {
        resolve: (result: NavigationResult) => void;
        reject: (error: Error) => void;
    }>();
    private requestId = 0;
    private connected = false;

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`[HRM] Connecting to ${RENDER_WS_URL}...`);

            this.ws = new WebSocket(RENDER_WS_URL);

            this.ws.on('open', () => {
                console.log('[HRM] ✅ Connected to Render');
                this.connected = true;

                // Register as controller client
                this.ws?.send(JSON.stringify({
                    type: 'register',
                    deviceId: `playwright-controller-${Date.now()}`,
                    payload: { deviceType: 'controller', platform: 'playwright' }
                }));
            });

            this.ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'registered') {
                    console.log('[HRM] Registered with server');
                    resolve();
                }

                if (msg.type === 'navigation_result') {
                    const pending = this.pendingRequests.get(msg.requestId);
                    if (pending) {
                        this.pendingRequests.delete(msg.requestId);
                        if (msg.payload.success) {
                            pending.resolve(msg.payload);
                        } else {
                            pending.reject(new Error(msg.payload.error || 'Navigation failed'));
                        }
                    }
                }
            });

            this.ws.on('error', (err) => {
                console.error('[HRM] WebSocket error:', err);
                reject(err);
            });

            this.ws.on('close', () => {
                console.log('[HRM] Connection closed');
                this.connected = false;
            });

            setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });
    }

    async requestNavigation(maze: UIGrid, currentScreen: string, targetScreen: string): Promise<NavigationResult> {
        if (!this.connected || !this.ws) {
            throw new Error('Not connected to server');
        }

        const requestId = `nav-${++this.requestId}-${Date.now()}`;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('Navigation request timeout'));
            }, NAVIGATION_TIMEOUT);

            this.pendingRequests.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            const message = {
                type: 'navigation_request',
                requestId,
                payload: {
                    currentScreen,
                    targetScreen,
                    uiState: {
                        grid: maze.grid.flat(),
                        width: maze.width,
                        height: maze.height
                    }
                }
            };

            console.log(`[HRM] 🧭 Sending navigation request: ${currentScreen} → ${targetScreen}`);
            this.ws?.send(JSON.stringify(message));
        });
    }

    close() {
        this.ws?.close();
    }
}

// ============================================
// Playwright Controller
// ============================================

class NavigationController {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private hrmClient: HRMClient;

    constructor() {
        this.hrmClient = new HRMClient();
    }

    async initialize(): Promise<void> {
        console.log('[Controller] Launching browser...');
        this.browser = await chromium.launch({
            headless: false,
            slowMo: 100
        });

        const context = await this.browser.newContext({
            viewport: { width: 1280, height: 800 }
        });

        this.page = await context.newPage();

        // Connect to Render/Jetson
        await this.hrmClient.connect();
    }

    async navigateTo(url: string): Promise<void> {
        if (!this.page) throw new Error('Browser not initialized');

        console.log(`[Controller] Navigating to ${url}...`);
        await this.page.goto(url);
        await this.page.waitForLoadState('networkidle');
    }

    async getCurrentPage(): Promise<string> {
        if (!this.page) throw new Error('Browser not initialized');

        const url = this.page.url();
        const path = new URL(url).pathname.split('/').pop() || 'index';
        return path.replace('.html', '');
    }

    async executeHRMNavigation(targetPage: string): Promise<boolean> {
        if (!this.page) throw new Error('Browser not initialized');

        const currentPage = await this.getCurrentPage();
        console.log(`\n[Controller] === HRM Navigation ===`);
        console.log(`[Controller] Current: ${currentPage}`);
        console.log(`[Controller] Target: ${targetPage}`);

        if (currentPage === targetPage) {
            console.log('[Controller] Already at target!');
            return true;
        }

        // Build maze
        const maze = buildMaze(currentPage, targetPage);
        console.log(`[Controller] Maze built: ${maze.width}x${maze.height}`);
        this.printMaze(maze.grid);

        // Request navigation from Jetson HRM
        try {
            const result = await this.hrmClient.requestNavigation(maze, currentPage, targetPage);

            console.log(`[Controller] ✅ Path received: ${result.path?.length || 0} positions`);
            console.log(`[Controller] Inference time: ${result.inferenceTimeMs}ms`);

            if (!result.path || result.path.length < 2) {
                console.log('[Controller] ❌ No valid path');
                return false;
            }

            // Convert path to actions and execute
            return await this.executePath(result.path, maze);

        } catch (error) {
            console.error('[Controller] ❌ Navigation failed:', error);
            return false;
        }
    }

    private async executePath(path: [number, number][], maze: UIGrid): Promise<boolean> {
        if (!this.page) throw new Error('Browser not initialized');

        // Filter path to only include actual states
        const statePath = path.filter(([r, c]) => maze.positionToState.has(`${r},${c}`));
        console.log(`[Controller] Filtered path: ${path.length} → ${statePath.length} states`);

        if (statePath.length < 2) {
            console.log('[Controller] ❌ Not enough states in path');
            return false;
        }

        // Execute transitions
        for (let i = 0; i < statePath.length - 1; i++) {
            const [r1, c1] = statePath[i];
            const [r2, c2] = statePath[i + 1];

            const fromState = maze.positionToState.get(`${r1},${c1}`);
            const toState = maze.positionToState.get(`${r2},${c2}`);

            if (!fromState || !toState) continue;

            // Find edge
            const edge = EDGES.find(e => e.from === fromState && e.to === toState);

            if (!edge) {
                console.log(`[Controller] ⚠️ No edge found: ${fromState} → ${toState}`);
                continue;
            }

            console.log(`[Controller] 🖱️ Clicking: ${edge.selector}`);

            try {
                await this.page.waitForSelector(edge.selector, { timeout: 5000 });
                await this.page.click(edge.selector);
                await this.page.waitForLoadState('networkidle');
                console.log(`[Controller] ✅ Navigated to: ${toState}`);
            } catch (error) {
                console.error(`[Controller] ❌ Click failed: ${edge.selector}`, error);
                return false;
            }
        }

        const finalPage = await this.getCurrentPage();
        console.log(`[Controller] 📍 Final page: ${finalPage}`);
        return true;
    }

    private printMaze(grid: number[][]): void {
        const symbols = ['█', '·', 'S', 'T'];
        console.log('[Controller] Maze:');
        grid.forEach(row => {
            console.log('   ' + row.map(c => symbols[c] || '?').join(''));
        });
    }

    async close(): Promise<void> {
        this.hrmClient.close();
        await this.browser?.close();
    }
}

// ============================================
// Main
// ============================================

async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║     HRM Navigation Controller (Playwright)                ║');
    console.log('║     Conecta a: Hostinger → Render → Jetson                ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    const controller = new NavigationController();

    try {
        await controller.initialize();

        // Navigate to EMR on Hostinger
        await controller.navigateTo(EMR_URL);
        console.log('[Main] EMR loaded from Hostinger');

        // Login first
        console.log('[Main] Logging in...');
        const page = (controller as any).page as Page;
        await page.click('#loginBtn');
        await page.waitForLoadState('networkidle');
        console.log('[Main] ✅ Logged in');

        // Execute HRM navigation: Dashboard → Orders
        const success = await controller.executeHRMNavigation('orders');

        if (success) {
            console.log('\n✅ Navigation completed successfully!');
        } else {
            console.log('\n❌ Navigation failed');
        }

        // Keep browser open for inspection
        console.log('\n⏸️ Browser will close in 15 seconds...');
        await new Promise(resolve => setTimeout(resolve, 15000));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await controller.close();
    }
}

main().catch(console.error);

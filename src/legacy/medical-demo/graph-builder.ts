/**
 * MedEMR - Graph Builder
 * Explores UI and builds navigation graph incrementally
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildNode,
    normalizeDOM,
    hashState,
    extractInteractiveElements,
    graphToJSON,
    jsonToGraph,
    createEmptyGraph
} from './formalizer';
import type { UIGraph, UINode, UIEdge, UIAction } from './types';

// ============================================
// Configuration
// ============================================

const EMR_BASE_URL = `file://${path.resolve(__dirname, 'emr-app/index.html')}`;
const GRAPH_PATH = path.resolve(__dirname, 'graph.json');
const MAX_DEPTH = 10;
const ACTION_DELAY = 300; // ms between actions

// ============================================
// Graph Builder Class
// ============================================

export class GraphBuilder {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private graph: UIGraph;
    private visited: Set<string> = new Set();
    private actionQueue: { stateId: string; action: UIAction }[] = [];

    constructor() {
        this.graph = createEmptyGraph();
    }

    /**
     * Initialize browser and start exploration
     */
    async initialize(): Promise<void> {
        console.log('🚀 Initializing browser...');
        this.browser = await chromium.launch({
            headless: false,  // Show browser for debugging
            slowMo: 100
        });

        const context = await this.browser.newContext({
            viewport: { width: 1280, height: 800 }
        });

        this.page = await context.newPage();

        // Load existing graph if available
        await this.loadGraph();
    }

    /**
     * Close browser
     */
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    /**
     * Load graph from disk
     */
    async loadGraph(): Promise<void> {
        try {
            if (fs.existsSync(GRAPH_PATH)) {
                const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
                this.graph = jsonToGraph(json);
                console.log(`📂 Loaded graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
            }
        } catch (error) {
            console.log('📂 No existing graph found, starting fresh');
            this.graph = createEmptyGraph();
        }
    }

    /**
     * Save graph to disk
     */
    async saveGraph(): Promise<void> {
        const json = graphToJSON(this.graph);
        fs.writeFileSync(GRAPH_PATH, JSON.stringify(json, null, 2));
        console.log(`💾 Saved graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
    }

    /**
     * Get current state of the page
     */
    async getCurrentState(): Promise<UINode> {
        if (!this.page) throw new Error('Browser not initialized');
        return await buildNode(this.page);
    }

    /**
     * Main exploration loop
     * Uses BFS to discover all reachable states
     */
    async explore(): Promise<void> {
        if (!this.page) throw new Error('Browser not initialized');

        console.log('🔍 Starting exploration from login page...');

        // Navigate to start
        await this.page.goto(EMR_BASE_URL);
        await this.page.waitForLoadState('networkidle');

        // Get initial state
        const initialNode = await this.getCurrentState();
        this.graph.nodes.set(initialNode.id, initialNode);

        // BFS exploration queue
        const queue: { stateId: string; depth: number }[] = [
            { stateId: initialNode.id, depth: 0 }
        ];

        while (queue.length > 0) {
            const current = queue.shift()!;

            if (this.visited.has(current.stateId)) continue;
            if (current.depth >= MAX_DEPTH) {
                console.log(`⚠️ Max depth reached at ${current.stateId}`);
                continue;
            }

            this.visited.add(current.stateId);

            const node = this.graph.nodes.get(current.stateId);
            if (!node) continue;

            console.log(`\n📍 Exploring: ${node.screenName} (${node.elements.length} elements)`);

            // Try each interactive element
            for (const element of node.elements) {
                // Skip certain elements
                if (element.type === 'input' && !element.label.toLowerCase().includes('search')) {
                    continue; // Skip most inputs for now
                }

                try {
                    // Navigate to this state first
                    await this.navigateToState(current.stateId);

                    // Perform action
                    const action: UIAction = {
                        type: element.type === 'input' ? 'input' : 'click',
                        selector: element.selector,
                        label: element.label,
                        value: element.type === 'input' ? 'test' : undefined
                    };

                    console.log(`  🖱️ Trying: ${element.type} "${element.label}"`);

                    const newState = await this.executeAction(action);

                    if (newState && newState.id !== current.stateId) {
                        // New state discovered
                        if (!this.graph.nodes.has(newState.id)) {
                            this.graph.nodes.set(newState.id, newState);
                            console.log(`  ✅ Discovered: ${newState.screenName}`);
                            queue.push({ stateId: newState.id, depth: current.depth + 1 });
                        }

                        // Record edge
                        const edgeExists = this.graph.edges.some(
                            e => e.from === current.stateId && e.to === newState.id && e.action.selector === action.selector
                        );

                        if (!edgeExists) {
                            this.graph.edges.push({
                                from: current.stateId,
                                to: newState.id,
                                action,
                                observedCount: 1
                            });
                        }
                    }

                    // Save periodically
                    if (this.graph.nodes.size % 5 === 0) {
                        await this.saveGraph();
                    }

                } catch (error) {
                    console.log(`  ❌ Failed: ${(error as Error).message}`);
                }

                // Delay between actions
                await new Promise(resolve => setTimeout(resolve, ACTION_DELAY));
            }
        }

        this.graph.metadata.explorationComplete = true;
        this.graph.metadata.updatedAt = Date.now();
        await this.saveGraph();

        console.log('\n✅ Exploration complete!');
        console.log(`   Total nodes: ${this.graph.nodes.size}`);
        console.log(`   Total edges: ${this.graph.edges.length}`);
    }

    /**
     * Navigate to a specific state by following known path
     */
    async navigateToState(targetStateId: string): Promise<boolean> {
        if (!this.page) return false;

        const currentNode = await this.getCurrentState();
        if (currentNode.id === targetStateId) return true;

        // For now, simple approach: go to start and follow known path
        // TODO: Use proper pathfinding

        const targetNode = this.graph.nodes.get(targetStateId);
        if (!targetNode) return false;

        // Direct navigation by URL where possible
        const screenToUrl: Record<string, string> = {
            'index': 'index.html',
            'dashboard': 'dashboard.html',
            'patients': 'patients.html',
            'patient-detail': 'patient-detail.html',
            'orders': 'orders.html'
        };

        const baseScreen = targetNode.screenName.split(':')[0];
        if (screenToUrl[baseScreen]) {
            const url = EMR_BASE_URL.replace('index.html', screenToUrl[baseScreen]);
            await this.page.goto(url);
            await this.page.waitForLoadState('networkidle');

            // Handle sub-states (e.g., tabs)
            if (targetNode.screenName.includes(':')) {
                const subState = targetNode.screenName.split(':')[1];
                const tabSelector = `[data-tab="${subState}"]`;
                if (await this.page.$(tabSelector)) {
                    await this.page.click(tabSelector);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            return true;
        }

        return false;
    }

    /**
     * Execute an action and return new state
     */
    async executeAction(action: UIAction): Promise<UINode | null> {
        if (!this.page) return null;

        try {
            const element = await this.page.$(action.selector);
            if (!element) return null;

            // Take snapshot before
            const beforeDOM = await normalizeDOM(this.page);
            const beforeHash = hashState(beforeDOM);

            // Execute based on type
            switch (action.type) {
                case 'click':
                    await element.click();
                    break;
                case 'input':
                    await element.fill(action.value || '');
                    break;
                case 'submit':
                    await element.press('Enter');
                    break;
                default:
                    await element.click();
            }

            // Wait for potential navigation/animation
            await new Promise(resolve => setTimeout(resolve, 300));

            try {
                await this.page.waitForLoadState('networkidle', { timeout: 2000 });
            } catch {
                // Timeout is OK, state may not involve navigation
            }

            // Take snapshot after
            const newNode = await this.getCurrentState();

            // Only return if state changed
            if (newNode.id !== beforeHash) {
                return newNode;
            }

            return null;

        } catch (error) {
            console.log(`Action failed: ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Get the built graph
     */
    getGraph(): UIGraph {
        return this.graph;
    }

    /**
     * Print graph summary
     */
    printSummary(): void {
        console.log('\n📊 Graph Summary');
        console.log('================');
        console.log(`Nodes: ${this.graph.nodes.size}`);
        console.log(`Edges: ${this.graph.edges.length}`);
        console.log('\nScreens:');

        const screens = new Map<string, number>();
        this.graph.nodes.forEach(node => {
            const screen = node.screenName.split(':')[0];
            screens.set(screen, (screens.get(screen) || 0) + 1);
        });

        screens.forEach((count, screen) => {
            console.log(`  - ${screen}: ${count} states`);
        });

        console.log('\nTransitions:');
        const transitions = new Map<string, number>();
        this.graph.edges.forEach(edge => {
            const fromNode = this.graph.nodes.get(edge.from);
            const toNode = this.graph.nodes.get(edge.to);
            if (fromNode && toNode) {
                const key = `${fromNode.screenName} → ${toNode.screenName}`;
                transitions.set(key, (transitions.get(key) || 0) + 1);
            }
        });

        transitions.forEach((count, transition) => {
            console.log(`  - ${transition} (${count}x)`);
        });
    }
}

// ============================================
// CLI Entry Point
// ============================================

async function main() {
    const builder = new GraphBuilder();

    try {
        await builder.initialize();
        await builder.explore();
        builder.printSummary();
    } finally {
        await builder.close();
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}

export { main as exploreGraph };

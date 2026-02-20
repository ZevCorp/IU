/**
 * MedEMR - Main Entry Point / CLI
 * Orchestrates exploration, navigation, and execution
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { GraphBuilder } from './graph-builder';
import { findPath, navigate, printGrid, printGridWithPath, resolveGoal } from './solver';
import { executeNavigation, getCurrentScreen } from './executor';
import { graphToGrid, jsonToGraph, buildNode } from './formalizer';
import type { UIGraph, NavigationGoal } from './types';

// ============================================
// Configuration
// ============================================

const EMR_BASE_URL = `file://${path.resolve(__dirname, 'emr-app/index.html')}`;
const GRAPH_PATH = path.resolve(__dirname, 'graph.json');

// ============================================
// CLI Commands
// ============================================

interface CLIOptions {
    command: 'explore' | 'navigate' | 'execute' | 'visualize' | 'status';
    target?: string;
    from?: string;
}

async function parseArgs(): Promise<CLIOptions> {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
        command: 'status'
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case 'explore':
            case 'navigate':
            case 'execute':
            case 'visualize':
            case 'status':
                options.command = arg;
                break;
            case '--target':
            case '-t':
                options.target = args[++i];
                break;
            case '--from':
            case '-f':
                options.from = args[++i];
                break;
        }
    }

    return options;
}

// ============================================
// Commands Implementation
// ============================================

/**
 * Explore the EMR UI and build navigation graph
 */
async function commandExplore(): Promise<void> {
    console.log('🔍 Starting UI Exploration...\n');

    const builder = new GraphBuilder();

    try {
        await builder.initialize();
        await builder.explore();
        builder.printSummary();
    } finally {
        await builder.close();
    }
}

/**
 * Find path between states (dry run)
 */
async function commandNavigate(from: string | undefined, target: string): Promise<void> {
    console.log('🧭 Computing Navigation Path...\n');

    // Load graph
    if (!fs.existsSync(GRAPH_PATH)) {
        console.error('❌ No graph found. Run "explore" first.');
        return;
    }

    const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
    const graph = jsonToGraph(json);

    // If no "from" specified, determine from list
    if (!from) {
        console.log('Available states:');
        graph.nodes.forEach((node, id) => {
            console.log(`  - ${node.screenName} (${id.substring(0, 8)}...)`);
        });

        // Default to first state
        from = Array.from(graph.nodes.keys())[0];
        console.log(`\nUsing first state as origin: ${graph.nodes.get(from)?.screenName}`);
    }

    // Resolve goal
    const goal: NavigationGoal = {
        screenName: target,
        elementLabel: target
    };

    const result = navigate(graph, from, goal);

    if (result.reachable) {
        console.log('\n✅ Path found!');
        console.log(`   Steps: ${result.actions.length}`);
        console.log(`   Path: ${result.statePath.map(id => graph.nodes.get(id)?.screenName).join(' → ')}`);
        console.log('\n   Actions:');
        result.actions.forEach((action, i) => {
            console.log(`   ${i + 1}. ${action.type} "${action.label}" (${action.selector})`);
        });

        // Show grid visualization
        const targetId = resolveGoal(graph, goal);
        if (targetId) {
            const uiGrid = graphToGrid(graph, from, targetId);
            printGrid(uiGrid.grid);
        }
    } else {
        console.log(`\n❌ No path found: ${result.error}`);
    }
}

/**
 * Execute navigation on live browser
 */
async function commandExecute(target: string): Promise<void> {
    console.log('🚀 Executing Navigation...\n');

    // Load graph
    if (!fs.existsSync(GRAPH_PATH)) {
        console.error('❌ No graph found. Run "explore" first.');
        return;
    }

    const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
    const graph = jsonToGraph(json);

    // Launch browser
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    try {
        // Navigate to EMR
        await page.goto(EMR_BASE_URL);
        await page.waitForLoadState('networkidle');

        // Get current state
        const currentNode = await buildNode(page);
        console.log(`Current state: ${currentNode.screenName}`);

        // Find existing state in graph (or add current)
        let currentStateId = currentNode.id;
        if (!graph.nodes.has(currentStateId)) {
            // Try to match by screen name
            for (const [id, node] of graph.nodes) {
                if (node.screenName === currentNode.screenName) {
                    currentStateId = id;
                    break;
                }
            }
        }

        // Navigate to target
        const goal: NavigationGoal = {
            screenName: target,
            elementLabel: target
        };

        const result = navigate(graph, currentStateId, goal);

        if (result.reachable) {
            console.log(`\n🎯 Target: ${target}`);
            console.log(`   Actions: ${result.actions.length}`);

            // Execute actions
            const execResult = await executeNavigation(page, result, { delay: 300 });

            if (execResult.success) {
                console.log('\n✅ Navigation successful!');

                // Verify final state
                const finalScreen = await getCurrentScreen(page);
                console.log(`   Final screen: ${finalScreen}`);
            } else {
                console.log(`\n❌ Navigation failed: ${execResult.error}`);
            }
        } else {
            console.log(`\n❌ Cannot navigate: ${result.error}`);
        }

        // Keep browser open for viewing
        console.log('\n⏸️  Browser open. Press Ctrl+C to exit.');
        await new Promise(() => { }); // Wait indefinitely

    } finally {
        await browser.close();
    }
}

/**
 * Visualize the UI graph
 */
async function commandVisualize(): Promise<void> {
    console.log('📊 UI Graph Visualization\n');

    // Load graph
    if (!fs.existsSync(GRAPH_PATH)) {
        console.error('❌ No graph found. Run "explore" first.');
        return;
    }

    const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
    const graph = jsonToGraph(json);

    // Print summary
    console.log(`Nodes: ${graph.nodes.size}`);
    console.log(`Edges: ${graph.edges.length}`);
    console.log(`Last updated: ${new Date(graph.metadata.updatedAt).toLocaleString()}`);
    console.log(`Exploration complete: ${graph.metadata.explorationComplete}`);

    // Print screens
    console.log('\n📱 Screens:');
    const screens = new Map<string, string[]>();
    graph.nodes.forEach((node, id) => {
        const screen = node.screenName.split(':')[0];
        if (!screens.has(screen)) screens.set(screen, []);
        screens.get(screen)!.push(`${node.screenName} (${node.elements.length} elements)`);
    });

    screens.forEach((states, screen) => {
        console.log(`\n  ${screen}:`);
        states.forEach(state => console.log(`    - ${state}`));
    });

    // Print transitions
    console.log('\n🔗 Transitions:');
    graph.edges.forEach(edge => {
        const from = graph.nodes.get(edge.from);
        const to = graph.nodes.get(edge.to);
        if (from && to) {
            console.log(`  ${from.screenName} → ${to.screenName} [${edge.action.type}: "${edge.action.label}"]`);
        }
    });

    // Show sample grid
    if (graph.nodes.size >= 2) {
        const nodeIds = Array.from(graph.nodes.keys());
        const uiGrid = graphToGrid(graph, nodeIds[0], nodeIds[nodeIds.length - 1]);
        console.log('\n🗺️ Grid Representation:');
        printGrid(uiGrid.grid);
        console.log(`Grid sequence length: ${uiGrid.sequence.length} tokens`);
    }
}

/**
 * Show current status
 */
async function commandStatus(): Promise<void> {
    console.log('📋 Medical Demo Status\n');

    console.log('EMR App:');
    const emrPath = path.resolve(__dirname, 'emr-app');
    const htmlFiles = fs.readdirSync(emrPath).filter(f => f.endsWith('.html'));
    console.log(`  Location: ${emrPath}`);
    console.log(`  Pages: ${htmlFiles.join(', ')}`);

    console.log('\nNavigation Graph:');
    if (fs.existsSync(GRAPH_PATH)) {
        const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
        console.log(`  Nodes: ${json.nodes.length}`);
        console.log(`  Edges: ${json.edges.length}`);
        console.log(`  Complete: ${json.metadata.explorationComplete}`);
    } else {
        console.log('  ❌ Not built yet. Run: npx ts-node index.ts explore');
    }

    console.log('\nCommands:');
    console.log('  explore           - Build navigation graph by exploring UI');
    console.log('  navigate -t <screen> - Find path to target screen');
    console.log('  execute -t <screen>  - Navigate to target in live browser');
    console.log('  visualize         - Show graph summary and visualization');
    console.log('  status            - Show this status message');
}

// ============================================
// Main Entry Point
// ============================================

async function main(): Promise<void> {
    console.log('═══════════════════════════════════════════');
    console.log('  MedEMR - HRM UI Navigation Demo');
    console.log('═══════════════════════════════════════════\n');

    const options = await parseArgs();

    switch (options.command) {
        case 'explore':
            await commandExplore();
            break;

        case 'navigate':
            if (!options.target) {
                console.error('❌ Please specify target: --target <screen>');
                return;
            }
            await commandNavigate(options.from, options.target);
            break;

        case 'execute':
            if (!options.target) {
                console.error('❌ Please specify target: --target <screen>');
                return;
            }
            await commandExecute(options.target);
            break;

        case 'visualize':
            await commandVisualize();
            break;

        case 'status':
        default:
            await commandStatus();
            break;
    }
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

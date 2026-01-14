/**
 * MedEMR - Demo de navegación con HRM
 * 
 * Este script muestra cómo:
 * 1. Explorar el EMR y construir el grafo
 * 2. Asignar un goal (objetivo) de navegación
 * 3. Ejecutar la navegación con HRM
 * 
 * Uso:
 *   npx ts-node src/medical-demo/demo.ts
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { GraphBuilder } from './graph-builder';
import { navigate, printGrid, printGridWithPath, resolveGoal } from './solver';
import { executeNavigation, getCurrentScreen } from './executor';
import { graphToGrid, jsonToGraph, buildNode } from './formalizer';
import type { NavigationGoal } from './types';

// ============================================
// Configuración
// ============================================

const EMR_BASE_URL = `file://${path.resolve(__dirname, 'emr-app/index.html')}`;
const GRAPH_PATH = path.resolve(__dirname, 'graph.json');

// ============================================
// Demostración Principal
// ============================================

async function demo() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║     MedEMR + HRM Navigation Demo                          ║');
    console.log('║     UI como laberinto navegable                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    // ========================================
    // Paso 1: Construir el grafo (si no existe)
    // ========================================

    if (!fs.existsSync(GRAPH_PATH)) {
        console.log('📊 PASO 1: Construyendo grafo de navegación...');
        console.log('   (Esto solo se hace una vez)\n');

        const builder = new GraphBuilder();
        try {
            await builder.initialize();
            await builder.explore();
            builder.printSummary();
        } finally {
            await builder.close();
        }

        console.log('\n✅ Grafo construido y guardado en graph.json\n');
    } else {
        console.log('📂 Grafo existente encontrado, saltando exploración.\n');
    }

    // ========================================
    // Paso 2: Cargar grafo
    // ========================================

    console.log('📊 PASO 2: Cargando grafo...');
    const json = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
    const graph = jsonToGraph(json);
    console.log(`   Nodos: ${graph.nodes.size}`);
    console.log(`   Aristas: ${graph.edges.length}\n`);

    // ========================================
    // Paso 3: Definir objetivo (GOAL)
    // ========================================

    console.log('🎯 PASO 3: Definiendo objetivo de navegación...');

    // Ejemplo de diferentes formas de especificar un goal:

    // Opción A: Por nombre de pantalla
    const goal1: NavigationGoal = { screenName: 'orders' };

    // Opción B: Por etiqueta de elemento
    const goal2: NavigationGoal = { elementLabel: 'Nueva Orden' };

    // Opción C: Por selector CSS
    const goal3: NavigationGoal = { elementSelector: '#createOrderBtn' };

    // Usamos goal1 para esta demo
    const currentGoal = goal1;
    console.log(`   Goal: ir a la pantalla "${currentGoal.screenName}"`);

    // ========================================
    // Paso 4: Visualizar como grid (formato HRM)
    // ========================================

    console.log('\n🗺️ PASO 4: Visualización del grafo como grid (formato HRM):\n');

    const nodeIds = Array.from(graph.nodes.keys());
    if (nodeIds.length >= 2) {
        // Tomamos el primer nodo como actual y buscamos el target
        const currentStateId = nodeIds[0];
        const targetStateId = resolveGoal(graph, currentGoal);

        if (targetStateId) {
            const uiGrid = graphToGrid(graph, currentStateId, targetStateId);

            console.log('   Grid 2D (lo que ve HRM):');
            printGrid(uiGrid.grid);

            console.log('   Secuencia aplanada (input a HRM):');
            console.log(`   [${uiGrid.sequence.join(', ')}]`);
            console.log(`   Total tokens: ${uiGrid.sequence.length}\n`);
        }
    }

    // ========================================
    // Paso 5: Ejecutar navegación en navegador real
    // ========================================

    console.log('🚀 PASO 5: Ejecutando navegación en navegador...\n');

    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    try {
        // Ir al login
        await page.goto(EMR_BASE_URL);
        await page.waitForLoadState('networkidle');

        // Login
        console.log('   1. Iniciando sesión...');
        await page.click('#loginBtn');
        await page.waitForLoadState('networkidle');

        // Obtener estado actual
        const currentNode = await buildNode(page);
        console.log(`   2. Estado actual: ${currentNode.screenName}`);

        // Encontrar ID en el grafo
        let currentStateId = currentNode.id;
        for (const [id, node] of graph.nodes) {
            if (node.screenName === currentNode.screenName) {
                currentStateId = id;
                break;
            }
        }

        // Navegar al objetivo
        const result = navigate(graph, currentStateId, currentGoal);

        if (result.reachable) {
            console.log(`   3. Path encontrado: ${result.actions.length} acciones`);
            console.log(`   4. Ruta: ${result.statePath.map(id =>
                graph.nodes.get(id)?.screenName || id
            ).join(' → ')}\n`);

            // Mostrar grid con path
            const targetStateId = resolveGoal(graph, currentGoal);
            if (targetStateId) {
                const uiGrid = graphToGrid(graph, currentStateId, targetStateId);
                console.log('   Path en el grid:');
                // BFS returns positions, we need to map back
                // For now, just show the grid
                printGrid(uiGrid.grid);
            }

            // Ejecutar
            console.log('   Ejecutando acciones...');
            const execResult = await executeNavigation(page, result, { delay: 500 });

            if (execResult.success) {
                const finalScreen = await getCurrentScreen(page);
                console.log(`\n   ✅ Navegación exitosa!`);
                console.log(`   📍 Pantalla final: ${finalScreen}`);
            } else {
                console.log(`\n   ❌ Error: ${execResult.error}`);
            }
        } else {
            console.log(`\n   ❌ No se puede navegar: ${result.error}`);
        }

        // Mantener navegador abierto para ver el resultado
        console.log('\n   ⏸️ Navegador abierto por 10 segundos para ver el resultado...');
        await new Promise(resolve => setTimeout(resolve, 10000));

    } finally {
        await browser.close();
    }

    console.log('\n✅ Demo completada!\n');
}

// ============================================
// Ejecutar
// ============================================

demo().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});

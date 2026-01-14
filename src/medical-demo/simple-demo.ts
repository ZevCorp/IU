/**
 * MedEMR - Simple Demo Script (standalone)
 * Demonstrates HRM navigation without complex imports
 */

import { chromium } from 'playwright';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// EMR URL
const EMR_URL = `file://${path.resolve(__dirname, 'emr-app/index.html')}`;

// Simple hash function
function hash(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
    }
    return Math.abs(h).toString(16).substring(0, 8);
}

// Grid tokens
const WALL = 0, WALK = 1, START = 2, TARGET = 3;

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║     MedEMR + HRM Navigation Demo                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Launch browser
    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const page = await browser.newPage();

    try {
        // Navigate to login
        await page.goto(EMR_URL);
        console.log('📍 Loaded: Login page\n');

        // Get current state info
        const loginState = await page.evaluate(() => ({
            route: window.location.pathname.split('/').pop(),
            buttons: document.querySelectorAll('button').length,
            inputs: document.querySelectorAll('input').length
        }));
        console.log('📊 State Analysis:', loginState);
        console.log('   Hash:', hash(JSON.stringify(loginState)));

        // Define navigation graph manually (what HRM would compute)
        console.log('\n🗺️ Navigation Graph (what HRM sees):');
        console.log('   States: login → dashboard → patients → detail → orders');

        // Show as HRM grid format
        console.log('\n🎮 HRM Grid Representation:');
        const grid = [
            [WALL, WALL, WALL, WALL, WALL, WALL, WALL],
            [WALL, START, WALK, WALL, WALK, WALK, WALL],
            [WALL, WALL, WALK, WALK, WALK, TARGET, WALL],
            [WALL, WALL, WALL, WALL, WALL, WALL, WALL]
        ];

        const symbols: Record<number, string> = {
            [WALL]: '█', [WALK]: '·', [START]: 'S', [TARGET]: 'T'
        };
        grid.forEach(row => console.log('   ' + row.map(c => symbols[c]).join(' ')));

        console.log('\n   Sequence (HRM input):', grid.flat().join(','));

        // Demo: Navigate from login → orders
        console.log('\n🎯 Goal: Navigate to Orders page');
        console.log('   Path: Login → Dashboard → Orders\n');

        // Step 1: Login
        console.log('   [1/3] Clicking login...');
        await page.click('#loginBtn');
        await page.waitForLoadState('networkidle');
        console.log('   ✓ Now on: Dashboard');

        // Step 2: Go to orders
        console.log('   [2/3] Clicking Orders in sidebar...');
        await page.click('#nav-orders');
        await page.waitForLoadState('networkidle');
        console.log('   ✓ Now on: Orders');

        // Step 3: Select lab order type
        console.log('   [3/3] Selecting Laboratorio...');
        await page.click('#orderTypeLab');
        console.log('   ✓ Form opened');

        // Final state
        console.log('\n✅ Navigation complete!');
        console.log('   Current screen: Orders (with Lab form open)');

        // Keep browser open
        console.log('\n⏸️ Browser will close in 10 seconds...');
        await new Promise(r => setTimeout(r, 10000));

    } finally {
        await browser.close();
    }

    console.log('\n✅ Demo finished!\n');
}

main().catch(console.error);

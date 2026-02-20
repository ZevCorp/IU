/**
 * Core Action Executor
 * Executes action sequences on the browser
 */

import type { Page } from 'playwright';
import type { UIAction, NavigationResult } from '../types.js';

// ============================================
// Execution Configuration
// ============================================

const DEFAULT_ACTION_DELAY = 200;  // ms between actions
const DEFAULT_TIMEOUT = 5000;       // ms to wait for element

// ============================================
// Action Executor
// ============================================

/**
 * Executes a single action on the page
 */
export async function executeAction(
    page: Page,
    action: UIAction,
    options: { timeout?: number; delay?: number } = {}
): Promise<boolean> {
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const delay = options.delay || DEFAULT_ACTION_DELAY;

    try {
        // Wait for element
        const element = await page.waitForSelector(action.selector, {
            timeout,
            state: 'visible'
        });

        if (!element) {
            console.log(`❌ Element not found: ${action.selector}`);
            return false;
        }

        // Execute based on action type
        switch (action.type) {
            case 'click':
                await element.click();
                console.log(`🖱️ Clicked: ${action.label || action.selector}`);
                break;

            case 'input':
                await element.fill(action.value || '');
                console.log(`⌨️ Typed: "${action.value}" into ${action.label || action.selector}`);
                break;

            case 'submit':
                await element.press('Enter');
                console.log(`↵ Submitted: ${action.label || action.selector}`);
                break;

            case 'select':
                if (action.value) {
                    await (element as any).selectOption(action.value);
                    console.log(`📋 Selected: "${action.value}" in ${action.label || action.selector}`);
                }
                break;

            case 'navigate':
                if (action.value) {
                    await page.goto(action.value);
                    console.log(`🌐 Navigated to: ${action.value}`);
                }
                break;

            default:
                await element.click();
                console.log(`🖱️ Default click: ${action.label || action.selector}`);
        }

        // Wait for potential navigation/animation
        await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => { });

        // Delay between actions
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        return true;

    } catch (error) {
        console.log(`❌ Action failed: ${(error as Error).message}`);
        return false;
    }
}

/**
 * Executes a sequence of actions
 */
export async function executeSequence(
    page: Page,
    actions: UIAction[],
    options: {
        timeout?: number;
        delay?: number;
        stopOnError?: boolean;
        onProgress?: (index: number, total: number, action: UIAction) => void;
    } = {}
): Promise<{ success: boolean; completedActions: number; error?: string }> {
    const stopOnError = options.stopOnError ?? true;

    console.log(`\n🚀 Executing ${actions.length} actions...`);

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        // Progress callback
        if (options.onProgress) {
            options.onProgress(i, actions.length, action);
        }

        console.log(`\n[${i + 1}/${actions.length}] ${action.type}: ${action.label || action.selector}`);

        const success = await executeAction(page, action, options);

        if (!success && stopOnError) {
            return {
                success: false,
                completedActions: i,
                error: `Failed at action ${i + 1}: ${action.type} on ${action.selector}`
            };
        }
    }

    console.log(`\n✅ Completed all ${actions.length} actions`);

    return {
        success: true,
        completedActions: actions.length
    };
}

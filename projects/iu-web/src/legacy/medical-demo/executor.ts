/**
 * MedEMR - Action Executor
 * Executes action sequences on the browser
 */

import type { Page } from 'playwright';
import type { UIAction, NavigationResult } from './types';

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

/**
 * Executes a navigation result
 */
export async function executeNavigation(
    page: Page,
    navigation: NavigationResult,
    options: { timeout?: number; delay?: number } = {}
): Promise<{ success: boolean; error?: string }> {
    if (!navigation.reachable) {
        return {
            success: false,
            error: navigation.error || 'Navigation not reachable'
        };
    }

    console.log(`\n🧭 Navigating through ${navigation.statePath.length} states...`);
    console.log(`   Path: ${navigation.statePath.join(' → ')}`);

    const result = await executeSequence(page, navigation.actions, options);

    return {
        success: result.success,
        error: result.error
    };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Wait for a specific screen/state
 */
export async function waitForScreen(
    page: Page,
    screenName: string,
    timeout: number = 5000
): Promise<boolean> {
    try {
        // Different screens have different indicators
        const screenIndicators: Record<string, string> = {
            'index': '#loginForm',
            'login': '#loginForm',
            'dashboard': '.stats-grid',
            'patients': '#searchPatient',
            'patient-detail': '.patient-header',
            'orders': '#orderTypeCard'
        };

        const indicator = screenIndicators[screenName];
        if (indicator) {
            await page.waitForSelector(indicator, { timeout, state: 'visible' });
            return true;
        }

        // Fallback: wait for URL change
        await page.waitForURL(`**/${screenName}*`, { timeout });
        return true;

    } catch {
        return false;
    }
}

/**
 * Get current screen name from page
 */
export async function getCurrentScreen(page: Page): Promise<string> {
    return await page.evaluate(() => {
        const path = window.location.pathname.split('/').pop() || 'index';
        return path.replace('.html', '');
    });
}

/**
 * Highlight an element on the page (for visualization)
 */
export async function highlightElement(
    page: Page,
    selector: string,
    duration: number = 2000
): Promise<void> {
    await page.evaluate(({ selector, duration }) => {
        const element = document.querySelector(selector) as HTMLElement;
        if (!element) return;

        const originalOutline = element.style.outline;
        const originalTransition = element.style.transition;

        element.style.transition = 'outline 0.2s ease';
        element.style.outline = '3px solid #ff0000';

        setTimeout(() => {
            element.style.outline = originalOutline;
            element.style.transition = originalTransition;
        }, duration);
    }, { selector, duration });
}

/**
 * Take screenshot with annotation
 */
export async function screenshotWithAnnotation(
    page: Page,
    path: string,
    annotation?: string
): Promise<void> {
    if (annotation) {
        await page.evaluate((text) => {
            const div = document.createElement('div');
            div.id = 'screenshot-annotation';
            div.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 14px;
        z-index: 99999;
      `;
            div.textContent = text;
            document.body.appendChild(div);
        }, annotation);
    }

    await page.screenshot({ path, fullPage: false });

    if (annotation) {
        await page.evaluate(() => {
            document.getElementById('screenshot-annotation')?.remove();
        });
    }
}

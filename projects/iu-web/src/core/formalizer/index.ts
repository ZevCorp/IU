/**
 * Core DOM Formalizer
 * Converts DOM state to HRM-compatible grid representation
 */

import type { Page } from 'playwright';
import type {
    UIElement,
    UINode,
    UIGraph,
    UIGraphJSON,
    UIGrid
} from '../types.js';
import { GridToken } from '../types.js';

/**
 * Simple hash function (djb2 algorithm) - no Node crypto dependency
 */
function simpleHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0').substring(0, 16);
}

// ============================================
// DOM Normalization
// ============================================

/**
 * Extracts and normalizes DOM structure for state identification
 * Strips dynamic content (timestamps, session data) to create stable hashes
 */
export async function normalizeDOM(page: Page): Promise<string> {
    return await page.evaluate(() => {
        // Clone document to avoid modifying original
        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        // Remove dynamic/noise elements
        const removeSelectors = [
            'script',
            'style',
            'noscript',
            'iframe',
            '[data-dynamic]',
            '.timestamp',
            '.session-id'
        ];

        removeSelectors.forEach(selector => {
            clone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Normalize attributes that vary
        clone.querySelectorAll('*').forEach(el => {
            // Remove event handlers
            Array.from(el.attributes)
                .filter(attr => attr.name.startsWith('on'))
                .forEach(attr => el.removeAttribute(attr.name));

            // Normalize dynamic classes
            if (el.className && typeof el.className === 'string') {
                el.className = el.className
                    .split(' ')
                    .filter(c => !c.match(/^(active|hover|focus|selected)/))
                    .sort()
                    .join(' ');
            }
        });

        // Extract structural information for robust fingerprinting
        // This can be extended based on specific app needs
        const structure = {
            // Current page/route
            route: window.location.pathname,
            // Visible structural structure (simplified)
            bodyStructure: clone.innerHTML.length // Simple metric for now
        };

        return JSON.stringify(structure);
    });
}

/**
 * Generates a unique hash for a DOM state
 */
export function hashState(normalizedDOM: string): string {
    return simpleHash(normalizedDOM);
}

/**
 * Extracts human-readable screen name from page
 * Optimized for generic URL-based routing, can be customized
 */
export async function getScreenName(page: Page): Promise<string> {
    return await page.evaluate(() => {
        const path = window.location.pathname.split('/').pop() || 'index';
        const baseName = path.replace('.html', '');
        return baseName;
    });
}

// ============================================
// Interactive Element Extraction
// ============================================

/**
 * Extracts all interactive elements from current page
 */
export async function extractInteractiveElements(page: Page): Promise<UIElement[]> {
    return await page.evaluate(() => {
        const selectors = [
            'button:not([disabled])',
            'a[href]',
            'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[role="button"]',
        ];

        const elements: any[] = [];
        const seen = new Set<string>();

        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach((el: Element) => {
                const htmlEl = el as HTMLElement;

                // Check visibility
                const style = window.getComputedStyle(htmlEl);
                const isVisible =
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    htmlEl.offsetParent !== null;

                if (!isVisible) return;

                // Generate unique selector
                let uniqueSelector = '';
                if (htmlEl.id) {
                    uniqueSelector = `#${htmlEl.id}`;
                } else {
                    // Fallback using path
                    const path: string[] = [];
                    let current: Element | null = htmlEl;
                    while (current && current !== document.body) {
                        const siblings = current.parentElement?.children;
                        if (siblings) {
                            const idx = Array.from(siblings).indexOf(current);
                            path.unshift(`${current.tagName.toLowerCase()}:nth-child(${idx + 1})`);
                        }
                        current = current.parentElement;
                    }
                    uniqueSelector = path.slice(-3).join(' > ');
                }

                // Skip duplicates
                if (seen.has(uniqueSelector)) return;
                seen.add(uniqueSelector);

                // Determine element type
                let type: string = 'button';
                const tag = htmlEl.tagName.toLowerCase();
                if (tag === 'a') type = 'link';
                else if (tag === 'input') type = 'input';
                else if (tag === 'select') type = 'select';

                // Get label
                const label =
                    htmlEl.getAttribute('aria-label') ||
                    htmlEl.textContent?.trim().substring(0, 50) ||
                    htmlEl.getAttribute('placeholder') ||
                    htmlEl.id ||
                    'unknown';

                // Get bounds
                const rect = htmlEl.getBoundingClientRect();

                elements.push({
                    id: htmlEl.id || `${type}-${elements.length}`,
                    selector: uniqueSelector,
                    type,
                    label,
                    visible: true,
                    bounds: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                });
            });
        });

        return elements;
    });
}

// ============================================
// Node Building
// ============================================

/**
 * Builds a complete UINode from current page state
 */
export async function buildNode(page: Page): Promise<UINode> {
    const normalizedDOM = await normalizeDOM(page);
    const stateHash = hashState(normalizedDOM);
    const screenName = await getScreenName(page);
    const elements = await extractInteractiveElements(page);

    return {
        id: stateHash,
        screenName,
        elements,
        discoveredAt: Date.now()
    };
}

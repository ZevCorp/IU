/**
 * MedEMR - DOM Formalizer
 * Converts DOM state to HRM-compatible grid representation
 */

import type { Page } from 'playwright';
import type {
    UIElement,
    UINode,
    UIGraph,
    UIGraphJSON,
    UIGrid
} from './types.js';
import { GridToken } from './types.js';

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

        // Extract structural information only
        const structure = {
            // Current page/route
            route: window.location.pathname.split('/').pop() || 'index.html',
            // Active tab if any
            activeTab: document.querySelector('.tab.active')?.getAttribute('data-tab') || null,
            // Modal/overlay state
            hasModal: !!document.querySelector('.modal:not([style*="display: none"])'),
            // Form state (visible forms)
            visibleForms: Array.from(document.querySelectorAll('form:not([style*="display: none"])')).map(f => f.id || 'form'),
            // Key structural elements count
            buttons: document.querySelectorAll('button:not([style*="display: none"])').length,
            links: document.querySelectorAll('a:not([style*="display: none"])').length,
            inputs: document.querySelectorAll('input:not([style*="display: none"])').length
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
 */
export async function getScreenName(page: Page): Promise<string> {
    return await page.evaluate(() => {
        const path = window.location.pathname.split('/').pop() || 'index';
        const baseName = path.replace('.html', '');

        // Include sub-state in name
        const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab');
        const orderFormVisible = document.getElementById('orderFormCard')?.style.display !== 'none';

        if (activeTab) return `${baseName}:${activeTab}`;
        if (orderFormVisible) return `${baseName}:form`;

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
            '.nav-item',
            '.tab',
            '.order-type-btn',
            'tr[onclick]'
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
                    // Use combination of tag, class, and position
                    const tag = htmlEl.tagName.toLowerCase();
                    const classes = htmlEl.className && typeof htmlEl.className === 'string'
                        ? '.' + htmlEl.className.split(' ').filter(c => c).slice(0, 2).join('.')
                        : '';

                    if (classes) {
                        uniqueSelector = `${tag}${classes}`;
                        // Check uniqueness
                        if (document.querySelectorAll(uniqueSelector).length > 1) {
                            const all = Array.from(document.querySelectorAll(uniqueSelector));
                            const idx = all.indexOf(htmlEl);
                            uniqueSelector = `${uniqueSelector}:nth-of-type(${idx + 1})`;
                        }
                    } else {
                        // Fallback to parent path
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
                }

                // Skip duplicates
                if (seen.has(uniqueSelector)) return;
                seen.add(uniqueSelector);

                // Determine element type
                let type: string = 'button';
                const tag = htmlEl.tagName.toLowerCase();
                if (tag === 'a') type = 'link';
                else if (tag === 'input') {
                    const inputType = (htmlEl as HTMLInputElement).type;
                    if (inputType === 'checkbox') type = 'checkbox';
                    else type = 'input';
                }
                else if (tag === 'select') type = 'select';
                else if (htmlEl.classList.contains('tab')) type = 'tab';
                else if (tag === 'tr') type = 'row';

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

// ============================================
// Graph → Grid Conversion (HRM Format)
// ============================================

/**
 * Converts UI graph to HRM-compatible 2D grid
 * Uses topological layout to position nodes
 */
export function graphToGrid(
    graph: UIGraph,
    currentStateId: string,
    targetStateId: string
): UIGrid {
    const nodes = Array.from(graph.nodes.values());
    const nodeCount = nodes.length;

    // Calculate grid size (square grid that fits all nodes)
    // Add padding for walls
    const gridSize = Math.ceil(Math.sqrt(nodeCount)) + 2;

    // Initialize grid with walls
    const grid: number[][] = Array(gridSize)
        .fill(null)
        .map(() => Array(gridSize).fill(GridToken.WALL));

    // Position nodes in grid
    const stateToPosition = new Map<string, [number, number]>();
    const positionToState = new Map<string, string>();

    // Simple layout: place nodes in order
    let row = 1;
    let col = 1;

    nodes.forEach(node => {
        if (col >= gridSize - 1) {
            col = 1;
            row++;
        }

        let token = GridToken.WALKABLE;
        if (node.id === currentStateId) token = GridToken.CURRENT;
        else if (node.id === targetStateId) token = GridToken.TARGET;

        grid[row][col] = token;
        stateToPosition.set(node.id, [row, col]);
        positionToState.set(`${row},${col}`, node.id);

        col++;
    });

    // Find current and target positions
    const currentPos = stateToPosition.get(currentStateId) || [1, 1];
    const targetPos = stateToPosition.get(targetStateId) || [1, 1];

    // Mark valid transitions (connect adjacent walkable cells)
    graph.edges.forEach(edge => {
        const fromPos = stateToPosition.get(edge.from);
        const toPos = stateToPosition.get(edge.to);

        if (fromPos && toPos) {
            // For non-adjacent nodes, we may need to add intermediate walkable cells
            // For now, simple approach: mark a path between them
            const [r1, c1] = fromPos;
            const [r2, c2] = toPos;

            // If not adjacent, mark intermediate cells as walkable
            if (Math.abs(r1 - r2) > 1 || Math.abs(c1 - c2) > 1) {
                // Simple horizontal then vertical path
                const minR = Math.min(r1, r2);
                const maxR = Math.max(r1, r2);
                const minC = Math.min(c1, c2);
                const maxC = Math.max(c1, c2);

                for (let r = minR; r <= maxR; r++) {
                    if (grid[r][c1] === GridToken.WALL) {
                        grid[r][c1] = GridToken.WALKABLE;
                    }
                }
                for (let c = minC; c <= maxC; c++) {
                    if (grid[r2][c] === GridToken.WALL) {
                        grid[r2][c] = GridToken.WALKABLE;
                    }
                }
            }
        }
    });

    // Flatten grid to sequence (row-major order)
    const sequence = grid.flat();

    return {
        grid,
        sequence,
        width: gridSize,
        height: gridSize,
        currentPos,
        targetPos,
        positionToState,
        stateToPosition
    };
}

/**
 * Converts HRM path (grid positions) back to UI actions
 */
export function pathToActions(
    path: [number, number][],
    uiGrid: UIGrid,
    graph: UIGraph
): { stateId: string; node: UINode }[] {
    return path
        .map(([row, col]) => {
            const stateId = uiGrid.positionToState.get(`${row},${col}`);
            if (!stateId) return null;
            const node = graph.nodes.get(stateId);
            if (!node) return null;
            return { stateId, node };
        })
        .filter((x): x is { stateId: string; node: UINode } => x !== null);
}

// ============================================
// Graph Serialization
// ============================================

/**
 * Serializes UIGraph to JSON for storage
 */
export function graphToJSON(graph: UIGraph): UIGraphJSON {
    return {
        nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({ ...node, id })),
        edges: graph.edges,
        metadata: graph.metadata
    };
}

/**
 * Deserializes UIGraph from JSON
 */
export function jsonToGraph(json: UIGraphJSON): UIGraph {
    const nodes = new Map<string, UINode>();
    json.nodes.forEach(node => {
        nodes.set(node.id, node);
    });

    return {
        nodes,
        edges: json.edges,
        metadata: json.metadata
    };
}

/**
 * Creates an empty graph
 */
export function createEmptyGraph(): UIGraph {
    return {
        nodes: new Map(),
        edges: [],
        metadata: {
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            explorationComplete: false
        }
    };
}

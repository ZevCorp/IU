/**
 * GraphFormalizer.js
 * 
 * Implements a "Formalization Layer" that transforms raw AX trees into a simplified, 
 * semantic graph optimized for LLM consumption.
 * 
 * Simulates SwiftUI accessibility behaviors via heuristics:
 * - .combine: Merges related elements (Icon + Text) into a single interactive node.
 * - .contain: Abstructs large lists/containers into summary nodes.
 * - .ignore: Removes decorative or redundant elements.
 */

class GraphFormalizer {
    constructor() {
        // Configuration thresholds
        this.config = {
            mergeDistance: 0.05, // Max distance to consider merging (normalized 0-1)
            minContainerSize: 10, // Min elements to collapse a container
            maxTextLength: 50, // Max length for label summaries
        };
    }

    /**
     * Main entry point: Optimize a list of raw AX elements.
     * @param {Array} elements Raw elements from extractor
     * @returns {Array} Optimized, semantic elements
     */
    optimize(elements) {
        if (!elements || elements.length === 0) return [];

        let optimized = [...elements];

        // 1. Noise Reduction (.ignore)
        optimized = this._removeNoise(optimized);

        // 2. Semantic Merging (.combine) -> Create "Mega-Nodes"
        optimized = this._mergeSemanticPairs(optimized);

        // 3. Container Abstraction (.contain) -> Summarize Lists
        // optimized = this._abstractContainers(optimized); // TBD: simpler first

        // 4. Final Cleanup
        optimized = this._deduplicate(optimized);

        return optimized;
    }

    /**
     * Remove decorative or irrelevant elements
     */
    _removeNoise(elements) {
        return elements.filter(e => {
            // Remove empty groups without children context (we don't have tree here, just list)
            // But we filter by type/size
            if (e.type === 'group' && (!e.label || e.label.trim() === '')) return false;

            // Remove tiny invisible elements (unless input/checkbox)
            if (e.bbox.w < 0.001 || e.bbox.h < 0.001) return false;

            // Remove purely structural elements with no accessible info
            if (e.role === 'AXSplitGroup' || e.role === 'AXScrollArea') {
                // Keep ScrollArea if it has a label, otherwise it's just a container
                // Actually, ScrollArea is good context. Keep it.
            }

            return true;
        });
    }

    /**
     * Merge related elements (e.g. Icon + Label) into one button.
     * Heuristic: 
     * - An Image and a Text are very close to each other.
     * - Or a Text is inside a generic container that also has an Image.
     */
    _mergeSemanticPairs(elements) {
        const merged = [];
        const processedIds = new Set();

        // Sort by Y then X to process top-down left-right
        const sorted = [...elements].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i];
            if (processedIds.has(current.id)) continue;

            let mergedNode = { ...current };

            // Look for a partner to merge with (next few elements)
            // We only look forward because we sorted
            for (let j = i + 1; j < Math.min(i + 10, sorted.length); j++) {
                const partner = sorted[j];
                if (processedIds.has(partner.id)) continue;

                if (this._shouldMerge(current, partner)) {
                    // Create merged node
                    mergedNode = this._createMergedNode(current, partner);
                    processedIds.add(partner.id); // Mark partner as processed

                    // Update 'current' in case we can merge more (e.g. Icon + Text + Chevron)
                    // For now, pair-wise is safest.
                    break;
                }
            }

            merged.push(mergedNode);
            processedIds.add(current.id);
        }

        return merged;
    }

    /**
     * Check if two elements should be merged based on heuristics
     */
    _shouldMerge(a, b) {
        // Rule 1: Text + Image (Icon with label)
        const types = [a.type, b.type];
        const hasText = types.includes('text') || types.includes('statictext');
        const hasImage = types.includes('image');

        if (hasText && hasImage) {
            // Check distance
            if (this._isClose(a, b)) return true;
        }

        // Rule 2: Text + Text (Label + Value, or split lines)
        // e.g. "Monday" + "15" -> "Monday 15"
        if (a.type === b.type && (a.type === 'text' || a.type === 'statictext')) {
            if (this._isVeryClose(a, b)) return true;
        }

        return false;
    }

    /**
     * Calculate normalized distance between centers
     */
    _isClose(a, b) {
        const cxA = a.bbox.x + a.bbox.w / 2;
        const cyA = a.bbox.y + a.bbox.h / 2;
        const cxB = b.bbox.x + b.bbox.w / 2;
        const cyB = b.bbox.y + b.bbox.h / 2;

        const dist = Math.sqrt(Math.pow(cxA - cxB, 2) + Math.pow(cyA - cyB, 2));
        return dist < this.config.mergeDistance;
    }

    _isVeryClose(a, b) {
        const cxA = a.bbox.x + a.bbox.w / 2;
        const cyA = a.bbox.y + a.bbox.h / 2;
        const cxB = b.bbox.x + b.bbox.w / 2;
        const cyB = b.bbox.y + b.bbox.h / 2;

        const dist = Math.sqrt(Math.pow(cxA - cxB, 2) + Math.pow(cyA - cyB, 2));
        return dist < (this.config.mergeDistance / 2);
    }

    /**
     * Create a new node combining A and B
     */
    _createMergedNode(a, b) {
        // Determine primary role (Button wins over Text)
        let type = a.type;
        if (['button', 'link', 'menu', 'checkbox'].includes(b.type)) type = b.type;
        else if (['button', 'link', 'menu', 'checkbox'].includes(a.type)) type = a.type;
        else if (a.type === 'image' && b.type === 'text') type = 'button'; // Infer button
        else if (b.type === 'image' && a.type === 'text') type = 'button';

        // Combine labels
        const labelA = a.label || '';
        const labelB = b.label || '';
        const label = `${labelA} ${labelB}`.trim();

        // Combine bbox (bounding box union)
        const x = Math.min(a.bbox.x, b.bbox.x);
        const y = Math.min(a.bbox.y, b.bbox.y);
        const x2 = Math.max(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w);
        const y2 = Math.max(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h);

        const bbox = {
            x: x,
            y: y,
            w: x2 - x,
            h: y2 - y
        };

        return {
            id: a.id, // Keep ID of first element (or maybe generate composite ID?)
            // Using A's ID means click will go to A's center... NO.
            // ScreenAgent calculates click from bbox center.
            // So if we update bbox, click will go to NEW center.
            // BUT ScreenAgent finds element by ID in the original list? 
            // NO, we are replacing the list sent to LLM.
            // ScreenAgent needs to use THIS optimized list to look up coordinates.
            type: type,
            label: label,
            role: 'MergedNode',
            bbox: bbox,
            originalIds: [a.id, b.id]
        };
    }

    _deduplicate(elements) {
        const seen = new Set();
        return elements.filter(e => {
            const key = `${e.type}|${e.label}|${e.bbox.x.toFixed(3)}|${e.bbox.y.toFixed(3)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

module.exports = new GraphFormalizer();

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * PersistentMemory
 * Manages a persistent knowledge graph of application UIs.
 * Allows 'U' to remember buttons and navigation structures across sessions.
 */
class PersistentMemory {
    constructor() {
        this.baseDir = path.join(app.getPath('userData'), 'persistent_maps');
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
        this.cache = new Map();
    }

    /**
     * Get the file path for an app's persistent map
     */
    _getMapPath(appName) {
        const safeName = (appName || 'unknown').replace(/[^a-z0-9]/gi, '_');
        return path.join(this.baseDir, `${safeName}_map.json`);
    }

    /**
     * Load the map for an app from disk
     */
    load(appName) {
        if (this.cache.has(appName)) return this.cache.get(appName);

        const filePath = this._getMapPath(appName);
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.cache.set(appName, data);
                return data;
            } catch (e) {
                console.error(`⚠️ [PersistentMemory] Failed to load map for ${appName}:`, e.message);
            }
        }

        // Default structure
        const emptyMap = { windows: {}, lastUpdated: null };
        this.cache.set(appName, emptyMap);
        return emptyMap;
    }

    /**
     * Save the map for an app to disk
     */
    save(appName) {
        const data = this.cache.get(appName);
        if (!data) return;

        const filePath = this._getMapPath(appName);
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error(`⚠️ [PersistentMemory] Failed to save map for ${appName}:`, e.message);
        }
    }

    /**
     * Generate a semantic hash key for an element to identify it across sessions
     * Uses: type + label + relative_position_hash
     */
    _generateNodeKey(element) {
        // Round coordinates to avoid jitter (e.g. 0.123 -> 0.1)
        // We use a coarse grid (10x10) for spatial identity
        const gridX = Math.round(element.bbox.x * 10);
        const gridY = Math.round(element.bbox.y * 10);

        // Clean label
        const label = (element.label || '').trim().toLowerCase().slice(0, 50);

        return `${element.type}|${label}|${gridX},${gridY}`;
    }

    /**
     * Merge new elements into the persistent memory
     * @param {string} appName 
     * @param {string} windowName 
     * @param {Array} newElements 
     */
    update(appName, windowName, newElements) {
        const appMap = this.load(appName);

        if (!appMap.windows[windowName]) {
            appMap.windows[windowName] = { nodes: [] };
        }

        const knownNodes = appMap.windows[windowName].nodes;
        const knownKeys = new Set(knownNodes.map(n => n.key));

        // Stats
        let newCount = 0;
        let updatedCount = 0;

        // Process new elements
        for (const el of newElements) {
            const key = this._generateNodeKey(el);

            // Enrich element with memory metadata
            const memoryNode = {
                ...el,
                key,
                lastSeen: new Date().toISOString(),
                occurrences: 1
            };

            if (knownKeys.has(key)) {
                // Update existing node
                const existing = knownNodes.find(n => n.key === key);
                if (existing) {
                    existing.lastSeen = new Date().toISOString();
                    existing.occurrences = (existing.occurrences || 1) + 1;
                    // Update bbox if it shifted slightly (averaged?) - for now just overwrite recent
                    existing.bbox = el.bbox;
                    existing.id = el.id; // Update current session ID
                    updatedCount++;
                }
            } else {
                // Add new node
                knownNodes.push(memoryNode);
                knownKeys.add(key);
                newCount++;
            }
        }

        appMap.lastUpdated = new Date().toISOString();
        this.save(appName);
        console.log(`🧠 [PersistentMemory] Learned ${newCount} new nodes, updated ${updatedCount} in "${windowName}"`);

        return appMap;
    }

    /**
     * Retrieve all known nodes for a window, including those NOT currently visible
     * @returns {Array} List of nodes with 'status' ('visible' or 'remembered')
     */
    getKnowledge(appName, windowName, currentIds) {
        const appMap = this.load(appName);
        const windowData = appMap.windows[windowName];
        if (!windowData) return [];

        const currentIdSet = new Set(currentIds.map(String));

        return windowData.nodes.map(node => ({
            ...node,
            status: currentIdSet.has(String(node.id)) ? 'visible' : 'remembered'
        }));
    }
}

module.exports = new PersistentMemory();

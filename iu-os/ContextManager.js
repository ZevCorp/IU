/**
 * ContextManager.js
 * Central "Working Memory" (RAM) + Gateway to Long-Term Memory (Disk).
 * 
 * Unifies context from:
 * - Text Chat (OpenAI/Gemini API)
 * - Voice Chat (Playwright/ChatGPT Web)
 * - Implicit Actions (Gaze/Nod)
 * 
 * Persists to:
 * - brain/episodic/YYYY-MM-DD.md (via MemoryFileSystem)
 */

const EventEmitter = require('events');
const memoryFS = require('./MemoryFileSystem');
const vectorIndex = require('./VectorIndex');

class ContextManager extends EventEmitter {
    constructor() {
        super();
        this.history = [];
        this.maxHistory = 50; // Keep last 50 turns in RAM
        this.openai = null;
    }

    /**
     * Initialize with OpenAI instance for embeddings
     */
    init(openaiInstance) {
        this.openai = openaiInstance;
        vectorIndex.init(openaiInstance);

        // Load initial index (async)
        // In prototype, we might want to rebuild index on startup to catch manual edits
        vectorIndex.rebuildIndex().catch(err => console.error('Index rebuild failed:', err));
    }

    /**
     * Add a message to the shared history AND persist to disk
     * @param {string} role - 'user', 'assistant', 'system'
     * @param {string} text - The message content
     * @param {string} source - 'chat_ui', 'voice_transcription', 'action_result', 'implicit'
     */
    addMessage(role, text, source = 'unknown') {
        if (!text || typeof text !== 'string') return;

        const message = {
            role,
            text: text.trim(),
            source,
            timestamp: new Date().toISOString()
        };

        // 1. Update RAM (Working Memory)
        this.history.push(message);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        console.log(`🧠 [Context] Added ${role} message from ${source}: "${text.substring(0, 40)}..."`);
        this.emit('history-updated', this.history);

        // 2. Persist to Disk (Episodic Memory)
        // We only persist meaningful interactions, not system debugs
        if (role === 'user' || role === 'assistant') {
            memoryFS.appendToDailyLog(message).then(success => {
                if (success) {
                    console.log(`💾 [Context] Persisted to daily log`);
                    // TODO: Ideally we'd incrementally update the index here
                    // For now, next startup or search will catch it?
                    // Let's do a lazy index update for this chunk
                    // vectorIndex.addEmbeddingForText... (Future optimization)
                }
            });
        }
    }

    /**
     * Get history formatted for LLM API (OpenAI format)
     * @param {number} limit - Number of recent messages to return
     */
    getHistoryForAPI(limit = 10) {
        const recent = this.history.slice(-limit);

        return recent.map(msg => ({
            role: msg.role === 'action_result' ? 'system' : msg.role,
            content: msg.text
        }));
    }

    /**
     * Get relevant context for a query using Vector Search + Recent History
     */
    async getRelevantContext(query) {
        // 1. Recent History (RAM)
        const recentSummary = this.getRecentContextSummary(3);

        // 2. Long Term Memory (Disk Vector Search)
        let sematicContext = "";
        try {
            const results = await vectorIndex.search(query, 3);
            if (results.length > 0) {
                sematicContext = results.map(r => `- ${r.text} (Source: ${r.source})`).join('\n');
            }
        } catch (e) {
            console.error('Vector search failed:', e);
        }

        return {
            recent: recentSummary,
            longTerm: sematicContext
        };
    }

    /**
     * Get a concise summary of recent context for injection
     */
    getRecentContextSummary(turns = 3) {
        const recent = this.history.slice(-turns);
        if (recent.length === 0) return null;

        return recent.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
    }

    /**
     * Clear RAM history
     */
    clear() {
        this.history = [];
        this.emit('history-updated', this.history);
    }
}

module.exports = new ContextManager();

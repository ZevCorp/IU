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
     * @param {string} role - 'user', 'assistant', 'system', 'tool'
     * @param {string} text - The message content
     * @param {string} source - 'chat_ui', 'voice_transcription', 'action_result', 'implicit'
     * @param {object} metadata - Extra fields like tool_calls, tool_call_id, name
     */
    addMessage(role, text, source = 'unknown', metadata = {}) {
        const message = {
            role,
            text: text !== null && text !== undefined ? String(text).trim() : null, // Allow null for tool calls
            source,
            timestamp: new Date().toISOString(),
            ...metadata // Spread metadata: tool_calls, tool_call_id, name
        };

        // 1. Update RAM (Working Memory)
        this.history.push(message);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        console.log(`🧠 [Context] Added ${role} message from ${source}: "${(message.text || '').substring(0, 40)}..."`);
        this.emit('history-updated', this.history);

        // 2. Persist to Disk (Episodic Memory)
        // We only persist meaningful interactions, not system debugs
        if (role === 'user' || role === 'assistant') {
            memoryFS.appendToDailyLog(message).then(success => {
                if (success) {
                    // console.log(`💾 [Context] Persisted to daily log`); 
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

        return recent.map(msg => {
            const apiMsg = {
                role: msg.role === 'action_result' ? 'system' : msg.role,
                content: msg.text
            };

            // Add tool-specific fields if present
            if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls;
            if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id;
            if (msg.name) apiMsg.name = msg.name; // Function name for tool results

            return apiMsg;
        });
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
    /**
     * Get full conversation history for cross-device context sync
     * Returns simplified format suitable for WebSocket transmission
     */
    getFullHistory() {
        return this.history.map(msg => ({
            role: msg.role,
            text: msg.text,
            source: msg.source,
            timestamp: msg.timestamp
        }));
    }
}

module.exports = new ContextManager();

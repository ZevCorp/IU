/**
 * VectorIndex.js
 * Lightweight embedding index for Brain files.
 * Generates embeddings for file chunks and performs cosine similarity search.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const memoryFS = require('./MemoryFileSystem');
const ModelSwitch = require('./ModelSwitch');
// Removed OpenAI instance dependency for embeddings, now using ModelSwitch.

class VectorIndex {
    constructor() {
        this.openai = null;
        // Store index in userData to avoid cluttering user documents
        this.indexPath = path.join(app.getPath('userData'), 'brain_index.json');
        this.index = []; // Array of { text, embedding, source, timestamp }
        this.isDirty = false;
    }

    init(openaiInstance) {
        this.openai = openaiInstance;
        this.loadIndex();
    }

    loadIndex() {
        if (fs.existsSync(this.indexPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
                this.index = data;
                console.log(`🧠 [VectorIndex] Loaded ${this.index.length} chunks.`);
            } catch (e) {
                console.error('❌ [VectorIndex] Failed to load index:', e);
                this.index = [];
            }
        }
    }

    saveIndex() {
        if (!this.isDirty) return;
        try {
            fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
            this.isDirty = false;
            console.log(`💾 [VectorIndex] Saved index (${this.index.length} chunks).`);
        } catch (e) {
            console.error('❌ [VectorIndex] Failed to save index:', e);
        }
    }

    /**
     * Chunk text into manageable pieces for embedding
     */
    chunkText(text, source) {
        // Simple splitting by double newline (paragraphs) for markdown
        // Could be improved with recursive splitting
        return text.split('\n\n')
            .map(chunk => chunk.trim())
            .filter(chunk => chunk.length > 20); // Filter tiny chunks
    }

    /**
     * Generate embedding for a text string
     */
    async getEmbedding(text) {
        try {
            const embedding = await ModelSwitch.embedding(text);
            return embedding;
        } catch (e) {
            console.error('❌ [VectorIndex] Embedding failed:', e.message);
            return null;
        }
    }

    /**
     * Re-index all memory files. 
     * IMPORTANT: This effectively rebuilds the RAM index from disk files.
     * Optimization: In a real app, we'd check file mtimes to only re-index changed files.
     * For simplicity/prototype: Re-index all (clean slate).
     */
    async rebuildIndex() {
        // if (!this.openai) return; // Removed, now using ModelSwitch

        console.log('🔄 [VectorIndex] Rebuilding index from files...');
        const files = memoryFS.getAllMemoryFiles();
        const newIndex = [];

        for (const file of files) {
            const chunks = this.chunkText(file.content, file.path);

            for (const chunk of chunks) {
                // Check if we already have this exact chunk text in old index to save API calls
                const existing = this.index.find(i => i.text === chunk);

                if (existing) {
                    newIndex.push(existing);
                } else {
                    // Generate new embedding
                    const embedding = await this.getEmbedding(chunk);
                    if (embedding) {
                        newIndex.push({
                            text: chunk,
                            embedding,
                            source: path.basename(file.path),
                            timestamp: new Date().toISOString()
                        });
                        // Rate limit safety
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
            }
        }

        this.index = newIndex;
        this.isDirty = true;
        this.saveIndex();
        console.log(`✅ [VectorIndex] Rebuild complete. Index size: ${this.index.length}`);
    }

    /**
     * Semantic Search
     */
    async search(query, limit = 3) {
        if (this.index.length === 0) return [];

        const queryEmbedding = await this.getEmbedding(query);
        if (!queryEmbedding) return [];

        // Cosine Similarity
        const scored = this.index.map(item => ({
            ...item,
            score: this.cosineSimilarity(queryEmbedding, item.embedding)
        }));

        // Sort and slice
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .filter(item => item.score > 0.4); // Relevance threshold
    }

    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

module.exports = new VectorIndex();

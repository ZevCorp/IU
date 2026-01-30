/**
 * MemoryService.js
 * Handles Long-Term Memory (RAG) using MongoDB Atlas Vector Search.
 */

const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
require('dotenv').config();

class MemoryService {
    constructor() {
        this.client = null;
        this.collection = null;
        this.openai = null;
        this.isInitialized = false;

        this.config = {
            uri: process.env.MONGODB_URI,
            dbName: process.env.MONGODB_DB_NAME || 'ue_face',
            collectionName: process.env.MONGODB_COLLECTION_NAME || 'memory',
            openaiKey: process.env.OPENAI_API_KEY,
            vectorIndex: process.env.VECTOR_INDEX_NAME || 'vector_index'
        };
    }

    async init() {
        if (this.isInitialized) return;

        if (!this.config.uri || !this.config.openaiKey) {
            console.warn('⚠️ MemoryService: MONGODB_URI or OPENAI_API_KEY missing in .env');
            return false;
        }

        try {
            // Init OpenAI
            this.openai = new OpenAI({ apiKey: this.config.openaiKey });

            // Init MongoDB
            this.client = new MongoClient(this.config.uri);
            await this.client.connect();

            const db = this.client.db(this.config.dbName);
            this.collection = db.collection(this.config.collectionName);

            console.log('🧠 MemoryService: Connected to MongoDB Atlas');
            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('❌ MemoryService Init Failed:', error);
            return false;
        }
    }

    /**
     * Generate embedding for text
     */
    async getEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: "text-embeddings-3-small",
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('❌ Embedding generation failed:', error);
            return null;
        }
    }

    /**
     * Store a new memory
     */
    async saveMemory(text, metadata = {}) {
        if (!this.isInitialized) await this.init();
        if (!this.isInitialized) return null;

        try {
            const embedding = await this.getEmbedding(text);
            if (!embedding) return null;

            const doc = {
                text,
                embedding,
                metadata,
                timestamp: new Date()
            };

            const result = await this.collection.insertOne(doc);
            console.log(`💾 Memory Saved: "${text.substring(0, 30)}..."`);
            return result.insertedId;
        } catch (error) {
            console.error('❌ Save Memory Failed:', error);
            return null;
        }
    }

    /**
     * Search memory for relevant context
     */
    async searchMemory(query, limit = 3) {
        if (!this.isInitialized) await this.init();
        if (!this.isInitialized) return [];

        try {
            const queryEmbedding = await this.getEmbedding(query);
            if (!queryEmbedding) return [];

            // Atlas Vector Search Pipeline
            const pipeline = [
                {
                    "$vectorSearch": {
                        "index": this.config.vectorIndex,
                        "path": "embedding",
                        "queryVector": queryEmbedding,
                        "numCandidates": 100,
                        "limit": limit
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "text": 1,
                        "score": { "$meta": "vectorSearchScore" },
                        "metadata": 1
                    }
                }
            ];

            const results = await this.collection.aggregate(pipeline).toArray();
            return results;
        } catch (error) {
            console.error('❌ Search Memory Failed:', error);
            return [];
        }
    }
}

module.exports = new MemoryService();

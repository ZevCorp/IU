/**
 * Consolidator.js
 * The "Sleep" Process.
 * Turns short-term daily logs (episodic) into long-term Core Memory (semantic).
 */

const fs = require('fs');
const path = require('path');
const memoryFS = require('./MemoryFileSystem');
const ModelSwitch = require('./ModelSwitch');
const vectorIndex = require('./VectorIndex');

class Consolidator {
    constructor() {
        this.isConsolidating = false;
    }

    /**
     * Run the consolidation process on a specific log file (usually yesterday's or today's on demand)
     * @param {string} dateStr - 'YYYY-MM-DD'
     */
    async consolidateDailyLog(dateStr) {
        if (this.isConsolidating) {
            console.log('💤 [Consolidator] Already running...');
            return;
        }

        const logPath = path.join(memoryFS.episodicDir, `${dateStr}.md`);
        if (!fs.existsSync(logPath)) {
            console.log(`💤 [Consolidator] No log found for ${dateStr}`);
            return;
        }

        this.isConsolidating = true;
        console.log(`💤 [Consolidator] Processing log: ${dateStr}...`);

        try {
            const logContent = fs.readFileSync(logPath, 'utf-8');
            if (logContent.length < 50) {
                console.log('💤 [Consolidator] Log too short, skipping.');
                this.isConsolidating = false;
                return;
            }

            // 1. Ask LLM to extract facts
            const facts = await this.extractFacts(logContent);

            if (facts && facts.length > 0) {
                // 2. Append to Core Memory
                const coreEntry = `\n## Aprendizaje del ${dateStr}\n${facts}\n`;
                const corePath = path.join(memoryFS.brainDir, 'MEMORY.md');
                fs.appendFileSync(corePath, coreEntry);
                console.log('💤 [Consolidator] Wrote facts to MEMORY.md');

                // 3. Mark log as processed (rename or header)
                // For now, let's just leave it. Maybe move to 'archive' later.
                // Or rename to .processed.md? No, we might want to read it again.

                // 4. Rebuild Index to include new facts
                console.log('💤 [Consolidator] Rebuilding Vector Index...');
                await vectorIndex.rebuildIndex();
                console.log('💤 [Consolidator] Done.');
            } else {
                console.log('💤 [Consolidator] No new facts found.');
            }

        } catch (e) {
            console.error('❌ [Consolidator] Failed:', e);
        } finally {
            this.isConsolidating = false;
        }
    }

    async extractFacts(logContent) {
        try {
            console.log('💤 [Consolidator] Asking LLM to extract facts...');
            const response = await ModelSwitch.chatCompletion({
                messages: [
                    {
                        role: "system",
                        content: `Eres el proceso de consolidación de memoria de una IA.
Analiza el siguiente registro de chat diario.
Extrae ÚNICAMENTE hechos nuevos, permanentes o importantes sobre el usuario (preferencias, nombres, tareas pendientes a largo plazo, proyectos).
Ignora saludos, charlas triviales o comandos de sistema transitorios.
Formato de salida: Lista con guiones markdown (- Hecho 1).
Si no hay nada relevante, responde "NADA".`
                    },
                    {
                        role: "user",
                        content: logContent
                    }
                ],
                max_tokens: 1000
            });

            const content = response.choices[0].message.content.trim();
            if (content === 'NADA' || content.includes('no hay nada relevante')) return null;
            return content;
        } catch (e) {
            console.error('❌ [Consolidator] Extract error:', e);
            return null;
        }
    }
}

module.exports = new Consolidator();

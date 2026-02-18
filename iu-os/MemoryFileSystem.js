/**
 * MemoryFileSystem.js
 * Handles file I/O for the OpenClaw-style Brain.
 * Manages:
 * - Episodic Memory (Daily Logs): brain/episodic/YYYY-MM-DD.md
 * - Semantic Memory (Core): brain/MEMORY.md
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class MemoryFileSystem {
    constructor() {
        // Production storage: ~/Library/Application Support/iu-os/brain
        const userData = app.getPath('userData');
        this.brainDir = path.join(userData, 'brain');
        this.episodicDir = path.join(this.brainDir, 'episodic');

        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.brainDir)) {
            fs.mkdirSync(this.brainDir, { recursive: true });
        }
        if (!fs.existsSync(this.episodicDir)) {
            fs.mkdirSync(this.episodicDir, { recursive: true });
        }

        // Ensure MEMORY.md exists
        const coreMemoryPath = path.join(this.brainDir, 'MEMORY.md');
        if (!fs.existsSync(coreMemoryPath)) {
            fs.writeFileSync(coreMemoryPath, '# Core Memory\n\n- User is the owner of this system.\n- System is "U", a digital assistant.\n');
        }
    }

    /**
     * Append an interaction to today's daily log
     */
    async appendToDailyLog(interaction) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const logPath = path.join(this.episodicDir, `${today}.md`);

        const timestamp = new Date().toLocaleTimeString();
        const entry = `\n## [${timestamp}] ${interaction.source}\n**${interaction.role.toUpperCase()}**: ${interaction.text}\n`;

        try {
            fs.appendFileSync(logPath, entry);
            return true;
        } catch (e) {
            console.error('❌ [MemoryFS] Failed to write daily log:', e);
            return false;
        }
    }

    /**
     * Read Core Memory (MEMORY.md)
     */
    getCoreMemory() {
        const corePath = path.join(this.brainDir, 'MEMORY.md');
        try {
            if (fs.existsSync(corePath)) {
                return fs.readFileSync(corePath, 'utf-8');
            }
        } catch (e) {
            console.error('❌ [MemoryFS] Failed to read core memory:', e);
        }
        return '';
    }

    /**
     * Get all memory files for indexing (Core + Recent Episodic)
     * Limit episodic to last 7 days to keep index manageable for now.
     */
    getAllMemoryFiles() {
        const files = [];

        // 1. Core Memory
        const corePath = path.join(this.brainDir, 'MEMORY.md');
        if (fs.existsSync(corePath)) {
            files.push({
                path: corePath,
                type: 'core',
                content: fs.readFileSync(corePath, 'utf-8')
            });
        }

        // 2. Episodic Memory (Last 7 days)
        try {
            const logs = fs.readdirSync(this.episodicDir)
                .filter(f => f.endsWith('.md'))
                .sort()
                .reverse() // Newest first
                .slice(0, 7); // Keep last 7

            logs.forEach(log => {
                const logPath = path.join(this.episodicDir, log);
                files.push({
                    path: logPath,
                    type: 'episodic',
                    content: fs.readFileSync(logPath, 'utf-8')
                });
            });
        } catch (e) {
            console.error('❌ [MemoryFS] Failed to read episodic logs:', e);
        }

        return files;
    }
}

module.exports = new MemoryFileSystem();

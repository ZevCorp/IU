/**
 * IÜ OS - Reminders Manager
 * Simple priority-based reminder system
 */

class RemindersManager {
    constructor() {
        this.reminders = [];
        this.storageKey = 'iu-os-reminders';
        this.load();
    }

    /**
     * Add a new reminder
     */
    add(title, options = {}) {
        const reminder = {
            id: this.generateId(),
            title,
            description: options.description || '',
            priority: options.priority || 50, // 0-100
            dueDate: options.dueDate || null,
            tags: options.tags || [],
            completed: false,
            createdAt: Date.now(),
            adjustmentHistory: []
        };

        this.reminders.push(reminder);
        this.save();

        console.log(`📝 Reminder added: "${title}" (priority: ${reminder.priority})`);
        return reminder;
    }

    /**
     * Get top reminders sorted by priority
     */
    getTop(count = 5) {
        return this.reminders
            .filter(r => !r.completed)
            .sort((a, b) => b.priority - a.priority)
            .slice(0, count);
    }

    /**
     * Adjust priority based on conversation mention
     */
    mentionedInConversation(reminderId, reason = 'Mentioned in conversation') {
        const reminder = this.reminders.find(r => r.id === reminderId);
        if (!reminder) return;

        const oldPriority = reminder.priority;
        const boost = 10;
        reminder.priority = Math.min(100, reminder.priority + boost);

        reminder.adjustmentHistory.push({
            timestamp: Date.now(),
            oldPriority,
            newPriority: reminder.priority,
            reason
        });

        this.save();
        console.log(`📈 Priority adjusted: "${reminder.title}" ${oldPriority} → ${reminder.priority}`);
    }

    /**
     * Search reminders by keyword
     */
    search(keyword) {
        const lower = keyword.toLowerCase();
        return this.reminders.filter(r =>
            r.title.toLowerCase().includes(lower) ||
            r.description.toLowerCase().includes(lower) ||
            r.tags.some(t => t.toLowerCase().includes(lower))
        );
    }

    /**
     * Mark complete
     */
    complete(reminderId) {
        const reminder = this.reminders.find(r => r.id === reminderId);
        if (reminder) {
            reminder.completed = true;
            reminder.completedAt = Date.now();
            this.save();
            console.log(`✅ Reminder completed: "${reminder.title}"`);
        }
    }

    /**
     * Delete reminder
     */
    delete(reminderId) {
        this.reminders = this.reminders.filter(r => r.id !== reminderId);
        this.save();
    }

    /**
     * Update priority manually
     */
    setPriority(reminderId, newPriority) {
        const reminder = this.reminders.find(r => r.id === reminderId);
        if (reminder) {
            const oldPriority = reminder.priority;
            reminder.priority = Math.max(0, Math.min(100, newPriority));
            reminder.adjustmentHistory.push({
                timestamp: Date.now(),
                oldPriority,
                newPriority: reminder.priority,
                reason: 'Manual adjustment'
            });
            this.save();
        }
    }

    /**
     * Decay priorities over time (call daily)
     */
    applyTimeDecay(decayRate = 0.95) {
        this.reminders.forEach(r => {
            if (!r.completed) {
                const oldPriority = r.priority;
                r.priority = Math.round(r.priority * decayRate);
                if (oldPriority !== r.priority) {
                    r.adjustmentHistory.push({
                        timestamp: Date.now(),
                        oldPriority,
                        newPriority: r.priority,
                        reason: 'Time decay'
                    });
                }
            }
        });
        this.save();
    }

    // Storage
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.reminders));
        } catch (e) {
            console.error('Failed to save reminders:', e);
        }
    }

    load() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                this.reminders = JSON.parse(data);
                console.log(`📋 Loaded ${this.reminders.length} reminders`);
            }
        } catch (e) {
            console.error('Failed to load reminders:', e);
            this.reminders = [];
        }
    }

    // Utils
    generateId() {
        return `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get priority class for UI styling
     */
    getPriorityClass(priority) {
        if (priority >= 70) return 'priority-high';
        if (priority >= 40) return 'priority-medium';
        return 'priority-low';
    }
}

export default RemindersManager;

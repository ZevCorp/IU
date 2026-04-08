/**
 * Brain.js
 * Central Intelligence Unit for U.
 * Manages autonomous behavior, context awareness, and task scheduling.
 */

const { screen } = require('electron');
const MemoryService = require('./MemoryService');
const SecurityFilter = require('./SecurityFilter');
const ActionPlanner = require('./ActionPlanner');
const NativeGlassController = require('./NativeGlassController'); // Use existing controller

class Brain {
    constructor(mainWindow, actionPlanner, screenAgent) {
        this.mainWindow = mainWindow;
        this.planner = actionPlanner;
        this.screenAgent = screenAgent;
        this.executionDispatcher = null;
        this.executionBusyChecker = null;
        this.status = 'connected'; // 'connected', 'disconnected'
        this.disconnectEndTime = null;
        this.taskQueue = [];
        this.scheduledTasks = []; // { id, label, time, executed: false }
        this.monitoringInterval = null;

        // "Digital Life" routine tasks
        this.routineTasks = [
            { type: 'check_messages', label: 'Revisar mensajes importantes', priority: 1, interval: 15 * 60 * 1000 },
            { type: 'check_calendar', label: 'Revisar agenda próxima', priority: 2, interval: 30 * 60 * 1000 }
        ];

        // Start the heartbeat immediately
        this._startHeartbeat();
    }

    setExecutionDispatcher(dispatcher) {
        this.executionDispatcher = typeof dispatcher === 'function' ? dispatcher : null;
    }

    setExecutionBusyChecker(checker) {
        this.executionBusyChecker = typeof checker === 'function' ? checker : null;
    }

    _startHeartbeat() {
        if (this.monitoringInterval) clearInterval(this.monitoringInterval);
        this.monitoringInterval = setInterval(() => this._heartbeat(), 30 * 1000); // Check every 30s
    }

    /**
     * Start Disconnection Mode
     */
    startDisconnectionMode(durationMinutes) {
        console.log(`🧠 [Brain] Starting Disconnection Mode for ${durationMinutes} minutes`);
        this.status = 'disconnected';
        this.disconnectEndTime = Date.now() + (durationMinutes * 60 * 1000);

        if (this.mainWindow) {
            this.mainWindow.minimize();
        }
    }

    /**
     * Stop Disconnection Mode
     */
    stopDisconnectionMode() {
        if (this.status !== 'disconnected') return;

        console.log('🧠 [Brain] Stopping Disconnection Mode');
        this.status = 'connected';
        this.disconnectEndTime = null;

        if (this.mainWindow) {
            this.mainWindow.restore();
            this.mainWindow.focus();
        }
    }

    /**
     * Main Heartbeat (Runs always)
     */
    async _heartbeat() {
        const now = Date.now();

        // 1. Check Scheduled Tasks (Reminders) - ALWAYS ACTIVE
        this.scheduledTasks.forEach(task => {
            if (!task.executed && now >= task.time) {
                console.log(`⏰ [Brain] Triggering scheduled reminder: ${task.label}`);
                task.executed = true;
                this.triggerWakeUp(task);
            }
        });

        // 2. Disconnection Mode Logic
        if (this.status === 'disconnected') {
            if (now > this.disconnectEndTime) {
                console.log('🧠 [Brain] Disconnection time over. Returning control.');
                this.stopDisconnectionMode();
                return;
            }

            // Check Routines
            for (const task of this.routineTasks) {
                if (!task.lastRun || (now - task.lastRun) > task.interval) {
                    console.log(`🧠 [Brain] Triggering routine task: ${task.label}`);
                    // Add to queue if not already there
                    const exists = this.taskQueue.some(t => t.type === task.type);
                    if (!exists) {
                        this.addTask({ ...task, source: 'routine' });
                    }
                    task.lastRun = now;
                    break;
                }
            }

            // Process Queue
            if (this.taskQueue.length > 0) {
                // Check if agent is busy
                if ((this.executionBusyChecker && this.executionBusyChecker()) || (this.screenAgent && this.screenAgent.isRunning)) return;
                const currentTask = this.taskQueue.shift();
                await this._executeTask(currentTask);
            }
        }
    }

    /**
     * Trigger "Wake Up" Sequence for a Reminder
     */
    triggerWakeUp(task) {
        console.log('🔔 [Brain] Waking up for task:', task.label);

        // 1. Wake up UI (Restore window, play sound)
        if (this.mainWindow) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.show();
            this.mainWindow.focus();

            // Notify Renderer to play sound and prepare face
            this.mainWindow.webContents.send('brain-wake-up', {
                task: task.label,
                taskId: task.id
            });
        }
    }

    /**
     * Schedule a new task (Natural Language Processing would happen before this)
     */
    scheduleTask(label, dateObj) {
        const task = {
            id: Date.now().toString(),
            label,
            time: dateObj.getTime(),
            executed: false
        };
        this.scheduledTasks.push(task);
        console.log(`📅 [Brain] Scheduled: "${label}" for ${dateObj.toLocaleString()}`);
        return task;
    }

    /**
     * Execute a single task autonomously
     */
    async _executeTask(task) {
        console.log(`🧠 [Brain] Executing task: ${task.label}`);

        // 1. Retrieve Context (Memory + Preferences)
        const preferences = await MemoryService.getPreferences();

        // 2. Security Check (Skip for user-confirmed reminders)
        if (task.source !== 'user_confirmed') {
            const validation = await SecurityFilter.validateAction(
                task.label,
                "Modo Desconexión Activo. Tarea rutinaria o agendada.",
                preferences
            );

            if (!validation.safe) {
                console.warn(`🛑 [Brain] Task BLOCKED by Security Filter: ${task.label} - Reason: ${validation.reason}`);
                return;
            }
        }

        // 3. Execution via Planner
        if (this.planner) {
            console.log(`🧠 [Brain] Planning action for: "${task.label}"`);
            const plan = await this.planner.planAutonomousAction(task.label, preferences);

            if (plan && (this.executionDispatcher || this.screenAgent)) {
                console.log(`🧠 [Brain] EXECUTING PLAN: ${plan.app} -> ${plan.stepsHint}`);
                try {
                    let result;
                    if (this.executionDispatcher) {
                        result = await this.executionDispatcher(plan.goal, plan.app, plan.stepsHint, plan.executor || 'iu_desktop', {
                            source: 'brain_autonomous'
                        });
                    } else {
                        result = await this.screenAgent.executeAction(plan.goal, plan.app, plan.stepsHint);
                    }
                    console.log(`🧠 [Brain] Execution Result: success=${result?.success}`);
                } catch (e) {
                    console.error(`❌ [Brain] Execution failed: ${e.message}`);
                }
            } else {
                console.warn('⚠️ [Brain] Failed to plan action or no executor available.');
            }
        }
    }

    /**
     * Execute a task that was explicitly confirmed by the user (Nod/Voice)
     */
    async executeApprovedTask(taskId) {
        console.log(`✅ [Brain] executing APPROVED task ${taskId}`);

        let task = this.scheduledTasks.find(t => t.id === taskId);

        // If not a scheduled task, maybe it's a dynamic one passed by ID? 
        // For now, let's assume we find it or reconstruct a simple one.
        if (!task) {
            console.warn(`⚠️ [Brain] Task ${taskId} not found in schedule.`);
            return;
        }

        // Execute immediately with 'user_confirmed' source to bypass some checks if needed
        await this._executeTask({ ...task, source: 'user_confirmed' });
    }

    /**
     * Add a task to the queue externally (e.g. from Scheduler or IPC)
     */
    addTask(task) {
        this.taskQueue.push(task);
        console.log(`🧠 [Brain] Task added: ${task.label}`);
    }
}

module.exports = Brain;

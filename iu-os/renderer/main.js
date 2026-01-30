/**
 * IÜ OS - Renderer Main Entry Point
 * Orchestrates all subsystems with full integration
 */

import EyeTracker from './eye-tracker.js';
import NeuralGraph from './neural-graph.js';
import UFace from './face/index.js';
import RemindersManager from './reminders/manager.js';

// ============================================
// State Management
// ============================================

const state = {
    isActive: false,
    currentMode: 'idle', // idle | active | tracking
    eyeTrackingEnabled: false,
    metrics: {
        activationTime: 0,
        accuracy: 0,
        hrmLatency: 0
    }
};

// ============================================
// DOM Elements
// ============================================

const elements = {
    idleScreen: document.getElementById('idle-screen'),
    activeInterface: document.getElementById('active-interface'),
    zones: Array.from(document.querySelectorAll('.activation-zone')),
    activationPoint: document.getElementById('activation-point'),
    faceContainer: document.getElementById('face-container'),
    neuralCanvas: document.getElementById('neural-graph'),
    remindersList: document.getElementById('reminders-list'),
    metricActivation: document.getElementById('metric-activation'),
    metricAccuracy: document.getElementById('metric-accuracy'),
    metricHRM: document.getElementById('metric-hrm')
};

// ============================================
// Subsystems
// ============================================

let eyeTracker = null;
let neuralGraph = null;
let face = null;
let reminders = null;

// ============================================
// Initialization
// ============================================

async function init() {
    console.log('🚀 IÜ OS initializing...');

    // Set canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Get screen info
    const screenSize = await window.iuOS.getScreenSize();
    console.log('📺 Screen size:', screenSize);

    // Initialize Ü Face
    face = new UFace(elements.faceContainer);
    console.log('😊 Face initialized');

    // Initialize Neural Graph
    neuralGraph = new NeuralGraph(elements.neuralCanvas);
    createDemoGraph();
    neuralGraph.start();
    console.log('🧠 Neural graph initialized');

    // Initialize Reminders
    reminders = new RemindersManager();
    setupDemoReminders();
    renderReminders();
    console.log('📝 Reminders initialized');

    // Initialize Eye Tracking (optional - needs camera permission)
    try {
        eyeTracker = new EyeTracker({ activationTime: 500 });
        const eyeTrackingReady = await eyeTracker.init();
        if (eyeTrackingReady) {
            setupEyeTracking();
            state.eyeTrackingEnabled = true;
            console.log('👁️ Eye tracking initialized');
        }
    } catch (e) {
        console.log('👁️ Eye tracking not available:', e.message);
    }

    // Start in idle mode
    transitionToIdle();

    // Show activation prompt after delay
    setTimeout(() => {
        if (state.currentMode === 'idle') {
            showActivationPoint();
        }
    }, 2000);

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    console.log('✅ IÜ OS ready');
}

// ============================================
// Canvas Management
// ============================================

function resizeCanvas() {
    elements.neuralCanvas.width = window.innerWidth;
    elements.neuralCanvas.height = window.innerHeight;
}

// ============================================
// Eye Tracking Setup
// ============================================

function setupEyeTracking() {
    // Register activation zones
    elements.zones.forEach((zone, index) => {
        const rect = zone.getBoundingClientRect();
        eyeTracker.registerZone(`zone-${index + 1}`, {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        });
    });

    // Handle gaze updates
    eyeTracker.onGazeUpdate = (gaze) => {
        // Make face look at where user is looking
        const normX = gaze.x / window.innerWidth;
        const normY = gaze.y / window.innerHeight;
        face.lookAt(normX, normY);
    };

    // Handle zone looking
    eyeTracker.onLookingAtZone = (zoneId, duration) => {
        elements.zones.forEach((zone, index) => {
            const isLooking = zoneId === `zone-${index + 1}`;
            zone.classList.toggle('looking', isLooking);

            // Show progress indicator
            if (isLooking) {
                const progress = Math.min(duration / 500, 1);
                zone.style.setProperty('--progress', progress);
            }
        });
    };

    // Handle zone activation
    eyeTracker.onZoneActivated = (zoneId, activationTime, accuracy) => {
        console.log(`🎯 ${zoneId} activated!`);

        // Visual feedback
        const zoneIndex = parseInt(zoneId.split('-')[1]) - 1;
        elements.zones[zoneIndex].classList.add('active');
        setTimeout(() => {
            elements.zones[zoneIndex].classList.remove('active');
        }, 500);

        // Update metrics
        state.metrics.activationTime = activationTime;
        state.metrics.accuracy = accuracy;
        updateMetrics();

        // Activate interface
        if (state.currentMode === 'idle') {
            transitionToActive();
        }

        // Fire corresponding neuron
        const nodeIds = Array.from(neuralGraph.nodes.keys());
        if (nodeIds[zoneIndex]) {
            neuralGraph.fireNeuron(nodeIds[zoneIndex]);
        }
    };

    eyeTracker.start();
}

// ============================================
// State Transitions
// ============================================

function transitionToIdle() {
    state.currentMode = 'idle';
    state.isActive = false;

    elements.idleScreen.classList.remove('hidden');
    elements.activeInterface.classList.add('hidden');

    face?.setExpression('idle');

    // Enable click-through
    window.iuOS.setClickThrough(true);

    console.log('💤 Entered idle mode');
}

function transitionToActive() {
    state.currentMode = 'active';
    state.isActive = true;

    elements.idleScreen.classList.add('hidden');
    elements.activeInterface.classList.remove('hidden');
    elements.activationPoint.classList.remove('visible');

    face?.setExpression('attention');
    setTimeout(() => face?.setExpression('happy'), 500);

    // Disable click-through
    window.iuOS.setClickThrough(false);

    console.log('⚡ Entered active mode');

    // Demo: animate a path through the graph
    setTimeout(() => {
        const path = ['node-1', 'node-2', 'node-4'];
        neuralGraph.animatePath(path, 300);
        face?.setExpression('thinking');

        setTimeout(() => {
            state.metrics.hrmLatency = Math.round(50 + Math.random() * 30);
            updateMetrics();
            face?.setExpression('happy');
        }, path.length * 300 + 200);
    }, 1000);

    // Auto-return to idle after 30 seconds
    setTimeout(() => {
        if (state.isActive && state.currentMode === 'active') {
            transitionToIdle();
        }
    }, 30000);
}

// ============================================
// Activation Point
// ============================================

function showActivationPoint() {
    elements.activationPoint.classList.add('visible');

    // Click activation (fallback for no eye tracking)
    elements.activationPoint.addEventListener('click', handleActivation, { once: true });
}

function hideActivationPoint() {
    elements.activationPoint.classList.remove('visible');
}

function handleActivation() {
    const startTime = performance.now();
    state.metrics.activationTime = Math.round(performance.now() - startTime);
    state.metrics.accuracy = 100;
    updateMetrics();

    hideActivationPoint();
    transitionToActive();
}

// ============================================
// Metrics
// ============================================

function updateMetrics() {
    elements.metricActivation.textContent = `${state.metrics.activationTime}ms`;
    elements.metricAccuracy.textContent = `${state.metrics.accuracy}%`;
    elements.metricHRM.textContent = `${state.metrics.hrmLatency}ms`;
}

// ============================================
// Demo Data
// ============================================

function createDemoGraph() {
    // Create a sample neural network visualization
    const centerX = elements.neuralCanvas.width / 2;
    const centerY = elements.neuralCanvas.height / 2;

    // Input layer
    neuralGraph.addNode('node-1', 'Input', { x: centerX - 80, y: centerY - 60 });
    neuralGraph.addNode('node-2', 'Process', { x: centerX - 80, y: centerY + 60 });

    // Hidden layer
    neuralGraph.addNode('node-3', 'Hidden 1', { x: centerX, y: centerY - 40 });
    neuralGraph.addNode('node-4', 'Hidden 2', { x: centerX, y: centerY + 40 });

    // Output layer
    neuralGraph.addNode('node-5', 'Action', { x: centerX + 80, y: centerY });

    // Connections
    neuralGraph.addEdge('node-1', 'node-3');
    neuralGraph.addEdge('node-1', 'node-4');
    neuralGraph.addEdge('node-2', 'node-3');
    neuralGraph.addEdge('node-2', 'node-4');
    neuralGraph.addEdge('node-3', 'node-5');
    neuralGraph.addEdge('node-4', 'node-5');
}

function setupDemoReminders() {
    if (reminders.reminders.length === 0) {
        reminders.add('Review HRM architecture', { priority: 85, tags: ['dev'] });
        reminders.add('Eye tracking calibration', { priority: 72, tags: ['feature'] });
        reminders.add('Update documentation', { priority: 45, tags: ['docs'] });
    }
}

function renderReminders() {
    const topReminders = reminders.getTop(3);

    elements.remindersList.innerHTML = topReminders.map(r => `
    <div class="reminder-item ${reminders.getPriorityClass(r.priority)}" data-id="${r.id}">
      <div class="reminder-title">${r.title}</div>
      <div class="reminder-meta">Priority: ${r.priority}</div>
    </div>
  `).join('');

    // Add click handlers
    elements.remindersList.querySelectorAll('.reminder-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            reminders.complete(id);
            renderReminders();
        });
    });
}

// ============================================
// Keyboard Shortcuts
// ============================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape - return to idle
        if (e.key === 'Escape') {
            transitionToIdle();
        }

        // Space - toggle active
        if (e.key === ' ') {
            if (state.currentMode === 'idle') {
                transitionToActive();
            } else {
                transitionToIdle();
            }
        }

        // 1, 2, 3 - fire neurons manually
        if (['1', '2', '3'].includes(e.key)) {
            const nodeId = `node-${e.key}`;
            neuralGraph.fireNeuron(nodeId);
            face?.setExpression('thinking');
            setTimeout(() => face?.setExpression('happy'), 300);
        }
    });
}

// ============================================
// Performance Monitoring
// ============================================

setInterval(() => {
    const perf = window.iuOS.getPerformanceMetrics();
    const memoryMB = (perf.memory.heapUsed / 1024 / 1024).toFixed(1);
    console.log(`📊 Memory: ${memoryMB}MB | Uptime: ${Math.round(perf.uptime)}s`);
}, 30000);

// ============================================
// Start App
// ============================================

init();

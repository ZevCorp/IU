/**
 * main.ts
 * 
 * Application entry point for Drifting Sagan - Living Face UI
 * Initializes the face and sets up demo controls
 */

import { initializeFace, getFace } from './face/Face';
import { faceEventBus } from './events/FaceEventBus';
import { initDeviceSync, getDeviceSync } from './sync/DeviceSync';
import { getQRConnect } from './sync/QRConnect';
import { getFaceTransfer } from './sync/FaceTransfer';
import './styles/main.css';

// =====================================================
// Initialization
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🌟 Drifting Sagan - Living Face UI');
    console.log('Initializing face system...');

    try {
        // Initialize the face
        const face = initializeFace();

        // Start animation systems
        face.start();

        // Set up demo controls
        setupStateButtons(face);
        setupThemeButtons();
        setupMicroToggle(face);

        // Initialize device sync and QR connect
        setupDeviceSync(face);
        setupQRButton();
        setupFaceTransfer(face);

        // Log available presets
        console.log('Available presets:', face.getPresets());

        // Listen for events (for debugging)
        setupEventLogging();

        // Check for connection params (from QR scan)
        checkConnectionParams();

        console.log('✅ Face initialized successfully!');
        console.log('The face is now alive with micro-expressions.');
        console.log('📱 Click "Scan QR" to connect your phone!');

    } catch (error) {
        console.error('❌ Failed to initialize face:', error);
    }
});

// =====================================================
// Demo Controls Setup
// =====================================================

function setupStateButtons(face: ReturnType<typeof initializeFace>): void {
    const buttons = {
        'btn-neutral': 'neutral',
        'btn-smile': 'smile',
        'btn-attention': 'attention',
        'btn-thinking': 'thinking',
        'btn-wink': 'wink'
    };

    Object.entries(buttons).forEach(([btnId, presetName]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        btn.addEventListener('click', () => {
            // Update active button
            document.querySelectorAll('.state-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Transition to preset
            face.transitionTo(presetName, 0.5);

            // Show thinking label for thinking state
            const thinkingLabel = document.getElementById('thinking-label');
            if (thinkingLabel) {
                if (presetName === 'thinking') {
                    thinkingLabel.classList.remove('hidden');
                } else {
                    thinkingLabel.classList.add('hidden');
                }
            }

            console.log(`Transitioning to: ${presetName}`);
        });
    });
}

function setupThemeButtons(): void {
    const darkBtn = document.getElementById('btn-dark');
    const lightBtn = document.getElementById('btn-light');

    if (darkBtn && lightBtn) {
        darkBtn.addEventListener('click', () => {
            document.documentElement.removeAttribute('data-theme');
            darkBtn.classList.add('active');
            lightBtn.classList.remove('active');
        });

        lightBtn.addEventListener('click', () => {
            document.documentElement.setAttribute('data-theme', 'light');
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
        });
    }
}

function setupMicroToggle(face: ReturnType<typeof initializeFace>): void {
    const toggle = document.getElementById('toggle-micro') as HTMLInputElement;

    if (toggle) {
        toggle.addEventListener('change', () => {
            face.setMicroExpressionsEnabled(toggle.checked);
            console.log(`Micro-expressions: ${toggle.checked ? 'enabled' : 'disabled'}`);
        });
    }
}

// =====================================================
// Device Sync & QR Connect
// =====================================================

function setupDeviceSync(_face: ReturnType<typeof initializeFace>): void {
    const deviceSync = initDeviceSync();

    // Set the public URL for QR codes (from our tunnel)
    // In a real app, this would be an env var or config
    // Note: modifying protocol to wss for secure websocket
    deviceSync.setPublicServerUrl('wss://ds-sock-v6.loca.lt');
    deviceSync.setPublicAppUrl('https://ds-app-v6.loca.lt');

    // Update connection status UI
    deviceSync.setOnConnectionChange((connected, devices) => {
        updateConnectionStatus(connected, devices.length);

        // Show swipe hint when connected
        const swipeHint = document.getElementById('swipe-hint');
        if (swipeHint) {
            if (connected && devices.length > 0) {
                swipeHint.classList.remove('hidden');
                swipeHint.classList.add('visible');

                // Hide hint after 3 seconds
                setTimeout(() => {
                    swipeHint.classList.remove('visible');
                }, 3000);
            }
        }
    });

    console.log(`[DeviceSync] Device ID: ${deviceSync.getDeviceId()}`);
    console.log(`[DeviceSync] Device Type: ${deviceSync.getDeviceType()}`);
}

function setupQRButton(): void {
    const qrBtn = document.getElementById('btn-qr');
    const qrConnect = getQRConnect();

    if (qrBtn) {
        qrBtn.addEventListener('click', () => {
            qrConnect.toggle();
        });
    }
}

function setupFaceTransfer(face: ReturnType<typeof initializeFace>): void {
    const faceTransfer = getFaceTransfer();
    const faceContainer = document.getElementById('face-container');
    const faceGroup = document.querySelector('#face-group') as unknown as SVGGElement;

    if (faceContainer && faceGroup) {
        faceTransfer.init(
            faceContainer,
            faceGroup,
            () => face.getState()
        );

        // Check if we are joining via QR code (should hide face initially)
        const params = new URLSearchParams(window.location.search);
        // If we have 'connect' or 'room' in URL, assume we are the secondary device
        if (params.has('connect') || params.has('room')) {
            console.log('[FaceTransfer] Joined via QR code. Hiding face initially.');
            faceTransfer.hideImmediate();
        }

        // When face is hidden (transferred out)
        faceTransfer.setOnFaceHidden(() => {
            console.log('👋 Face transferred to another device');
        });

        // When face is received
        faceTransfer.setOnFaceShown((state) => {
            console.log('🎉 Face received from another device');
            face.setState(state);
        });
    }
}

function updateConnectionStatus(connected: boolean, deviceCount: number): void {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;

    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('.status-text');

    if (connected && deviceCount > 0) {
        indicator?.classList.add('connected');
        if (text) text.textContent = `Connected (${deviceCount} device${deviceCount > 1 ? 's' : ''})`;
    } else {
        indicator?.classList.remove('connected');
        if (text) text.textContent = 'Not connected';
    }
}

function checkConnectionParams(): void {
    const params = new URLSearchParams(window.location.search);
    const connectTo = params.get('connect');

    if (connectTo) {
        console.log(`[DeviceSync] Connecting to device: ${connectTo}`);
        // The device sync will automatically connect when initialized

        // Clean up URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

        // Show connected notification
        setTimeout(() => {
            updateConnectionStatus(true, 1);
        }, 500);
    }
}

// =====================================================
// Event Logging (for development)
// =====================================================

function setupEventLogging(): void {
    // Log state transitions
    faceEventBus.on('state:transition:start', (data) => {
        console.log(`🔄 Transition: ${data.from} → ${data.to} (${data.duration}s)`);
    });

    faceEventBus.on('state:transition:end', (data) => {
        console.log(`✓ Transitioned to: ${data.to}`);
    });

    // Log connection events
    faceEventBus.on('system:connected', (data) => {
        console.log(`🔗 Connected: ${data.device}`);
    });

    faceEventBus.on('system:disconnected', (data) => {
        console.log(`🔌 Disconnected: ${data.device}`);
    });
}

// =====================================================
// Export for console access (development)
// =====================================================

// Make face accessible from console for testing
declare global {
    interface Window {
        face: ReturnType<typeof getFace>;
        faceEventBus: typeof faceEventBus;
        deviceSync: ReturnType<typeof getDeviceSync>;
        qrConnect: ReturnType<typeof getQRConnect>;
    }
}

window.addEventListener('load', () => {
    window.face = getFace();
    window.faceEventBus = faceEventBus;
    window.deviceSync = getDeviceSync();
    window.qrConnect = getQRConnect();
    console.log('💡 Access face from console: window.face');
    console.log('💡 Example: window.face.transitionTo("smile")');
    console.log('💡 Show QR: window.qrConnect.show()');
});

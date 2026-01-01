/**
 * main.ts
 * 
 * Application entry point for Drifting Sagan - Living Face UI
 * Initializes the face and sets up demo controls
 */

import { initializeFace, getFace } from './face/Face';
import { faceEventBus } from './events/FaceEventBus';
import { getDeviceSync } from './sync/DeviceSync';
import { getQRConnect } from './sync/QRConnect';
import { getFaceTransfer } from './sync/FaceTransfer';
import { initSharedState, getSharedState } from './sync/SharedState';
import { getFaceDetector } from './detection/FaceDetector';
import { getGazeController } from './detection/GazeController';
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
        setupThemeButtons(face);
        setupMicroToggle(face);
        setupMenuToggle();

        // Initialize device sync and QR connect
        setupDeviceSync(face);
        setupQRButton();
        setupFaceTransfer(face);

        // Initialize shared state (after DeviceSync is set up)
        setupSharedState(face);

        // Set up face detection (camera-based gaze and wink)
        setupFaceDetection(face);

        // Log available presets
        console.log('Available presets:', face.getPresets());

        // Listen for events (for debugging)
        setupEventLogging();

        // Check for connection params (from QR scan)
        checkConnectionParams();

        console.log('✅ Face initialized successfully!');
        console.log('The face is now alive with micro-expressions.');
        console.log('📷 Click "Start Camera" for gaze-based transfer!');
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
            applyPreset(face, presetName);
            // Broadcast to other devices
            getSharedState().set('activePreset', presetName);
        });
    });
}

/** Apply a preset and update UI */
function applyPreset(face: ReturnType<typeof initializeFace>, presetName: string): void {
    // Update active button
    document.querySelectorAll('.state-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-${presetName}`);
    if (btn) btn.classList.add('active');

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
}

function setupThemeButtons(face: ReturnType<typeof initializeFace>): void {
    const darkBtn = document.getElementById('btn-dark');
    const lightBtn = document.getElementById('btn-light');

    if (darkBtn && lightBtn) {
        darkBtn.addEventListener('click', () => {
            applyTheme('dark');
            getSharedState().set('theme', 'dark');
        });

        lightBtn.addEventListener('click', () => {
            applyTheme('light');
            getSharedState().set('theme', 'light');
        });
    }
}

/** Apply theme and update UI */
function applyTheme(theme: 'dark' | 'light'): void {
    const darkBtn = document.getElementById('btn-dark');
    const lightBtn = document.getElementById('btn-light');

    if (theme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        darkBtn?.classList.add('active');
        lightBtn?.classList.remove('active');
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        lightBtn?.classList.add('active');
        darkBtn?.classList.remove('active');
    }
}

function setupMicroToggle(face: ReturnType<typeof initializeFace>): void {
    const toggle = document.getElementById('toggle-micro') as HTMLInputElement;

    if (toggle) {
        toggle.addEventListener('change', () => {
            face.setMicroExpressionsEnabled(toggle.checked);
            getSharedState().set('microExpressionsEnabled', toggle.checked);
            console.log(`Micro-expressions: ${toggle.checked ? 'enabled' : 'disabled'}`);
        });
    }
}

// =====================================================
// Menu Toggle
// =====================================================

function setupMenuToggle(): void {
    const toggleBtn = document.getElementById('menu-toggle');
    const controlsPanel = document.getElementById('controls-panel');

    if (!toggleBtn || !controlsPanel) return;

    let isCollapsed = false;
    let isLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;

    // Toggle menu visibility
    toggleBtn.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        toggleBtn.classList.toggle('active', !isCollapsed);

        if (isLandscape) {
            // In landscape, toggle force-visible class
            controlsPanel.classList.toggle('force-visible', !isCollapsed);
        } else {
            // In portrait, toggle collapsed class
            controlsPanel.classList.toggle('collapsed', isCollapsed);
        }
    });

    // Handle orientation change
    const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 500px)');

    const handleOrientationChange = (e: MediaQueryListEvent | MediaQueryList) => {
        isLandscape = e.matches;
        if (isLandscape) {
            // Entering landscape - menu is auto-hidden by CSS
            controlsPanel.classList.remove('collapsed');
            controlsPanel.classList.remove('force-visible');
            toggleBtn.classList.remove('active');
            isCollapsed = true;
        } else {
            // Leaving landscape - reset to normal state
            controlsPanel.classList.remove('force-visible');
            controlsPanel.classList.remove('collapsed');
            isCollapsed = false;
        }
    };

    landscapeQuery.addEventListener('change', handleOrientationChange);
    handleOrientationChange(landscapeQuery); // Initial check
}

// =====================================================
// Shared State Setup
// =====================================================

function setupSharedState(face: ReturnType<typeof initializeFace>): void {
    const sharedState = initSharedState();

    // Listen for REMOTE changes - update UI when other device makes changes
    sharedState.onRemoteChange('theme', (theme) => {
        applyTheme(theme);
    });

    sharedState.onRemoteChange('activePreset', (preset) => {
        applyPreset(face, preset);
    });

    sharedState.onRemoteChange('microExpressionsEnabled', (enabled) => {
        const toggle = document.getElementById('toggle-micro') as HTMLInputElement;
        if (toggle) {
            toggle.checked = enabled;
            face.setMicroExpressionsEnabled(enabled);
        }
    });

    console.log('[SharedState] Ready - state syncs automatically');
}

// =====================================================
// Device Sync & QR Connect
// =====================================================

function setupDeviceSync(_face: ReturnType<typeof initializeFace>): void {
    // CRITICAL: Process connection params BEFORE initializing DeviceSync
    // This ensures room ID is saved to sessionStorage before DeviceSync.getRoomId() is called
    const connectionParams = processConnectionParams();

    const renderUrl = 'wss://iu-rw9m.onrender.com';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Get the device sync instance (but don't connect yet)
    const deviceSync = getDeviceSync();

    // Determine which server URL to use
    let serverToUse: string;

    // If we have a server URL from QR params, use that (mobile device joining)
    if (connectionParams.serverUrl) {
        serverToUse = connectionParams.serverUrl;
        console.log(`[Setup] Using server from QR code: ${serverToUse}`);
    } else if (!isLocal) {
        serverToUse = renderUrl;
        console.log('[Setup] Production environment, using Render backend');
    } else {
        serverToUse = renderUrl; // Default to Render for local testing too
        console.log('[Setup] Local environment, using Render backend for testing');
    }

    // Set URLs BEFORE connecting
    deviceSync.setServerUrl(serverToUse);
    deviceSync.setPublicServerUrl(renderUrl);
    deviceSync.setPublicAppUrl(window.location.origin);

    // NOW connect (after all URLs are set)
    deviceSync.connect();

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
    console.log(`[DeviceSync] Room ID: ${sessionStorage.getItem('drifting-sagan-room')}`);
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

        // When face is received - just apply the visual state
        // Preset is already synced via SharedState
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

/**
 * Process connection parameters from QR code scan.
 * MUST be called BEFORE initDeviceSync to ensure room ID is saved.
 * Returns the server URL if provided in params.
 */
function processConnectionParams(): { serverUrl: string | null; roomId: string | null } {
    const params = new URLSearchParams(window.location.search);
    const connectTo = params.get('connect');
    const roomId = params.get('room');
    const serverUrl = params.get('server');

    // Save room ID to sessionStorage BEFORE clearing URL
    // This is critical - DeviceSync.getRoomId() reads from sessionStorage
    if (roomId) {
        console.log(`[Connection] Saving room ID to session: ${roomId}`);
        sessionStorage.setItem('drifting-sagan-room', roomId);
    }

    if (connectTo) {
        console.log(`[Connection] Connecting to device: ${connectTo}`);
        console.log(`[Connection] Room: ${roomId}`);
        console.log(`[Connection] Server: ${serverUrl}`);
    }

    // Clean up URL (but only after we've saved everything we need)
    if (connectTo || roomId || serverUrl) {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }

    return { serverUrl, roomId };
}

function checkConnectionParams(): void {
    // Now just used for post-connection UI updates
    const deviceSync = getDeviceSync();
    if (deviceSync.isConnected()) {
        setTimeout(() => {
            updateConnectionStatus(true, 1);
        }, 500);
    }
}

// =====================================================
// Face Detection (Camera-based)
// =====================================================

function setupFaceDetection(face: ReturnType<typeof initializeFace>): void {
    const cameraBtn = document.getElementById('btn-camera');
    const cameraStatus = document.getElementById('camera-status');
    const videoElement = document.getElementById('camera-video') as HTMLVideoElement;

    if (!cameraBtn || !videoElement) return;

    const faceDetector = getFaceDetector();
    const gazeController = getGazeController();
    const faceTransfer = getFaceTransfer();

    let cameraActive = false;

    // Camera toggle button
    cameraBtn.addEventListener('click', async () => {
        if (!cameraActive) {
            try {
                cameraBtn.textContent = '⏳ Loading...';
                cameraBtn.classList.add('active');

                // Initialize and start face detector
                await faceDetector.init(videoElement);
                await faceDetector.start();

                // Start gaze controller
                gazeController.start();

                // NEW LOGIC: "I'm being looked at!"
                // When user looks at THIS device (center gaze), request the face if we don't have it
                gazeController.setOnTransfer(() => {
                    console.log(`[FaceDetection] User is looking at me!`);
                    if (!faceTransfer.isFaceVisible()) {
                        // I don't have the face - request it from the other device
                        console.log(`[FaceDetection] Requesting face from other device`);
                        getDeviceSync().requestFace();
                    }
                });

                // Listen for face requests from other devices
                // When another device says "I'm being looked at", send them the face
                getDeviceSync().setOnFaceRequested(() => {
                    console.log(`[FaceDetection] Other device wants the face`);
                    if (faceTransfer.isFaceVisible()) {
                        // I have the face - send it
                        faceTransfer.teleportFace();
                    }
                });

                // Connect wink to face animation
                gazeController.setOnWink((side) => {
                    console.log(`[FaceDetection] Wink: ${side}`);
                    face.transitionTo('wink', 0.1);
                    // Return to previous state after wink
                    setTimeout(() => {
                        const currentPreset = getSharedState().get('activePreset');
                        face.transitionTo(currentPreset, 0.3);
                    }, 300);
                });

                cameraActive = true;
                cameraBtn.textContent = '📷 Stop Camera';
                updateCameraStatus(true);

            } catch (error) {
                console.error('[FaceDetection] Failed to start:', error);
                cameraBtn.textContent = '📷 Start Camera';
                cameraBtn.classList.remove('active');
                updateCameraStatus(false, 'Camera error');
            }
        } else {
            // Stop camera
            faceDetector.stop();
            gazeController.stop();
            cameraActive = false;
            cameraBtn.textContent = '📷 Start Camera';
            cameraBtn.classList.remove('active');
            updateCameraStatus(false);
        }
    });

    function updateCameraStatus(active: boolean, message?: string): void {
        if (!cameraStatus) return;
        const indicator = cameraStatus.querySelector('.status-indicator');
        const text = cameraStatus.querySelector('.status-text');

        if (active) {
            indicator?.classList.add('connected');
            if (text) text.textContent = 'Camera active - look left/right to transfer';
        } else {
            indicator?.classList.remove('connected');
            if (text) text.textContent = message || 'Camera off';
        }
    }

    console.log('[FaceDetection] Ready - click "Start Camera" to enable');
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

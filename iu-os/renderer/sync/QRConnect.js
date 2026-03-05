/**
 * QRConnect.js
 * 
 * Generates and displays QR code for connecting mobile devices.
 */

class QRConnect {
    constructor(deviceSync) {
        this.deviceSync = deviceSync;
        this.qrContainer = null;
        this.isVisible = false;
    }

    createQRContainer() {
        const existing = document.getElementById('qr-connect-container');
        if (existing) existing.remove();

        const container = document.createElement('div');
        container.id = 'qr-connect-container';
        container.innerHTML = `
            <div class="qr-overlay">
                <div class="qr-modal">
                    <button class="qr-close" id="qr-close-btn">&times;</button>
                    <h2 class="qr-title">Connect Your Phone</h2>
                    <p class="qr-subtitle">Scan this QR code with your phone's camera</p>
                    <div class="qr-code-wrapper">
                        <div id="qr-target"></div>
                    </div>
                    <p class="qr-instruction">
                        Once connected, you can sync the face between devices!
                    </p>
                    <div class="qr-devices-status" id="qr-devices-status">
                        <span class="status-dot"></span>
                        <span class="status-text">Waiting for connection...</span>
                    </div>
                </div>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .qr-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.95);
                display: flex;
                align-items: flex-start;
                justify-content: center;
                z-index: 2000;
                animation: qr-fade-in 0.3s ease;
                -webkit-app-region: no-drag;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 8px;
            }
            
            @keyframes qr-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .qr-modal {
                background: var(--bg-primary, #0a0a0a);
                border: 1px solid var(--control-border, rgba(255, 255, 255, 0.1));
                border-radius: 16px;
                padding: 14px 12px 12px;
                text-align: center;
                width: 100%;
                max-width: 400px;
                position: relative;
                animation: qr-slide-up 0.3s ease;
                margin: auto 0;
            }
            
            @keyframes qr-slide-up {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            
            .qr-close {
                position: absolute;
                top: 6px;
                right: 6px;
                background: rgba(255,255,255,0.1);
                border: none;
                color: var(--text-primary, #fff);
                font-size: 20px;
                cursor: pointer;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                -webkit-app-region: no-drag;
                z-index: 10;
            }
            
            .qr-close:hover {
                background: var(--control-hover, rgba(255, 255, 255, 0.2));
            }
            
            .qr-title {
                font-size: clamp(14px, 5vw, 24px);
                font-weight: 600;
                color: var(--text-primary, #fff);
                margin: 0 0 4px 0;
            }
            
            .qr-subtitle {
                font-size: clamp(10px, 3vw, 14px);
                color: var(--text-secondary, #888);
                margin: 0 0 12px 0;
            }
            
            .qr-code-wrapper {
                background: #fff;
                padding: 10px;
                border-radius: 12px;
                display: inline-block;
                margin-bottom: 12px;
                max-width: calc(100% - 20px);
            }
            
            #qr-target {
                display: flex;
                justify-content: center;
            }
            
            #qr-target img, #qr-target canvas {
                display: block;
                max-width: 100% !important;
                height: auto !important;
            }
            
            .qr-instruction {
                font-size: clamp(9px, 2.8vw, 13px);
                color: var(--text-secondary, #888);
                margin: 0 0 8px 0;
            }
            
            .qr-devices-status {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                font-size: clamp(9px, 2.8vw, 13px);
                color: var(--text-secondary, #888);
            }
            
            .status-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #666;
                animation: status-pulse 2s ease-in-out infinite;
            }
            
            .status-dot.connected {
                background: #4ade80;
                animation: none;
            }
            
            @keyframes status-pulse {
                0%, 100% { opacity: 0.5; }
                50% { opacity: 1; }
            }
        `;

        container.appendChild(style);
        document.body.appendChild(container);

        return container;
    }

    async show() {
        if (this.isVisible) return;

        this.qrContainer = this.createQRContainer();
        this.isVisible = true;

        // Generate QR code
        const target = document.getElementById('qr-target');
        const url = this.deviceSync.getConnectionUrl();

        try {
            // Use QRCode library (qrcodejs style)
            // It modifies the target element, injecting the QR code
            if (typeof QRCode !== 'undefined') {
                // Clear previous if any
                target.innerHTML = '';

                // Adaptive QR size: smaller in compact windows
                const winW = window.innerWidth || 400;
                const qrSize = winW < 300 ? 130 : winW < 400 ? 160 : 200;

                new QRCode(target, {
                    text: url,
                    width: qrSize,
                    height: qrSize,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });

                console.log('[QRConnect] QR code generated for:', url);
            } else {
                console.error('[QRConnect] QRCode library not loaded');
                const urlDisplay = document.createElement('p');
                urlDisplay.style.cssText = 'word-break: break-all; font-size: 10px; max-width: 160px; color: black;';
                urlDisplay.textContent = url;
                target.appendChild(urlDisplay);
            }
        } catch (error) {
            console.error('[QRConnect] Failed to generate QR code:', error);
        }

        // Set up close button
        const closeBtn = document.getElementById('qr-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hide());
        }

        // Close on overlay click
        const overlay = this.qrContainer.querySelector('.qr-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.hide();
            });
        }

        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Listen for device connections
        this.deviceSync.setOnConnectionChange((connected, devices) => {
            this.updateConnectionStatus(devices.length > 0);
        });
    }

    hide() {
        if (!this.isVisible) return;

        if (this.qrContainer) {
            this.qrContainer.remove();
            this.qrContainer = null;
        }

        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    updateConnectionStatus(hasDevices) {
        const statusEl = document.getElementById('qr-devices-status');
        if (!statusEl) return;

        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        if (hasDevices) {
            if (dot) dot.classList.add('connected');
            if (text) text.textContent = '✅ Device connected! You can close this.';
        } else {
            if (dot) dot.classList.remove('connected');
            if (text) text.textContent = 'Waiting for connection...';
        }
    }

    isOpen() {
        return this.isVisible;
    }
}

// Export
window.QRConnect = QRConnect;

/**
 * QRConnect.ts
 * 
 * Generates and displays a QR code for connecting mobile devices.
 * When scanned, the phone opens the same app and can sync with the computer.
 */

import QRCode from 'qrcode';
import { getDeviceSync, DeviceSync } from './DeviceSync';

// =====================================================
// QRConnect Class
// =====================================================

export class QRConnect {
    private deviceSync: DeviceSync;
    private qrContainer: HTMLDivElement | null = null;
    private isVisible: boolean = false;

    constructor() {
        this.deviceSync = getDeviceSync();
    }

    /**
     * Create the QR code UI element
     */
    private createQRContainer(): HTMLDivElement {
        // Remove existing container if any
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
            <canvas id="qr-canvas"></canvas>
          </div>
          <p class="qr-instruction">
            Once connected, swipe the face between devices!
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
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: qr-fade-in 0.3s ease;
      }
      
      @keyframes qr-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .qr-modal {
        background: var(--bg-primary, #0a0a0a);
        border: 1px solid var(--control-border, rgba(255, 255, 255, 0.1));
        border-radius: 24px;
        padding: 40px;
        text-align: center;
        max-width: 400px;
        width: 90%;
        position: relative;
        animation: qr-slide-up 0.3s ease;
      }
      
      @keyframes qr-slide-up {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      
      .qr-close {
        position: absolute;
        top: 16px;
        right: 16px;
        background: transparent;
        border: none;
        color: var(--text-secondary, #888);
        font-size: 24px;
        cursor: pointer;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .qr-close:hover {
        background: var(--control-hover, rgba(255, 255, 255, 0.1));
        color: var(--text-primary, #fff);
      }
      
      .qr-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary, #fff);
        margin: 0 0 8px 0;
      }
      
      .qr-subtitle {
        font-size: 14px;
        color: var(--text-secondary, #888);
        margin: 0 0 24px 0;
      }
      
      .qr-code-wrapper {
        background: #fff;
        padding: 20px;
        border-radius: 16px;
        display: inline-block;
        margin-bottom: 24px;
      }
      
      #qr-canvas {
        display: block;
        width: 200px;
        height: 200px;
      }
      
      .qr-instruction {
        font-size: 13px;
        color: var(--text-secondary, #888);
        margin: 0 0 16px 0;
      }
      
      .qr-devices-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 13px;
        color: var(--text-secondary, #888);
      }
      
      .status-dot {
        width: 8px;
        height: 8px;
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

    /**
     * Show the QR code modal
     */
    async show(): Promise<void> {
        if (this.isVisible) return;

        this.qrContainer = this.createQRContainer();
        this.isVisible = true;

        // Generate QR code
        const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
        const url = this.deviceSync.getConnectionUrl();

        try {
            await QRCode.toCanvas(canvas, url, {
                width: 200,
                margin: 0,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            console.log('[QRConnect] QR code generated for:', url);
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
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Listen for device connections
        this.deviceSync.setOnConnectionChange((_connected, devices) => {
            this.updateConnectionStatus(devices.length > 0);
        });
    }

    /**
     * Hide the QR code modal
     */
    hide(): void {
        if (!this.isVisible) return;

        if (this.qrContainer) {
            this.qrContainer.remove();
            this.qrContainer = null;
        }

        this.isVisible = false;
    }

    /**
     * Toggle visibility
     */
    toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Update the connection status display
     */
    private updateConnectionStatus(hasDevices: boolean): void {
        const statusEl = document.getElementById('qr-devices-status');
        if (!statusEl) return;

        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        if (hasDevices) {
            dot?.classList.add('connected');
            if (text) text.textContent = 'Device connected! You can close this.';
        } else {
            dot?.classList.remove('connected');
            if (text) text.textContent = 'Waiting for connection...';
        }
    }

    /**
     * Check if QR modal is visible
     */
    isOpen(): boolean {
        return this.isVisible;
    }
}

// =====================================================
// Export
// =====================================================

let qrConnectInstance: QRConnect | null = null;

export function getQRConnect(): QRConnect {
    if (!qrConnectInstance) {
        qrConnectInstance = new QRConnect();
    }
    return qrConnectInstance;
}

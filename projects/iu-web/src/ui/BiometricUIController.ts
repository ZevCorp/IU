/**
 * BiometricUIController.ts
 * 
 * Controls the UI for biometric enrollment and verification
 */

import type {
    BiometricEnrollmentResult,
    BiometricVerificationResult,
    EnrollmentProgress
} from '../systems/biometric/BiometricTypes';

// =====================================================
// BiometricUIController Class
// =====================================================

export class BiometricUIController {
    private modalElement: HTMLElement | null = null;
    private isOpen = false;

    constructor() {
        this.createModal();
    }

    /**
     * Create the modal HTML structure
     */
    private createModal(): void {
        const modal = document.createElement('div');
        modal.className = 'biometric-modal';
        modal.id = 'biometric-modal';

        modal.innerHTML = `
            <div class="biometric-modal-content">
                <div class="biometric-modal-header">
                    <h2 class="biometric-modal-title" id="biometric-title">Verificación Biométrica</h2>
                    <p class="biometric-modal-subtitle" id="biometric-subtitle">Por favor, posiciona tu rostro en el marco</p>
                </div>

                <div class="enrollment-steps" id="enrollment-steps" style="display: none;">
                    <div class="enrollment-step" id="step-1">1</div>
                    <div class="enrollment-step" id="step-2">2</div>
                    <div class="enrollment-step" id="step-3">3</div>
                </div>

                <div class="biometric-scanner">
                    <video class="biometric-scanner-video" id="biometric-video" autoplay playsinline></video>
                    <div class="biometric-scanner-overlay">
                        <div class="scanner-frame" id="scanner-frame"></div>
                        <div class="scanner-line" id="scanner-line"></div>
                    </div>
                </div>

                <div class="quality-indicator" id="quality-indicator" style="display: none;">
                    <span class="quality-label">Calidad de captura:</span>
                    <span class="quality-value medium" id="quality-value">--</span>
                </div>

                <div class="confidence-meter" id="confidence-meter" style="display: none;">
                    <div class="confidence-label">
                        <span>Confianza de verificación</span>
                        <span class="confidence-value" id="confidence-value">0%</span>
                    </div>
                    <div class="confidence-bar">
                        <div class="confidence-fill" id="confidence-fill" style="width: 0%"></div>
                    </div>
                </div>

                <div class="biometric-progress" id="biometric-progress" style="display: none;">
                    <div class="biometric-progress-bar">
                        <div class="biometric-progress-fill" id="progress-fill" style="width: 0%"></div>
                    </div>
                    <p class="biometric-progress-text" id="progress-text">Preparando...</p>
                </div>

                <div class="biometric-status" id="biometric-status" style="display: none;">
                    <div class="biometric-status-icon" id="status-icon">🔍</div>
                    <p class="biometric-status-message" id="status-message">Iniciando verificación...</p>
                </div>

                <div class="biometric-buttons" id="biometric-buttons">
                    <button class="biometric-btn biometric-btn-secondary" id="biometric-cancel">Cancelar</button>
                    <button class="biometric-btn biometric-btn-primary" id="biometric-confirm" style="display: none;">Confirmar</button>
                    <button class="biometric-btn biometric-btn-primary" id="biometric-retry" style="display: none;">Reintentar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modalElement = modal;

        // Set up event listeners
        this.setupEventListeners();
    }

    /**
     * Set up UI event listeners
     */
    private setupEventListeners(): void {
        const cancelBtn = document.getElementById('biometric-cancel');
        const retryBtn = document.getElementById('biometric-retry');

        cancelBtn?.addEventListener('click', () => {
            this.onCancel();
        });

        retryBtn?.addEventListener('click', () => {
            this.onRetry();
        });
    }

    // =====================================================
    // Enrollment UI
    // =====================================================

    /**
     * Show enrollment modal
     */
    showEnrollmentModal(): void {
        this.reset();
        this.setTitle('Registro Biométrico', 'Vamos a capturar tu perfil facial');

        const stepsEl = document.getElementById('enrollment-steps');
        if (stepsEl) stepsEl.style.display = 'flex';

        const qualityEl = document.getElementById('quality-indicator');
        if (qualityEl) qualityEl.style.display = 'flex';

        const progressEl = document.getElementById('biometric-progress');
        if (progressEl) progressEl.style.display = 'block';

        this.showScanner();
        this.open();
    }

    /**
     * Update enrollment progress
     */
    updateEnrollmentProgress(progress: EnrollmentProgress): void {
        // Update steps
        for (let i = 1; i <= 3; i++) {
            const stepEl = document.getElementById(`step-${i}`);
            if (!stepEl) continue;

            if (i < progress.currentStep) {
                stepEl.className = 'enrollment-step completed';
            } else if (i === progress.currentStep) {
                stepEl.className = 'enrollment-step active';
            } else {
                stepEl.className = 'enrollment-step';
            }
        }

        // Update quality
        this.updateQuality(progress.currentQuality);

        // Update progress text
        this.updateProgress(
            (progress.currentStep / progress.totalSteps) * 100,
            progress.message
        );

        // Update scanner frame
        const frameEl = document.getElementById('scanner-frame');
        if (frameEl) {
            if (progress.isAcceptable) {
                frameEl.className = 'scanner-frame success';
                this.activateScanLine();
            } else {
                frameEl.className = 'scanner-frame scanning';
            }
        }
    }

    /**
     * Show enrollment result
     */
    showEnrollmentResult(result: BiometricEnrollmentResult): void {
        const stepsEl = document.getElementById('enrollment-steps');
        if (stepsEl) stepsEl.style.display = 'none';

        const qualityEl = document.getElementById('quality-indicator');
        if (qualityEl) qualityEl.style.display = 'none';

        const progressEl = document.getElementById('biometric-progress');
        if (progressEl) progressEl.style.display = 'none';

        this.hideScanner();

        if (result.success) {
            this.showStatus('success', '✅', result.message);
            setTimeout(() => this.close(), 2000);
        } else {
            this.showStatus('error', '❌', result.message);
            this.showRetryButton();
        }
    }

    // =====================================================
    // Verification UI
    // =====================================================

    /**
     * Show verification modal
     */
    showVerificationModal(): void {
        this.reset();
        this.setTitle('Verificación de Identidad', 'Por favor, mira a la cámara');

        const confidenceEl = document.getElementById('confidence-meter');
        if (confidenceEl) confidenceEl.style.display = 'block';

        this.showScanner();
        this.updateScannerState('scanning');
        this.activateScanLine();
        this.open();
    }

    /**
     * Update verification confidence in real-time
     */
    updateVerificationConfidence(confidence: number): void {
        const valueEl = document.getElementById('confidence-value');
        const fillEl = document.getElementById('confidence-fill');

        if (valueEl) {
            valueEl.textContent = `${confidence.toFixed(0)}%`;
        }

        if (fillEl) {
            fillEl.style.width = `${confidence}%`;
        }
    }

    /**
     * Show verification result
     */
    showVerificationResult(result: BiometricVerificationResult): void {
        const confidenceEl = document.getElementById('confidence-meter');
        if (confidenceEl) confidenceEl.style.display = 'none';

        this.hideScanner();

        if (result.success) {
            this.showStatus('success', '✅', result.message);
            setTimeout(() => this.close(), 2000);
        } else {
            const icon = result.attemptsRemaining && result.attemptsRemaining > 0 ? '⚠️' : '❌';
            const statusType = result.attemptsRemaining && result.attemptsRemaining > 0 ? 'warning' : 'error';

            let message = result.message;
            if (result.attemptsRemaining !== undefined && result.attemptsRemaining > 0) {
                message += `\n\nIntentos restantes: ${result.attemptsRemaining}`;
            }

            this.showStatus(statusType, icon, message);

            if (result.attemptsRemaining && result.attemptsRemaining > 0) {
                this.showRetryButton();
            } else {
                // No more attempts - just show cancel
                setTimeout(() => this.close(), 3000);
            }
        }
    }

    // =====================================================
    // UI Helper Methods
    // =====================================================

    private setTitle(title: string, subtitle: string): void {
        const titleEl = document.getElementById('biometric-title');
        const subtitleEl = document.getElementById('biometric-subtitle');

        if (titleEl) titleEl.textContent = title;
        if (subtitleEl) subtitleEl.textContent = subtitle;
    }

    private showScanner(): void {
        const scannerEl = document.querySelector('.biometric-scanner') as HTMLElement;
        if (scannerEl) scannerEl.style.display = 'block';
    }

    private hideScanner(): void {
        const scannerEl = document.querySelector('.biometric-scanner') as HTMLElement;
        if (scannerEl) scannerEl.style.display = 'none';
    }

    private updateScannerState(state: 'idle' | 'scanning' | 'success' | 'error'): void {
        const frameEl = document.getElementById('scanner-frame');
        if (frameEl) {
            frameEl.className = `scanner-frame ${state}`;
        }
    }

    private activateScanLine(): void {
        const lineEl = document.getElementById('scanner-line');
        if (lineEl) lineEl.classList.add('active');
    }

    private deactivateScanLine(): void {
        const lineEl = document.getElementById('scanner-line');
        if (lineEl) lineEl.classList.remove('active');
    }

    private updateQuality(quality: number): void {
        const valueEl = document.getElementById('quality-value');
        if (!valueEl) return;

        valueEl.textContent = `${quality.toFixed(0)}%`;

        // Update color based on quality
        valueEl.className = 'quality-value';
        if (quality >= 80) {
            valueEl.classList.add('high');
        } else if (quality >= 60) {
            valueEl.classList.add('medium');
        } else {
            valueEl.classList.add('low');
        }
    }

    private updateProgress(percent: number, message: string): void {
        const fillEl = document.getElementById('progress-fill');
        const textEl = document.getElementById('progress-text');

        if (fillEl) fillEl.style.width = `${percent}%`;
        if (textEl) textEl.textContent = message;
    }

    private showStatus(type: 'success' | 'error' | 'warning', icon: string, message: string): void {
        const statusEl = document.getElementById('biometric-status');
        const iconEl = document.getElementById('status-icon');
        const messageEl = document.getElementById('status-message');

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.className = `biometric-status ${type}`;
        }

        if (iconEl) iconEl.textContent = icon;
        if (messageEl) messageEl.textContent = message;
    }

    private showRetryButton(): void {
        const retryBtn = document.getElementById('biometric-retry');
        if (retryBtn) retryBtn.style.display = 'inline-block';
    }

    private reset(): void {
        // Hide all optional elements
        const elementsToHide = [
            'enrollment-steps',
            'quality-indicator',
            'confidence-meter',
            'biometric-progress',
            'biometric-status',
            'biometric-confirm',
            'biometric-retry'
        ];

        elementsToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Reset scanner state
        this.updateScannerState('idle');
        this.deactivateScanLine();

        // Reset steps
        for (let i = 1; i <= 3; i++) {
            const stepEl = document.getElementById(`step-${i}`);
            if (stepEl) stepEl.className = 'enrollment-step';
        }
    }

    // =====================================================
    // Modal Control
    // =====================================================

    open(): void {
        if (this.modalElement) {
            this.modalElement.classList.add('visible');
            this.isOpen = true;
        }
    }

    close(): void {
        if (this.modalElement) {
            this.modalElement.classList.remove('visible');
            this.isOpen = false;
        }
        this.deactivateScanLine();
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    isModalOpen(): boolean {
        return this.isOpen;
    }

    /**
     * Get the video element for camera stream
     */
    getVideoElement(): HTMLVideoElement | null {
        return document.getElementById('biometric-video') as HTMLVideoElement;
    }

    // =====================================================
    // Callbacks
    // =====================================================

    private onCancelCallback: (() => void) | null = null;
    private onRetryCallback: (() => void) | null = null;
    private onCloseCallback: (() => void) | null = null;

    setOnCancel(callback: () => void): void {
        this.onCancelCallback = callback;
    }

    setOnRetry(callback: () => void): void {
        this.onRetryCallback = callback;
    }

    setOnClose(callback: () => void): void {
        this.onCloseCallback = callback;
    }

    private onCancel(): void {
        this.close();
        if (this.onCancelCallback) {
            this.onCancelCallback();
        }
    }

    private onRetry(): void {
        this.reset();
        if (this.onRetryCallback) {
            this.onRetryCallback();
        }
    }

    // =====================================================
    // Toast Notifications
    // =====================================================

    showToast(message: string, duration: number = 3000): void {
        let toast = document.getElementById('toast-message');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-message';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('visible');

        setTimeout(() => {
            toast!.classList.remove('visible');
        }, duration);
    }
}

// =====================================================
// Singleton Export
// =====================================================

let instance: BiometricUIController | null = null;

export function getBiometricUIController(): BiometricUIController {
    if (!instance) {
        instance = new BiometricUIController();
    }
    return instance;
}

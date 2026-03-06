/**
 * BankTransferDemo.ts
 * 
 * Demonstration of biometric authentication for bank transfers
 * Updated to support Face-API.js data structures.
 */

import { getFaceDetector } from '../detection/FaceDetector';
import { getBiometricAuthManager } from '../systems/biometric/BiometricAuthManager';
import { getBiometricUIController } from '../ui/BiometricUIController';

// =====================================================
// Types
// =====================================================

interface TransferData {
    amount: number;
    recipient: string;
    accountNumber?: string;
    description?: string;
}

type TransferCallback = (data: TransferData) => void;

// =====================================================
// BankTransferDemo Class
// =====================================================

export class BankTransferDemo {
    private faceDetector = getFaceDetector();
    private authManager = getBiometricAuthManager();
    private uiController = getBiometricUIController();

    private isEnrolling = false;
    private isVerifying = false;
    private pendingTransfer: TransferData | null = null;
    private onTransferApproved: TransferCallback | null = null;
    private onTransferRejected: ((reason: string) => void) | null = null;

    private landmarkUnsubscribe: (() => void) | null = null;

    constructor() {
        this.setupUICallbacks();
    }

    /**
     * Get the UI controller for external access
     */
    getUIController() {
        return this.uiController;
    }

    /**
     * Set up UI event callbacks
     */
    private setupUICallbacks(): void {
        this.uiController.setOnCancel(() => {
            this.cancelCurrentOperation();
        });

        this.uiController.setOnRetry(() => {
            if (this.isEnrolling) {
                this.startEnrollment();
            } else if (this.isVerifying && this.pendingTransfer) {
                this.startVerification(this.pendingTransfer);
            }
        });

        this.uiController.setOnClose(() => {
            this.stopCamera();
        });
    }

    // =====================================================
    // Enrollment
    // =====================================================

    /**
     * Start biometric enrollment process
     */
    async startEnrollment(): Promise<void> {
        console.log('[BankTransferDemo] Starting enrollment');
        this.isEnrolling = true;

        try {
            await this.startCamera();
            await this.authManager.startEnrollment();
            this.uiController.showEnrollmentModal();

            this.subscribeToFaceData(async (faceData) => {
                if (!this.isEnrolling) return;

                // Only process if we have valid data
                if (!faceData || !faceData.descriptor) return;

                try {
                    const progress = await this.authManager.addEnrollmentCapture(faceData);
                    this.uiController.updateEnrollmentProgress(progress);

                    if (progress.currentStep >= 3 && progress.isAcceptable) {
                        this.completeEnrollment();
                    }
                } catch (error) {
                    console.error('[BankTransferDemo] Enrollment capture error:', error);
                }
            });

        } catch (error) {
            console.error('[BankTransferDemo] Failed to start enrollment:', error);
            this.uiController.showToast('Error al iniciar el registro biométrico');
            this.cancelCurrentOperation();
        }
    }

    /**
     * Complete the enrollment process
     */
    private async completeEnrollment(): Promise<void> {
        this.unsubscribeFromLandmarks();

        const result = await this.authManager.completeEnrollment();
        this.uiController.showEnrollmentResult(result);

        this.isEnrolling = false;

        if (result.success) {
            console.log('[BankTransferDemo] Enrollment completed successfully');
        }
    }

    // =====================================================
    // Bank Transfer Verification
    // =====================================================

    /**
     * Request a bank transfer (requires biometric verification)
     */
    async requestTransfer(
        data: TransferData,
        onApproved: TransferCallback,
        onRejected: (reason: string) => void
    ): Promise<void> {
        console.log('[BankTransferDemo] Transfer requested:', data);

        if (!this.authManager.isEnrolled()) {
            this.uiController.showToast('Debes registrar tu perfil biométrico primero');
            onRejected('Usuario no registrado');
            return;
        }

        this.onTransferApproved = onApproved;
        this.onTransferRejected = onRejected;
        this.pendingTransfer = data;

        await this.startVerification(data);
    }

    private lastVerifyTime = 0;
    private verificationTimeoutId: any = null;

    private async startVerification(data: TransferData): Promise<void> {
        console.log('[BankTransferDemo] Starting verification');
        this.isVerifying = true;
        this.lastVerifyTime = 0;

        // Reset failed attempts for the new verification session
        this.authManager.resetFailedAttempts();

        // Set a timeout for verification (15 seconds)
        this.clearVerificationTimeout();
        this.verificationTimeoutId = setTimeout(() => {
            if (this.isVerifying) {
                console.log('[BankTransferDemo] Verification timeout reached');
                this.completeVerification(false, {
                    success: false,
                    confidence: 0,
                    message: 'Tiempo de espera agotado. No se detectó un rostro válido.'
                });
            }
        }, 15000);

        try {
            await this.startCamera();
            this.uiController.showVerificationModal();

            this.subscribeToFaceData(async (faceData) => {
                if (!this.isVerifying) return;

                // Only verify if we have a face descriptor
                if (!faceData || !faceData.descriptor) return;

                // Throttle verification (500ms)
                const now = Date.now();
                if (now - this.lastVerifyTime < 500) return;

                try {
                    this.lastVerifyTime = now;
                    const result = await this.authManager.verify(faceData);

                    // Update UI with confidence
                    this.uiController.updateVerificationConfidence(result.confidence);

                    // Check if verification is successful
                    if (result.success) {
                        console.log('[BankTransferDemo] Verification succeeded, completing...');
                        this.completeVerification(true, result);
                    } else {
                        console.log(`[BankTransferDemo] Verification failed. Attempts remaining: ${result.attemptsRemaining}`);

                        // If no more attempts, fail permanently
                        if (result.attemptsRemaining === 0) {
                            this.completeVerification(false, result);
                        } else if (result.confidence >= this.authManager.getConfig().minConfidenceThreshold * 0.95) {
                            console.log('[BankTransferDemo] Confidence very close, waiting for better match...');
                        }
                    }
                } catch (error) {
                    console.error('[BankTransferDemo] Verification error:', error);
                }
            });

        } catch (error) {
            this.clearVerificationTimeout();
            console.error('[BankTransferDemo] Failed to start verification:', error);
            this.uiController.showToast('Error al iniciar la verificación');
            this.rejectTransfer('Error de verificación');
        }
    }

    private clearVerificationTimeout(): void {
        if (this.verificationTimeoutId) {
            clearTimeout(this.verificationTimeoutId);
            this.verificationTimeoutId = null;
        }
    }

    /**
     * Complete verification and process transfer
     */
    private async completeVerification(success: boolean, result?: any): Promise<void> {
        this.clearVerificationTimeout();
        this.unsubscribeFromLandmarks();
        this.isVerifying = false;

        if (success && this.pendingTransfer) {
            // Show success result
            this.uiController.showVerificationResult(result || {
                success: true,
                confidence: 100,
                message: 'Verificación exitosa'
            });

            console.log('[BankTransferDemo] Transfer approved');
            if (this.onTransferApproved) {
                this.onTransferApproved(this.pendingTransfer);
            }
            this.pendingTransfer = null;
        } else {
            // Show failure result
            this.uiController.showVerificationResult(result || {
                success: false,
                confidence: 0,
                message: 'Verificación fallida. No se pudo confirmar tu identidad.'
            });
            this.rejectTransfer('Verificación fallida');
        }
    }

    /**
     * Reject the pending transfer
     */
    private rejectTransfer(reason: string): void {
        console.log('[BankTransferDemo] Transfer rejected:', reason);

        if (this.onTransferRejected) {
            this.onTransferRejected(reason);
        }

        this.pendingTransfer = null;
        this.isVerifying = false;
    }

    // =====================================================
    // Camera Management
    // =====================================================

    /**
     * Start the camera for face detection
     */
    private async startCamera(): Promise<void> {
        if (this.faceDetector.isActive()) {
            return; // Already running
        }

        const videoElement = this.uiController.getVideoElement();
        if (!videoElement) {
            throw new Error('Video element not found');
        }

        await this.faceDetector.init(videoElement);
        await this.faceDetector.start();

        console.log('[BankTransferDemo] Camera started');
    }

    /**
     * Stop the camera
     */
    private stopCamera(): void {
        this.faceDetector.stop();
        console.log('[BankTransferDemo] Camera stopped');
    }

    /**
     * Subscribe to face data updates
     */
    private subscribeToFaceData(callback: (data: any) => void): void {
        this.unsubscribeFromLandmarks();
        // Use the new method name from FaceDetector
        this.landmarkUnsubscribe = this.faceDetector.onFaceDataDetected(callback);
    }

    /**
     * Unsubscribe from updates
     */
    private unsubscribeFromLandmarks(): void {
        if (this.landmarkUnsubscribe) {
            this.landmarkUnsubscribe();
            this.landmarkUnsubscribe = null;
        }
    }

    // =====================================================
    // Utility Methods
    // =====================================================

    private cancelCurrentOperation(): void {
        this.isEnrolling = false;
        this.isVerifying = false;
        this.pendingTransfer = null;
        this.unsubscribeFromLandmarks();
        this.stopCamera();

        console.log('[BankTransferDemo] Operation cancelled');
    }

    isUserEnrolled(): boolean {
        return this.authManager.isEnrolled();
    }

    async deleteProfile(): Promise<void> {
        await this.authManager.deleteProfile();
        this.uiController.showToast('Perfil biométrico eliminado');
    }

    getAuthState() {
        return this.authManager.getAuthState();
    }
}

// Singleton
let instance: BankTransferDemo | null = null;

export function getBankTransferDemo(): BankTransferDemo {
    if (!instance) {
        instance = new BankTransferDemo();
    }
    return instance;
}

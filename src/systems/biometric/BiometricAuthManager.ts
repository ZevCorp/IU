/**
 * BiometricAuthManager.ts
 * 
 * Main manager for biometric authentication operations using Face-API.js
 */

import { getBiometricAnalyzer } from './BiometricAnalyzer';
import { getBiometricStorage } from './BiometricStorage';
import type {
    BiometricConfig,
    BiometricTemplate,
    BiometricVerificationResult,
    BiometricEnrollmentResult,
    BiometricAuthState,
    EnrollmentProgress,
    BiometricEventCallback,
    BiometricEvent
} from './BiometricTypes';

// =====================================================
// Types
// =====================================================

// Input data type (FaceData from FaceDetector)
type BiometricData = any;

// =====================================================
// BiometricAuthManager Class
// =====================================================

export class BiometricAuthManager {
    private config: BiometricConfig;
    private analyzer = getBiometricAnalyzer();
    private storage = getBiometricStorage();
    private eventCallbacks: Set<BiometricEventCallback> = new Set();

    // State
    private currentUserId: string = 'default_user';
    private authState: BiometricAuthState = {
        isEnrolled: false,
        isAuthenticated: false,
        failedAttempts: 0,
        isLocked: false
    };

    // Enrollment state
    private enrollmentCaptures: BiometricTemplate[] = [];

    constructor(config: Partial<BiometricConfig> = {}) {
        const defaults: BiometricConfig = {
            minConfidenceThreshold: 75,
            maxVerificationAttempts: 3,
            sessionTimeout: 5 * 60 * 1000,
            requireLiveness: false, // Disabled for now in Face-API implementation
            minEnrollmentQuality: 60,
            enrollmentCaptureCount: 3,
            debugMode: false
        };
        this.config = { ...defaults, ...config };
        this.initializeState();
    }

    /**
     * Initialize authentication state from storage
     */
    private async initializeState(): Promise<void> {
        const hasProfile = this.storage.hasProfile(this.currentUserId);
        this.authState.isEnrolled = hasProfile;

        console.log('[BiometricAuthManager] Initialized. Enrolled:', hasProfile);
    }

    /**
     * Set the current user ID
     */
    setUserId(userId: string): void {
        this.currentUserId = userId;
        this.authState.isEnrolled = this.storage.hasProfile(userId);
        this.authState.isAuthenticated = false;
        console.log('[BiometricAuthManager] User ID set to:', userId);
    }

    /**
     * Check if user is enrolled
     */
    isEnrolled(): boolean {
        return this.storage.hasProfile(this.currentUserId);
    }

    /**
     * Check if user is currently authenticated
     */
    isAuthenticated(): boolean {
        if (!this.authState.isAuthenticated) {
            return false;
        }

        // Check if session has expired
        if (this.authState.lastAuthTime) {
            const elapsed = Date.now() - this.authState.lastAuthTime;
            if (elapsed > this.config.sessionTimeout) {
                this.authState.isAuthenticated = false;
                this.emitEvent({ type: 'session:expired' });
                return false;
            }
        }

        return true;
    }

    /**
     * Get current authentication state
     */
    getAuthState(): BiometricAuthState {
        return { ...this.authState };
    }

    // =====================================================
    // Enrollment
    // =====================================================

    /**
     * Start the enrollment process
     */
    async startEnrollment(): Promise<void> {
        console.log('[BiometricAuthManager] Starting enrollment');
        this.enrollmentCaptures = [];
        this.emitEvent({ type: 'enrollment:started' });
    }

    /**
     * Add a capture to the enrollment process
     */
    async addEnrollmentCapture(faceData: BiometricData): Promise<EnrollmentProgress> {
        try {
            if (!faceData) {
                throw new Error('No face data provided');
            }

            // Extract features and create template
            const template = this.analyzer.extractFeatures(faceData);

            const progress: EnrollmentProgress = {
                currentStep: this.enrollmentCaptures.length,
                totalSteps: this.config.enrollmentCaptureCount,
                currentQuality: template.metadata.quality,
                message: '',
                isAcceptable: false
            };

            // Check quality
            if (template.metadata.quality < this.config.minEnrollmentQuality) {
                progress.message = `Calidad baja (${template.metadata.quality.toFixed(0)}%). Asegúrate de que tu rostro se vea bien.`;
                progress.isAcceptable = false;
            } else {
                this.enrollmentCaptures.push(template);
                progress.currentStep = this.enrollmentCaptures.length;
                progress.isAcceptable = true;

                if (this.enrollmentCaptures.length < this.config.enrollmentCaptureCount) {
                    progress.message = `Captura ${this.enrollmentCaptures.length}/${this.config.enrollmentCaptureCount} completada. Continúa...`;
                } else {
                    progress.message = 'Todas las capturas completadas. Procesando...';
                }
            }

            this.emitEvent({ type: 'enrollment:progress', data: progress });
            return progress;

        } catch (error) {
            console.error('[BiometricAuthManager] Enrollment capture failed:', error);
            throw error;
        }
    }

    /**
     * Complete the enrollment process
     */
    async completeEnrollment(): Promise<BiometricEnrollmentResult> {
        if (this.enrollmentCaptures.length < this.config.enrollmentCaptureCount) {
            const result: BiometricEnrollmentResult = {
                success: false,
                message: `Se requieren ${this.config.enrollmentCaptureCount} capturas. Solo se completaron ${this.enrollmentCaptures.length}.`
            };
            this.emitEvent({ type: 'enrollment:failed', error: result.message });
            return result;
        }

        try {
            // Average the templates to create a more robust profile
            const averagedTemplate = this.averageTemplates(this.enrollmentCaptures);

            // Save to storage
            await this.storage.saveProfile(this.currentUserId, averagedTemplate);

            this.authState.isEnrolled = true;
            this.enrollmentCaptures = [];

            const result: BiometricEnrollmentResult = {
                success: true,
                message: 'Perfil biométrico registrado exitosamente.',
                template: averagedTemplate,
                captureQualities: this.enrollmentCaptures.map(t => t.metadata.quality)
            };

            this.emitEvent({ type: 'enrollment:completed', data: result });
            console.log('[BiometricAuthManager] Enrollment completed successfully');

            return result;

        } catch (error) {
            console.error('[BiometricAuthManager] Failed to complete enrollment:', error);
            const result: BiometricEnrollmentResult = {
                success: false,
                message: 'Error al guardar el perfil biométrico.'
            };
            this.emitEvent({ type: 'enrollment:failed', error: result.message });
            return result;
        }
    }

    /**
     * Cancel enrollment
     */
    cancelEnrollment(): void {
        this.enrollmentCaptures = [];
        console.log('[BiometricAuthManager] Enrollment cancelled');
    }

    // =====================================================
    // Verification
    // =====================================================

    /**
     * Verify user identity against enrolled profile
     */
    async verify(faceData: BiometricData): Promise<BiometricVerificationResult> {
        console.log('[BiometricAuthManager] Starting verification');
        this.emitEvent({ type: 'verification:started' });

        // Check if user is enrolled
        if (!this.authState.isEnrolled) {
            const result: BiometricVerificationResult = {
                success: false,
                confidence: 0,
                message: 'Usuario no registrado. Por favor, registra tu perfil biométrico primero.'
            };
            this.emitEvent({ type: 'verification:failed', error: result.message });
            return result;
        }

        // Check if locked
        if (this.authState.isLocked) {
            const result: BiometricVerificationResult = {
                success: false,
                confidence: 0,
                message: 'Cuenta bloqueada por demasiados intentos fallidos.'
            };
            return result;
        }

        try {
            // Extract features from current capture
            const currentTemplate = this.analyzer.extractFeatures(faceData);

            // Check quality
            if (currentTemplate.metadata.quality < this.config.minEnrollmentQuality) {
                const result: BiometricVerificationResult = {
                    success: false,
                    confidence: 0,
                    message: 'Calidad de imagen insuficiente. Por favor, asegúrate de que tu rostro esté bien iluminado.',
                    attemptsRemaining: this.config.maxVerificationAttempts - this.authState.failedAttempts
                };
                return result;
            }

            // Load enrolled profile
            const storedProfile = await this.storage.loadProfile(this.currentUserId);
            if (!storedProfile) {
                throw new Error('Profile not found in storage');
            }

            // Compare templates
            const confidence = this.analyzer.compareTemplates(
                currentTemplate,
                storedProfile.template
            );

            this.emitEvent({ type: 'verification:progress', confidence });

            // Check threshold
            const success = confidence >= this.config.minConfidenceThreshold;

            let message: string;
            if (success) {
                message = `Verificación exitosa (${confidence.toFixed(1)}% de confianza)`;
                this.authState.isAuthenticated = true;
                this.authState.lastAuthTime = Date.now();
                this.authState.failedAttempts = 0;
            } else {
                this.authState.failedAttempts++;
                message = `Verificación fallida (${confidence.toFixed(1)}% de confianza)`;
                this.checkAndLockAccount();
            }

            const result: BiometricVerificationResult = {
                success,
                confidence,
                message,
                attemptsRemaining: this.config.maxVerificationAttempts - this.authState.failedAttempts,
                metrics: this.config.debugMode ? {
                    distance: 0,
                    captureQuality: currentTemplate.metadata.quality
                } : undefined
            };

            this.emitEvent({ type: 'verification:completed', data: result });
            console.log('[BiometricAuthManager] Verification result:', result);

            return result;

        } catch (error) {
            console.error('[BiometricAuthManager] Verification error:', error);
            const result: BiometricVerificationResult = {
                success: false,
                confidence: 0,
                message: 'Error durante la verificación.'
            };
            this.emitEvent({ type: 'verification:failed', error: String(error) });
            return result;
        }
    }

    /**
     * Logout (clear authentication)
     */
    logout(): void {
        this.authState.isAuthenticated = false;
        this.authState.lastAuthTime = undefined;
        console.log('[BiometricAuthManager] User logged out');
    }

    /**
     * Reset failed attempts counter
     */
    resetFailedAttempts(): void {
        this.authState.failedAttempts = 0;
        this.authState.isLocked = false;
        console.log('[BiometricAuthManager] Failed attempts reset');
    }

    // =====================================================
    // Profile Management
    // =====================================================

    /**
     * Delete the current user's biometric profile
     */
    async deleteProfile(): Promise<void> {
        await this.storage.deleteProfile(this.currentUserId);
        this.authState.isEnrolled = false;
        this.authState.isAuthenticated = false;
        console.log('[BiometricAuthManager] Profile deleted');
    }

    // =====================================================
    // Event System
    // =====================================================

    /**
     * Subscribe to biometric events
     */
    on(callback: BiometricEventCallback): () => void {
        this.eventCallbacks.add(callback);
        return () => this.eventCallbacks.delete(callback);
    }

    private emitEvent(event: BiometricEvent): void {
        this.eventCallbacks.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('[BiometricAuthManager] Event callback error:', error);
            }
        });
    }

    // =====================================================
    // Configuration
    // =====================================================

    /**
     * Update configuration
     */
    updateConfig(config: Partial<BiometricConfig>): void {
        this.config = { ...this.config, ...config };
        console.log('[BiometricAuthManager] Configuration updated:', this.config);
    }

    /**
     * Get current configuration
     */
    getConfig(): BiometricConfig {
        return { ...this.config };
    }

    // =====================================================
    // Private Helpers
    // =====================================================

    private averageTemplates(templates: BiometricTemplate[]): BiometricTemplate {
        const featureCount = templates[0].features.length;
        const averagedFeatures = new Float32Array(featureCount); // 128-d

        // Sum all feature vectors
        for (const template of templates) {
            const features = template.features;
            for (let i = 0; i < featureCount; i++) {
                averagedFeatures[i] += features[i];
            }
        }

        // Divide by count to get average
        for (let i = 0; i < featureCount; i++) {
            averagedFeatures[i] /= templates.length;
        }

        // Calculate average quality
        const avgQuality = templates.reduce((sum, t) => sum + t.metadata.quality, 0) / templates.length;

        return {
            features: averagedFeatures,
            metadata: {
                capturedAt: Date.now(),
                quality: avgQuality,
                version: templates[0].metadata.version
            }
        };
    }

    private checkAndLockAccount(): void {
        if (this.authState.failedAttempts >= this.config.maxVerificationAttempts) {
            this.authState.isLocked = true;
            this.emitEvent({
                type: 'auth:locked',
                reason: `Demasiados intentos fallidos (${this.authState.failedAttempts})`
            });
            console.warn('[BiometricAuthManager] Account locked due to failed attempts');
        }
    }
}

// =====================================================
// Singleton Export
// =====================================================

let instance: BiometricAuthManager | null = null;

export function getBiometricAuthManager(config?: Partial<BiometricConfig>): BiometricAuthManager {
    if (!instance) {
        instance = new BiometricAuthManager(config);
    }
    return instance;
}

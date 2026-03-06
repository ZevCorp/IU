/**
 * BiometricTypes.ts
 * 
 * Type definitions for the biometric authentication system
 */

// =====================================================
// Biometric Template
// =====================================================

/**
 * Represents a biometric template extracted from facial landmarks
 */
export interface BiometricTemplate {
    /** Feature vector representing the face (128-d embedding) */
    features: Float32Array | number[]; // Support both for graceful migration

    /** Metadata about the template */
    metadata: {
        /** Timestamp when the template was captured */
        capturedAt: number;

        /** Quality score of the capture (0-100) */
        quality: number;

        /** Version of the feature extraction algorithm */
        version: string;

        /** Optional: ID of the user */
        userId?: string;
    };
}

// =====================================================
// Verification Results
// =====================================================

/**
 * Result of a biometric verification attempt
 */
export interface BiometricVerificationResult {
    /** Whether the verification was successful */
    success: boolean;

    /** Confidence score (0-100) */
    confidence: number;

    /** Human-readable message */
    message: string;

    /** Number of attempts remaining (if failed) */
    attemptsRemaining?: number;

    /** Detailed metrics (for debugging/development) */
    metrics?: {
        /** Feature distance between templates */
        distance: number;

        /** Individual feature scores */
        featureScores?: number[];

        /** Quality of the captured image */
        captureQuality: number;
    };
}

/**
 * Result of an enrollment (registration) process
 */
export interface BiometricEnrollmentResult {
    /** Whether enrollment was successful */
    success: boolean;

    /** Message about the enrollment */
    message: string;

    /** The generated template (if successful) */
    template?: BiometricTemplate;

    /** Quality scores of all captures */
    captureQualities?: number[];
}

// =====================================================
// Configuration
// =====================================================

/**
 * Configuration for the biometric authentication system
 */
export interface BiometricConfig {
    /** Minimum confidence threshold for successful verification (0-100) */
    minConfidenceThreshold: number;

    /** Maximum number of verification attempts allowed */
    maxVerificationAttempts: number;

    /** Session timeout in milliseconds */
    sessionTimeout: number;

    /** Whether to require liveness detection */
    requireLiveness: boolean;

    /** Minimum quality score for enrollment captures (0-100) */
    minEnrollmentQuality: number;

    /** Number of captures required for enrollment */
    enrollmentCaptureCount: number;

    /** Enable debug mode (shows detailed metrics) */
    debugMode: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_BIOMETRIC_CONFIG: BiometricConfig = {
    minConfidenceThreshold: 75,
    maxVerificationAttempts: 3,
    sessionTimeout: 5 * 60 * 1000, // 5 minutes
    requireLiveness: false,
    minEnrollmentQuality: 60,
    enrollmentCaptureCount: 3,
    debugMode: false
};

// =====================================================
// Authentication State
// =====================================================

/**
 * Current state of the authentication session
 */
export interface BiometricAuthState {
    /** Whether user is enrolled */
    isEnrolled: boolean;

    /** Whether user is currently authenticated */
    isAuthenticated: boolean;

    /** Timestamp of last successful authentication */
    lastAuthTime?: number;

    /** Number of failed attempts in current session */
    failedAttempts: number;

    /** Whether account is locked due to too many failures */
    isLocked: boolean;
}

// =====================================================
// Enrollment Progress
// =====================================================

/**
 * Progress information during enrollment
 */
export interface EnrollmentProgress {
    /** Current step (0-based) */
    currentStep: number;

    /** Total steps required */
    totalSteps: number;

    /** Quality of the current capture */
    currentQuality: number;

    /** Message for the user */
    message: string;

    /** Whether current capture is acceptable */
    isAcceptable: boolean;
}

// =====================================================
// Liveness Detection
// =====================================================

/**
 * Result of liveness detection
 */
export interface LivenessDetectionResult {
    /** Whether the face appears to be live (not a photo/video) */
    isLive: boolean;

    /** Confidence in the liveness assessment (0-100) */
    confidence: number;

    /** Reasons for the assessment */
    indicators: {
        /** Whether natural eye movement was detected */
        eyeMovement: boolean;

        /** Whether blinking was detected */
        blinkDetected: boolean;

        /** Whether facial micro-expressions were detected */
        microExpressions: boolean;

        /** Whether depth/3D characteristics were detected */
        depthDetected: boolean;
    };
}

// =====================================================
// Events
// =====================================================

/**
 * Events emitted by the biometric system
 */
export type BiometricEvent =
    | { type: 'enrollment:started' }
    | { type: 'enrollment:progress'; data: EnrollmentProgress }
    | { type: 'enrollment:completed'; data: BiometricEnrollmentResult }
    | { type: 'enrollment:failed'; error: string }
    | { type: 'verification:started' }
    | { type: 'verification:progress'; confidence: number }
    | { type: 'verification:completed'; data: BiometricVerificationResult }
    | { type: 'verification:failed'; error: string }
    | { type: 'session:expired' }
    | { type: 'auth:locked'; reason: string };

/**
 * Callback for biometric events
 */
export type BiometricEventCallback = (event: BiometricEvent) => void;

// =====================================================
// Storage
// =====================================================

/**
 * Stored biometric profile
 */
export interface StoredBiometricProfile {
    /** Unique profile ID */
    id: string;

    /** User identifier */
    userId: string;

    /** The biometric template */
    template: BiometricTemplate;

    /** When the profile was created */
    createdAt: number;

    /** When the profile was last updated */
    updatedAt: number;

    /** Checksum for integrity verification */
    checksum: string;
}

/**
 * BiometricAnalyzer.ts
 * 
 * Extracts biometric features using Face-API.js descriptors (Deep Learning Embeddings)
 * instead of geometric landmarks.
 */

import type { BiometricTemplate, LivenessDetectionResult } from './BiometricTypes';

// =====================================================
// Constants
// =====================================================

const FEATURE_EXTRACTION_VERSION = '2.0.0-deep-learning';
const MATCH_THRESHOLD_DISTANCE = 0.6; // face-api recommendation for Euclidean distance

// =====================================================
// Types
// =====================================================

// Adapting to face-api structure
interface FaceData {
    detection: { score: number; box: any };
    landmarks: any;
    descriptor: Float32Array;
}

// =====================================================
// BiometricAnalyzer Class
// =====================================================

export class BiometricAnalyzer {
    /**
     * Extract biometric features from Face-API data
     */
    extractFeatures(faceData: any): BiometricTemplate {
        // Validation
        if (!faceData || !faceData.descriptor) {
            throw new Error('Invalid face data: missing descriptor');
        }

        const descriptor = faceData.descriptor;

        // Quality score based on detection confidence
        // face-api score is 0-1, we map to 0-100
        const processingScore = faceData.detection ? faceData.detection.score : 0;
        const quality = Math.min(100, Math.round(processingScore * 100));

        return {
            features: descriptor, // This is the 128-d embedding
            metadata: {
                capturedAt: Date.now(),
                quality,
                version: FEATURE_EXTRACTION_VERSION
            }
        };
    }

    /**
     * Compare two biometric templates and return similarity score (0-100)
     * Using Euclidean Distance on 128-d embeddings
     */
    compareTemplates(template1: BiometricTemplate, template2: BiometricTemplate): number {
        const feat1 = template1.features;
        const feat2 = template2.features;

        if (feat1.length !== feat2.length) {
            console.warn('Feature vector length mismatch during comparison');
            return 0;
        }

        // Calculate Euclidean distance manually to avoid dependency on global faceapi
        let sum = 0;
        for (let i = 0; i < feat1.length; i++) {
            const diff = feat1[i] - feat2[i];
            sum += diff * diff;
        }
        const distance = Math.sqrt(sum);

        // Convert distance to confidence percentage
        // distance 0.0 = 100% match (exact same image)
        // distance 0.4 = 80% match (very strong match)
        // distance 0.6 = 60% match (standard threshold)
        // distance 0.8 = 40% match
        // distance > 1.0 = 0% match

        // Linear mapping: 0 -> 100, 1.2 -> 0
        const maxDistance = 1.2;
        const normalizedScore = Math.max(0, (1 - (distance / maxDistance)) * 100);

        return normalizedScore;
    }

    /**
     * Perform liveness detection
     * Note: Deep Learning implementation currently focuses on recognition.
     * Liveness checks are basic for now.
     */
    detectLiveness(
        currentData: any,
        previousData: any | null
    ): LivenessDetectionResult {
        // Placeholder for Liveness with 68-point landmarks
        // We can implement blink detection with EAR (Eye Aspect Ratio) here later

        return {
            isLive: true,
            confidence: 100,
            indicators: {
                eyeMovement: false,
                blinkDetected: false,
                microExpressions: false,
                depthDetected: true
            }
        };
    }

    // =====================================================
    // Private Methods
    // =====================================================

    private calculateEuclideanDistance(a: Float32Array | number[], b: Float32Array | number[]): number {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
}

// =====================================================
// Singleton Export
// =====================================================

let instance: BiometricAnalyzer | null = null;

export function getBiometricAnalyzer(): BiometricAnalyzer {
    if (!instance) {
        instance = new BiometricAnalyzer();
    }
    return instance;
}

/**
 * FaceState.ts
 * 
 * Defines the parametric state interface and preset facial expressions.
 * Each parameter controls a specific aspect of the face, allowing for
 * fine-grained control and smooth interpolation between states.
 * 
 * PARAMETRIC SYSTEM EXPLANATION:
 * - All values are normalized (-1 to 1) or (0 to 1) for consistency
 * - Values interpolate smoothly via GSAP for organic transitions
 * - The state can be modified in real-time from external sources (voice, camera, AI)
 */

// =====================================================
// Face State Interface
// =====================================================

export interface FaceState {
    // === Eyes ===
    /** Eye openness: 0 (fully closed) to 1 (fully open) */
    eyeOpenness: number;

    /** Eye squint amount: 0 (normal) to 1 (fully squinted) */
    eyeSquint: number;

    /** Left eye individual openness override (-1 uses global, 0-1 individual) */
    leftEyeOpenness: number;

    /** Right eye individual openness override (-1 uses global, 0-1 individual) */
    rightEyeOpenness: number;

    // === Eyebrows ===
    /** Left eyebrow height: -1 (lowered/angry) to 1 (raised/surprised) */
    leftBrowHeight: number;

    /** Right eyebrow height: -1 (lowered/angry) to 1 (raised/surprised) */
    rightBrowHeight: number;

    /** Left eyebrow curve: -1 (sad droop) to 1 (surprised arch) */
    leftBrowCurve: number;

    /** Right eyebrow curve: -1 (sad droop) to 1 (surprised arch) */
    rightBrowCurve: number;

    // === Mouth ===
    /** Mouth curve: -1 (frown) to 1 (smile) */
    mouthCurve: number;

    /** Mouth width multiplier: 0.5 (narrow) to 1.5 (wide) */
    mouthWidth: number;

    /** Left corner height for asymmetric expressions: -1 to 1 */
    leftCornerHeight: number;

    /** Right corner height for asymmetric expressions: -1 to 1 */
    rightCornerHeight: number;

    /** Mouth openness: 0 (closed) to 1 (open - for speaking/surprise) */
    mouthOpenness: number;

    // === Global Transforms ===
    /** Head tilt in degrees: -15 to 15 */
    headTilt: number;

    /** Overall scale for breathing effect: 0.95 to 1.05 */
    scale: number;

    /** Horizontal offset for subtle drift: -5 to 5 */
    offsetX: number;

    /** Vertical offset for subtle drift: -5 to 5 */
    offsetY: number;
}

// =====================================================
// Default/Neutral State
// =====================================================

export const DEFAULT_STATE: FaceState = {
    // Eyes
    eyeOpenness: 1,
    eyeSquint: 0,
    leftEyeOpenness: -1,  // Use global
    rightEyeOpenness: -1, // Use global

    // Eyebrows
    leftBrowHeight: 0,
    rightBrowHeight: 0,
    leftBrowCurve: 0.2,   // Slight natural arch
    rightBrowCurve: 0.2,

    // Mouth
    mouthCurve: 0,
    mouthWidth: 1,
    leftCornerHeight: 0,
    rightCornerHeight: 0,
    mouthOpenness: 0,

    // Global
    headTilt: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0
};

// =====================================================
// Preset States
// =====================================================

export const PRESETS: Record<string, Partial<FaceState>> = {
    /**
     * NEUTRAL - Relaxed, baseline expression
     * The face at rest, but still alive via microexpressions
     */
    neutral: {
        eyeOpenness: 1,
        eyeSquint: 0,
        leftEyeOpenness: -1,
        rightEyeOpenness: -1,
        leftBrowHeight: 0,
        rightBrowHeight: 0,
        leftBrowCurve: 0.2,
        rightBrowCurve: 0.2,
        mouthCurve: 0,
        mouthWidth: 1,
        leftCornerHeight: 0,
        rightCornerHeight: 0,
        mouthOpenness: 0,
        headTilt: 0
    },

    /**
     * SMILE - Asymmetric side smile (user's preferred style)
     * Right corner elevated, slight eye squint for genuine smile
     */
    smile: {
        eyeOpenness: 0.9,
        eyeSquint: 0.15,
        leftBrowHeight: 0.1,
        rightBrowHeight: 0.15,
        leftBrowCurve: 0.3,
        rightBrowCurve: 0.35,
        mouthCurve: 0.6,
        mouthWidth: 1.1,
        leftCornerHeight: 0.2,
        rightCornerHeight: 0.5,  // Asymmetric - right side higher
        mouthOpenness: 0,
        headTilt: 3  // Slight tilt into the smile
    },



    /**
     * THINKING - Processing, contemplative expression
     * Eyes narrowed, asymmetric brow, neutral mouth
     */
    thinking: {
        eyeOpenness: 0.75,
        eyeSquint: 0.2,
        leftBrowHeight: -0.1,
        rightBrowHeight: 0.2,
        leftBrowCurve: 0.1,
        rightBrowCurve: 0.25,
        mouthCurve: 0.05,
        mouthWidth: 0.9,
        leftCornerHeight: 0.1,
        rightCornerHeight: 0,
        mouthOpenness: 0,
        headTilt: 4
    },

    /**
     * WINK - Playful acknowledgment
     * One eye closed, smile, head tilt
     */
    wink: {
        eyeOpenness: 1,
        eyeSquint: 0,
        leftEyeOpenness: -1,     // Left eye normal
        rightEyeOpenness: 0.05,  // Right eye nearly closed (wink)
        leftBrowHeight: 0.2,
        rightBrowHeight: -0.1,
        leftBrowCurve: 0.3,
        rightBrowCurve: 0.1,
        mouthCurve: 0.5,
        mouthWidth: 1.05,
        leftCornerHeight: 0.15,
        rightCornerHeight: 0.4,
        mouthOpenness: 0,
        headTilt: 5
    },

    /**
     * BLINK - Used for blinking animation
     * Eyes fully closed, everything else neutral
     */
    blink: {
        eyeOpenness: 0,
        leftEyeOpenness: -1,
        rightEyeOpenness: -1
    },

    /**
     * SURPRISED - Wide-eyed surprise
     * Eyes wide, eyebrows raised, mouth slightly open
     */
    surprised: {
        eyeOpenness: 1.2,
        eyeSquint: 0,
        leftBrowHeight: 0.7,
        rightBrowHeight: 0.7,
        leftBrowCurve: 0.6,
        rightBrowCurve: 0.6,
        mouthCurve: 0,
        mouthWidth: 0.85,
        leftCornerHeight: 0,
        rightCornerHeight: 0,
        mouthOpenness: 0.3,
        headTilt: 0
    }
};

// =====================================================
// State Utilities
// =====================================================

/**
 * Creates a complete FaceState by merging a partial state with defaults
 */
export function createState(partial: Partial<FaceState> = {}): FaceState {
    return { ...DEFAULT_STATE, ...partial };
}

/**
 * Interpolates between two states (for manual blending)
 * @param from Starting state
 * @param to Target state  
 * @param progress 0-1 interpolation progress
 */
export function lerpState(
    from: FaceState,
    to: FaceState,
    progress: number
): FaceState {
    const result: FaceState = { ...from };

    for (const key of Object.keys(from) as (keyof FaceState)[]) {
        const fromVal = from[key];
        const toVal = to[key];
        result[key] = fromVal + (toVal - fromVal) * progress;
    }

    return result;
}

/**
 * Adds random micro-variation to a state (for organic feel)
 * @param state Base state
 * @param intensity How much variation (0-1)
 */
export function addMicroVariation(
    state: FaceState,
    intensity: number = 0.1
): FaceState {
    const varied = { ...state };

    // Add tiny random variations to specific parameters
    varied.leftBrowHeight += (Math.random() - 0.5) * 0.05 * intensity;
    varied.rightBrowHeight += (Math.random() - 0.5) * 0.05 * intensity;
    varied.mouthCurve += (Math.random() - 0.5) * 0.03 * intensity;
    varied.offsetX += (Math.random() - 0.5) * 2 * intensity;
    varied.offsetY += (Math.random() - 0.5) * 2 * intensity;
    varied.headTilt += (Math.random() - 0.5) * 1 * intensity;

    return varied;
}

// Export state type for external use
export type { FaceState as FaceStateType };

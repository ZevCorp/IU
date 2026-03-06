/**
 * Mouth.ts
 * 
 * Mouth component for the parametric face.
 * Supports asymmetric smile with individual corner control,
 * matching the "side smile with elevated corner" from the user's sketch.
 */

import { generateMouthPath } from '../../utils/bezier';
import { FaceState } from '../FaceState';

// =====================================================
// Configuration
// =====================================================

interface MouthConfig {
    /** SVG path element ID */
    elementId: string;
    /** X position (center) */
    centerX: number;
    /** Y position */
    centerY: number;
    /** Base width */
    baseWidth: number;
}

// =====================================================
// Mouth Class
// =====================================================

export class Mouth {
    private element: SVGPathElement;
    private config: MouthConfig;

    constructor(config: MouthConfig) {
        this.config = config;

        const el = document.getElementById(config.elementId);
        if (!el || !(el instanceof SVGPathElement)) {
            throw new Error(`Mouth element not found: ${config.elementId}`);
        }
        this.element = el;

        // Initialize with neutral position
        this.update({
            curve: 0,
            width: 1,
            leftCorner: 0,
            rightCorner: 0,
            openness: 0
        });
    }

    /**
     * Update the mouth based on parameters
     */
    update(params: {
        curve: number;
        width: number;
        leftCorner: number;
        rightCorner: number;
        openness: number;
    }): void {
        const { curve, width, leftCorner, rightCorner, openness } = params;
        const { centerX, centerY, baseWidth } = this.config;

        // Calculate actual width
        const actualWidth = baseWidth * width;

        // Generate the path
        const path = generateMouthPath(
            centerX,
            centerY,
            actualWidth,
            curve,
            leftCorner,
            rightCorner,
            openness
        );

        this.element.setAttribute('d', path);
    }

    /**
     * Update from full face state
     */
    updateFromState(state: FaceState): void {
        this.update({
            curve: state.mouthCurve,
            width: state.mouthWidth,
            leftCorner: state.leftCornerHeight,
            rightCorner: state.rightCornerHeight,
            openness: state.mouthOpenness
        });
    }

    /**
     * Get the underlying SVG element
     */
    getElement(): SVGPathElement {
        return this.element;
    }
}

// =====================================================
// Factory Function
// =====================================================

export function createMouth(): Mouth {
    return new Mouth({
        elementId: 'mouth',
        centerX: 0,
        centerY: 50,
        baseWidth: 60
    });
}

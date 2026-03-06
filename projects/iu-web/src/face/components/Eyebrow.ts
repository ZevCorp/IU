/**
 * Eyebrow.ts
 * 
 * Eyebrow component for the parametric face.
 * Renders as a curved arc that responds to height and curve parameters.
 */

import { generateEyebrowPath } from '../../utils/bezier';
import { FaceState } from '../FaceState';

// =====================================================
// Configuration
// =====================================================

interface EyebrowConfig {
    /** SVG path element ID */
    elementId: string;
    /** Which side ('left' | 'right') */
    side: 'left' | 'right';
    /** X offset from center (positive = right) */
    offsetX: number;
    /** Y position */
    baseY: number;
    /** Eyebrow width */
    width: number;
}

// =====================================================
// Eyebrow Class
// =====================================================

export class Eyebrow {
    private element: SVGPathElement;
    private config: EyebrowConfig;

    constructor(config: EyebrowConfig) {
        this.config = config;

        const el = document.getElementById(config.elementId);
        if (!el || !(el instanceof SVGPathElement)) {
            throw new Error(`Eyebrow element not found: ${config.elementId}`);
        }
        this.element = el;

        // Initialize with default path
        this.update({
            height: 0,
            curve: 0.2
        });
    }

    /**
     * Update the eyebrow based on face state parameters
     */
    update(params: { height: number; curve: number }): void {
        const { height, curve } = params;
        const { side, offsetX, baseY, width } = this.config;

        // Calculate actual position based on height parameter
        // Height range: -1 (lowered) to 1 (raised), maps to Y offset
        const heightOffset = height * 15;

        // Generate the path
        const path = generateEyebrowPath(
            offsetX,
            baseY - heightOffset,
            width,
            heightOffset,
            curve,
            side === 'right' // Flip for right eyebrow
        );

        this.element.setAttribute('d', path);
    }

    /**
     * Update from full face state
     */
    updateFromState(state: FaceState): void {
        const isRight = this.config.side === 'right';
        this.update({
            height: isRight ? state.rightBrowHeight : state.leftBrowHeight,
            curve: isRight ? state.rightBrowCurve : state.leftBrowCurve
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

export function createEyebrows(): { left: Eyebrow; right: Eyebrow } {
    const left = new Eyebrow({
        elementId: 'left-eyebrow',
        side: 'left',
        offsetX: -55,  // Left of center
        baseY: -70,    // Above eyes
        width: 45
    });

    const right = new Eyebrow({
        elementId: 'right-eyebrow',
        side: 'right',
        offsetX: 55,   // Right of center
        baseY: -70,
        width: 45
    });

    return { left, right };
}

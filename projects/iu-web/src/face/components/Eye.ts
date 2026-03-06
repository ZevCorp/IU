/**
 * Eye.ts
 * 
 * Eye component for the parametric face.
 * Based on the user's sketch: vertical line with horizontal markers at top/bottom.
 * This creates a minimalist, non-realistic eye representation.
 */

import { generateEyePaths } from '../../utils/bezier';
import { FaceState } from '../FaceState';

// =====================================================
// Configuration
// =====================================================

interface EyeConfig {
    /** Container group ID */
    groupId: string;
    /** Top marker path ID */
    topId: string;
    /** Vertical line path ID */
    lineId: string;
    /** Bottom marker path ID */
    bottomId: string;
    /** Which side ('left' | 'right') */
    side: 'left' | 'right';
    /** X offset from center */
    offsetX: number;
    /** Y position */
    baseY: number;
    /** Width of the horizontal markers */
    markerWidth: number;
}

// =====================================================
// Eye Class
// =====================================================

export class Eye {
    private group: SVGGElement;
    private topPath: SVGPathElement;
    private linePath: SVGPathElement;
    private bottomPath: SVGPathElement;
    private config: EyeConfig;

    // Current state for animation interpolation
    private currentOpenness: number = 1;

    constructor(config: EyeConfig) {
        this.config = config;

        // Get all elements
        const group = document.getElementById(config.groupId);
        const top = document.getElementById(config.topId);
        const line = document.getElementById(config.lineId);
        const bottom = document.getElementById(config.bottomId);

        if (!group || !top || !line || !bottom) {
            throw new Error(`Eye elements not found for: ${config.groupId}`);
        }

        this.group = group as unknown as SVGGElement;
        this.topPath = top as unknown as SVGPathElement;
        this.linePath = line as unknown as SVGPathElement;
        this.bottomPath = bottom as unknown as SVGPathElement;

        // Initialize with default state
        this.update({ openness: 1, squint: 0 });
    }

    /**
     * Update the eye based on parameters
     */
    update(params: { openness: number; squint: number }): void {
        const { openness, squint } = params;
        const { offsetX, baseY, markerWidth } = this.config;

        // Combine openness and squint
        // Squint reduces maximum openness
        const effectiveOpenness = openness * (1 - squint * 0.4);
        this.currentOpenness = effectiveOpenness;

        // Generate the paths
        const paths = generateEyePaths(
            offsetX,
            baseY,
            Math.max(0, effectiveOpenness), // Prevent negative values
            markerWidth
        );

        // Apply paths
        this.topPath.setAttribute('d', paths.top);
        this.linePath.setAttribute('d', paths.line);
        this.bottomPath.setAttribute('d', paths.bottom);

        // Adjust opacity when nearly closed for smoother appearance
        if (effectiveOpenness < 0.15) {
            this.linePath.style.opacity = String(effectiveOpenness / 0.15);
        } else {
            this.linePath.style.opacity = '1';
        }
    }

    /**
     * Update from full face state
     */
    updateFromState(state: FaceState): void {
        const isRight = this.config.side === 'right';

        // Check for individual eye override
        const individualOpenness = isRight
            ? state.rightEyeOpenness
            : state.leftEyeOpenness;

        // If individual is >= 0, use it; otherwise use global
        const openness = individualOpenness >= 0
            ? individualOpenness
            : state.eyeOpenness;

        this.update({
            openness,
            squint: state.eyeSquint
        });
    }

    /**
     * Quick blink animation (returns promise when done)
     * Note: This is a direct animation, not using GSAP (for simplicity)
     * The main animation system uses GSAP for state transitions
     */
    async blink(duration: number = 120): Promise<void> {
        const startOpenness = this.currentOpenness;

        // Close
        this.update({ openness: 0, squint: 0 });

        await new Promise(resolve => setTimeout(resolve, duration));

        // Open
        this.update({ openness: startOpenness, squint: 0 });
    }

    /**
     * Get current openness (for animation interpolation)
     */
    getOpenness(): number {
        return this.currentOpenness;
    }

    /**
     * Get the container group element
     */
    getElement(): SVGGElement {
        return this.group;
    }
}

// =====================================================
// Factory Function
// =====================================================

export function createEyes(): { left: Eye; right: Eye } {
    const left = new Eye({
        groupId: 'left-eye',
        topId: 'left-eye-top',
        lineId: 'left-eye-line',
        bottomId: 'left-eye-bottom',
        side: 'left',
        offsetX: -55,
        baseY: -25,
        markerWidth: 8
    });

    const right = new Eye({
        groupId: 'right-eye',
        topId: 'right-eye-top',
        lineId: 'right-eye-line',
        bottomId: 'right-eye-bottom',
        side: 'right',
        offsetX: 55,
        baseY: -25,
        markerWidth: 8
    });

    return { left, right };
}

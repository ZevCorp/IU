/**
 * bezier.ts
 * 
 * Utilities for generating and manipulating SVG Bézier curves.
 * These functions create path data strings that can be directly
 * applied to SVG path elements.
 */

// =====================================================
// Types
// =====================================================

export interface Point {
    x: number;
    y: number;
}

export interface BezierCurve {
    /** Starting point */
    start: Point;
    /** First control point */
    control1: Point;
    /** Second control point (for cubic) */
    control2?: Point;
    /** End point */
    end: Point;
}

// =====================================================
// Path Generation
// =====================================================

/**
 * Creates a quadratic Bézier curve path string
 * Q command: single control point
 */
export function quadraticBezier(
    start: Point,
    control: Point,
    end: Point
): string {
    return `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
}

/**
 * Creates a cubic Bézier curve path string
 * C command: two control points for more complex curves
 */
export function cubicBezier(
    start: Point,
    control1: Point,
    control2: Point,
    end: Point
): string {
    return `M${start.x},${start.y} C${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`;
}

/**
 * Creates a simple horizontal line path
 */
export function horizontalLine(
    start: Point,
    length: number
): string {
    return `M${start.x},${start.y} L${start.x + length},${start.y}`;
}

/**
 * Creates a simple vertical line path
 */
export function verticalLine(
    start: Point,
    length: number
): string {
    return `M${start.x},${start.y} L${start.x},${start.y + length}`;
}

// =====================================================
// Eyebrow Generation
// =====================================================

/**
 * Generates an eyebrow path based on parameters
 * 
 * @param baseX - Center X position
 * @param baseY - Base Y position
 * @param width - Total width of the eyebrow
 * @param height - Height offset (positive = raised, negative = lowered)
 * @param curve - Curve intensity (-1 = sad, 0 = flat, 1 = arched)
 * @param flip - Whether to flip horizontally (for right eyebrow)
 */
export function generateEyebrowPath(
    baseX: number,
    baseY: number,
    width: number,
    height: number,
    curve: number,
    flip: boolean = false
): string {
    const halfWidth = width / 2;
    const flipMultiplier = flip ? -1 : 1;

    // Start and end points
    const startX = baseX - halfWidth * flipMultiplier;
    const endX = baseX + halfWidth * flipMultiplier;
    const startY = baseY - height * 0.3; // Outer edge slightly lower
    const endY = baseY - height;

    // Control point for the arch
    const controlX = baseX;
    const controlY = baseY - height - (curve * 12); // Curve affects arch height

    return quadraticBezier(
        { x: startX, y: startY },
        { x: controlX, y: controlY },
        { x: endX, y: endY }
    );
}

// =====================================================
// Eye Generation
// =====================================================

/**
 * Generates eye as a simple vertical line
 * Minimalist style - just a clean vertical stroke
 * 
 * @param centerX - Center X position of the eye
 * @param centerY - Center Y position of the eye
 * @param openness - 0 (closed) to 1 (fully open)
 */
export function generateEyePaths(
    centerX: number,
    centerY: number,
    openness: number,
    _markerWidth: number = 8 // kept for compatibility but unused
): { top: string; line: string; bottom: string } {
    // Simple vertical line that shrinks when closing
    const lineHeight = 25 * openness;
    const verticalOffset = lineHeight / 2;

    // Only the vertical line - no horizontal markers
    const line = verticalLine(
        { x: centerX, y: centerY - verticalOffset },
        Math.max(0, lineHeight)
    );

    // Return empty strings for top/bottom (no markers)
    return { top: '', line, bottom: '' };
}

// =====================================================
// Mouth Generation
// =====================================================

/**
 * Generates an asymmetric mouth path
 * 
 * @param centerX - Center X position
 * @param centerY - Center Y position
 * @param width - Total mouth width
 * @param curve - Overall curve (-1 = frown, 0 = neutral, 1 = smile)
 * @param leftCorner - Left corner height offset (-1 to 1)
 * @param rightCorner - Right corner height offset (-1 to 1)
 * @param openness - Mouth openness (0 = closed, 1 = open)
 */
export function generateMouthPath(
    centerX: number,
    centerY: number,
    width: number,
    curve: number,
    leftCorner: number,
    rightCorner: number,
    openness: number = 0
): string {
    const halfWidth = width / 2;

    // Corner positions (curve and individual corner offsets)
    const baseOffset = curve * 15;
    const leftY = centerY - baseOffset - (leftCorner * 8);
    const rightY = centerY - baseOffset - (rightCorner * 8);

    // Start (left corner)
    const start: Point = { x: centerX - halfWidth, y: leftY };

    // End (right corner)
    const end: Point = { x: centerX + halfWidth, y: rightY };

    // Control points for asymmetric curve
    // The curve dips below or rises above the corners based on curve value
    const curveDepth = -curve * 12;
    const midY = centerY + curveDepth;

    // For asymmetric smile, shift control point toward the higher corner
    const asymmetryShift = (rightCorner - leftCorner) * 10;

    const control1: Point = {
        x: centerX - halfWidth * 0.3 + asymmetryShift,
        y: midY
    };

    const control2: Point = {
        x: centerX + halfWidth * 0.3 + asymmetryShift,
        y: midY
    };

    // If mouth is open, we need to create a closed shape
    if (openness > 0.05) {
        const bottomOffset = openness * 15;
        const bottomY = centerY + bottomOffset;

        // Create top curve + bottom curve for open mouth
        const topPath = cubicBezier(start, control1, control2, end);
        const bottomPath = ` Q${centerX},${bottomY} ${start.x},${leftY}`;

        return topPath + bottomPath;
    }

    return cubicBezier(start, control1, control2, end);
}

// =====================================================
// Utility Functions
// =====================================================

/**
 * Linearly interpolate between two values
 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Map a value from one range to another
 */
export function mapRange(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
): number {
    return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

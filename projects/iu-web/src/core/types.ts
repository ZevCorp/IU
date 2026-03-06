/**
 * Core Type Definitions for UI Formalization
 * These types support HRM-compatible grid representation
 */

// ============================================
// Core UI State Types
// ============================================

/**
 * Represents a single interactive element in the UI
 */
export interface UIElement {
    /** Unique identifier (prefer id attribute, fallback to generated) */
    id: string;
    /** CSS selector to locate this element */
    selector: string;
    /** Type of interaction possible */
    type: 'button' | 'link' | 'input' | 'select' | 'checkbox' | 'tab' | 'row';
    /** Visible text/label */
    label: string;
    /** Whether element is currently visible */
    visible: boolean;
    /** Element's bounding box */
    bounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Represents a UI state (a unique configuration of the interface)
 */
export interface UINode {
    /** Unique hash identifying this state */
    id: string;
    /** Human-readable screen identifier */
    screenName: string;
    /** Sub-state identifier (e.g., active tab, modal open) */
    subState?: string;
    /** All interactive elements in this state */
    elements: UIElement[];
    /** Timestamp of discovery */
    discoveredAt: number;
}

/**
 * Represents a transition between UI states
 */
export interface UIEdge {
    /** Source state ID */
    from: string;
    /** Target state ID */
    to: string;
    /** Action that triggers this transition */
    action: UIAction;
    /** How many times this transition has been observed */
    observedCount: number;
}

/**
 * An action that can be performed on the UI
 */
export interface UIAction {
    /** Type of action */
    type: 'click' | 'input' | 'submit' | 'select' | 'navigate';
    /** CSS selector of target element */
    selector: string;
    /** Optional value for input actions */
    value?: string;
    /** Element label for debugging */
    label?: string;
}

// ============================================
// Graph Types
// ============================================

/**
 * Complete UI navigation graph
 */
export interface UIGraph {
    /** All discovered states */
    nodes: Map<string, UINode>;
    /** All discovered transitions */
    edges: UIEdge[];
    /** Graph metadata */
    metadata: {
        version: string;
        createdAt: number;
        updatedAt: number;
        explorationComplete: boolean;
    };
}

/**
 * Serializable version of UIGraph for JSON storage
 */
export interface UIGraphJSON {
    nodes: Array<UINode & { id: string }>;
    edges: UIEdge[];
    metadata: UIGraph['metadata'];
}

// ============================================
// HRM Grid Types (Optimized for HRM inference)
// ============================================

/**
 * Token vocabulary for HRM grid representation
 * Based on maze-hard benchmark format
 */
export enum GridToken {
    WALL = 0,      // No valid transition
    WALKABLE = 1,  // Valid UI state
    CURRENT = 2,   // Starting position
    TARGET = 3     // Goal state
}

/**
 * 2D grid representation of UI graph
 * Designed for HRM sequence-to-sequence processing
 */
export interface UIGrid {
    /** 2D grid array */
    grid: number[][];
    /** Flattened sequence for HRM input */
    sequence: number[];
    /** Grid dimensions */
    width: number;
    height: number;
    /** Position of current state */
    currentPos: [number, number];
    /** Position of target state */
    targetPos: [number, number];
    /** Map from grid position to state ID */
    positionToState: Map<string, string>;  // "row,col" -> stateId
    /** Map from state ID to grid position */
    stateToPosition: Map<string, [number, number]>;
}

/**
 * HRM inference request
 */
export interface HRMRequest {
    /** Type of request */
    type: 'solve';
    /** Flattened grid sequence */
    grid: number[];
    /** Grid dimensions for reconstruction */
    width: number;
    height: number;
}

/**
 * HRM inference response
 */
export interface HRMResponse {
    /** Optimal path as grid positions */
    path: [number, number][];
    /** Whether a valid path was found */
    success: boolean;
    /** Inference time in milliseconds */
    inferenceTimeMs?: number;
}

// ============================================
// Navigation Types
// ============================================

/**
 * Navigation goal specification
 */
export interface NavigationGoal {
    /** Target by screen name */
    screenName?: string;
    /** Target by element selector */
    elementSelector?: string;
    /** Target by element label */
    elementLabel?: string;
    /** Target by state ID */
    stateId?: string;
}

/**
 * Navigation result
 */
export interface NavigationResult {
    /** Whether target is reachable */
    reachable: boolean;
    /** Sequence of actions to reach target */
    actions: UIAction[];
    /** Path through states */
    statePath: string[];
    /** Source used for pathfinding */
    source: 'hrm' | 'bfs' | 'manual';
    /** Error message if not reachable */
    error?: string;
}

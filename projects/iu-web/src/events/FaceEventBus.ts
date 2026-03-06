/**
 * FaceEventBus.ts
 * 
 * Event-driven communication system for the face.
 * Designed for future integration with:
 * - Voice detection (microphone input)
 * - Camera (face tracking, gesture recognition)
 * - AI processing (thought generation, intent detection)
 * - Cross-device communication (phone ↔ computer via QR)
 */

// =====================================================
// Event Types
// =====================================================

export type FaceEventType =
    // State Events
    | 'state:changed'
    | 'state:transition:start'
    | 'state:transition:end'

    // Animation Events
    | 'animation:blink'
    | 'animation:micro'
    | 'animation:idle'

    // Voice Events (future)
    | 'voice:detected'
    | 'voice:transcribed'
    | 'voice:silence'

    // Camera Events (future)
    | 'camera:userLooking'
    | 'camera:userAway'
    | 'camera:gesture:nod'
    | 'camera:gesture:shake'
    | 'camera:gesture:confirmed'

    // AI Events (future)
    | 'ai:thinking:start'
    | 'ai:thinking:proposal'
    | 'ai:thinking:complete'
    | 'ai:action:execute'

    // System Events
    | 'system:ready'
    | 'system:error'
    | 'system:connected'
    | 'system:disconnected';

// =====================================================
// Event Payload Types
// =====================================================

export interface FaceEventPayloads {
    'state:changed': { stateName: string; state: unknown };
    'state:transition:start': { from: string; to: string; duration: number };
    'state:transition:end': { to: string };

    'animation:blink': { eye: 'left' | 'right' | 'both' };
    'animation:micro': { type: string; intensity: number };
    'animation:idle': { duration: number };

    'voice:detected': { level: number };
    'voice:transcribed': { text: string; confidence: number };
    'voice:silence': { duration: number };

    'camera:userLooking': { confidence: number };
    'camera:userAway': { duration: number };
    'camera:gesture:nod': { confidence: number };
    'camera:gesture:shake': { confidence: number };
    'camera:gesture:confirmed': { action: string };

    'ai:thinking:start': { context: string };
    'ai:thinking:proposal': { proposals: string[] };
    'ai:thinking:complete': { result: string };
    'ai:action:execute': { action: string; params: unknown };

    'system:ready': Record<string, never>;
    'system:error': { error: Error; context: string };
    'system:connected': { device: string };
    'system:disconnected': { device: string };
}

// =====================================================
// Event Callback Type
// =====================================================

type EventCallback<T extends FaceEventType> = (
    payload: FaceEventPayloads[T]
) => void;

// =====================================================
// FaceEventBus Class
// =====================================================

class FaceEventBus {
    private listeners: Map<FaceEventType, Set<EventCallback<FaceEventType>>>;
    private history: Array<{ type: FaceEventType; payload: unknown; timestamp: number }>;
    private maxHistory: number;

    constructor(maxHistory: number = 100) {
        this.listeners = new Map();
        this.history = [];
        this.maxHistory = maxHistory;
    }

    /**
     * Subscribe to an event type
     */
    on<T extends FaceEventType>(
        type: T,
        callback: EventCallback<T>
    ): () => void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }

        const callbacks = this.listeners.get(type)!;
        callbacks.add(callback as EventCallback<FaceEventType>);

        // Return unsubscribe function
        return () => {
            callbacks.delete(callback as EventCallback<FaceEventType>);
        };
    }

    /**
     * Subscribe to an event type (one-time)
     */
    once<T extends FaceEventType>(
        type: T,
        callback: EventCallback<T>
    ): () => void {
        const unsubscribe = this.on(type, (payload) => {
            unsubscribe();
            callback(payload as FaceEventPayloads[T]);
        });
        return unsubscribe;
    }

    /**
     * Emit an event
     */
    emit<T extends FaceEventType>(
        type: T,
        payload: FaceEventPayloads[T]
    ): void {
        // Record in history
        this.history.push({
            type,
            payload,
            timestamp: Date.now()
        });

        // Trim history if needed
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }

        // Notify listeners
        const callbacks = this.listeners.get(type);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(payload as FaceEventPayloads[FaceEventType]);
                } catch (error) {
                    console.error(`[FaceEventBus] Error in listener for ${type}:`, error);
                }
            });
        }
    }

    /**
     * Remove all listeners for an event type
     */
    off(type: FaceEventType): void {
        this.listeners.delete(type);
    }

    /**
     * Remove all listeners
     */
    clear(): void {
        this.listeners.clear();
    }

    /**
     * Get event history (for debugging/replay)
     */
    getHistory(): ReadonlyArray<{ type: FaceEventType; payload: unknown; timestamp: number }> {
        return this.history;
    }

    /**
     * Get recent history of a specific type
     */
    getRecentEvents<T extends FaceEventType>(
        type: T,
        count: number = 10
    ): Array<{ payload: FaceEventPayloads[T]; timestamp: number }> {
        return this.history
            .filter(e => e.type === type)
            .slice(-count)
            .map(e => ({
                payload: e.payload as FaceEventPayloads[T],
                timestamp: e.timestamp
            }));
    }
}

// =====================================================
// Singleton Export
// =====================================================

export const faceEventBus = new FaceEventBus();

// Also export class for testing/multiple instances
export { FaceEventBus };

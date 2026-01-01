/**
 * SharedState.ts
 * 
 * Manages shared state between connected devices.
 * Synchronizes theme, active preset, and other shared properties
 * via WebSocket through DeviceSync.
 */

import { getDeviceSync } from './DeviceSync';

// =====================================================
// Types
// =====================================================

export interface SharedStateData {
    /** Current theme: 'dark' or 'light' */
    theme: 'dark' | 'light';
    /** Currently active face preset */
    activePreset: string;
    /** Microexpressions enabled */
    microExpressionsEnabled: boolean;
    /** Timestamp of last update */
    lastUpdated: number;
}

type SharedStateKey = keyof Omit<SharedStateData, 'lastUpdated'>;

interface StateChangeEvent {
    state: SharedStateData;
    key: SharedStateKey;
    isRemote: boolean;
}

// =====================================================
// SharedState Class
// =====================================================

export class SharedState {
    private state: SharedStateData;
    private listeners: Map<string, Set<(event: StateChangeEvent) => void>> = new Map();
    private initialized = false;

    constructor() {
        // Default state
        this.state = {
            theme: 'dark',
            activePreset: 'neutral',
            microExpressionsEnabled: true,
            lastUpdated: Date.now()
        };
    }

    /**
     * Initialize shared state and connect to DeviceSync
     */
    init(): void {
        if (this.initialized) return;

        const deviceSync = getDeviceSync();

        // Listen for shared state messages from other devices
        deviceSync.setOnSharedStateChange((newState: Partial<SharedStateData>) => {
            console.log('[SharedState] Received remote state:', newState);
            this.applyRemoteState(newState);
        });

        this.initialized = true;
        console.log('[SharedState] Initialized');
    }

    /**
     * Get the current state
     */
    getState(): SharedStateData {
        return { ...this.state };
    }

    /**
     * Get a specific property
     */
    get<K extends SharedStateKey>(key: K): SharedStateData[K] {
        return this.state[key];
    }

    /**
     * Set a specific property and broadcast to other devices
     * @param broadcast - If false, only updates locally without broadcasting (used for receiving transfers)
     */
    set<K extends SharedStateKey>(key: K, value: SharedStateData[K], broadcast: boolean = true): void {
        if (this.state[key] === value) return;

        this.state[key] = value;
        this.state.lastUpdated = Date.now();

        // Only notify local listeners if NOT broadcasting (to avoid double-triggering)
        // When broadcasting, the change is considered "local" and UI was already updated by the caller
        if (!broadcast) {
            this.notifyListeners(key, false);
        }

        // Broadcast to other devices
        if (broadcast) {
            this.broadcast({ [key]: value });
        }

        console.log(`[SharedState] Set ${key}:`, value, broadcast ? '(broadcast)' : '(local only)');
    }

    /**
     * Apply state received from another device
     */
    private applyRemoteState(newState: Partial<SharedStateData>): void {
        const keys = Object.keys(newState) as (keyof SharedStateData)[];

        for (const key of keys) {
            if (key === 'lastUpdated') continue;
            const value = newState[key];
            if (value !== undefined && this.state[key] !== value) {
                (this.state as any)[key] = value;
                this.state.lastUpdated = Date.now();
                // Notify listeners that this is a REMOTE change - UI should update
                this.notifyListeners(key as SharedStateKey, true);
            }
        }
    }

    /**
     * Broadcast state change to other devices
     */
    private broadcast(partialState: Partial<SharedStateData>): void {
        const deviceSync = getDeviceSync();
        deviceSync.broadcastSharedState(partialState);
    }

    /**
     * Subscribe to state changes
     * @param key - Property to listen to, or '*' for all changes
     * @param callback - Function to call when state changes. Receives event with isRemote flag.
     *                   isRemote=true means UI should update to reflect the change.
     *                   isRemote=false means the change came from local action (transfer receive).
     * @returns Unsubscribe function
     */
    subscribe(key: SharedStateKey | '*', callback: (event: StateChangeEvent) => void): () => void {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key)!.add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(key)?.delete(callback);
        };
    }

    /**
     * Notify listeners of a state change
     */
    private notifyListeners(key: SharedStateKey, isRemote: boolean): void {
        const event: StateChangeEvent = { state: this.state, key, isRemote };

        // Notify specific key listeners
        this.listeners.get(key)?.forEach(cb => cb(event));
        // Notify wildcard listeners
        this.listeners.get('*')?.forEach(cb => cb(event));
    }
}

// =====================================================
// Singleton Export
// =====================================================

let sharedStateInstance: SharedState | null = null;

export function getSharedState(): SharedState {
    if (!sharedStateInstance) {
        sharedStateInstance = new SharedState();
    }
    return sharedStateInstance;
}

export function initSharedState(): SharedState {
    const sharedState = getSharedState();
    sharedState.init();
    return sharedState;
}

/**
 * SharedState.ts
 * 
 * Simple shared state between devices via WebSocket.
 * Changes sync automatically - no dependency on face transfer.
 */

import { getDeviceSync } from './DeviceSync';

// =====================================================
// Types
// =====================================================

export interface SharedStateData {
    theme: 'dark' | 'light';
    activePreset: string;
    microExpressionsEnabled: boolean;
}

type StateKey = keyof SharedStateData;
type RemoteChangeCallback<K extends StateKey> = (value: SharedStateData[K]) => void;

// =====================================================
// SharedState Class
// =====================================================

export class SharedState {
    private state: SharedStateData = {
        theme: 'dark',
        activePreset: 'neutral',
        microExpressionsEnabled: true
    };

    private remoteListeners: Map<StateKey, Set<RemoteChangeCallback<any>>> = new Map();
    private initialized = false;

    /**
     * Initialize - connect to DeviceSync for remote changes
     */
    init(): void {
        if (this.initialized) return;

        getDeviceSync().setOnSharedStateChange((data: Partial<SharedStateData>) => {
            // Apply each changed key and notify listeners
            for (const key of Object.keys(data) as StateKey[]) {
                const value = data[key];
                if (value !== undefined && this.state[key] !== value) {
                    (this.state as any)[key] = value;
                    console.log(`[SharedState] Remote change: ${key} = ${value}`);
                    this.notifyRemote(key, value);
                }
            }
        });

        this.initialized = true;
        console.log('[SharedState] Initialized');
    }

    /**
     * Get current value
     */
    get<K extends StateKey>(key: K): SharedStateData[K] {
        return this.state[key];
    }

    /**
     * Set value and broadcast to other devices
     */
    set<K extends StateKey>(key: K, value: SharedStateData[K]): void {
        if (this.state[key] === value) return;

        this.state[key] = value;
        console.log(`[SharedState] Local change: ${key} = ${value}`);

        // Broadcast to other devices
        getDeviceSync().broadcastSharedState({ [key]: value });
    }

    /**
     * Listen for REMOTE changes only (from other devices)
     * Use this to update UI when remote device makes a change
     */
    onRemoteChange<K extends StateKey>(key: K, callback: RemoteChangeCallback<K>): () => void {
        if (!this.remoteListeners.has(key)) {
            this.remoteListeners.set(key, new Set());
        }
        this.remoteListeners.get(key)!.add(callback);

        return () => this.remoteListeners.get(key)?.delete(callback);
    }

    private notifyRemote<K extends StateKey>(key: K, value: SharedStateData[K]): void {
        this.remoteListeners.get(key)?.forEach(cb => cb(value));
    }
}

// =====================================================
// Singleton
// =====================================================

let instance: SharedState | null = null;

export function getSharedState(): SharedState {
    if (!instance) instance = new SharedState();
    return instance;
}

export function initSharedState(): SharedState {
    const s = getSharedState();
    s.init();
    return s;
}

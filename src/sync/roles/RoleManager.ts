/**
 * Role Manager
 * Handles negotiation of device roles (Main vs Display)
 * to ensure only one device listens/looks.
 */

import { getSharedState } from '../../sync/SharedState';

export enum DeviceRole {
    MAIN = 'main',      // Has eyes & ears (processes inputs)
    DISPLAY = 'display' // Only shows face/output
}

class RoleManager {
    private currentRole: DeviceRole = DeviceRole.DISPLAY;
    private deviceId: string;
    private listeners: ((role: DeviceRole) => void)[] = [];

    constructor() {
        this.deviceId = this.generateDeviceId();
        this.initializeNetworkListeners();
    }

    private generateDeviceId(): string {
        let id = localStorage.getItem('ds_device_id');
        if (!id) {
            id = `device_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('ds_device_id', id);
        }
        return id;
    }

    private initializeNetworkListeners() {
        // Listen for changes in who the "main" device is
        const sharedState = getSharedState();

        // Initial check
        this.checkIfMain(sharedState.get('mainDeviceId') as string);

        sharedState.onRemoteChange('mainDeviceId', (mainId) => {
            console.log(`[RoleManager] Main device changed to: ${mainId}`);
            this.checkIfMain(mainId);
        });
    }

    private checkIfMain(mainId: string | null) {
        const previousRole = this.currentRole;

        if (mainId === this.deviceId) {
            this.currentRole = DeviceRole.MAIN;
        } else {
            this.currentRole = DeviceRole.DISPLAY;
        }

        if (previousRole !== this.currentRole) {
            console.log(`[RoleManager] Role switched to: ${this.currentRole}`);
            this.notifyListeners();
        }
    }

    public claimMainRole() {
        console.log('[RoleManager] Claiming MAIN role');
        const sharedState = getSharedState();
        sharedState.set('mainDeviceId', this.deviceId);
        this.currentRole = DeviceRole.MAIN;
        this.notifyListeners();
    }

    public getRole(): DeviceRole {
        return this.currentRole;
    }

    public isMain(): boolean {
        return this.currentRole === DeviceRole.MAIN;
    }

    public onRoleChange(callback: (role: DeviceRole) => void) {
        this.listeners.push(callback);
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb(this.currentRole));
    }
}

// Singleton
let instance: RoleManager | null = null;

export function getRoleManager(): RoleManager {
    if (!instance) instance = new RoleManager();
    return instance;
}

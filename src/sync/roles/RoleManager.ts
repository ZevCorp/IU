/**
 * Role Manager (Simplified)
 * Mac = MAIN (always executes), Phone = INPUT (sends commands, displays face).
 * No complex negotiation — just a flag based on device type.
 */

export enum DeviceRole {
    MAIN = 'main',      // Executes actions, processes inputs
    INPUT = 'input'     // Sends commands, displays face
}

class RoleManager {
    private currentRole: DeviceRole;

    constructor() {
        // Desktop/Electron = MAIN, everything else = INPUT
        this.currentRole = this.detectRole();
    }

    private detectRole(): DeviceRole {
        // In Electron (desktop), we're always MAIN
        // @ts-ignore
        if (typeof window !== 'undefined' && window.iuOS) {
            return DeviceRole.MAIN;
        }
        // In a browser (phone client), we're INPUT
        return DeviceRole.INPUT;
    }

    public getRole(): DeviceRole {
        return this.currentRole;
    }

    public isMain(): boolean {
        return this.currentRole === DeviceRole.MAIN;
    }

    public isInput(): boolean {
        return this.currentRole === DeviceRole.INPUT;
    }
}

// Singleton
let instance: RoleManager | null = null;

export function getRoleManager(): RoleManager {
    if (!instance) instance = new RoleManager();
    return instance;
}

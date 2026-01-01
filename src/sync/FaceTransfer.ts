/**
 * FaceTransfer.ts
 * 
 * Handles the swipe gesture and animation for transferring the face
 * between devices. The face slides out of one screen and into another
 * in real-time.
 */

import gsap from 'gsap';
import { getDeviceSync, DeviceSync, TransferDirection } from './DeviceSync';
import { FaceState } from '../face/FaceState';
import { faceEventBus } from '../events/FaceEventBus';

// =====================================================
// Configuration
// =====================================================

interface TransferConfig {
    /** Minimum swipe distance to trigger transfer (pixels) */
    minSwipeDistance: number;
    /** Minimum velocity to trigger transfer */
    minSwipeVelocity: number;
    /** Animation duration for face slide (seconds) */
    slideDuration: number;
    /** Edge threshold for starting swipe (pixels from edge) */
    edgeThreshold: number;
}

const DEFAULT_CONFIG: TransferConfig = {
    minSwipeDistance: 150,
    minSwipeVelocity: 0.5,
    slideDuration: 0.4,
    edgeThreshold: 100
};

// =====================================================
// FaceTransfer Class
// =====================================================

export class FaceTransfer {
    private deviceSync: DeviceSync;
    private config: TransferConfig;
    private faceContainer: HTMLElement | null = null;
    private faceGroup: SVGGElement | null = null;

    // Gesture tracking
    private isTracking: boolean = false;
    private startX: number = 0;
    private startY: number = 0;
    private currentX: number = 0;
    private lastX: number = 0;
    private lastTime: number = 0;
    private velocity: number = 0;

    // Transfer state
    private isTransferring: boolean = false;
    private faceVisible: boolean = true;

    // Callbacks
    private getCurrentState: (() => FaceState) | null = null;
    private onFaceHidden: (() => void) | null = null;
    private onFaceShown: ((state: FaceState) => void) | null = null;

    constructor(config: Partial<TransferConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.deviceSync = getDeviceSync();
    }

    /**
     * Initialize the transfer system
     */
    init(
        faceContainer: HTMLElement,
        faceGroup: SVGGElement,
        getCurrentState: () => FaceState
    ): void {
        this.faceContainer = faceContainer;
        this.faceGroup = faceGroup;
        this.getCurrentState = getCurrentState;

        // Set up touch/mouse events
        this.setupGestureListeners();

        // Listen for incoming transfers
        this.deviceSync.setOnFaceReceived((state, direction) => {
            this.receiveFace(state, direction);
        });

        console.log('[FaceTransfer] Initialized');
    }

    // =====================================================
    // Gesture Handling
    // =====================================================

    private setupGestureListeners(): void {
        if (!this.faceContainer) return;

        // Mouse events
        this.faceContainer.addEventListener('mousedown', this.handlePointerDown.bind(this));
        window.addEventListener('mousemove', this.handlePointerMove.bind(this));
        window.addEventListener('mouseup', this.handlePointerUp.bind(this));

        // Touch events
        this.faceContainer.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        window.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        window.addEventListener('touchend', this.handleTouchEnd.bind(this));
    }

    private handlePointerDown(e: MouseEvent): void {
        if (this.isTransferring || !this.faceVisible) return;

        this.startTracking(e.clientX, e.clientY);
    }

    private handlePointerMove(e: MouseEvent): void {
        if (!this.isTracking) return;

        this.updateTracking(e.clientX, e.clientY);
    }

    private handlePointerUp(): void {
        if (!this.isTracking) return;

        this.endTracking();
    }

    private handleTouchStart(e: TouchEvent): void {
        if (this.isTransferring || !this.faceVisible) return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        this.startTracking(touch.clientX, touch.clientY);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.isTracking) return;
        if (e.touches.length !== 1) return;

        e.preventDefault();
        const touch = e.touches[0];
        this.updateTracking(touch.clientX, touch.clientY);
    }

    private handleTouchEnd(): void {
        if (!this.isTracking) return;

        this.endTracking();
    }

    private startTracking(x: number, y: number): void {
        this.isTracking = true;
        this.startX = x;
        this.startY = y;
        this.currentX = x;
        this.lastX = x;
        this.lastTime = performance.now();
        this.velocity = 0;

        // Add grabbing cursor
        if (this.faceContainer) {
            this.faceContainer.style.cursor = 'grabbing';
        }
    }

    private updateTracking(x: number, _y: number): void {
        const now = performance.now();
        const dt = now - this.lastTime;

        if (dt > 0) {
            this.velocity = (x - this.lastX) / dt;
        }

        this.currentX = x;
        this.lastX = x;
        this.lastTime = now;

        // Calculate drag offset
        const deltaX = x - this.startX;

        // Apply visual feedback (move the face)
        this.applyDragOffset(deltaX);

        // Update transfer progress
        const screenWidth = window.innerWidth;
        const progress = Math.abs(deltaX) / (screenWidth * 0.5);
        this.deviceSync.updateTransferProgress(Math.min(progress, 1));
    }

    private endTracking(): void {
        this.isTracking = false;

        // Reset cursor
        if (this.faceContainer) {
            this.faceContainer.style.cursor = '';
        }

        const deltaX = this.currentX - this.startX;
        const absDistance = Math.abs(deltaX);
        const absVelocity = Math.abs(this.velocity);

        // Check if we should transfer
        const shouldTransfer =
            absDistance > this.config.minSwipeDistance ||
            absVelocity > this.config.minSwipeVelocity;

        if (shouldTransfer && this.getCurrentState) {
            const direction: TransferDirection = deltaX > 0 ? 'right' : 'left';
            this.sendFace(direction);
        } else {
            // Snap back
            this.snapBack();
            this.deviceSync.cancelTransfer();
        }
    }

    private applyDragOffset(offsetX: number): void {
        if (!this.faceGroup) return;

        // Apply offset to the face group
        // The face group is already translated, so we adjust
        const baseTransform = 'translate(200, 250)';
        this.faceGroup.setAttribute('transform', `${baseTransform} translate(${offsetX}, 0)`);

        // Add opacity fade as it moves off screen
        const screenWidth = window.innerWidth;
        const progress = Math.abs(offsetX) / (screenWidth * 0.4);
        const opacity = Math.max(0.2, 1 - progress * 0.8);
        this.faceGroup.style.opacity = String(opacity);
    }

    private snapBack(): void {
        if (!this.faceGroup) return;

        gsap.to(this.faceGroup, {
            attr: { transform: 'translate(200, 250)' },
            opacity: 1,
            duration: 0.3,
            ease: 'power2.out'
        });
    }

    // =====================================================
    // Transfer Animation
    // =====================================================

    /**
     * Send the face to another device
     */
    sendFace(direction: TransferDirection): void {
        if (!this.faceGroup || !this.getCurrentState) return;

        this.isTransferring = true;
        const state = this.getCurrentState();

        // Calculate exit position
        const screenWidth = window.innerWidth;
        const exitX = direction === 'right' ? screenWidth : -screenWidth;

        // Animate face sliding out
        gsap.to(this.faceGroup, {
            attr: { transform: `translate(${200 + exitX}, 250)` },
            opacity: 0,
            duration: this.config.slideDuration,
            ease: 'power2.in',
            onComplete: () => {
                this.faceVisible = false;
                this.isTransferring = false;

                // Notify device sync
                this.deviceSync.startTransfer(direction, state);
                this.deviceSync.completeTransfer();

                // Trigger callback
                if (this.onFaceHidden) {
                    this.onFaceHidden();
                }

                faceEventBus.emit('state:changed', { stateName: 'transferred', state });
            }
        });
    }

    /**
     * Receive the face from another device
     */
    private receiveFace(state: FaceState, direction: TransferDirection): void {
        if (!this.faceGroup) return;

        this.isTransferring = true;

        // Calculate entry position (opposite of direction)
        const screenWidth = window.innerWidth;
        const entryX = direction === 'right' ? -screenWidth : screenWidth;

        // Set initial position off-screen
        this.faceGroup.setAttribute('transform', `translate(${200 + entryX}, 250)`);
        this.faceGroup.style.opacity = '0';

        // Animate face sliding in
        gsap.to(this.faceGroup, {
            attr: { transform: 'translate(200, 250)' },
            opacity: 1,
            duration: this.config.slideDuration,
            ease: 'power2.out',
            onComplete: () => {
                this.faceVisible = true;
                this.isTransferring = false;

                // Trigger callback
                if (this.onFaceShown) {
                    this.onFaceShown(state);
                }
            }
        });
    }

    /**
     * Manually show the face (if hidden)
     */
    showFace(): void {
        if (this.faceVisible || !this.faceGroup) return;

        this.faceGroup.setAttribute('transform', 'translate(200, 250)');
        this.faceGroup.style.opacity = '1';
        this.faceVisible = true;
    }

    /**
     * Immediately hide the face (for initial state)
     */
    hideImmediate(): void {
        if (!this.faceGroup) return;
        this.faceGroup.style.opacity = '0';
        this.faceVisible = false;
        // Move it off-screen to prevent interaction
        this.faceGroup.setAttribute('transform', 'translate(-1000, 250)');
    }

    /**
     * Check if face is currently visible
     */
    isFaceVisible(): boolean {
        return this.faceVisible;
    }

    // =====================================================
    // Callbacks
    // =====================================================

    setOnFaceHidden(callback: () => void): void {
        this.onFaceHidden = callback;
    }

    setOnFaceShown(callback: (state: FaceState) => void): void {
        this.onFaceShown = callback;
    }

    // =====================================================
    // Cleanup
    // =====================================================

    destroy(): void {
        if (this.faceContainer) {
            this.faceContainer.removeEventListener('mousedown', this.handlePointerDown.bind(this));
            this.faceContainer.removeEventListener('touchstart', this.handleTouchStart.bind(this));
        }
        window.removeEventListener('mousemove', this.handlePointerMove.bind(this));
        window.removeEventListener('mouseup', this.handlePointerUp.bind(this));
        window.removeEventListener('touchmove', this.handleTouchMove.bind(this));
        window.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    }
}

// =====================================================
// Export
// =====================================================

let faceTransferInstance: FaceTransfer | null = null;

export function getFaceTransfer(): FaceTransfer {
    if (!faceTransferInstance) {
        faceTransferInstance = new FaceTransfer();
    }
    return faceTransferInstance;
}

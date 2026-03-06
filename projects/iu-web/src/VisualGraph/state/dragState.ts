// Synchronous drag state - not React, just a simple flag
// This bypasses React's async state updates so camera controls 
// can be disabled immediately when drag starts

export const dragState = {
    isDragging: false,
    onMove: null as ((x: number, y: number) => void) | null,
    cameraControls: null as any,
    activePointerId: -1,
    startTime: 0,

    // Set camera controls reference
    setCameraControls(controls: any) {
        this.cameraControls = controls;
    },

    // Block camera controls during drag by intercepting events
    startDrag(pointerId: number, onMove: (x: number, y: number) => void) {
        this.isDragging = true;
        this.onMove = onMove;
        this.activePointerId = pointerId;
        this.startTime = Date.now();

        // SYNCHRONOUSLY disconnect camera controls
        if (this.cameraControls) {
            this.cameraControls.disconnect();
            console.log('Camera SYNC disconnected');
        }

        // Add capture-phase listener to block any remaining events
        document.addEventListener('pointermove', this.handlePointerMove, true);
        document.addEventListener('pointerup', this.handlePointerUp, true);
    },

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.onMove = null;
        this.activePointerId = -1;

        // SYNCHRONOUSLY reconnect camera controls
        if (this.cameraControls) {
            const canvas = document.querySelector('canvas');
            if (canvas) {
                this.cameraControls.connect(canvas);
                console.log('Camera SYNC reconnected');
            }
        }

        document.removeEventListener('pointermove', this.handlePointerMove, true);
        document.removeEventListener('pointerup', this.handlePointerUp, true);
    },

    handlePointerMove(e: PointerEvent) {
        if (dragState.isDragging && e.pointerId === dragState.activePointerId) {
            e.stopPropagation();
            e.preventDefault();
            if (dragState.onMove) {
                dragState.onMove(e.clientX, e.clientY);
            }
        }
    },

    handlePointerUp(e: PointerEvent) {
        // Only end drag if it's the same pointer AND at least 50ms has passed
        if (dragState.isDragging &&
            e.pointerId === dragState.activePointerId &&
            Date.now() - dragState.startTime > 50) {
            e.stopPropagation();
            dragState.endDrag();
        }
    }
};

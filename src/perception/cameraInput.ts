// Camera Input Module
// Accesses webcam and extracts frames at low frequency (no UI rendering)

export interface CameraInput {
    start(): Promise<void>;
    stop(): void;
    onFrame(callback: (imageData: ImageData) => void): () => void;
    isActive(): boolean;
}

export function createCameraInput(fps: number = 5): CameraInput {
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let intervalId: number | null = null;
    let active = false;

    const frameCallbacks = new Set<(imageData: ImageData) => void>();

    const captureFrame = () => {
        if (!video || !canvas || !ctx || !active) return;

        // Draw current video frame to offscreen canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Extract image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Notify all subscribers
        frameCallbacks.forEach(cb => cb(imageData));
    };

    return {
        async start(): Promise<void> {
            if (active) return;

            try {
                // Request camera access
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 320, height: 240, facingMode: 'user' }
                });

                // Create hidden video element
                video = document.createElement('video');
                video.srcObject = stream;
                video.autoplay = true;
                video.playsInline = true;

                // Wait for video to be ready
                await new Promise<void>((resolve, reject) => {
                    video!.onloadedmetadata = () => {
                        video!.play().then(resolve).catch(reject);
                    };
                    video!.onerror = () => reject(new Error('Video failed to load'));
                });

                // Create offscreen canvas for frame extraction
                canvas = new OffscreenCanvas(320, 240);
                ctx = canvas.getContext('2d');

                if (!ctx) {
                    throw new Error('Failed to get canvas context');
                }

                active = true;

                // Start frame capture at specified FPS
                const intervalMs = 1000 / fps;
                intervalId = window.setInterval(captureFrame, intervalMs);

                console.log(`[CameraInput] Started at ${fps} FPS`);
            } catch (error) {
                console.error('[CameraInput] Failed to start:', error);
                this.stop();
                throw error;
            }
        },

        stop(): void {
            active = false;

            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }

            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }

            if (video) {
                video.srcObject = null;
                video = null;
            }

            canvas = null;
            ctx = null;

            console.log('[CameraInput] Stopped');
        },

        onFrame(callback: (imageData: ImageData) => void): () => void {
            frameCallbacks.add(callback);
            return () => frameCallbacks.delete(callback);
        },

        isActive(): boolean {
            return active;
        }
    };
}

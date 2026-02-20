/**
 * Audio Loop & Buffer
 * Records audio continuously in a rolling buffer (max 40s)
 * Returns the recorded Blob when requested.
 */

import { getRoleManager, DeviceRole } from '../../sync/roles/RoleManager';

export class AudioLoop {
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private isRecording = false;
    private maxDurationMs = 40000; // 40 seconds
    private chunkIntervalMs = 1000; // 1 second chunks
    private intervalParams: any = null;

    constructor() {
        // Only start recording if we are the MAIN device
        const roleManager = getRoleManager();

        roleManager.onRoleChange((role) => {
            if (role === DeviceRole.MAIN) {
                this.start();
            } else {
                this.stop();
            }
        });

        // Initial check
        if (roleManager.isMain()) {
            this.start();
        }
    }

    public async start() {
        if (this.isRecording) return;

        try {
            console.log('[AudioLoop] Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    this.trimBuffer();
                }
            };

            this.mediaRecorder.start(); // Start recording
            this.isRecording = true;
            console.log('[AudioLoop] Started rolling recording');

            // Request data every second to keep chunks granular
            this.intervalParams = setInterval(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.requestData();
                }
            }, this.chunkIntervalMs);

        } catch (error) {
            console.error('[AudioLoop] Error accessing microphone:', error);
        }
    }

    public stop() {
        if (!this.isRecording) return;

        if (this.intervalParams) clearInterval(this.intervalParams);

        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }

        this.isRecording = false;
        this.audioChunks = []; // Clear buffer
        console.log('[AudioLoop] Stopped recording');
    }

    /**
     * Keep only the last ~40 seconds of chunks
     */
    private trimBuffer() {
        // Estimate: 1 chunk = 1 second (due to setInterval)
        // Keep last 40 chunks
        const maxChunks = this.maxDurationMs / this.chunkIntervalMs;
        if (this.audioChunks.length > maxChunks) {
            this.audioChunks = this.audioChunks.slice(-maxChunks);
        }
    }

    /**
     * Get the full buffer (last 40s) as a single Blob
     */
    public getAudioBuffer(): Blob {
        return new Blob(this.audioChunks, { type: 'audio/webm' });
    }
}

// Singleton instance
let instance: AudioLoop | null = null;

export function getAudioLoop(): AudioLoop {
    if (!instance) instance = new AudioLoop();
    return instance;
}

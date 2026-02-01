/**
 * Audio Loop & Buffer (Simplified for Electron)
 * Records audio continuously in a rolling buffer (max 40s)
 * Uses restart strategy to ensure valid webm headers.
 */

class AudioLoop {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.maxDurationMs = 40000; // 40 seconds
        this.restartIntervalMs = 30000; // Restart every 30s to keep headers fresh
        this.restartTimer = null;
        this.stream = null;

        // Auto-start for simplicity in Electron app
        this.start();
    }

    async start() {
        if (this.isRecording) return;

        try {
            console.log('[AudioLoop] Requesting microphone access...');
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this._startRecorder();

            // Restart recorder periodically to ensure fresh headers
            this.restartTimer = setInterval(() => {
                console.log('[AudioLoop] Restarting recorder for fresh headers...');
                this._restartRecorder();
            }, this.restartIntervalMs);

        } catch (error) {
            console.error('[AudioLoop] Error accessing microphone:', error);
        }
    }

    _startRecorder() {
        if (!this.stream) return;

        // Specify MIME type explicitly to ensure webm format
        const mimeType = 'audio/webm;codecs=opus';

        if (!MediaRecorder.isTypeSupported(mimeType)) {
            console.warn('[AudioLoop] webm not supported, using default');
            this.mediaRecorder = new MediaRecorder(this.stream);
        } else {
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
        }

        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };

        this.mediaRecorder.start(1000); // Collect chunks every 1s
        this.isRecording = true;
        console.log('[AudioLoop] Started recording with MIME:', this.mediaRecorder.mimeType);
    }

    _restartRecorder() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        // Small delay to ensure clean stop
        setTimeout(() => {
            this._startRecorder();
        }, 100);
    }

    stop() {
        if (!this.isRecording) return;

        if (this.restartTimer) {
            clearInterval(this.restartTimer);
            this.restartTimer = null;
        }

        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.isRecording = false;
        this.audioChunks = [];
        console.log('[AudioLoop] Stopped recording');
    }

    hasAudio() {
        return this.audioChunks.length > 0;
    }

    getAudioBuffer() {
        if (this.audioChunks.length === 0) {
            console.warn('[AudioLoop] No audio chunks available');
            return null;
        }

        // Create blob with explicit MIME type
        const mimeType = this.mediaRecorder ? this.mediaRecorder.mimeType : 'audio/webm;codecs=opus';
        const blob = new Blob(this.audioChunks, { type: mimeType });
        console.log(`[AudioLoop] Created blob with ${this.audioChunks.length} chunks, size: ${blob.size} bytes, type: ${mimeType}`);
        return blob;
    }
}

// Export for window use
window.AudioLoop = AudioLoop;

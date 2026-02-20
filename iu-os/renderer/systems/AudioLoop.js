/**
 * Audio Loop & Buffer (Simplified for Electron)
 * Records audio continuously, always keeping ~30s available.
 * Saves previous cycle's audio to ensure continuity.
 */

class AudioLoop {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.restartIntervalMs = 30000; // 30 seconds per cycle
        this.restartTimer = null;
        this.stream = null;

        // Keep previous cycle's blob for continuity
        this.previousBlob = null;

        // Auto-start
        this.start();
    }

    // ... previous code ...

    async start() {
        if (this.isRecording) return;

        // Initialize Speech Recognition for Wake Words
        this._initSpeechRecognition();

        try {
            console.log('[AudioLoop] Requesting microphone access...');
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this._startRecorder();

            // Restart recorder every 30s, saving the previous blob
            this.restartTimer = setInterval(() => {
                this._saveAndRestart();
            }, this.restartIntervalMs);

        } catch (error) {
            console.error('[AudioLoop] Error accessing microphone:', error);
        }
    }

    async _initSpeechRecognition() {
        if (!('webkitSpeechRecognition' in window)) {
            console.warn('[AudioLoop] Web Speech API not supported');
            // return; // Don't return, we want to try Porcupine even if webkit is missing
        }
        console.log('[AudioLoop] Initializing Porcupine Wake Word Engine...');

        try {
            // We need the Access Key from main process env
            const accessKey = 'YOUR_ACCESS_KEY_HERE'; // Placeholder, user will provide key

            if (accessKey === 'YOUR_ACCESS_KEY_HERE') {
                console.warn('[AudioLoop] ⚠️ Missing PICOVOICE_API_KEY. Wake word disabled.');
                return;
            }

            // check if Porcupine is loaded (we will add script tags to index.html)
            if (typeof PorcupineWeb === 'undefined') {
                console.warn('[AudioLoop] PorcupineWeb library not loaded.');
                return;
            }

            // Initialize Porcupine with built-in keywords for now:
            // "Porcupine" -> maps to "Hey U"
            // "Bumblebee" -> maps to "Pss Pss"
            this.porcupine = await PorcupineWeb.PorcupineWorker.create(
                accessKey,
                ['porcupine', 'bumblebee']
            );

            console.log('🦔 [Porcupine] Engine Ready');

            this.porcupine.onmessage = (msg) => {
                switch (msg.data.command) {
                    case 'keyword':
                        this._handleKeyword(msg.data.keywordLabel);
                        break;
                }
            };

            // Start processing audio stream
            if (typeof WebVoiceProcessor === 'undefined') {
                console.warn('[AudioLoop] WebVoiceProcessor library not loaded.');
                return;
            }

            this.webVoiceProcessor = await WebVoiceProcessor.WebVoiceProcessor.create({
                engines: [this.porcupine],
                start: true
            });

            console.log('🦔 [Porcupine] Listening for wake words...');

        } catch (e) {
            console.error('[AudioLoop] Porcupine Init Failed:', e);
        }
    }

    _handleKeyword(label) {
        console.log(`✨ [Porcupine] Keyword Detected: ${label}`);

        let wakeType = null;

        if (label === 'porcupine') {
            wakeType = 'global'; // "Hey Ü"
        } else if (label === 'bumblebee') {
            wakeType = 'gated'; // "Pss Pss"
        }

        if (wakeType && this.onWakeWord) {
            this.onWakeWord(wakeType, label);
        }
    }

    // Callback setter
    setOnWakeWord(callback) {
        this.onWakeWord = callback;
    }

    _startRecorder() {
        if (!this.stream) return;

        const mimeType = 'audio/webm;codecs=opus';

        if (!MediaRecorder.isTypeSupported(mimeType)) {
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

        this.mediaRecorder.start(1000);
        this.isRecording = true;
        console.log('[AudioLoop] Started recording');
    }

    _saveAndRestart() {
        // Save current chunks as blob before restarting
        if (this.audioChunks.length > 0) {
            const mimeType = this.mediaRecorder ? this.mediaRecorder.mimeType : 'audio/webm;codecs=opus';
            this.previousBlob = new Blob(this.audioChunks, { type: mimeType });
            console.log(`[AudioLoop] Saved previous blob: ${this.previousBlob.size} bytes`);
        }

        // Stop and restart
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

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
        this.previousBlob = null;
        console.log('[AudioLoop] Stopped recording');
    }

    hasAudio() {
        return this.audioChunks.length > 0 || this.previousBlob !== null;
    }

    getAudioBuffer() {
        const mimeType = this.mediaRecorder ? this.mediaRecorder.mimeType : 'audio/webm;codecs=opus';

        // If current chunks have at least 15s (15 chunks), use them
        if (this.audioChunks.length >= 15) {
            const blob = new Blob(this.audioChunks, { type: mimeType });
            console.log(`[AudioLoop] Using current buffer: ${this.audioChunks.length}s, ${blob.size} bytes`);
            return blob;
        }

        // Otherwise use the previous cycle's blob if available
        if (this.previousBlob) {
            console.log(`[AudioLoop] Using previous cycle: ${this.previousBlob.size} bytes`);
            return this.previousBlob;
        }

        // Fallback: use whatever we have
        if (this.audioChunks.length > 0) {
            const blob = new Blob(this.audioChunks, { type: mimeType });
            console.log(`[AudioLoop] Using short buffer: ${this.audioChunks.length}s, ${blob.size} bytes`);
            return blob;
        }

        console.warn('[AudioLoop] No audio available');
        return null;
    }
}

window.AudioLoop = AudioLoop;

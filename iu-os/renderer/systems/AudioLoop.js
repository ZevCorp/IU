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
        this.porcupine = null;
        this.webVoiceProcessor = null;
        this.speechRecognition = null;
        this.lastHeyDetection = 0;

        // Keep previous cycle's blob for continuity
        this.previousBlob = null;

        // Auto-start
        this.start();
    }

    // ... previous code ...

    async start() {
        if (this.isRecording) return;

        // Initialize local wake engines
        this._initWakeEngines();

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

    async _initWakeEngines() {
        await this._initPorcupineIfAvailable();
        this._initHeySpeechFallback();
    }

    async _initPorcupineIfAvailable() {
        try {
            if (typeof PorcupineWeb === 'undefined' || typeof WebVoiceProcessor === 'undefined') {
                console.warn('[AudioLoop] Porcupine/WebVoiceProcessor not available in renderer.');
                return;
            }

            const cfg = await (window.iuOS?.getPicovoiceConfig?.() || Promise.resolve(null));
            const accessKey = cfg?.accessKey;
            const heyKeywordPath = cfg?.heyKeywordPath;

            if (!accessKey) {
                console.warn('[AudioLoop] No PICOVOICE_API_KEY found. Skipping Porcupine.');
                return;
            }

            const keywordConfig = heyKeywordPath
                ? [{ publicPath: heyKeywordPath, label: 'hey_local' }]
                : ['porcupine']; // fallback built-in

            this.porcupine = await PorcupineWeb.PorcupineWorker.create(
                accessKey,
                keywordConfig
            );

            this.porcupine.onmessage = (msg) => {
                if (msg?.data?.command === 'keyword') {
                    const label = msg.data.keywordLabel || 'hey_local';
                    if (label === 'hey_local' || label === 'porcupine') {
                        this._handleKeyword('hey');
                    } else {
                        this._handleKeyword(label);
                    }
                }
            };

            this.webVoiceProcessor = await WebVoiceProcessor.WebVoiceProcessor.create({
                engines: [this.porcupine],
                start: true
            });

            console.log('🦔 [Porcupine] Wake engine active');
        } catch (e) {
            console.error('[AudioLoop] Porcupine init failed:', e);
        }
    }

    _initHeySpeechFallback() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            console.warn('[AudioLoop] No SpeechRecognition fallback available.');
            return;
        }

        try {
            const recognition = new SR();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event) => {
                let transcript = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    transcript += `${event.results[i][0].transcript} `;
                }
                transcript = transcript.trim().toLowerCase();
                if (!transcript) return;

                const hasHey = /\bhey\b/.test(transcript);
                if (hasHey) {
                    const now = Date.now();
                    if (now - this.lastHeyDetection > 500) {
                        this.lastHeyDetection = now;
                        this._handleKeyword('hey');
                    }
                }
            };

            recognition.onerror = (e) => {
                console.warn('[AudioLoop] Speech fallback error:', e.error);
            };

            recognition.onend = () => {
                if (this.isRecording) {
                    try {
                        recognition.start();
                    } catch (e) {
                        // ignored
                    }
                }
            };

            recognition.start();
            this.speechRecognition = recognition;
            console.log('[AudioLoop] Speech fallback active for \"Hey\"');
        } catch (e) {
            console.warn('[AudioLoop] Failed to start speech fallback:', e);
        }
    }

    _handleKeyword(label) {
        console.log(`✨ [Porcupine] Keyword Detected: ${label}`);

        let wakeType = null;

        if (label === 'hey') {
            wakeType = 'hey';
        } else if (label === 'porcupine') {
            wakeType = 'global'; // legacy
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

        if (this.speechRecognition) {
            try {
                this.speechRecognition.stop();
            } catch (e) {
                // ignored
            }
            this.speechRecognition = null;
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

# AudioLoop - Posibles Mejoras Futuras

## Problema Identificado: Corrupción de Headers en WebM

### Contexto
El `MediaRecorder` de WebM genera chunks donde **solo el primer chunk contiene el header EBML/WebM**. Cuando se hace `trimBuffer()` y se eliminan los primeros chunks para mantener solo los últimos 40 segundos, el archivo resultante pierde su header y se convierte en datos binarios inválidos.

### Estado Actual (Funcional)
La solución actual reinicia el `MediaRecorder` cada 30 segundos, lo que genera un nuevo archivo con headers frescos. Esto funciona bien pero tiene la limitación de que el buffer nunca contiene más de 30 segundos de audio continuo.

### Mejora Propuesta: Snapshot-on-Demand

En lugar de mantener un buffer rolling de chunks, se puede implementar un sistema de "snapshot":

```javascript
class AudioLoopImproved {
    constructor() {
        this.mediaRecorder = null;
        this.stream = null;
        this.isRecording = false;
        this.lastSnapshot = null; // Blob válido del último snapshot
        this.snapshotInterval = null;
    }

    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._startNewRecording();
        
        // Cada 30s, tomar un snapshot y reiniciar
        this.snapshotInterval = setInterval(() => {
            this._takeSnapshot();
        }, 30000);
    }

    _startNewRecording() {
        this.mediaRecorder = new MediaRecorder(this.stream, { 
            mimeType: 'audio/webm;codecs=opus' 
        });
        
        const chunks = [];
        
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        
        this.mediaRecorder.onstop = () => {
            // Guardar el blob completo como snapshot válido
            this.lastSnapshot = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
        };
        
        this.mediaRecorder.start(1000);
        this.isRecording = true;
    }

    _takeSnapshot() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop(); // Esto triggerea onstop -> guarda snapshot
            
            setTimeout(() => {
                this._startNewRecording();
            }, 100);
        }
    }

    getAudioBuffer() {
        // Opción 1: Devolver el último snapshot (siempre válido)
        return this.lastSnapshot;
        
        // Opción 2: Forzar un snapshot ahora (más fresco pero async)
        // return this._takeSnapshotAsync();
    }
}
```

### Ventajas de esta Mejora
1. **Siempre válido**: El blob siempre tiene headers correctos
2. **Predecible**: El tamaño del audio es consistente (~30s)
3. **Sin corrupción**: No hay manipulación de chunks individuales

### Alternativa: Conversión a WAV

Otra opción es convertir el audio a WAV en el proceso principal usando `ffmpeg` o una librería como `audiobuffer-to-wav`:

```javascript
// En main.js
const ffmpeg = require('fluent-ffmpeg');

async function convertToWav(webmBuffer) {
    return new Promise((resolve, reject) => {
        const inputPath = path.join(os.tmpdir(), `input_${Date.now()}.webm`);
        const outputPath = path.join(os.tmpdir(), `output_${Date.now()}.wav`);
        
        fs.writeFileSync(inputPath, webmBuffer);
        
        ffmpeg(inputPath)
            .toFormat('wav')
            .on('end', () => {
                const wavBuffer = fs.readFileSync(outputPath);
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
                resolve(wavBuffer);
            })
            .on('error', reject)
            .save(outputPath);
    });
}
```

### Notas
- OpenAI Whisper soporta: `flac`, `m4a`, `mp3`, `mp4`, `mpeg`, `mpga`, `oga`, `ogg`, `wav`, `webm`
- WAV es el más simple y confiable pero genera archivos más grandes
- WebM/Opus es más eficiente pero requiere headers correctos

---

*Documentado: 2026-02-01*

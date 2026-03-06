package com.u.bank

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.u.bank.face.FacePresets
import com.u.bank.face.UFaceView
import com.u.bank.network.JetsonClient
import com.u.bank.service.UAccessibilityService
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * MainActivity — Main Ü Bank interface.
 * 
 * Shows the Ü vector face fullscreen on a black background.
 * User looks at Ü and speaks to request banking operations.
 * 
 * Flow:
 * 1. Ü shows idle face (smile)
 * 2. User says "Ü" or taps → listening mode
 * 3. User speaks command → face transitions to thinking
 * 4. Command sent to Jetson → intent confirmed → face shows confirming
 * 5. User says "Hazlo" → face transitions to processing
 * 6. Execution happens → face shows action_complete or error
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "UBankMain"
        private const val PERMISSION_REQUEST_CODE = 100
    }

    // UI
    private lateinit var faceView: UFaceView
    private lateinit var statusText: TextView
    private lateinit var transcriptText: TextView
    private lateinit var intentSummaryText: TextView
    private lateinit var confirmOverlay: View
    private lateinit var progressText: TextView

    // Services
    private lateinit var jetsonClient: JetsonClient
    private var speechRecognizer: SpeechRecognizer? = null

    // State
    private var currentState = AppState.IDLE
    private var pendingRequestId: String = ""
    private var pendingPlanSteps: List<JSONObject> = emptyList()
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    enum class AppState {
        IDLE,           // Showing smile, waiting for wake
        LISTENING,      // Microphone active, capturing speech
        THINKING,       // Sent to Jetson, waiting for intent
        CONFIRMING,     // Showing intent, waiting for "Hazlo"
        EXECUTING,      // Running the plan on the phone
        COMPLETE,       // Done
        ERROR           // Something went wrong
    }

    // ============================================
    // Lifecycle
    // ============================================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Fullscreen immersive
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )

        // Bind views
        faceView = findViewById(R.id.face_view)
        statusText = findViewById(R.id.status_text)
        transcriptText = findViewById(R.id.transcript_text)
        intentSummaryText = findViewById(R.id.intent_summary_text)
        confirmOverlay = findViewById(R.id.confirm_overlay)
        progressText = findViewById(R.id.progress_text)

        // Setup
        setupJetsonClient()
        checkPermissions()
        checkAccessibilityService()

        // Tap face to start listening
        faceView.setOnClickListener {
            when (currentState) {
                AppState.IDLE -> startListening()
                AppState.CONFIRMING -> confirmExecution()
                else -> {} // Ignore taps in other states
            }
        }

        // Long press to cancel
        faceView.setOnLongClickListener {
            cancelCurrentOperation()
            true
        }

        transitionToState(AppState.IDLE)
        Log.i(TAG, "Ü Bank ready")
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        speechRecognizer?.destroy()
        jetsonClient.disconnect()
    }

    // ============================================
    // Jetson Client Setup
    // ============================================

    private fun setupJetsonClient() {
        jetsonClient = JetsonClient()

        jetsonClient.onConnected = {
            runOnUiThread {
                statusText.text = "Conectado"
                statusText.setTextColor(0xFF00FF88.toInt())
            }
        }

        jetsonClient.onDisconnected = {
            runOnUiThread {
                statusText.text = "Desconectado"
                statusText.setTextColor(0xFFFF4444.toInt())
            }
        }

        jetsonClient.onIntentConfirmed = { requestId, intent ->
            runOnUiThread {
                pendingRequestId = requestId
                val summary = intent.optString("summary", "")
                val needsConfirm = intent.optBoolean("requiresConfirmation", true)

                intentSummaryText.text = summary

                if (needsConfirm) {
                    transitionToState(AppState.CONFIRMING)
                } else {
                    // Auto-execute non-destructive intents
                    confirmExecution()
                }
            }
        }

        jetsonClient.onExecutePlan = { requestId, steps ->
            runOnUiThread {
                pendingRequestId = requestId
                pendingPlanSteps = steps
                executePlan(requestId, steps)
            }
        }

        jetsonClient.onPlanComplete = { _, summary ->
            runOnUiThread {
                progressText.text = summary
                transitionToState(AppState.COMPLETE)

                // Return to idle after 3 seconds
                scope.launch {
                    delay(3000)
                    transitionToState(AppState.IDLE)
                }
            }
        }

        jetsonClient.onPlanError = { _, error ->
            runOnUiThread {
                progressText.text = "Error: $error"
                transitionToState(AppState.ERROR)

                scope.launch {
                    delay(3000)
                    transitionToState(AppState.IDLE)
                }
            }
        }

        jetsonClient.onExploreRequest = { requestId, app, depth ->
            // Trigger graph exploration
            val explorer = UAccessibilityService.instance?.getExplorer()
            if (explorer != null) {
                explorer.onExplorationComplete = { graph ->
                    jetsonClient.sendGraphUpdate(app, graph)
                    jetsonClient.send(JSONObject().apply {
                        put("type", "explore_complete")
                        put("requestId", requestId)
                        put("payload", JSONObject().apply {
                            put("app", app)
                        })
                    })
                }
                explorer.startExploration(app, depth)
            }
        }

        jetsonClient.connect()
    }

    // ============================================
    // State Machine
    // ============================================

    private fun transitionToState(newState: AppState) {
        Log.i(TAG, "State: $currentState → $newState")
        currentState = newState

        when (newState) {
            AppState.IDLE -> {
                faceView.transitionTo(FacePresets.SMILE, 500)
                transcriptText.visibility = View.GONE
                intentSummaryText.visibility = View.GONE
                confirmOverlay.visibility = View.GONE
                progressText.visibility = View.GONE
                statusText.text = "Toca para hablar"
            }

            AppState.LISTENING -> {
                faceView.transitionTo(FacePresets.LISTENING, 300)
                transcriptText.visibility = View.VISIBLE
                transcriptText.text = "Escuchando..."
                intentSummaryText.visibility = View.GONE
                confirmOverlay.visibility = View.GONE
                progressText.visibility = View.GONE
            }

            AppState.THINKING -> {
                faceView.transitionTo(FacePresets.THINKING, 400)
                transcriptText.visibility = View.VISIBLE
                intentSummaryText.visibility = View.GONE
                progressText.visibility = View.GONE
            }

            AppState.CONFIRMING -> {
                faceView.transitionTo(FacePresets.CONFIRMING, 300)
                transcriptText.visibility = View.GONE
                intentSummaryText.visibility = View.VISIBLE
                confirmOverlay.visibility = View.VISIBLE
                progressText.visibility = View.GONE
            }

            AppState.EXECUTING -> {
                faceView.transitionTo(FacePresets.LOOKING_AT_SCREEN, 300)
                transcriptText.visibility = View.GONE
                intentSummaryText.visibility = View.GONE
                confirmOverlay.visibility = View.GONE
                progressText.visibility = View.VISIBLE
                progressText.text = "Ejecutando..."
            }

            AppState.COMPLETE -> {
                faceView.transitionTo(FacePresets.ACTION_COMPLETE, 400)
                transcriptText.visibility = View.GONE
                intentSummaryText.visibility = View.GONE
                confirmOverlay.visibility = View.GONE
                progressText.visibility = View.VISIBLE
            }

            AppState.ERROR -> {
                faceView.transitionTo(FacePresets.ERROR, 300)
                transcriptText.visibility = View.GONE
                intentSummaryText.visibility = View.GONE
                confirmOverlay.visibility = View.GONE
                progressText.visibility = View.VISIBLE
            }
        }
    }

    // ============================================
    // Speech Recognition
    // ============================================

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Toast.makeText(this, "Speech recognition not available", Toast.LENGTH_SHORT).show()
            return
        }

        transitionToState(AppState.LISTENING)

        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)

        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull() ?: ""

                if (text.isNotEmpty()) {
                    Log.i(TAG, "Speech: \"$text\"")
                    transcriptText.text = "\"$text\""

                    // Check for confirmation keywords
                    if (currentState == AppState.CONFIRMING) {
                        val confirmWords = listOf("hazlo", "ejecuta", "dale", "sí", "confirma", "ok")
                        if (confirmWords.any { text.lowercase().contains(it) }) {
                            confirmExecution()
                            return
                        }
                        val cancelWords = listOf("cancela", "no", "para", "detente")
                        if (cancelWords.any { text.lowercase().contains(it) }) {
                            cancelCurrentOperation()
                            return
                        }
                    }

                    // Send to Jetson for processing
                    transitionToState(AppState.THINKING)
                    jetsonClient.sendVoiceCommand(text)
                } else {
                    transitionToState(AppState.IDLE)
                }
            }

            override fun onError(error: Int) {
                Log.w(TAG, "Speech error: $error")
                if (currentState == AppState.LISTENING) {
                    transitionToState(AppState.IDLE)
                }
            }

            override fun onPartialResults(partialResults: Bundle?) {
                val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull() ?: ""
                if (text.isNotEmpty()) {
                    transcriptText.text = "\"$text\"..."
                }
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CO") // Colombian Spanish
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }

        speechRecognizer?.startListening(intent)
    }

    // ============================================
    // Execution
    // ============================================

    private fun confirmExecution() {
        transitionToState(AppState.EXECUTING)
        // The plan will arrive via onExecutePlan callback
        // If we already have steps, execute them
        if (pendingPlanSteps.isNotEmpty()) {
            executePlan(pendingRequestId, pendingPlanSteps)
        }
    }

    private fun executePlan(requestId: String, steps: List<JSONObject>) {
        val executor = UAccessibilityService.instance?.getExecutor()
        if (executor == null) {
            progressText.text = "Error: AccessibilityService no activo"
            transitionToState(AppState.ERROR)
            return
        }

        transitionToState(AppState.EXECUTING)

        executor.onActionComplete = { stepIndex, success, newFingerprint, error ->
            runOnUiThread {
                val total = steps.size
                val desc = if (stepIndex < steps.size) {
                    steps[stepIndex].optString("description", "Paso ${stepIndex + 1}")
                } else "..."

                progressText.text = "[${ stepIndex + 1}/$total] $desc"

                // Update face expression based on progress
                if (success) {
                    faceView.transitionTo(FacePresets.PROCESSING, 200)
                }
            }

            // Report to Jetson
            jetsonClient.sendActionResult(requestId, stepIndex, success, newFingerprint, error)
        }

        scope.launch(Dispatchers.Main) {
            executor.executePlan(steps, requestId)
        }
    }

    private fun cancelCurrentOperation() {
        pendingPlanSteps = emptyList()
        pendingRequestId = ""
        transitionToState(AppState.IDLE)
    }

    // ============================================
    // Permissions & Accessibility
    // ============================================

    private fun checkPermissions() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private fun checkAccessibilityService() {
        if (UAccessibilityService.instance == null) {
            statusText.text = "Activa el servicio de accesibilidad"
            statusText.setTextColor(0xFFFFAA00.toInt())

            // Prompt user to enable accessibility service
            scope.launch {
                delay(2000)
                val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                startActivity(intent)
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                Log.i(TAG, "All permissions granted")
            } else {
                Toast.makeText(this, "Se necesitan permisos de micrófono", Toast.LENGTH_LONG).show()
            }
        }
    }
}

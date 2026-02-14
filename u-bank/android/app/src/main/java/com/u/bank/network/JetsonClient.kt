package com.u.bank.network

import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * JetsonClient — WebSocket connection from Android to Render backend.
 * 
 * Handles all communication between the Android Ü Bank app and the
 * Jetson Orin Nano (via the Render WebSocket relay).
 * 
 * Message types sent:
 * - voice_command: User speech transcription
 * - graph_update: Explored app navigation graph
 * - ui_state: Current screen state
 * - action_result: Result of executing an action step
 * 
 * Message types received:
 * - execute_plan: Execution plan from Jetson planner
 * - intent_confirmed: Parsed intent for user confirmation
 * - explore_request: Request to explore more of the app
 * - plan_complete: Plan execution finished
 * - plan_error: Error during plan execution
 */
class JetsonClient(
    private val serverUrl: String = DEFAULT_SERVER_URL,
    private val authSecret: String = DEFAULT_AUTH_SECRET
) {
    companion object {
        private const val TAG = "JetsonClient"
        private const val DEFAULT_SERVER_URL = "wss://iu-rw9m.onrender.com"
        private const val DEFAULT_AUTH_SECRET = "u-bank-android-dev"
        private const val RECONNECT_DELAY_MS = 5000L
        private const val PING_INTERVAL_MS = 25000L
    }

    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)  // No timeout for WebSocket
        .pingInterval(PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
        .build()

    private var connected = false
    private var reconnecting = false
    private var scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ============================================
    // Callbacks
    // ============================================

    var onConnected: (() -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null
    var onExecutePlan: ((requestId: String, steps: List<JSONObject>) -> Unit)? = null
    var onIntentConfirmed: ((requestId: String, intent: JSONObject) -> Unit)? = null
    var onExploreRequest: ((requestId: String, app: String, depth: Int) -> Unit)? = null
    var onPlanComplete: ((requestId: String, summary: String) -> Unit)? = null
    var onPlanError: ((requestId: String, error: String) -> Unit)? = null

    // ============================================
    // Connection
    // ============================================

    fun connect() {
        if (connected) return

        Log.i(TAG, "Connecting to $serverUrl...")

        val request = Request.Builder()
            .url(serverUrl)
            .addHeader("X-Android-Auth", authSecret)
            .addHeader("X-Device-Id", android.os.Build.MODEL)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected to server")
                connected = true
                reconnecting = false

                // Register
                send(JSONObject().apply {
                    put("type", "register")
                    put("deviceId", android.os.Build.MODEL)
                    put("payload", JSONObject().apply {
                        put("deviceType", "android")
                        put("app", "u-bank")
                        put("model", android.os.Build.MODEL)
                        put("sdk", android.os.Build.VERSION.SDK_INT)
                    })
                })

                onConnected?.invoke()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Connection closing: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Connection closed: $code $reason")
                connected = false
                onDisconnected?.invoke()
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Connection failed: ${t.message}")
                connected = false
                onDisconnected?.invoke()
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        reconnecting = false
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        connected = false
    }

    private fun scheduleReconnect() {
        if (reconnecting) return
        reconnecting = true

        scope.launch {
            delay(RECONNECT_DELAY_MS)
            if (reconnecting) {
                Log.i(TAG, "Reconnecting...")
                connect()
            }
        }
    }

    fun isConnected(): Boolean = connected

    // ============================================
    // Message Sending
    // ============================================

    fun send(message: JSONObject) {
        if (!connected || webSocket == null) {
            Log.w(TAG, "Cannot send — not connected")
            return
        }
        webSocket?.send(message.toString())
    }

    /**
     * Send voice command for SLM processing on Jetson.
     */
    fun sendVoiceCommand(text: String, app: String = "com.bancolombia.app") {
        send(JSONObject().apply {
            put("type", "voice_command")
            put("requestId", "vc-${System.currentTimeMillis()}")
            put("payload", JSONObject().apply {
                put("text", text)
                put("app", app)
                put("confidence", 1.0)
            })
        })
        Log.i(TAG, "Voice command sent: \"$text\"")
    }

    /**
     * Send explored graph to Jetson for compilation.
     */
    fun sendGraphUpdate(app: String, graph: JSONObject) {
        send(JSONObject().apply {
            put("type", "graph_update")
            put("payload", JSONObject().apply {
                put("app", app)
                put("graph", graph)
            })
        })
        Log.i(TAG, "Graph update sent: ${graph.optInt("node_count")} nodes")
    }

    /**
     * Send current UI state.
     */
    fun sendUiState(screenFingerprint: String, currentApp: String) {
        send(JSONObject().apply {
            put("type", "ui_state")
            put("payload", JSONObject().apply {
                put("screenFingerprint", screenFingerprint)
                put("currentApp", currentApp)
            })
        })
    }

    /**
     * Send action execution result.
     */
    fun sendActionResult(
        requestId: String,
        stepIndex: Int,
        success: Boolean,
        newScreenFingerprint: String,
        error: String = ""
    ) {
        send(JSONObject().apply {
            put("type", "action_result")
            put("requestId", requestId)
            put("payload", JSONObject().apply {
                put("stepIndex", stepIndex)
                put("success", success)
                put("newScreenFingerprint", newScreenFingerprint)
                put("error", error)
            })
        })
    }

    // ============================================
    // Message Handling
    // ============================================

    private fun handleMessage(raw: String) {
        try {
            val msg = JSONObject(raw)
            val type = msg.optString("type", "")
            val requestId = msg.optString("requestId", "")

            when (type) {
                "registered" -> {
                    Log.i(TAG, "Registered with server")
                }

                "execute_plan" -> {
                    val payload = msg.optJSONObject("payload") ?: return
                    val stepsArray = payload.optJSONArray("steps") ?: return
                    val steps = mutableListOf<JSONObject>()
                    for (i in 0 until stepsArray.length()) {
                        steps.add(stepsArray.getJSONObject(i))
                    }
                    Log.i(TAG, "Received execution plan: ${steps.size} steps")
                    onExecutePlan?.invoke(requestId, steps)
                }

                "intent_confirmed" -> {
                    val payload = msg.optJSONObject("payload") ?: return
                    Log.i(TAG, "Intent confirmed: ${payload.optString("intent")}")
                    onIntentConfirmed?.invoke(requestId, payload)
                }

                "explore_request" -> {
                    val payload = msg.optJSONObject("payload") ?: return
                    val app = payload.optString("app", "")
                    val depth = payload.optInt("depth", 4)
                    Log.i(TAG, "Explore request: $app (depth: $depth)")
                    onExploreRequest?.invoke(requestId, app, depth)
                }

                "plan_complete" -> {
                    val payload = msg.optJSONObject("payload") ?: return
                    val summary = payload.optString("summary", "")
                    Log.i(TAG, "Plan complete: $summary")
                    onPlanComplete?.invoke(requestId, summary)
                }

                "plan_error" -> {
                    val payload = msg.optJSONObject("payload") ?: return
                    val error = payload.optString("error", "Unknown error")
                    Log.w(TAG, "Plan error: $error")
                    onPlanError?.invoke(requestId, error)
                }

                "pong" -> { /* Keep-alive response */ }

                else -> {
                    Log.d(TAG, "Unknown message type: $type")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling message: ${e.message}")
        }
    }
}

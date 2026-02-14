package com.u.bank.face

/**
 * FaceState — All parameters that define a Ü face expression.
 * Direct port of the PRESETS object from IU OS renderer/app.js.
 */
data class FaceState(
    val eyeOpenness: Float = 1f,
    val leftEyeOpenness: Float = -1f,   // -1 = use eyeOpenness
    val rightEyeOpenness: Float = -1f,
    val eyeSquint: Float = 0f,
    val leftBrowHeight: Float = 0f,
    val rightBrowHeight: Float = 0f,
    val leftBrowCurve: Float = 0.2f,
    val rightBrowCurve: Float = 0.2f,
    val mouthCurve: Float = 0f,
    val mouthWidth: Float = 1f,
    val leftCornerHeight: Float = 0f,
    val rightCornerHeight: Float = 0f,
    val mouthOpenness: Float = 0f,
    val headTilt: Float = 0f
)

/**
 * FacePresets — Expression presets matching IU OS exactly.
 * Values copied from renderer/app.js PRESETS object.
 */
object FacePresets {

    val NEUTRAL = FaceState(
        eyeOpenness = 0.88f, eyeSquint = 0.12f,
        leftBrowHeight = -0.5f, rightBrowHeight = 3f,
        leftBrowCurve = 0.15f, rightBrowCurve = 0.45f,
        mouthCurve = 0.55f, mouthWidth = 0.95f,
        leftCornerHeight = 0.05f, rightCornerHeight = 0.45f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 4f
    )

    val SMILE = FaceState(
        eyeOpenness = 0.85f, eyeSquint = 0.15f,
        leftBrowHeight = 2f, rightBrowHeight = 2.5f,
        leftBrowCurve = 0.3f, rightBrowCurve = 0.4f,
        mouthCurve = 0.7f, mouthWidth = 1.1f,
        leftCornerHeight = 0.3f, rightCornerHeight = 0.5f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 0f
    )

    val MILD_ATTENTION = FaceState(
        eyeOpenness = 0.85f, eyeSquint = 0.15f,
        leftBrowHeight = 0f, rightBrowHeight = 4f,
        leftBrowCurve = 0.2f, rightBrowCurve = 0.5f,
        mouthCurve = 0.6f, mouthWidth = 0.92f,
        leftCornerHeight = 0f, rightCornerHeight = 0.5f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 6f
    )

    val THINKING = FaceState(
        eyeOpenness = 0.75f, eyeSquint = 0.2f,
        leftBrowHeight = -1f, rightBrowHeight = 4f,
        leftBrowCurve = 0.1f, rightBrowCurve = 0.5f,
        mouthCurve = 0.7f, mouthWidth = 0.95f,
        leftCornerHeight = 0.2f, rightCornerHeight = 0.1f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 6f
    )

    val LISTENING = FaceState(
        eyeOpenness = 1.15f, eyeSquint = -0.05f,
        leftBrowHeight = 8f, rightBrowHeight = 8f,
        leftBrowCurve = 0.5f, rightBrowCurve = 0.5f,
        mouthCurve = 0.9f, mouthWidth = 1.1f,
        leftCornerHeight = 0.3f, rightCornerHeight = 0.3f,
        mouthOpenness = 0.05f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 0f
    )

    val LOOKING_AT_SCREEN = FaceState(
        eyeOpenness = 0.80f, eyeSquint = 0.18f,
        leftBrowHeight = 1f, rightBrowHeight = 1f,
        leftBrowCurve = 0.2f, rightBrowCurve = 0.2f,
        mouthCurve = 0.5f, mouthWidth = 0.9f,
        leftCornerHeight = 0f, rightCornerHeight = 0f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = -8f
    )

    val ACTION_COMPLETE = FaceState(
        eyeOpenness = 0.90f, eyeSquint = 0.10f,
        leftBrowHeight = 3f, rightBrowHeight = 3f,
        leftBrowCurve = 0.3f, rightBrowCurve = 0.3f,
        mouthCurve = 0.75f, mouthWidth = 1.05f,
        leftCornerHeight = 0.3f, rightCornerHeight = 0.3f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 0f
    )

    val WINK = FaceState(
        eyeOpenness = 1f,
        leftEyeOpenness = 1f, rightEyeOpenness = 0.1f,
        eyeSquint = 0f,
        leftBrowHeight = 2f, rightBrowHeight = -1f,
        leftBrowCurve = 0.3f, rightBrowCurve = 0.1f,
        mouthCurve = 0.5f, mouthWidth = 1f,
        leftCornerHeight = 0f, rightCornerHeight = 0.6f,
        mouthOpenness = 0f,
        headTilt = 5f
    )

    // Banking-specific presets

    val PROCESSING = FaceState(
        eyeOpenness = 0.70f, eyeSquint = 0.25f,
        leftBrowHeight = 1f, rightBrowHeight = 1f,
        leftBrowCurve = 0.2f, rightBrowCurve = 0.2f,
        mouthCurve = 0.4f, mouthWidth = 0.85f,
        leftCornerHeight = 0f, rightCornerHeight = 0f,
        mouthOpenness = 0f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = -4f
    )

    val CONFIRMING = FaceState(
        eyeOpenness = 1.0f, eyeSquint = 0f,
        leftBrowHeight = 5f, rightBrowHeight = 5f,
        leftBrowCurve = 0.4f, rightBrowCurve = 0.4f,
        mouthCurve = 0.5f, mouthWidth = 1f,
        leftCornerHeight = 0.1f, rightCornerHeight = 0.1f,
        mouthOpenness = 0.1f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = 0f
    )

    val ERROR = FaceState(
        eyeOpenness = 0.95f, eyeSquint = 0f,
        leftBrowHeight = -2f, rightBrowHeight = -2f,
        leftBrowCurve = 0.1f, rightBrowCurve = 0.1f,
        mouthCurve = -0.3f, mouthWidth = 0.8f,
        leftCornerHeight = -0.2f, rightCornerHeight = -0.2f,
        mouthOpenness = 0.15f,
        leftEyeOpenness = -1f, rightEyeOpenness = -1f,
        headTilt = -2f
    )

    /**
     * Get preset by name string (for WebSocket messages).
     */
    fun fromName(name: String): FaceState? = when (name.lowercase()) {
        "neutral" -> NEUTRAL
        "smile" -> SMILE
        "mild_attention" -> MILD_ATTENTION
        "thinking" -> THINKING
        "listening" -> LISTENING
        "looking_at_screen" -> LOOKING_AT_SCREEN
        "action_complete" -> ACTION_COMPLETE
        "wink" -> WINK
        "processing" -> PROCESSING
        "confirming" -> CONFIRMING
        "error" -> ERROR
        else -> null
    }
}

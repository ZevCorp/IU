package com.u.bank.face

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * UFaceView — Ü vector face renderer for Android.
 * 
 * Direct port of the IU OS SVG face (renderer/app.js) to Android Canvas.
 * Uses the same Bezier curve logic, presets, and animation system.
 * 
 * The face consists of:
 * - Two eyebrows (quadratic Bezier curves)
 * - Two eyes (vertical lines with variable openness)
 * - One mouth (cubic Bezier curve with asymmetric corners)
 * 
 * All coordinates are in a virtual 400x500 viewport, scaled to fit the view.
 */
class UFaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    // ============================================
    // Face State (matches IU OS state object)
    // ============================================

    private var eyeOpenness = 1f
    private var leftEyeOpenness = -1f  // -1 means use eyeOpenness
    private var rightEyeOpenness = -1f
    private var eyeSquint = 0f
    private var leftBrowHeight = 0f
    private var rightBrowHeight = 0f
    private var leftBrowCurve = 0.2f
    private var rightBrowCurve = 0.2f
    private var mouthCurve = 0f
    private var mouthWidth = 1f
    private var leftCornerHeight = 0f
    private var rightCornerHeight = 0f
    private var mouthOpenness = 0f
    private var headTilt = 0f

    // Gaze
    private var gazeX = 0f
    private var gazeY = 0f

    // ============================================
    // Paint & Drawing
    // ============================================

    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 4f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = Color.WHITE
    }

    private val path = Path()
    private val matrix = Matrix()

    // Virtual viewport (matches IU OS SVG viewBox)
    private val viewportWidth = 400f
    private val viewportHeight = 500f
    private val centerX = 200f  // face-group translate(200, 250)
    private val centerY = 250f

    // Blink state
    private var isBlinking = false
    private val blinkHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val blinkRunnable = object : Runnable {
        override fun run() {
            if (Math.random() > 0.7) {
                blink()
            }
            blinkHandler.postDelayed(this, 2500)
        }
    }

    // Current animator
    private var transitionAnimator: ValueAnimator? = null

    // Stroke color
    private var strokeColor = Color.WHITE
        set(value) {
            field = value
            strokePaint.color = value
            invalidate()
        }

    init {
        // Start with smile preset
        applyPresetImmediate(FacePresets.SMILE)
        // Start blinking
        blinkHandler.postDelayed(blinkRunnable, 2500)
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Transition to a preset with animation.
     */
    fun transitionTo(preset: FaceState, durationMs: Long = 300) {
        transitionAnimator?.cancel()

        val startState = captureCurrentState()
        val targetState = preset

        transitionAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { animator ->
                val t = animator.animatedValue as Float
                interpolateState(startState, targetState, t)
                invalidate()
            }
            start()
        }
    }

    /**
     * Set state immediately (no animation).
     */
    fun applyPresetImmediate(preset: FaceState) {
        eyeOpenness = preset.eyeOpenness
        leftEyeOpenness = preset.leftEyeOpenness
        rightEyeOpenness = preset.rightEyeOpenness
        eyeSquint = preset.eyeSquint
        leftBrowHeight = preset.leftBrowHeight
        rightBrowHeight = preset.rightBrowHeight
        leftBrowCurve = preset.leftBrowCurve
        rightBrowCurve = preset.rightBrowCurve
        mouthCurve = preset.mouthCurve
        mouthWidth = preset.mouthWidth
        leftCornerHeight = preset.leftCornerHeight
        rightCornerHeight = preset.rightCornerHeight
        mouthOpenness = preset.mouthOpenness
        headTilt = preset.headTilt
        invalidate()
    }

    /**
     * Look at a normalized point (0-1, 0.5 is center).
     */
    fun lookAt(x: Float, y: Float) {
        val range = 8f
        gazeX = (x - 0.5f) * range
        gazeY = (y - 0.5f) * range
        invalidate()
    }

    /**
     * Set the stroke color for the face.
     */
    fun setFaceColor(color: Int) {
        strokeColor = color
    }

    fun blink() {
        if (isBlinking) return
        isBlinking = true

        val savedEye = eyeOpenness
        val savedLeft = leftEyeOpenness
        val savedRight = rightEyeOpenness

        eyeOpenness = 0f
        leftEyeOpenness = 0f
        rightEyeOpenness = 0f
        invalidate()

        postDelayed({
            eyeOpenness = savedEye
            leftEyeOpenness = savedLeft
            rightEyeOpenness = savedRight
            isBlinking = false
            invalidate()
        }, 100)
    }

    // ============================================
    // Drawing
    // ============================================

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // Calculate scale to fit viewport in view
        val scaleX = width.toFloat() / viewportWidth
        val scaleY = height.toFloat() / viewportHeight
        val scale = min(scaleX, scaleY)

        val offsetX = (width - viewportWidth * scale) / 2f
        val offsetY = (height - viewportHeight * scale) / 2f

        canvas.save()
        canvas.translate(offsetX, offsetY)
        canvas.scale(scale, scale)

        // Apply head tilt rotation around center
        canvas.rotate(headTilt * 0.5f, centerX, centerY)

        // Draw face elements relative to center (200, 250)
        drawEyebrows(canvas)
        drawEyes(canvas)
        drawMouth(canvas)

        canvas.restore()
    }

    private fun drawEyebrows(canvas: Canvas) {
        // Left eyebrow: base at (-55, -55) relative to center
        drawEyebrow(canvas, centerX - 55f, centerY - 55f, 35f, leftBrowHeight, leftBrowCurve, false)
        // Right eyebrow: base at (55, -55) relative to center
        drawEyebrow(canvas, centerX + 55f, centerY - 55f, 35f, rightBrowHeight, rightBrowCurve, true)
    }

    private fun drawEyebrow(
        canvas: Canvas,
        baseX: Float, baseY: Float,
        width: Float, height: Float, curve: Float,
        flip: Boolean
    ) {
        val halfWidth = width / 2f
        val flipMul = if (flip) -1f else 1f

        val startX = baseX - halfWidth * flipMul
        val endX = baseX + halfWidth * flipMul
        val startY = baseY - height
        val endY = baseY - height
        val controlX = baseX
        val controlY = baseY - height - (curve * 15f)

        path.reset()
        path.moveTo(startX, startY)
        path.quadTo(controlX, controlY, endX, endY)
        canvas.drawPath(path, strokePaint)
    }

    private fun drawEyes(canvas: Canvas) {
        // Left eye at (-55, -25) relative to center
        val leftOpen = if (leftEyeOpenness >= 0) leftEyeOpenness else eyeOpenness
        val effectiveLeftOpen = leftOpen * (1f - eyeSquint * 0.4f)
        drawEye(canvas, centerX - 55f + gazeX, centerY - 25f + gazeY, effectiveLeftOpen)

        // Right eye at (55, -25) relative to center
        val rightOpen = if (rightEyeOpenness >= 0) rightEyeOpenness else eyeOpenness
        val effectiveRightOpen = rightOpen * (1f - eyeSquint * 0.4f)
        drawEye(canvas, centerX + 55f + gazeX, centerY - 25f + gazeY, effectiveRightOpen)
    }

    private fun drawEye(canvas: Canvas, cx: Float, cy: Float, openness: Float) {
        val lineHeight = 25f * openness
        val verticalOffset = lineHeight / 2f

        if (lineHeight > 0.5f) {
            path.reset()
            path.moveTo(cx, cy - verticalOffset)
            path.lineTo(cx, cy - verticalOffset + max(0f, lineHeight))
            canvas.drawPath(path, strokePaint)
        }
    }

    private fun drawMouth(canvas: Canvas) {
        val cx = centerX
        val cy = centerY + 50f  // mouth at y=50 relative to center
        val w = 60f * mouthWidth
        val halfW = w / 2f

        val baseOffset = mouthCurve * 15f
        val leftY = cy - baseOffset - (leftCornerHeight * 8f)
        val rightY = cy - baseOffset - (rightCornerHeight * 8f)

        val curveDepth = -mouthCurve * 12f
        val midY = cy + curveDepth
        val asymShift = (rightCornerHeight - leftCornerHeight) * 10f

        val startX = cx - halfW
        val endX = cx + halfW
        val ctrl1X = cx - halfW * 0.3f + asymShift
        val ctrl1Y = midY
        val ctrl2X = cx + halfW * 0.3f + asymShift
        val ctrl2Y = midY

        path.reset()
        path.moveTo(startX, leftY)
        path.cubicTo(ctrl1X, ctrl1Y, ctrl2X, ctrl2Y, endX, rightY)

        if (mouthOpenness > 0.05f) {
            val bottomY = cy + mouthOpenness * 15f
            path.quadTo(cx, bottomY, startX, leftY)
        }

        canvas.drawPath(path, strokePaint)
    }

    // ============================================
    // State Interpolation
    // ============================================

    private fun captureCurrentState(): FaceState {
        return FaceState(
            eyeOpenness = eyeOpenness,
            leftEyeOpenness = leftEyeOpenness,
            rightEyeOpenness = rightEyeOpenness,
            eyeSquint = eyeSquint,
            leftBrowHeight = leftBrowHeight,
            rightBrowHeight = rightBrowHeight,
            leftBrowCurve = leftBrowCurve,
            rightBrowCurve = rightBrowCurve,
            mouthCurve = mouthCurve,
            mouthWidth = mouthWidth,
            leftCornerHeight = leftCornerHeight,
            rightCornerHeight = rightCornerHeight,
            mouthOpenness = mouthOpenness,
            headTilt = headTilt
        )
    }

    private fun interpolateState(from: FaceState, to: FaceState, t: Float) {
        fun lerp(a: Float, b: Float) = a + (b - a) * t

        eyeOpenness = lerp(from.eyeOpenness, to.eyeOpenness)
        leftEyeOpenness = lerp(from.leftEyeOpenness, to.leftEyeOpenness)
        rightEyeOpenness = lerp(from.rightEyeOpenness, to.rightEyeOpenness)
        eyeSquint = lerp(from.eyeSquint, to.eyeSquint)
        leftBrowHeight = lerp(from.leftBrowHeight, to.leftBrowHeight)
        rightBrowHeight = lerp(from.rightBrowHeight, to.rightBrowHeight)
        leftBrowCurve = lerp(from.leftBrowCurve, to.leftBrowCurve)
        rightBrowCurve = lerp(from.rightBrowCurve, to.rightBrowCurve)
        mouthCurve = lerp(from.mouthCurve, to.mouthCurve)
        mouthWidth = lerp(from.mouthWidth, to.mouthWidth)
        leftCornerHeight = lerp(from.leftCornerHeight, to.leftCornerHeight)
        rightCornerHeight = lerp(from.rightCornerHeight, to.rightCornerHeight)
        mouthOpenness = lerp(from.mouthOpenness, to.mouthOpenness)
        headTilt = lerp(from.headTilt, to.headTilt)
    }

    // ============================================
    // Cleanup
    // ============================================

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        blinkHandler.removeCallbacks(blinkRunnable)
        transitionAnimator?.cancel()
    }
}

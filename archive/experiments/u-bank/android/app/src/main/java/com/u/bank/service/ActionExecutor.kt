package com.u.bank.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * ActionExecutor — Executes UI actions on the Android device.
 * 
 * Uses AccessibilityService APIs to:
 * - Tap elements (performAction ACTION_CLICK)
 * - Fill text fields (performAction ACTION_SET_TEXT)
 * - Scroll containers (performAction ACTION_SCROLL_FORWARD/BACKWARD)
 * - Swipe gestures (dispatchGesture)
 * - Press back (performGlobalAction GLOBAL_ACTION_BACK)
 * 
 * Each action verifies the result by checking the new screen state.
 */
class ActionExecutor(private val service: UAccessibilityService) {

    companion object {
        private const val TAG = "ActionExecutor"
        private const val DEFAULT_TIMEOUT_MS = 5000L
        private const val POST_ACTION_DELAY_MS = 800L // Wait for UI to settle
    }

    // Callback for action results
    var onActionComplete: ((stepIndex: Int, success: Boolean, newFingerprint: String, error: String) -> Unit)? = null

    // ============================================
    // Execute a Full Plan
    // ============================================

    /**
     * Execute a sequence of action steps from the Jetson planner.
     * Runs each step sequentially, verifying state after each.
     */
    suspend fun executePlan(steps: List<JSONObject>, requestId: String) {
        Log.i(TAG, "Executing plan: ${steps.size} steps (request: $requestId)")

        for ((index, step) in steps.withIndex()) {
            val action = step.optString("action", "tap")
            val selector = step.optJSONObject("selector") ?: JSONObject()
            val value = step.optString("value", "")
            val expectedScreen = step.optString("expectedScreen", "")
            val timeoutMs = step.optLong("timeoutMs", DEFAULT_TIMEOUT_MS)
            val description = step.optString("description", "Step $index")

            Log.i(TAG, "Step $index: $action — $description")

            val success = when (action) {
                "tap" -> executeTap(selector, timeoutMs)
                "fill" -> executeFill(selector, value, timeoutMs)
                "scroll" -> executeScroll(selector, step.optString("direction", "down"))
                "swipe" -> executeSwipe(step)
                "back" -> executeBack()
                "wait" -> executeWait(timeoutMs)
                else -> {
                    Log.w(TAG, "Unknown action: $action")
                    false
                }
            }

            // Wait for UI to settle
            delay(POST_ACTION_DELAY_MS)

            // Get new screen state
            val newFingerprint = service.getCurrentFingerprint()

            // Report result
            val error = if (!success) "Action failed: $action on ${selector}" else ""
            onActionComplete?.invoke(index, success, newFingerprint, error)

            if (!success) {
                Log.e(TAG, "Step $index failed — aborting plan")
                break
            }

            // Verify expected screen (if specified)
            if (expectedScreen.isNotEmpty() && newFingerprint != expectedScreen) {
                Log.w(TAG, "Unexpected screen after step $index: $newFingerprint (expected: $expectedScreen)")
                // Don't abort — the fingerprint might differ slightly
                // The Jetson will handle re-planning if needed
            }
        }
    }

    // ============================================
    // Individual Actions
    // ============================================

    /**
     * Tap on an element identified by selector.
     */
    suspend fun executeTap(selector: JSONObject, timeoutMs: Long = DEFAULT_TIMEOUT_MS): Boolean {
        return withTimeoutOrNull(timeoutMs) {
            val node = findElementWithRetry(selector, timeoutMs)
            if (node == null) {
                Log.e(TAG, "Element not found for tap: $selector")
                return@withTimeoutOrNull false
            }

            // Try ACTION_CLICK first
            if (node.isClickable) {
                val result = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node.recycle()
                Log.d(TAG, "Tap (ACTION_CLICK): $result")
                return@withTimeoutOrNull result
            }

            // Fallback: click on parent
            var parent = node.parent
            while (parent != null) {
                if (parent.isClickable) {
                    val result = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    parent.recycle()
                    node.recycle()
                    Log.d(TAG, "Tap (parent click): $result")
                    return@withTimeoutOrNull result
                }
                val grandparent = parent.parent
                parent.recycle()
                parent = grandparent
            }

            // Last resort: gesture tap at element center
            val rect = Rect()
            node.getBoundsInScreen(rect)
            node.recycle()
            val centerX = rect.centerX().toFloat()
            val centerY = rect.centerY().toFloat()
            return@withTimeoutOrNull performGestureTap(centerX, centerY)
        } ?: false
    }

    /**
     * Fill a text field with a value.
     */
    suspend fun executeFill(
        selector: JSONObject,
        value: String,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): Boolean {
        return withTimeoutOrNull(timeoutMs) {
            val node = findElementWithRetry(selector, timeoutMs)
            if (node == null) {
                Log.e(TAG, "Element not found for fill: $selector")
                return@withTimeoutOrNull false
            }

            // Focus the field first
            node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            delay(200)

            // Clear existing text
            node.performAction(AccessibilityNodeInfo.ACTION_SELECT_ALL)
            delay(100)

            // Set new text
            val args = Bundle()
            args.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value
            )
            val result = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            node.recycle()

            Log.d(TAG, "Fill: '$value' → $result")
            return@withTimeoutOrNull result
        } ?: false
    }

    /**
     * Scroll a container.
     */
    suspend fun executeScroll(
        selector: JSONObject,
        direction: String = "down"
    ): Boolean {
        val root = service.rootInActiveWindow ?: return false

        // Find scrollable container
        val scrollable = if (selector.length() > 0) {
            service.findElement(selector)
        } else {
            findFirstScrollable(root)
        }

        if (scrollable == null) {
            Log.e(TAG, "No scrollable element found")
            root.recycle()
            return false
        }

        val action = when (direction) {
            "down" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            "up" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            else -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }

        val result = scrollable.performAction(action)
        scrollable.recycle()
        root.recycle()

        Log.d(TAG, "Scroll $direction: $result")
        return result
    }

    /**
     * Perform a swipe gesture.
     */
    suspend fun executeSwipe(step: JSONObject): Boolean {
        val startX = step.optDouble("startX", 540.0).toFloat()
        val startY = step.optDouble("startY", 1200.0).toFloat()
        val endX = step.optDouble("endX", 540.0).toFloat()
        val endY = step.optDouble("endY", 600.0).toFloat()
        val durationMs = step.optLong("durationMs", 300)

        return performGestureSwipe(startX, startY, endX, endY, durationMs)
    }

    /**
     * Press the back button.
     */
    suspend fun executeBack(): Boolean {
        val result = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        Log.d(TAG, "Back: $result")
        delay(POST_ACTION_DELAY_MS)
        return result
    }

    /**
     * Wait for a specified duration.
     */
    suspend fun executeWait(durationMs: Long): Boolean {
        delay(durationMs)
        return true
    }

    // ============================================
    // Element Finding with Retry
    // ============================================

    /**
     * Find an element with retries (UI may still be loading).
     */
    private suspend fun findElementWithRetry(
        selector: JSONObject,
        timeoutMs: Long
    ): AccessibilityNodeInfo? {
        val startTime = System.currentTimeMillis()
        val retryDelay = 500L

        while (System.currentTimeMillis() - startTime < timeoutMs) {
            val node = service.findElement(selector)
            if (node != null) return node
            delay(retryDelay)
        }

        return null
    }

    private fun findFirstScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findFirstScrollable(child)
            if (result != null) return result
            child.recycle()
        }
        return null
    }

    // ============================================
    // Gesture Execution
    // ============================================

    /**
     * Perform a tap gesture at screen coordinates.
     */
    private suspend fun performGestureTap(x: Float, y: Float): Boolean {
        return suspendCancellableCoroutine { cont ->
            val path = Path()
            path.moveTo(x, y)

            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
                .build()

            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    Log.d(TAG, "Gesture tap completed at ($x, $y)")
                    cont.resumeWith(Result.success(true))
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    Log.w(TAG, "Gesture tap cancelled at ($x, $y)")
                    cont.resumeWith(Result.success(false))
                }
            }, null)
        }
    }

    /**
     * Perform a swipe gesture.
     */
    private suspend fun performGestureSwipe(
        startX: Float, startY: Float,
        endX: Float, endY: Float,
        durationMs: Long
    ): Boolean {
        return suspendCancellableCoroutine { cont ->
            val path = Path()
            path.moveTo(startX, startY)
            path.lineTo(endX, endY)

            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
                .build()

            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    cont.resumeWith(Result.success(true))
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    cont.resumeWith(Result.success(false))
                }
            }, null)
        }
    }
}

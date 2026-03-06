package com.u.bank.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Core AccessibilityService for Ü Bank.
 * 
 * Responsibilities:
 * 1. Read the UI tree of any app (especially Bancolombia)
 * 2. Detect screen changes (TYPE_WINDOW_STATE_CHANGED)
 * 3. Execute actions (tap, fill, scroll) on UI elements
 * 4. Provide UI tree snapshots for graph building
 * 
 * Android Accessibility API gives us:
 * - Full tree of AccessibilityNodeInfo objects
 * - className, text, contentDescription, viewIdResourceName
 * - bounds (screen coordinates)
 * - isClickable, isScrollable, isEditable, isFocusable
 * - performAction(ACTION_CLICK), performAction(ACTION_SET_TEXT)
 */
class UAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "UAccessibility"
        
        // Singleton reference for other components to access
        var instance: UAccessibilityService? = null
            private set
        
        // Target packages we monitor
        val MONITORED_PACKAGES = setOf(
            "com.bancolombia.app",
            "com.todo1.mobile",           // Nequi
            "com.davivienda.daviplataapp", // Daviplata
        )
    }

    // Callbacks
    var onScreenChanged: ((screenFingerprint: String, packageName: String) -> Unit)? = null
    var onUiTreeReady: ((tree: JSONObject, packageName: String) -> Unit)? = null

    private var currentPackage: String = ""
    private var currentFingerprint: String = ""
    private var graphExplorer: GraphExplorer? = null
    private var actionExecutor: ActionExecutor? = null

    // ============================================
    // Lifecycle
    // ============================================

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this

        // Configure the service
        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                         AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                         AccessibilityEvent.TYPE_VIEW_CLICKED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                    AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            notificationTimeout = 100
        }

        graphExplorer = GraphExplorer(this)
        actionExecutor = ActionExecutor(this)

        Log.i(TAG, "Ü AccessibilityService connected")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
        Log.i(TAG, "Ü AccessibilityService destroyed")
    }

    // ============================================
    // Event Handling
    // ============================================

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return

        val packageName = event.packageName?.toString() ?: return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                handleWindowChange(packageName, event)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // Content changed within same window — may need to update state
                if (packageName in MONITORED_PACKAGES) {
                    handleContentChange(packageName)
                }
            }
            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                // Track user clicks for graph building
                if (packageName in MONITORED_PACKAGES) {
                    Log.d(TAG, "User clicked in $packageName: ${event.className}")
                }
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "AccessibilityService interrupted")
    }

    private fun handleWindowChange(packageName: String, event: AccessibilityEvent) {
        if (packageName !in MONITORED_PACKAGES) return

        currentPackage = packageName
        val root = rootInActiveWindow ?: return

        // Fingerprint the new screen
        val fingerprint = ScreenFingerprint.compute(root)

        if (fingerprint != currentFingerprint) {
            currentFingerprint = fingerprint
            Log.i(TAG, "Screen changed: $packageName → $fingerprint")

            // Notify listeners
            onScreenChanged?.invoke(fingerprint, packageName)

            // Capture UI tree
            val tree = captureUiTree(root)
            onUiTreeReady?.invoke(tree, packageName)
        }

        root.recycle()
    }

    private fun handleContentChange(packageName: String) {
        // Debounced — only process if significant change
        // (content changes fire very frequently)
    }

    // ============================================
    // UI Tree Capture
    // ============================================

    /**
     * Capture the full UI tree as a JSON object.
     * This is sent to the Jetson for graph building.
     */
    fun captureUiTree(root: AccessibilityNodeInfo? = null): JSONObject {
        val node = root ?: rootInActiveWindow ?: return JSONObject()
        val shouldRecycle = root == null

        val tree = nodeToJson(node)

        if (shouldRecycle) node.recycle()
        return tree
    }

    /**
     * Recursively convert an AccessibilityNodeInfo tree to JSON.
     */
    private fun nodeToJson(node: AccessibilityNodeInfo): JSONObject {
        val json = JSONObject()

        json.put("class", node.className?.toString() ?: "")
        json.put("id", node.viewIdResourceName ?: "")
        json.put("text", node.text?.toString() ?: "")
        json.put("contentDesc", node.contentDescription?.toString() ?: "")
        json.put("clickable", node.isClickable)
        json.put("scrollable", node.isScrollable)
        json.put("editable", node.isEditable)
        json.put("focusable", node.isFocusable)
        json.put("enabled", node.isEnabled)
        json.put("visible", node.isVisibleToUser)

        // Bounds
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)
        json.put("bounds", JSONArray().apply {
            put(rect.left)
            put(rect.top)
            put(rect.right)
            put(rect.bottom)
        })

        // Children
        val children = JSONArray()
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            children.put(nodeToJson(child))
            child.recycle()
        }
        if (children.length() > 0) {
            json.put("children", children)
        }

        return json
    }

    // ============================================
    // Element Finding
    // ============================================

    /**
     * Find a UI element by selector (id, text, contentDescription, class).
     * Returns the first matching node.
     */
    fun findElement(selector: JSONObject): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null

        // Try by resource ID first (most reliable)
        val id = selector.optString("id", "")
        if (id.isNotEmpty()) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            if (nodes.isNotEmpty()) return nodes[0]
        }

        // Try by text
        val text = selector.optString("text", "")
        if (text.isNotEmpty()) {
            val nodes = root.findAccessibilityNodeInfosByText(text)
            if (nodes.isNotEmpty()) return nodes[0]
        }

        // Try by content description (DFS)
        val contentDesc = selector.optString("content_desc", "")
        if (contentDesc.isNotEmpty()) {
            return findByContentDescription(root, contentDesc)
        }

        // Try by class name (DFS)
        val className = selector.optString("class", "")
        if (className.isNotEmpty()) {
            return findByClassName(root, className)
        }

        return null
    }

    private fun findByContentDescription(
        node: AccessibilityNodeInfo,
        desc: String
    ): AccessibilityNodeInfo? {
        if (node.contentDescription?.toString()?.contains(desc, ignoreCase = true) == true) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findByContentDescription(child, desc)
            if (result != null) return result
            child.recycle()
        }
        return null
    }

    private fun findByClassName(
        node: AccessibilityNodeInfo,
        className: String
    ): AccessibilityNodeInfo? {
        if (node.className?.toString() == className) {
            return node
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findByClassName(child, className)
            if (result != null) return result
            child.recycle()
        }
        return null
    }

    // ============================================
    // Clickable Elements Extraction
    // ============================================

    /**
     * Get all clickable/interactive elements on the current screen.
     * Used by GraphExplorer for automated exploration.
     */
    fun getClickableElements(): List<JSONObject> {
        val root = rootInActiveWindow ?: return emptyList()
        val elements = mutableListOf<JSONObject>()
        collectClickables(root, elements)
        root.recycle()
        return elements
    }

    private fun collectClickables(node: AccessibilityNodeInfo, out: MutableList<JSONObject>) {
        if (node.isClickable && node.isVisibleToUser && node.isEnabled) {
            val elem = JSONObject()
            elem.put("id", node.viewIdResourceName ?: "")
            elem.put("text", node.text?.toString() ?: "")
            elem.put("contentDesc", node.contentDescription?.toString() ?: "")
            elem.put("class", node.className?.toString() ?: "")

            val rect = android.graphics.Rect()
            node.getBoundsInScreen(rect)
            elem.put("bounds", JSONArray().apply {
                put(rect.left); put(rect.top); put(rect.right); put(rect.bottom)
            })

            out.add(elem)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectClickables(child, out)
            child.recycle()
        }
    }

    // ============================================
    // Public API for ActionExecutor
    // ============================================

    fun getExecutor(): ActionExecutor? = actionExecutor
    fun getExplorer(): GraphExplorer? = graphExplorer
    fun getCurrentFingerprint(): String = currentFingerprint
    fun getCurrentPackage(): String = currentPackage
}

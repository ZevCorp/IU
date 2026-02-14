package com.u.bank.service

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * GraphExplorer — Automated DFS exploration of an app's UI.
 * 
 * Builds a navigation graph by:
 * 1. Capturing the current screen's UI tree
 * 2. Identifying all clickable elements
 * 3. Clicking each one, capturing the new screen
 * 4. If it's a new state → add node + edge to graph
 * 5. Navigate back and repeat
 * 6. Recurse into new screens (DFS)
 * 
 * The result is a JSON graph that the Jetson can compile into a 30x30 maze.
 */
class GraphExplorer(private val service: UAccessibilityService) {

    companion object {
        private const val TAG = "GraphExplorer"
        private const val MAX_DEPTH = 5
        private const val MAX_NODES = 50
        private const val POST_CLICK_DELAY_MS = 1200L
        private const val POST_BACK_DELAY_MS = 800L
    }

    // Graph state
    private val nodes = mutableMapOf<String, JSONObject>()       // fingerprint → node data
    private val edges = mutableListOf<JSONObject>()               // edge list
    private val fingerprintToId = mutableMapOf<String, String>()  // fingerprint → human-readable ID
    private var nodeCounter = 0
    private var exploring = false

    // Callback when exploration completes
    var onExplorationComplete: ((graph: JSONObject) -> Unit)? = null
    var onProgress: ((nodesFound: Int, currentDepth: Int) -> Unit)? = null

    // ============================================
    // Public API
    // ============================================

    /**
     * Start automated exploration of the current app.
     * Runs asynchronously — results delivered via onExplorationComplete callback.
     */
    fun startExploration(
        appPackage: String,
        maxDepth: Int = MAX_DEPTH,
        scope: CoroutineScope = CoroutineScope(Dispatchers.Main)
    ) {
        if (exploring) {
            Log.w(TAG, "Already exploring — ignoring")
            return
        }

        exploring = true
        nodes.clear()
        edges.clear()
        fingerprintToId.clear()
        nodeCounter = 0

        Log.i(TAG, "Starting exploration of $appPackage (maxDepth: $maxDepth)")

        scope.launch {
            try {
                val root = service.rootInActiveWindow
                if (root == null) {
                    Log.e(TAG, "No active window — cannot explore")
                    exploring = false
                    return@launch
                }

                // Capture initial state
                val initialFp = ScreenFingerprint.compute(root)
                val initialId = generateNodeId(root, appPackage)
                registerNode(initialFp, initialId, root)
                root.recycle()

                // DFS explore
                explore(initialFp, depth = 0, maxDepth = maxDepth)

                // Build and deliver the graph
                val graph = buildGraphJson(appPackage)
                Log.i(TAG, "Exploration complete: ${nodes.size} nodes, ${edges.size} edges")
                onExplorationComplete?.invoke(graph)

            } catch (e: Exception) {
                Log.e(TAG, "Exploration failed", e)
            } finally {
                exploring = false
            }
        }
    }

    /**
     * Stop ongoing exploration.
     */
    fun stopExploration() {
        exploring = false
        Log.i(TAG, "Exploration stopped")
    }

    /**
     * Get the current graph (even if exploration is still running).
     */
    fun getCurrentGraph(appPackage: String): JSONObject {
        return buildGraphJson(appPackage)
    }

    // ============================================
    // DFS Exploration
    // ============================================

    private suspend fun explore(currentFp: String, depth: Int, maxDepth: Int) {
        if (!exploring) return
        if (depth >= maxDepth) return
        if (nodes.size >= MAX_NODES) return

        val currentId = fingerprintToId[currentFp] ?: return

        Log.d(TAG, "Exploring: $currentId (depth: $depth, nodes: ${nodes.size})")
        onProgress?.invoke(nodes.size, depth)

        // Get all clickable elements on this screen
        val clickables = service.getClickableElements()
        Log.d(TAG, "Found ${clickables.size} clickable elements")

        // Filter to meaningful clickables (skip tiny/decorative elements)
        val meaningful = clickables.filter { elem ->
            val text = elem.optString("text", "")
            val desc = elem.optString("contentDesc", "")
            val id = elem.optString("id", "")
            val bounds = elem.optJSONArray("bounds")

            // Must have some identifier
            val hasIdentifier = text.isNotEmpty() || desc.isNotEmpty() || id.isNotEmpty()

            // Must be reasonably sized (not a tiny icon)
            val hasSize = if (bounds != null && bounds.length() == 4) {
                val width = bounds.getInt(2) - bounds.getInt(0)
                val height = bounds.getInt(3) - bounds.getInt(1)
                width > 30 && height > 30
            } else true

            hasIdentifier && hasSize
        }

        Log.d(TAG, "Meaningful clickables: ${meaningful.size}")

        // Try clicking each element
        for (elem in meaningful) {
            if (!exploring) break
            if (nodes.size >= MAX_NODES) break

            val elemText = elem.optString("text", elem.optString("contentDesc", "unknown"))
            Log.d(TAG, "Trying click: '$elemText'")

            // Click the element
            val clicked = tryClick(elem)
            if (!clicked) continue

            // Wait for UI to settle
            delay(POST_CLICK_DELAY_MS)

            // Capture new state
            val newRoot = service.rootInActiveWindow
            if (newRoot == null) {
                // App might have crashed or closed — go back
                navigateBack()
                delay(POST_BACK_DELAY_MS)
                continue
            }

            val newFp = ScreenFingerprint.compute(newRoot)
            val newPackage = service.getCurrentPackage()

            // Check if we left the target app
            if (newPackage != "" && !UAccessibilityService.MONITORED_PACKAGES.contains(newPackage)) {
                Log.d(TAG, "Left target app — navigating back")
                newRoot.recycle()
                navigateBack()
                delay(POST_BACK_DELAY_MS)
                continue
            }

            if (newFp != currentFp) {
                // New screen discovered!
                val isNew = newFp !in fingerprintToId

                if (isNew) {
                    val newId = generateNodeId(newRoot, newPackage)
                    registerNode(newFp, newId, newRoot)
                    Log.i(TAG, "New screen: $newId (total: ${nodes.size})")
                }

                val newId = fingerprintToId[newFp]!!

                // Register edge
                registerEdge(currentId, newId, elem)

                // Recurse into new screen
                if (isNew) {
                    explore(newFp, depth + 1, maxDepth)
                }
            }

            newRoot.recycle()

            // Navigate back to current screen
            navigateBack()
            delay(POST_BACK_DELAY_MS)

            // Verify we're back on the right screen
            val backRoot = service.rootInActiveWindow
            if (backRoot != null) {
                val backFp = ScreenFingerprint.compute(backRoot)
                backRoot.recycle()

                if (backFp != currentFp) {
                    Log.w(TAG, "Back didn't return to expected screen — trying again")
                    navigateBack()
                    delay(POST_BACK_DELAY_MS)
                }
            }
        }
    }

    // ============================================
    // Node & Edge Registration
    // ============================================

    private fun registerNode(fingerprint: String, id: String, root: AccessibilityNodeInfo) {
        if (fingerprint in fingerprintToId) return

        fingerprintToId[fingerprint] = id

        val nodeData = JSONObject()
        nodeData.put("id", id)
        nodeData.put("fingerprint", fingerprint)
        nodeData.put("label", inferScreenLabel(root))
        nodeData.put("edges", JSONArray())

        // Capture key elements for the accessibility snapshot
        val snapshot = JSONObject()
        snapshot.put("root_class", root.className?.toString() ?: "")
        val keyElements = JSONArray()
        val clickables = service.getClickableElements()
        for (elem in clickables.take(20)) { // Limit to 20 key elements
            keyElements.put(elem)
        }
        snapshot.put("key_elements", keyElements)
        nodeData.put("accessibility_snapshot", snapshot)

        nodes[fingerprint] = nodeData
    }

    private fun registerEdge(fromId: String, toId: String, clickedElement: JSONObject) {
        // Check if edge already exists
        val exists = edges.any { edge ->
            edge.optString("from") == fromId && edge.optString("to") == toId
        }
        if (exists) return

        val edge = JSONObject()
        edge.put("from", fromId)
        edge.put("to", toId)
        edge.put("action", JSONObject().apply {
            put("type", "tap")
            put("selector", JSONObject().apply {
                put("id", clickedElement.optString("id", ""))
                put("text", clickedElement.optString("text", ""))
                put("content_desc", clickedElement.optString("contentDesc", ""))
            })
        })
        edge.put("weight", 1)

        edges.add(edge)

        // Also add to the node's edge list
        val fromFp = fingerprintToId.entries.find { it.value == fromId }?.key
        if (fromFp != null) {
            val nodeData = nodes[fromFp]
            nodeData?.optJSONArray("edges")?.put(toId)
        }

        Log.d(TAG, "Edge: $fromId → $toId")
    }

    // ============================================
    // Helpers
    // ============================================

    private fun generateNodeId(root: AccessibilityNodeInfo, packageName: String): String {
        // Try to infer a meaningful name from the activity or key elements
        val label = inferScreenLabel(root)
        val sanitized = label.lowercase()
            .replace(Regex("[^a-z0-9]+"), "_")
            .trim('_')
            .take(30)

        // Ensure uniqueness
        val baseId = if (sanitized.isNotEmpty()) sanitized else "screen_${nodeCounter}"
        var id = baseId
        var counter = 2
        while (fingerprintToId.containsValue(id)) {
            id = "${baseId}_$counter"
            counter++
        }

        nodeCounter++
        return id
    }

    private fun inferScreenLabel(root: AccessibilityNodeInfo): String {
        // Try to find a title/header element
        val titleNode = findTitleElement(root)
        if (titleNode != null) {
            val text = titleNode.text?.toString() ?: titleNode.contentDescription?.toString() ?: ""
            titleNode.recycle()
            if (text.isNotEmpty()) return text
        }

        // Fallback: use the activity class name
        return root.className?.toString()?.substringAfterLast('.') ?: "Screen"
    }

    private fun findTitleElement(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        // Look for common title patterns
        val id = node.viewIdResourceName ?: ""
        if (id.contains("title") || id.contains("toolbar") || id.contains("header")) {
            if (node.text?.isNotEmpty() == true) return node
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findTitleElement(child)
            if (result != null) return result
            child.recycle()
        }
        return null
    }

    private fun tryClick(element: JSONObject): Boolean {
        val selector = JSONObject().apply {
            put("id", element.optString("id", ""))
            put("text", element.optString("text", ""))
            put("content_desc", element.optString("contentDesc", ""))
        }

        val node = service.findElement(selector) ?: return false

        val result = if (node.isClickable) {
            node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
            // Try parent
            var parent = node.parent
            var clicked = false
            while (parent != null && !clicked) {
                if (parent.isClickable) {
                    clicked = parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                }
                val gp = parent.parent
                parent.recycle()
                parent = gp
            }
            clicked
        }

        node.recycle()
        return result
    }

    private fun navigateBack() {
        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }

    // ============================================
    // Graph JSON Export
    // ============================================

    private fun buildGraphJson(appPackage: String): JSONObject {
        val graph = JSONObject()
        graph.put("app", appPackage)
        graph.put("version", "1.0.0")
        graph.put("extracted_at", System.currentTimeMillis())
        graph.put("node_count", nodes.size)
        graph.put("edge_count", edges.size)

        // Nodes — convert from fingerprint-keyed to id-keyed
        val nodesObj = JSONObject()
        for ((_, nodeData) in nodes) {
            val id = nodeData.optString("id")
            nodesObj.put(id, nodeData)
        }
        graph.put("nodes", nodesObj)

        // Edges
        val edgesArr = JSONArray()
        for (edge in edges) {
            edgesArr.put(edge)
        }
        graph.put("edges", edgesArr)

        return graph
    }
}

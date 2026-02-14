package com.u.bank.service

import android.view.accessibility.AccessibilityNodeInfo

/**
 * Screen Fingerprinting — Determines if two screens are the "same state".
 * 
 * Strategy: Hash the STRUCTURAL layout (class names, IDs, clickable/scrollable flags)
 * but NOT the dynamic content (text values, list items). This way:
 * - "Home screen with $50,000 balance" == "Home screen with $100,000 balance"
 * - "Transfer screen" != "Pocket detail screen"
 * - "Contact list showing María" == "Contact list showing Pedro"
 */
object ScreenFingerprint {

    /**
     * Compute a structural fingerprint of the current screen.
     * Returns a hex string hash.
     */
    fun compute(root: AccessibilityNodeInfo): String {
        val sb = StringBuilder()
        sb.append(root.className ?: "")
        sb.append("|")
        traverseStructure(root, sb, depth = 0, maxDepth = 6)
        return sb.toString().hashCode().toString(16)
    }

    /**
     * Compute a detailed fingerprint that includes some content.
     * Used for more precise state matching.
     */
    fun computeDetailed(root: AccessibilityNodeInfo): String {
        val sb = StringBuilder()
        sb.append(root.className ?: "")
        sb.append("|")
        traverseDetailed(root, sb, depth = 0, maxDepth = 8)
        return sb.toString().hashCode().toString(16)
    }

    /**
     * Check if two screens are structurally equivalent.
     */
    fun isSameScreen(fp1: String, fp2: String): Boolean {
        return fp1 == fp2
    }

    // ============================================
    // Structural Traversal (ignores dynamic content)
    // ============================================

    private fun traverseStructure(
        node: AccessibilityNodeInfo,
        sb: StringBuilder,
        depth: Int,
        maxDepth: Int
    ) {
        if (depth > maxDepth) return

        // Structural properties only
        sb.append(node.className ?: "")
        sb.append(node.viewIdResourceName ?: "")
        if (node.isClickable) sb.append("C")
        if (node.isScrollable) sb.append("S")
        if (node.isEditable) sb.append("E")
        sb.append(",")

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            traverseStructure(child, sb, depth + 1, maxDepth)
            child.recycle()
        }
    }

    // ============================================
    // Detailed Traversal (includes key content)
    // ============================================

    private fun traverseDetailed(
        node: AccessibilityNodeInfo,
        sb: StringBuilder,
        depth: Int,
        maxDepth: Int
    ) {
        if (depth > maxDepth) return

        sb.append(node.className ?: "")
        sb.append(node.viewIdResourceName ?: "")
        if (node.isClickable) sb.append("C")
        if (node.isScrollable) sb.append("S")

        // Include text for buttons and labels (not for list items)
        if (node.isClickable || isLabel(node)) {
            val text = node.text?.toString() ?: ""
            val desc = node.contentDescription?.toString() ?: ""
            if (text.isNotEmpty()) sb.append("T:$text")
            if (desc.isNotEmpty()) sb.append("D:$desc")
        }

        sb.append(",")

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            traverseDetailed(child, sb, depth + 1, maxDepth)
            child.recycle()
        }
    }

    private fun isLabel(node: AccessibilityNodeInfo): Boolean {
        val className = node.className?.toString() ?: ""
        return className.contains("TextView") && !className.contains("EditText")
    }

    // ============================================
    // Screen Similarity (for fuzzy matching)
    // ============================================

    /**
     * Extract key structural features for similarity comparison.
     * Returns a set of feature strings.
     */
    fun extractFeatures(root: AccessibilityNodeInfo): Set<String> {
        val features = mutableSetOf<String>()
        collectFeatures(root, features, depth = 0, maxDepth = 5)
        return features
    }

    private fun collectFeatures(
        node: AccessibilityNodeInfo,
        features: MutableSet<String>,
        depth: Int,
        maxDepth: Int
    ) {
        if (depth > maxDepth) return

        val id = node.viewIdResourceName
        if (id != null) {
            features.add("id:$id")
        }

        if (node.isClickable) {
            val text = node.text?.toString() ?: node.contentDescription?.toString() ?: ""
            if (text.isNotEmpty()) {
                features.add("btn:$text")
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectFeatures(child, features, depth + 1, maxDepth)
            child.recycle()
        }
    }

    /**
     * Jaccard similarity between two feature sets.
     * Returns 0.0 - 1.0 (1.0 = identical).
     */
    fun similarity(features1: Set<String>, features2: Set<String>): Float {
        if (features1.isEmpty() && features2.isEmpty()) return 1.0f
        val intersection = features1.intersect(features2).size
        val union = features1.union(features2).size
        return if (union > 0) intersection.toFloat() / union.toFloat() else 0.0f
    }
}

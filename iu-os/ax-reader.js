#!/usr/bin/env osascript -l JavaScript
/**
 * AX Reader - macOS Accessibility Tree Extractor
 * 
 * Reads the UI elements from the active window and returns
 * a flattened semantic snapshot for LLM reasoning.
 * 
 * Usage: osascript -l JavaScript ax-reader.js
 */

ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function run() {
    const result = {
        app: null,
        window: null,
        snapshot: [],
        error: null
    };

    try {
        // Get the frontmost application
        const frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        const pid = frontApp.processIdentifier;
        const appName = ObjC.unwrap(frontApp.localizedName);

        result.app = appName;

        // Create AXUIElement for the application
        const appElement = $.AXUIElementCreateApplication(pid);

        // Try multiple methods to get a window
        let window = null;

        // Method 1: AXFocusedWindow
        const focusedRef = Ref();
        if ($.AXUIElementCopyAttributeValue(appElement, 'AXFocusedWindow', focusedRef) === 0 && focusedRef[0]) {
            window = focusedRef[0];
        }

        // Method 2: AXMainWindow
        if (!window) {
            const mainRef = Ref();
            if ($.AXUIElementCopyAttributeValue(appElement, 'AXMainWindow', mainRef) === 0 && mainRef[0]) {
                window = mainRef[0];
            }
        }

        // Method 3: First window from AXWindows
        if (!window) {
            const windowsRef = Ref();
            if ($.AXUIElementCopyAttributeValue(appElement, 'AXWindows', windowsRef) === 0 && windowsRef[0]) {
                const windows = ObjC.unwrap(windowsRef[0]);
                if (windows && windows.length > 0) {
                    window = windows[0];
                }
            }
        }

        if (!window) {
            result.error = 'No window found';
            return JSON.stringify(result);
        }

        // Get window title
        const titleRef = Ref();
        if ($.AXUIElementCopyAttributeValue(window, 'AXTitle', titleRef) === 0) {
            result.window = ObjC.unwrap(titleRef[0]) || 'Untitled';
        }

        // Get window frame for normalization
        const posRef = Ref();
        const sizeRef = Ref();
        $.AXUIElementCopyAttributeValue(window, 'AXPosition', posRef);
        $.AXUIElementCopyAttributeValue(window, 'AXSize', sizeRef);

        let winX = 0, winY = 0, winW = 1920, winH = 1080;

        if (posRef[0]) {
            const pos = {};
            $.AXValueGetValue(posRef[0], $.kAXValueCGPointType, pos);
            winX = pos.x || 0;
            winY = pos.y || 0;
        }
        if (sizeRef[0]) {
            const size = {};
            $.AXValueGetValue(sizeRef[0], $.kAXValueCGSizeType, size);
            winW = size.width || 1920;
            winH = size.height || 1080;
        }

        // Target roles - buttons, links, inputs, and text
        const targetRoles = [
            'AXButton', 'AXLink', 'AXTextField', 'AXTextArea',
            'AXStaticText', 'AXMenuItem', 'AXPopUpButton',
            'AXCheckBox', 'AXRadioButton', 'AXTab'
        ];

        let elementId = 0;
        const maxElements = 40;

        // Recursive traversal function
        function traverse(element, depth) {
            if (depth > 15 || elementId >= maxElements) return;

            try {
                // Get role
                const roleRef = Ref();
                if ($.AXUIElementCopyAttributeValue(element, 'AXRole', roleRef) !== 0) return;
                const role = ObjC.unwrap(roleRef[0]);
                if (!role) return;

                // Check if this is a target role
                if (targetRoles.includes(role)) {
                    // Get label from multiple possible attributes
                    let label = null;
                    const labelAttrs = ['AXTitle', 'AXValue', 'AXDescription', 'AXLabel', 'AXHelp'];

                    for (const attr of labelAttrs) {
                        try {
                            const labelRef = Ref();
                            if ($.AXUIElementCopyAttributeValue(element, attr, labelRef) === 0 && labelRef[0]) {
                                const val = ObjC.unwrap(labelRef[0]);
                                if (val && typeof val === 'string' && val.trim().length > 0) {
                                    label = val.trim().substring(0, 80);
                                    break;
                                }
                            }
                        } catch (e) { }
                    }

                    // For StaticText, we want the text even without explicit label
                    if (role === 'AXStaticText' && !label) {
                        const valRef = Ref();
                        if ($.AXUIElementCopyAttributeValue(element, 'AXValue', valRef) === 0 && valRef[0]) {
                            const val = ObjC.unwrap(valRef[0]);
                            if (val && typeof val === 'string') {
                                label = val.trim().substring(0, 80);
                            }
                        }
                    }

                    // Skip if no label (except for some clickable elements)
                    if (!label && role !== 'AXButton') return;

                    // Get position and size
                    const elPosRef = Ref();
                    const elSizeRef = Ref();

                    if ($.AXUIElementCopyAttributeValue(element, 'AXPosition', elPosRef) !== 0) return;
                    if ($.AXUIElementCopyAttributeValue(element, 'AXSize', elSizeRef) !== 0) return;

                    let x = 0, y = 0, w = 0, h = 0;

                    if (elPosRef[0]) {
                        const pos = {};
                        $.AXValueGetValue(elPosRef[0], $.kAXValueCGPointType, pos);
                        x = pos.x || 0;
                        y = pos.y || 0;
                    }
                    if (elSizeRef[0]) {
                        const size = {};
                        $.AXValueGetValue(elSizeRef[0], $.kAXValueCGSizeType, size);
                        w = size.width || 0;
                        h = size.height || 0;
                    }

                    // Skip tiny elements
                    if (w < 5 || h < 5) return;

                    // Calculate normalized bbox
                    const bbox = {
                        x: Math.max(0, Math.min(1, (x - winX) / winW)),
                        y: Math.max(0, Math.min(1, (y - winY) / winH)),
                        w: Math.min(1, w / winW),
                        h: Math.min(1, h / winH)
                    };

                    // Map role to simple type
                    let type = 'text';
                    if (role === 'AXButton' || role === 'AXPopUpButton') type = 'button';
                    else if (role === 'AXLink') type = 'link';
                    else if (role === 'AXTextField' || role === 'AXTextArea') type = 'input';
                    else if (role === 'AXMenuItem' || role === 'AXTab') type = 'menu';
                    else if (role === 'AXCheckBox' || role === 'AXRadioButton') type = 'checkbox';

                    elementId++;
                    result.snapshot.push({
                        id: String(elementId),
                        type: type,
                        label: label,
                        bbox: bbox,
                        confidence: 1.0
                    });
                }

                // Traverse children
                const childrenRef = Ref();
                if ($.AXUIElementCopyAttributeValue(element, 'AXChildren', childrenRef) === 0 && childrenRef[0]) {
                    const children = ObjC.unwrap(childrenRef[0]);
                    if (children && children.length) {
                        const maxChildren = Math.min(children.length, 100);
                        for (let i = 0; i < maxChildren && elementId < maxElements; i++) {
                            traverse(children[i], depth + 1);
                        }
                    }
                }
            } catch (e) {
                // Silently continue on element errors
            }
        }

        // Start traversal from window
        traverse(window, 0);

    } catch (e) {
        result.error = String(e);
    }

    return JSON.stringify(result);
}

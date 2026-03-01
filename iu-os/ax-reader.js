#!/usr/bin/env osascript -l JavaScript
/**
 * AX Reader v2 - Improved with permission handling and diagnostics
 * 
 * Returns a robust accessibility snapshot with proper error handling
 */

ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function run(argv) {
    const result = {
        app: null,
        window: null,
        snapshot: [],
        error: null,
        diagnostic: null
    };

    const targetRoles = [
        'AXButton', 'AXLink', 'AXTextField', 'AXTextArea', 'AXStaticText',
        'AXMenuItem', 'AXPopUpButton', 'AXCheckBox', 'AXRadioButton',
        'AXTab', 'AXImage', 'AXScrollArea', 'AXSlider', 'AXToolbar',
        'AXGroup'
    ];

    function readAttrString(element, attrName) {
        try {
            const ref = Ref();
            if ($.AXUIElementCopyAttributeValue(element, attrName, ref) !== 0 || !ref[0]) return null;
            const value = ObjC.unwrap(ref[0]);
            if (value === null || value === undefined) return null;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed.length > 0 ? trimmed : null;
            }
            return String(value);
        } catch (_) {
            return null;
        }
    }

    function readRect(element) {
        let x = 0, y = 0, w = 0, h = 0;
        try {
            const posRef = Ref();
            const sizeRef = Ref();
            if ($.AXUIElementCopyAttributeValue(element, 'AXPosition', posRef) === 0 && posRef[0]) {
                const pos = {};
                $.AXValueGetValue(posRef[0], $.kAXValueCGPointType, pos);
                x = pos.x || 0;
                y = pos.y || 0;
            }
            if ($.AXUIElementCopyAttributeValue(element, 'AXSize', sizeRef) === 0 && sizeRef[0]) {
                const size = {};
                $.AXValueGetValue(sizeRef[0], $.kAXValueCGSizeType, size);
                w = size.width || 0;
                h = size.height || 0;
            }
        } catch (_) { }
        return { x, y, w, h };
    }

    function mapRoleToType(role) {
        if (role === 'AXDockItem') return 'button';
        if (role === 'AXButton' || role === 'AXPopUpButton') return 'button';
        if (role === 'AXLink') return 'link';
        if (role === 'AXTextField' || role === 'AXTextArea') return 'input';
        if (role === 'AXMenuItem' || role === 'AXTab') return 'menu';
        if (role === 'AXCheckBox' || role === 'AXRadioButton') return 'checkbox';
        return 'text';
    }

    function sanitizeLabel(value) {
        const text = String(value || '')
            .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return null;
        if (text === 'AXUnknown' || text === 'unknown') return null;
        return text;
    }

    function getParentElement(element) {
        try {
            const parentRef = Ref();
            if ($.AXUIElementCopyAttributeValue(element, 'AXParent', parentRef) === 0 && parentRef[0]) {
                return parentRef[0];
            }
        } catch (_) { }
        return null;
    }

    function isUsefulRole(role) {
        if (!role) return false;
        if (role === 'AXUnknown' || role === 'AXApplication' || role === 'AXWindow') return false;
        return true;
    }

    function resolveBestHitElement(hitEl) {
        let current = hitEl;
        let depth = 0;
        let fallback = null;

        while (current && depth < 8) {
            const role = readAttrString(current, 'AXRole') || 'AXUnknown';
            const title = sanitizeLabel(readAttrString(current, 'AXTitle'));
            const value = sanitizeLabel(readAttrString(current, 'AXValue'));
            const description = sanitizeLabel(readAttrString(current, 'AXDescription'));
            const label = sanitizeLabel(readAttrString(current, 'AXLabel'));
            const help = sanitizeLabel(readAttrString(current, 'AXHelp'));
            const roleDesc = sanitizeLabel(readAttrString(current, 'AXRoleDescription'));
            const bestLabel = title || value || description || label || help || roleDesc || null;

            if (!fallback) {
                fallback = { element: current, role, label: bestLabel };
            }

            if (isUsefulRole(role) && bestLabel) {
                return { element: current, role, label: bestLabel };
            }
            if (isUsefulRole(role) && targetRoles.includes(role)) {
                return { element: current, role, label: bestLabel || role };
            }

            current = getParentElement(current);
            depth++;
        }

        return fallback || { element: hitEl, role: 'AXUnknown', label: null };
    }

    try {
        // Accept arguments: [appName, hitX, hitY]
        const targetApp = argv && argv.length > 0 ? argv[0] : null;
        const hitX = argv && argv.length > 1 ? parseFloat(argv[1]) : null;
        const hitY = argv && argv.length > 2 ? parseFloat(argv[2]) : null;

        let frontApp, pid, appName;

        if (targetApp) {
            // Try to get specific app
            try {
                const app = Application(targetApp);
                if (!app.running()) {
                    result.error = `App "${targetApp}" is not running`;
                    result.diagnostic = "APP_NOT_RUNNING";
                    return JSON.stringify(result);
                }
                app.activate();
                delay(0.5); // Give time to become frontmost
            } catch (e) {
                result.error = `Could not activate app "${targetApp}": ${e}`;
                result.diagnostic = "ACTIVATION_FAILED";
                return JSON.stringify(result);
            }
        }

        // Get the frontmost application
        frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        pid = frontApp.processIdentifier;
        appName = ObjC.unwrap(frontApp.localizedName);

        result.app = appName;
        // Primary screen size used for normalized bounding boxes.
        let screenW = 1920;
        let screenH = 1080;
        try {
            const mainScreen = $.NSScreen.mainScreen;
            if (mainScreen) {
                const frame = mainScreen.frame;
                if (frame && frame.size) {
                    screenW = Number(frame.size.width) || screenW;
                    screenH = Number(frame.size.height) || screenH;
                }
            }
        } catch (_) { }

        // Global hit-testing path: uses system-wide AX so it can detect Dock/Desktop/etc.
        if (hitX !== null && hitY !== null) {
            try {
                const systemWide = $.AXUIElementCreateSystemWide();
                const hitRef = Ref();
                const hitErr = $.AXUIElementCopyElementAtPosition(systemWide, hitX, hitY, hitRef);
                if (hitErr === 0 && hitRef[0]) {
                    const hitEl = hitRef[0];
                    const bestHit = resolveBestHitElement(hitEl);
                    const role = bestHit.role || 'AXUnknown';
                    const bestLabel = sanitizeLabel(bestHit.label) || role;
                    const rect = readRect(bestHit.element || hitEl);

                    let appAtPoint = appName;
                    try {
                        const pidRef = Ref();
                        if ($.AXUIElementGetPid(bestHit.element || hitEl, pidRef) === 0 && pidRef[0]) {
                            const pidAtPoint = Number(pidRef[0]);
                            const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pidAtPoint);
                            if (running) {
                                const localized = ObjC.unwrap(running.localizedName);
                                if (localized) appAtPoint = localized;
                            }
                        }
                    } catch (_) { }

                    result.app = appAtPoint;
                    result.snapshot = [{
                        id: 'hit',
                        type: mapRoleToType(role),
                        label: bestLabel,
                        role: role,
                        app: appAtPoint,
                        bbox: {
                            x: Math.max(0, Math.min(1, rect.x / screenW)),
                            y: Math.max(0, Math.min(1, rect.y / screenH)),
                            w: Math.max(0, Math.min(1, rect.w / screenW)),
                            h: Math.max(0, Math.min(1, rect.h / screenH))
                        },
                        confidence: 1.0
                    }];
                    return JSON.stringify(result);
                }
            } catch (_) { }
        }

        // Create AXUIElement for the application
        const appElement = $.AXUIElementCreateApplication(pid);

        // Try multiple methods to get a window
        let window = null;
        let windowMethod = null;

        // Method 1: AXFocusedWindow
        const focusedRef = Ref();
        const focusedResult = $.AXUIElementCopyAttributeValue(appElement, 'AXFocusedWindow', focusedRef);
        if (focusedResult === 0 && focusedRef[0]) {
            window = focusedRef[0];
            windowMethod = 'AXFocusedWindow';
        }

        // Method 2: AXMainWindow
        if (!window) {
            const mainRef = Ref();
            const mainResult = $.AXUIElementCopyAttributeValue(appElement, 'AXMainWindow', mainRef);
            if (mainResult === 0 && mainRef[0]) {
                window = mainRef[0];
                windowMethod = 'AXMainWindow';
            }
        }

        // Method 3: First window from AXWindows
        if (!window) {
            const windowsRef = Ref();
            const windowsResult = $.AXUIElementCopyAttributeValue(appElement, 'AXWindows', windowsRef);
            if (windowsResult === 0 && windowsRef[0]) {
                const windows = ObjC.unwrap(windowsRef[0]);
                if (windows && windows.length > 0) {
                    window = windows[0];
                    windowMethod = 'AXWindows[0]';
                }
            } else if (windowsResult === -25201) {
                // kAXErrorCannotComplete - permission denied
                result.error = 'Permission denied - Accessibility access required';
                result.diagnostic = 'PERMISSION_DENIED';
                return JSON.stringify(result);
            }
        }

        if (!window) {
            result.error = 'No window found';
            result.diagnostic = 'NO_WINDOW';
            return JSON.stringify(result);
        }

        result.diagnostic = `Window found via ${windowMethod}`;

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

        // screenW/screenH already resolved above

        let elementId = 0;
        const maxElements = 40;

        let bestHit = null;
        let smallestArea = Infinity;

        // Recursive traversal function
        function traverse(element, depth) {
            if (depth > 20 || (hitX === null && elementId >= maxElements)) return;

            try {
                // Get role
                const roleRef = Ref();
                if ($.AXUIElementCopyAttributeValue(element, 'AXRole', roleRef) !== 0) return;
                const role = ObjC.unwrap(roleRef[0]);
                if (!role) return;

                let isTarget = targetRoles.includes(role);

                // Get position and size
                const elPosRef = Ref();
                const elSizeRef = Ref();

                if ($.AXUIElementCopyAttributeValue(element, 'AXPosition', elPosRef) === 0 &&
                    $.AXUIElementCopyAttributeValue(element, 'AXSize', elSizeRef) === 0) {

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

                    // Hit testing: Check if point is inside
                    if (hitX !== null && hitY !== null) {
                        if (hitX >= x && hitX <= x + w && hitY >= y && hitY <= y + h) {
                            const area = w * h;
                            // If it's a target role and smaller than our previous best hit, mark it
                            if (isTarget && area <= smallestArea) {
                                smallestArea = area;
                                bestHit = {
                                    role: role,
                                    x: x, y: y, w: w, h: h,
                                    element: element
                                };
                            }
                        } else {
                            // Point is outside this container, skip children
                            return;
                        }
                    }

                    if (isTarget && hitX === null) {
                        // Regular extraction logic
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

                        if (role === 'AXStaticText' && !label) {
                            const valRef = Ref();
                            if ($.AXUIElementCopyAttributeValue(element, 'AXValue', valRef) === 0 && valRef[0]) {
                                const val = ObjC.unwrap(valRef[0]);
                                if (val && typeof val === 'string') label = val.trim().substring(0, 80);
                            }
                        }

                        if (label || role === 'AXButton') {
                            if (w >= 5 && h >= 5) {
                                const bbox = {
                                    x: Math.max(0, Math.min(1, x / screenW)),
                                    y: Math.max(0, Math.min(1, y / screenH)),
                                    w: Math.min(1, w / screenW),
                                    h: Math.min(1, h / screenH)
                                };

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
                        }
                    }
                }

                // Traverse children
                const childrenRef = Ref();
                if ($.AXUIElementCopyAttributeValue(element, 'AXChildren', childrenRef) === 0 && childrenRef[0]) {
                    const children = ObjC.unwrap(childrenRef[0]);
                    if (children && children.length) {
                        const maxChildren = children.length;
                        for (let i = 0; i < maxChildren; i++) {
                            traverse(children[i], depth + 1);
                        }
                    }
                }
            } catch (e) { }
        }

        // Start traversal from window
        traverse(window, 0);

        // If we were hit-testing, format the best hit as the only element in snapshot
        if (hitX !== null && bestHit) {
            // Re-extract data for the best hit
            const element = bestHit.element;
            const role = bestHit.role;
            let label = null;
            const labelAttrs = ['AXTitle', 'AXValue', 'AXDescription', 'AXLabel', 'AXHelp'];
            for (const attr of labelAttrs) {
                const labelRef = Ref();
                if ($.AXUIElementCopyAttributeValue(element, attr, labelRef) === 0 && labelRef[0]) {
                    const val = ObjC.unwrap(labelRef[0]);
                    if (val && typeof val === 'string' && val.trim().length > 0) {
                        label = val.trim().substring(0, 150);
                        break;
                    }
                }
            }

            let type = 'text';
            if (role === 'AXButton' || role === 'AXPopUpButton') type = 'button';
            else if (role === 'AXLink') type = 'link';
            else if (role === 'AXTextField' || role === 'AXTextArea') type = 'input';
            else if (role === 'AXMenuItem' || role === 'AXTab') type = 'menu';
            else if (role === 'AXCheckBox' || role === 'AXRadioButton') type = 'checkbox';

            result.snapshot = [{
                id: "hit",
                type: type,
                label: label || role,
                role: role,
                bbox: {
                    x: bestHit.x / screenW,
                    y: bestHit.y / screenH,
                    w: bestHit.w / screenW,
                    h: bestHit.h / screenH
                },
                confidence: 1.0
            }];
        }

    } catch (e) {
        result.error = String(e);
        result.diagnostic = 'UNEXPECTED_ERROR';
    }

    return JSON.stringify(result);
}

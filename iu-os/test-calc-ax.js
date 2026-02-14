#!/usr/bin/env osascript -l JavaScript

ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function run() {
    try {
        // Test Calculator specifically
        const app = Application('Calculator');
        app.activate();

        delay(1); // Wait for activation

        const frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        const pid = frontApp.processIdentifier;
        const appName = ObjC.unwrap(frontApp.localizedName);

        console.log('App: ' + appName);
        console.log('PID: ' + pid);

        const appElement = $.AXUIElementCreateApplication(pid);

        // Test AXFocusedWindow
        const focusedRef = Ref();
        const focusedResult = $.AXUIElementCopyAttributeValue(appElement, 'AXFocusedWindow', focusedRef);
        console.log('AXFocusedWindow result: ' + focusedResult);
        console.log('Has focused window: ' + (focusedRef[0] ? 'YES' : 'NO'));

        // Test AXMainWindow
        const mainRef = Ref();
        const mainResult = $.AXUIElementCopyAttributeValue(appElement, 'AXMainWindow', mainRef);
        console.log('AXMainWindow result: ' + mainResult);
        console.log('Has main window: ' + (mainRef[0] ? 'YES' : 'NO'));

        // Test AXWindows
        const windowsRef = Ref();
        const windowsResult = $.AXUIElementCopyAttributeValue(appElement, 'AXWindows', windowsRef);
        console.log('AXWindows result: ' + windowsResult);
        if (windowsRef[0]) {
            const windows = ObjC.unwrap(windowsRef[0]);
            console.log('Number of windows: ' + windows.length);
        } else {
            console.log('AXWindows is null');
        }

    } catch (e) {
        console.log('Error: ' + e);
    }
}

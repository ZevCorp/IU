#!/usr/bin/osascript -l JavaScript

// This script will trigger the system permission prompt
ObjC.import('ApplicationServices');

// Create options dictionary to show prompt
const opts = $.NSMutableDictionary.alloc.init;
opts.setValueForKey(true, 'AXTrustedCheckOptionPrompt');

// This will show the system prompt if not already trusted
const trusted = $.AXIsProcessTrustedWithOptions(opts);

if (trusted) {
    console.log("✅ Accessibility permissions granted!");
} else {
    console.log("⚠️ Please grant Accessibility permissions in System Settings");
    console.log("A system prompt should have appeared.");
}

#!/bin/bash
# Test AX permissions from different contexts

echo "=== Testing Accessibility Permissions ==="
echo ""

echo "1️⃣ Testing from Terminal (this script):"
result1=$(osascript -l JavaScript -e '
    ObjC.import("ApplicationServices");
    const trusted = $.AXIsProcessTrusted();
    JSON.stringify({ trusted: trusted });
')
echo "   Result: $result1"
echo ""

echo "2️⃣ Testing AX Reader from Terminal:"
cd /Users/felipemaldonado/Documents/U/iu-os
result2=$(osascript -l JavaScript ax-reader.js Calculator 2>&1 | head -1)
echo "   Result: $(echo $result2 | jq -r '.error // "Success"' 2>/dev/null || echo $result2)"
echo ""

echo "3️⃣ Testing what apps have Accessibility permissions:"
echo "   (This requires System Integrity Protection bypass, skipping)"
echo ""

echo "📝 Summary:"
echo "   - If Terminal works but Electron doesn't:"
echo "     → Electron needs to be added to Accessibility list"
echo "   - Look for 'Electron' or 'node' or your app name"
echo "   - Path: System Settings → Privacy & Security → Accessibility"
echo ""
echo "🔧 To add Electron manually:"
echo "   1. Open System Settings"
echo "   2. Privacy & Security → Accessibility  "
echo "   3. Click lock 🔓 and authenticate"
echo "   4. Click '+' button"
echo "   5. Navigate to: $(which electron || echo '/usr/local/bin/electron')"
echo "   6. Or add the Electron.app bundle if it exists"

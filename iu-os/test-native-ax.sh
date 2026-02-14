#!/bin/bash

# Test Native AX System
# Verifica que el addon nativo está compilado, instalado y funcionando

set -e

echo "🧪 Testing Native AX System..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if addon exists in dev
echo "📦 Checking dev build..."
if [ -f "build/Release/ax_native.node" ]; then
    echo -e "${GREEN}✅${NC} Dev addon exists: build/Release/ax_native.node"
    ls -lh build/Release/ax_native.node
else
    echo -e "${RED}❌${NC} Dev addon NOT found. Running npm install..."
    npm install
fi

echo ""

# 2. Check if IU.app exists
echo "📱 Checking IU.app..."
if [ -d "/Applications/IU.app" ]; then
    echo -e "${GREEN}✅${NC} IU.app installed"
else
    echo -e "${RED}❌${NC} IU.app NOT found. Run: ./rebuild-app.sh"
    exit 1
fi

echo ""

# 3. Check if addon exists in packaged app
echo "📦 Checking packaged addon..."
PACKAGED_ADDON="/Applications/IU.app/Contents/Resources/build/Release/ax_native.node"
if [ -f "$PACKAGED_ADDON" ]; then
    echo -e "${GREEN}✅${NC} Packaged addon exists"
    ls -lh "$PACKAGED_ADDON"
else
    echo -e "${RED}❌${NC} Packaged addon NOT found. Run: ./rebuild-app.sh"
    exit 1
fi

echo ""

# 4. Check Accessibility permissions
echo "🔒 Checking Accessibility permissions..."
if ./verify-permissions.sh 2>/dev/null | grep -q "IU.*1"; then
    echo -e "${GREEN}✅${NC} IU.app has Accessibility permissions"
else
    echo -e "${YELLOW}⚠️${NC}  IU.app may not have Accessibility permissions"
    echo "   Go to: System Settings → Privacy & Security → Accessibility"
    echo "   Add: /Applications/IU.app"
fi

echo ""

# 5. Create simple Node.js test script
echo "🧪 Running functional test..."
cat > test_ax_temp.js << 'EOF'
const SimpleAxAgent = require('./SimpleAxAgent');

async function test() {
    const agent = new SimpleAxAgent();
    
    // Test with Calculator (should be installed on all Macs)
    console.log('Testing AX extraction with Calculator...');
    
    // Open Calculator first
    const { exec } = require('child_process');
    exec('open -a Calculator');
    
    // Wait for app to open
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract AX tree
    const result = await agent.extract('Calculator');
    
    if (result.error) {
        console.error('❌ Error:', result.error);
        console.error('   Diagnostic:', result.diagnostic);
        process.exit(1);
    }
    
    if (result.snapshot && result.snapshot.length > 0) {
        console.log('✅ SUCCESS!');
        console.log(`   App: ${result.app}`);
        console.log(`   Window: ${result.window}`);
        console.log(`   Elements found: ${result.snapshot.length}`);
        console.log('');
        console.log('Sample elements:');
        result.snapshot.slice(0, 5).forEach(el => {
            console.log(`   - #${el.id}: ${el.label} (${el.type})`);
        });
        process.exit(0);
    } else {
        console.error('❌ No elements found');
        process.exit(1);
    }
}

test().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
EOF

# Run test
if node test_ax_temp.js; then
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Native AX System is working correctly! 🎉"
    echo ""
    echo "You can now use IU.app to control apps with voice commands."
    echo "Try: \"abre calculator y suma 5 + 5 + 5\""
else
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ TESTS FAILED${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Check the errors above and:"
    echo "1. Verify Accessibility permissions"
    echo "2. Run: npm install"
    echo "3. Run: ./rebuild-app.sh"
    echo "4. Try again"
    exit 1
fi

# Cleanup
rm -f test_ax_temp.js

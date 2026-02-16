#!/bin/bash
# Script de rebuild rápido para IU.app

echo "🔨 Rebuilding IU.app..."

cd /Users/felipemaldonado/Documents/U/iu-os

# Limpiar
rm -rf /Applications/IU.app dist/mac-arm64

# Rebuild
# Build Native Window first
./scripts/build-native-window.sh

npx node-gyp rebuild
npm run pack:mac

# Copiar
cp -R "dist/mac-arm64/IU.app" /Applications/

echo "✅ IU.app reconstruida y copiada a /Applications"
echo ""
echo "Para ejecutar con logs:"
echo "  killall IU 2>/dev/null; /Applications/IU.app/Contents/MacOS/IU"

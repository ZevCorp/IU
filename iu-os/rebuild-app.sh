#!/bin/bash
# Script de rebuild rápido para IU.app

set -euo pipefail

echo "🔨 Rebuilding IU.app..."

ROOT_DIR="/Users/felipemaldonado/Documents/U"
IU_OS_DIR="$ROOT_DIR/iu-os"
EXT_DIR="$ROOT_DIR/iu-chrome-extension"
EXT_ZIP="$ROOT_DIR/public/assets/iu-extension.zip"

cd "$IU_OS_DIR"

echo "🧩 Rebuilding Chrome extension package..."
rm -f "$EXT_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$EXT_DIR" "$EXT_ZIP"

# Limpiar
rm -rf /Applications/IU.app dist/mac-arm64

# Rebuild
# Build Native Window first
# ./scripts/build-native-window.sh

npx node-gyp rebuild
npm run pack:mac

# Copiar
cp -R "dist/mac-arm64/IU.app" /Applications/

echo "✅ IU.app reconstruida y copiada a /Applications"
echo "✅ Extensión actualizada en: $EXT_ZIP"
echo ""
echo "Para ejecutar con logs:"
echo "  killall IU 2>/dev/null; /Applications/IU.app/Contents/MacOS/IU"

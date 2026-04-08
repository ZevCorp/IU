#!/bin/bash
# Script para crear el instalador de macOS para IU.
# Uso:
#   ./create-installer.sh        -> genera ZIP listo para enviar
#   ./create-installer.sh zip    -> igual que arriba
#   ./create-installer.sh dmg    -> intenta generar DMG + ZIP
set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-zip}"

restore_sources() {
    if find . -name '*.backup' -print -quit | grep -q .; then
        echo "🔓 Restaurando archivos ofuscados..."
        npm run restore >/dev/null 2>&1 || true
    fi
}

trap restore_sources EXIT

case "$TARGET" in
    zip)
        BUILDER_TARGET=(--mac --dir)
        ;;
    dmg)
        BUILDER_TARGET=(--mac)
        ;;
    *)
        echo "Uso: ./create-installer.sh [zip|dmg]"
        exit 1
        ;;
esac

echo "🧹 Limpiando artefactos previos de macOS..."
rm -f dist/IU-*-arm64-mac.zip dist/IU-*-arm64-mac.zip.blockmap
rm -f dist/IU-*-arm64.dmg dist/IU-*-arm64.dmg.blockmap
rm -f dist/latest-mac.yml

echo "📦 Compilando IU para macOS (${TARGET})..."
npm run build:browser-core
npm run obfuscate
npx electron-builder "${BUILDER_TARGET[@]}"

ZIP_FILE=""
DMG_FILE="$(find dist -maxdepth 1 -name 'IU-*-arm64.dmg' -print | head -n 1)"

if [[ "$TARGET" == "zip" ]]; then
    APP_BUNDLE="$(find dist -maxdepth 2 -name 'IU.app' -print | head -n 1)"
    if [[ -z "$APP_BUNDLE" ]]; then
        echo "⚠️ No se encontró IU.app para comprimir."
        exit 1
    fi

    ZIP_FILE="dist/IU-$(node -p "require('./package.json').version")-arm64-mac.zip"
    rm -f "$ZIP_FILE"
    ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$ZIP_FILE"
else
    ZIP_FILE="$(find dist -maxdepth 1 -name 'IU-*-arm64-mac.zip' -print | head -n 1)"
fi

echo "✅ Build completada."
if [[ -n "$ZIP_FILE" ]]; then
    echo "📍 ZIP listo para enviar: $ZIP_FILE"
fi
if [[ -n "$DMG_FILE" ]]; then
    echo "📍 DMG listo para enviar: $DMG_FILE"
fi

if [[ -z "$ZIP_FILE" && -z "$DMG_FILE" ]]; then
    echo "⚠️ No se encontró ningún instalador en dist/."
    exit 1
fi

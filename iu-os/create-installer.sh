#!/bin/bash
# Script para crear el instalable (DMG) para distribuir
set -e

echo "🧹 Limpiando carpeta dist..."
rm -rf dist

echo "📦 Creando instalable PROTEGIDO (DMG)..."
# Esto encripta/ofusca el código y genera el .dmg
npm run build:mac

echo "✅ Instalable creado exitosamente!"
echo "📍 Archivo listo para enviar: dist/IU-1.0.0-arm64.dmg"

# Abrir la carpeta para facilitar el envío
open dist

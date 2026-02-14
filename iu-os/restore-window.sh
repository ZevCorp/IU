#!/bin/bash
# Script para restaurar la ventana de IU cuando se minimiza

echo "🔄 Buscando ventana de IU..."

# Buscar el PID de la app IU
pid=$(pgrep -f "IU.app")

if [ -z "$pid" ]; then
    echo "❌ IU no está corriendo"
    echo "Abriendo IU.app..."
    open /Applications/IU.app
    exit 0
fi

echo "✅ IU está corriendo (PID: $pid)"
echo "🪟 Restaurando ventana..."

# Activar la app usando AppleScript
osascript -e 'tell application "IU" to activate' 2>/dev/null

echo "✅ Ventana restaurada"

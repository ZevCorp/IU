#!/bin/bash
# Script para verificar permisos de Accessibility

echo "🔍 Verificando permisos de Accessibility..."
echo ""

# Verificar desde osascript
result=$(osascript -l JavaScript -e '
    ObjC.import("ApplicationServices");
    const trusted = $.AXIsProcessTrusted();
    JSON.stringify({ trusted: trusted });
' 2>&1)

echo "Resultado: $result"
echo ""

if echo "$result" | grep -q '"trusted":true'; then
    echo "✅ PERMISOS OTORGADOS - Todo está OK"
else
    echo "❌ SIN PERMISOS - Necesitas habilitar Accessibility"
    echo ""
    echo "Pasos:"
    echo "1. Abre: System Settings → Privacy & Security → Accessibility"
    echo "2. Desbloquea el candado 🔓"
    echo "3. Activa 'Electron' o 'Terminal'"
    echo "4. Reinicia iu-os"
fi

echo ""
echo "Para abrir System Settings directamente, corre:"
echo "  open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'"

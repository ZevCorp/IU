#!/bin/bash

echo "🔍 Verificando permisos de Accessibility..."
echo ""

# Test 1: Check if Terminal has permissions
result=$(osascript -l JavaScript -e '
    ObjC.import("ApplicationServices");
    const trusted = $.AXIsProcessTrusted();
    JSON.stringify({ trusted: trusted });
' 2>&1)

echo "📋 Resultado del check de permisos:"
echo "   $result"
echo ""

if echo "$result" | grep -q '"trusted":true'; then
    echo "✅ ¡ÉXITO! Los permisos están otorgados"
    echo ""
    echo "🎯 Ahora puedes ejecutar:"
    echo "   npm run dev"
    echo ""
    echo "Y debería funcionar correctamente."
else
    echo "❌ AÚN SIN PERMISOS"
    echo ""
    echo "🔧 Pasos para arreglar:"
    echo "   1. System Settings → Privacy & Security → Accessibility"
    echo "   2. Desbloquea el candado 🔓"
    echo "   3. Click en '+' y agrega Terminal.app"
    echo "   4. Asegúrate que el toggle esté ACTIVADO"
    echo "   5. Corre este script de nuevo para verificar"
    echo ""
    echo "📱 Abrir System Settings ahora:"
    echo "   open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'"
fi

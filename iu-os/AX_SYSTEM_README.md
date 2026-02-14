# Sistema de Extracción AX - Documentación

## Arquitectura Actual (Determinística)

### Componentes Principales

1. **`SimpleAxAgent.js`** - Agente determinístico simple
   - Verifica permisos primero
   - Asegura que la app esté lista (abierta y enfocada)
   - Reintenta hasta 3 veces con delays sensatos
   - Sin IA - rápido y confiable

2. **`PermissionManager.js`** - Gestión de permisos
   - Verifica permisos de Accessibility al iniciar
   - Muestra diálogo al usuario si faltan permisos
   - Abre System Settings automáticamente

3. **`ax-reader.js`** (v2) - Script JXA mejorado
   - Detecta códigos de error específicos (PERMISSION_DENIED, NO_WINDOW, etc.)
   - Acepta nombre de app como argumento
   - Retorna diagnósticos útiles

### Flujo de Extracción

```
Usuario da comando
    ↓
SimpleAxAgent.extract(appName)
    ↓
1. Verificar permisos
   ↓ (si no tiene permisos)
   Retornar error PERMISSION_DENIED
   ↓ (si tiene permisos)
2. Asegurar app lista
   - Verificar si está corriendo
   - Si no → abrir app
   - Esperar 2s
   - Activar (traer al frente)
   - Esperar 1s
    ↓
3. Intentar extracción (max 3 intentos)
   - Ejecutar ax-reader.js [AppName]
   - ¿Éxito? → Retornar elementos ✅
   - ¿NO_WINDOW? → Esperar 2s y reintentar
   - ¿PERMISSION_DENIED? → Error fatal (no reintentar)
   - Otro error → Esperar 1.5s y reintentar
    ↓
Retornar resultado o error
```

### Códigos de Diagnóstico

- `PERMISSION_DENIED` - Sin permisos de Accessibility (no reintentar)
- `NO_WINDOW` - App sin ventanas detectables (reintentar con delay)
- `APP_NOT_RUNNING` - App no está corriendo
- `ACTIVATION_FAILED` - No se pudo activar la app
- `SCRIPT_ERROR` - Error al ejecutar osascript
- `PARSE_ERROR` - Error al parsear JSON de salida
- `MAX_RETRIES_REACHED` - Falló después de 3 intentos

## Sistema Inteligente (Futuro)

### `AxExtractionAgent.js.future` - Agente con GPT-4.1

Para problemas complejos que el sistema determinístico no puede resolver.

**Características:**
- Usa GPT-4.1 para diagnosticar problemas
- Puede buscar en web vía ChatGPT+Playwright
- Aprende de cada intento
- Hasta 5 intentos con estrategias adaptativas

**Cuándo usarlo:**
- Apps con comportamiento no estándar
- Problemas que requieren investigación
- Debugging de nuevos escenarios

**Cómo habilitarlo:**
```javascript
// En ScreenAgent.js, reemplazar:
const SimpleAxAgent = require('./SimpleAxAgent');
// con:
const AxExtractionAgent = require('./AxExtractionAgent.future');
```

## Archivo de Configuración

### `.env` requerido

```bash
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...  # Opcional, para Gemini
```

## Otorgar Permisos de Accessibility

### macOS Ventura/Sonoma

1. Abre **Configuración del Sistema**
2. Ve a **Privacidad y Seguridad** → **Accesibilidad**
3. Haz clic en el candado y autentica
4. Busca **"Electron"** o **"iü-os"** en la lista
5. Activa el toggle
6. **Reinicia iü-os**

### Verificar permisos desde terminal

```bash
osascript -l JavaScript -e 'const trusted = $.AXIsProcessTrusted(); JSON.stringify({ trusted: trusted });'
```

Debería retornar: `{"trusted":true}`

## Troubleshooting

### "Permission denied - Accessibility access required"

**Causa:** La app no tiene permisos de Accessibility.

**Solución:**
1. Cierra iü-os
2. Otorga permisos (ver arriba)
3. Reinicia iü-os

### "No window found" después de otorgar permisos

**Causa posible:**
- App lenta en abrir
- App minimizada
- Formato de nombre incorrecto

**Solución:**
- El sistema reintentará automáticamente 3 veces
- Espera 2s entre intentos
- Verifica que Calculator esté visible

### Script funciona en terminal pero no en Electron

**Causa:** Terminal y Electron son procesos diferentes.

**Solución:** 
- Otorga permisos a **ambos** (Terminal Y Electron)
- O solo usa desde iü-os (Electron)

## Performance

### Tiempos Típicos

- **Verificación de permisos:** ~100ms
- **Apertura de app:** ~2s
- **Activación de app:** ~1s
- **Extracción AX:** ~500ms-1s
- **Total (si app ya abierta):** ~2s
- **Total (si app cerrada):** ~4-5s

### Optimizaciones

1. **Cache de estado de app** - evitar abrir si ya está abierta
2. **Extracción paralela** - si múltiples apps
3. **Reuso de resultados** - cache temporal de 5s

## Logs y Debug

### Logs importantes:

```bash
✅ [Permissions] Accessibility permissions granted
🍎 [SimpleAxAgent] Starting AX extraction...
📱 [SimpleAxAgent] Ensuring Calculator is ready...
🔄 [SimpleAxAgent] Attempt 1/3
✅ [SimpleAxAgent] Success! Found 15 elements
```

### Errores comunes:

```bash
❌ [SimpleAxAgent] Accessibility permissions not granted
⚠️ [SimpleAxAgent] Could not focus Calculator
❌ [SimpleAxAgent] Failed after 3 attempts
```

## Testing

### Test manual rápido:

```bash
cd /Users/felipemaldonado/Documents/U/iu-os
open -a Calculator
sleep 2
osascript -l JavaScript ax-reader.js Calculator
```

Debería retornar JSON con elementos detectados.

## Comparación de Sistemas

| Característica | Simple (Actual) | Inteligente (Futuro) |
|----------------|-----------------|----------------------|
| Velocidad | ⚡ ~2s | 🐌 ~10-30s |
| Token cost | 💰 $0 | 💸 ~$0.01-0.05 |
| Confiabilidad | ✅ Alta | ⚠️ Media |
| Debugging | ❌ Manual | ✅ Automático |
| Casos de uso | 95% apps | 5% apps problemáticas |

## Recomendación

**Usa el sistema Simple** para:
- Calculator, TextEdit, Safari, Chrome
- La mayoría de apps estándar de macOS
- Producción

**Usa el sistema Inteligente** para:
- Apps custom con UI no estándar
- Debugging de problemas nuevos
- Investigación de edge cases

---

📝 Última actualización: 2026-02-13

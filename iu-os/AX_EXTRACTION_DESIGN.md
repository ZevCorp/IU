# Sistema Efectivo de Extracción AX - Diseño Completo

## Problema Identificado
El error `-25201` (kAXErrorCannotComplete) = **PERMISSION_DENIED**

- `osascript` ejecutado desde Electron NO tiene permisos de Accessibility
- Calculator SÍ está abierto y tiene ventanas
- macOS bloquea el acceso por seguridad

## Solución: Sistema de 3 Niveles

### Nivel 1: Verificación de Permisos (CRÍTICO)
```javascript
// En main.js al inicio
async function checkAccessibilityPermissions() {
    return new Promise((resolve) => {
        const script = `
            const trusted = $.AXIsProcessTrusted();
            JSON.stringify({ trusted: trusted });
        `;
        execFile('osascript', ['-l', 'JavaScript', '-e', script], (err, stdout) => {
            if (err) {
                resolve({ trusted: false, error: err.message });
                return;
            }
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                resolve({ trusted: false, error: 'Parse error' });
            }
        });
    });
}

// Al iniciar la app
const axPermissions = await checkAccessibilityPermissions();
if (!axPermissions.trusted) {
    // Mostrar diálogo al usuario para que otorgue permisos
    dialog.showMessageBox({
        type: 'warning',
        title: 'Permisos Necesarios',
        message: 'iu-os necesita permisos de Accessibility',
        detail: 'Ve a Sistema → Privacidad → Accesibilidad y habilita "Electron" o "iu-os"',
        buttons: ['Abrir Configuración', 'Más Tarde']
    }).then(result => {
        if (result.response === 0) {
            // Abrir System Settings
            exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
        }
    });
}
```

### Nivel 2: AX Reader Mejorado
- ✅ Ya implementado en `ax-reader-v2.js`
- Detecta `PERMISSION_DENIED` específicamente
- Acepta nombre de app como argumento
- Retorna códigos de diagnóstico útiles

### Nivel 3: Estrategia de Retry Inteligente

```javascript
// En AxExtractionAgent
async extract(appName) {
    // 1. Primero verificar permisos
    const permCheck = await this._checkPermissions();
    if (!permCheck.trusted) {
        return {
            error: 'Accessibility permissions not granted',
            diagnostic: 'PERMISSION_DENIED',
            snapshot: [],
            requiresUserAction: true
        };
    }
    
    // 2. Asegurar que app está abierta y enfocada
    await this._ensureAppReady(appName);
    
    // 3. Intentar extracción con script mejorado
    const result = await this._tryExtractionV2(appName);
    
    // 4. Si falla, diagnosticar
    if (result.diagnostic === 'PERMISSION_DENIED') {
        // No reintentar - requiere acción del usuario
        return result;
    } else if (result.diagnostic === 'NO_WINDOW') {
        // Reintentar con delays más largos
        await this._wait(3000);
        return await this._tryExtractionV2(appName);
    }
    
    return result;
}

async _ensureAppReady(appName) {
    // 1. Abrir app
    await this._openApp(appName);
    await this._wait(2000);
    
    // 2. Activar (traer al frente)
    await this._focusApp(appName);
    await this._wait(1000);
    
    // 3. Verificar que está corriendo
    const isRunning = await this._checkAppRunning(appName);
    if (!isRunning) {
        throw new Error(`App ${appName} failed to launch`);
    }
}
```

## Implementación Paso a Paso

1. **Reemplazar ax-reader.js** con ax-reader-v2.js
2. **Agregar verificación de permisos** en main.js al iniciar
3. **Simplificar AxExtractionAgent** - no usar LLM para esto
4. **UI para permisos** - mostrar instrucciones claras al usuario

## Por qué NO Usar LLM para AX Extraction

El problema es **determinístico**:
- Si tienes permisos → funciona
- Si NO tienes permisos → NUNCA funcionará

El LLM no puede otorgar permisos. Solo el usuario puede.

## Sistema Final Propuesto

```
Usuario inicia iu-os
    ↓
¿Tiene permisos AX?
    ↓ NO
Mostrar diálogo → Usuario otorga permisos → Reiniciar
    ↓ SÍ
Usuario da comando
    ↓
AX Agent:
  1. Abrir app
  2. Esperar 2s
  3. Enfocar app
  4. Esperar 1s
  5. Ejecutar ax-reader-v2.js [AppName]
  6. ¿Éxito? → Retornar elementos
     ¿NO_WINDOW? → Esperar 3s más y reintentar
     ¿PERMISSION_DENIED? → Error fatal (no reintentar)
```

## Ventajas del Nuevo Diseño

1. **Detección temprana** de problemas de permisos
2. **Sin IA innecesaria** - problema determinístico
3. **Feedback claro** al usuario
4. **Retry inteligente** solo cuando tiene sentido
5. **Diagnósticos precisos** con códigos de error

## Siguiente Paso

¿Implemento este sistema completo en iu-os?

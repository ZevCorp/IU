# Sistema de Extracción AX Nativo

## ✅ Estado: COMPLETADO Y FUNCIONANDO

El sistema de extracción de Accessibility Tree (AX) en iu-os ahora usa **addons nativos C++** en lugar de subprocesos de `osascript`, solucionando definitivamente el problema de permisos de macOS.

---

## 🎯 Problema Resuelto

### Problema Original:
```
IU.app (✅ tiene permisos de Accessibility)
  └─ execFile('osascript', 'ax-reader.js')  ← subprocess
      └─ /usr/bin/osascript (❌ NO puede recibir permisos)
          └─ Llama AXUIElement APIs → PERMISSION_DENIED
```

**Por qué fallaba:**
- macOS TCC (Transparency, Consent, and Control) otorga permisos por **binary path exacto**
- Los subprocesos **NO heredan** permisos de Accessibility del proceso padre
- `osascript` es un binario del sistema que **no puede** agregarse a System Settings

### Solución Implementada:
```
IU.app (✅ tiene permisos de Accessibility)
  └─ require('./build/Release/ax_native.node')  ← native addon
      └─ C++ code ejecutándose EN IU.app
          └─ Llama AXUIElement APIs directamente → ✅ SUCCESS
```

---

## 📁 Arquitectura

### Archivos Clave:

1. **`native/ax_extractor.mm`** (522 líneas)
   - Addon C++ + Objective-C
   - Llama directamente a las APIs de macOS:
     - `AXUIElementCreateApplication()`
     - `AXUIElementCopyAttributeValue()`
   - Traversa el árbol de elementos recursivamente
   - Retorna JSON con elementos detectados

2. **`binding.gyp`**
   - Configuración de compilación para `node-gyp`
   - Flags: `-fobjc-arc`, frameworks: `ApplicationServices`, `Cocoa`, `AppKit`

3. **`SimpleAxAgent.js`** (modificado)
   - **Líneas 16-39**: Intenta cargar el addon nativo primero
   - **Líneas 147-195**: Usa addon nativo si está disponible, fallback a osascript
   - Logs:
     ```
     ✅ [SimpleAxAgent] Using NATIVE addon (no osascript!)
     📂 [SimpleAxAgent] Addon path: /Applications/IU.app/Contents/Resources/build/Release/ax_native.node
     ```

4. **`package.json`** (actualizado)
   - Script `install`: `"node-gyp rebuild"` - compila automáticamente el addon
   - **devDependencies**: `node-addon-api`, `node-gyp`
   - **extraResources**: Incluye `build/Release` para que el addon esté en la app empaquetada

---

## 🔧 Compilación

### Desarrollo (local):
```bash
cd /Users/felipemaldonado/Documents/U/iu-os
npm install  # Compila automáticamente el addon nativo
```

El addon se compila en: `build/Release/ax_native.node` (54KB)

### Producción (app empaquetada):
```bash
./rebuild-app.sh
```

Esto:
1. Ejecuta `electron-builder` que empaqueta todo
2. Copia el addon a `/Applications/IU.app/Contents/Resources/build/Release/ax_native.node`
3. El path es resuelto automáticamente por `SimpleAxAgent.js`

---

## 🚀 Uso

### Desde Código:
```javascript
const SimpleAxAgent = require('./SimpleAxAgent');
const agent = new SimpleAxAgent();

const result = await agent.extract('Calculator');
// result = {
//   app: "Calculator",
//   window: "Calculator",
//   snapshot: [
//     { id: "1", type: "button", label: "5", bbox: {...}, confidence: 1.0 },
//     { id: "2", type: "button", label: "+", bbox: {...}, confidence: 1.0 },
//     ...
//   ]
// }
```

### Verificación de Logs:
```bash
killall IU; /Applications/IU.app/Contents/MacOS/IU
```

Busca:
```
✅ [SimpleAxAgent] Using NATIVE addon (no osascript!)
🔧 [SimpleAxAgent] Using native C++ extraction...
✅ [SimpleAxAgent] Success! Found 28 elements
```

---

## 🐛 Problemas Solucionados

### 1. ✅ Error de `tool_choice` en chat
**Era:** Enviaba `tool_choice: "auto"` incluso cuando `tools` era `undefined`
**Solución:** `tool_choice: actionPlanner ? "auto" : undefined` (main.js:279)

### 2. ✅ Referencia a `ax-reader.sh` obsoleta
**Era:** `captureScreenContext()` llamaba script bash inexistente
**Solución:** Función marcada como deprecada, retorna error explicativo (main.js:462-465)

### 3. ✅ Error `ENOTDIR: history/graphs`
**Era:** Intentaba crear directorio dentro de `app.asar` (read-only)
**Solución:** Usa `app.getPath('userData')/history/graphs` (ScreenAgent.js:506-508)

### 4. ✅ Archivos obsoletos removidos
- `ax-reader.sh` - eliminado
- `ax-reader-old.js` - eliminado
- Referencias en `package.json` - removidas

---

## 📊 Testing

### Test Manual:
```bash
# 1. Abrir Calculator
open -a Calculator

# 2. Ejecutar IU.app
killall IU; /Applications/IU.app/Contents/MacOS/IU

# 3. En la ventana de chat, escribir:
"abre el app calculator y suma 5 + 5 + 5"

# 4. Verificar logs:
✅ [SimpleAxAgent] Success! Found XX elements
✅ [ScreenAgent] AX Graph extracted: XX nodes
🎯 [ScreenAgent] Click on #11 [5 #11] at pixel (551, 585)
```

### Resultado Esperado:
- La calculadora se abre automáticamente
- Se detectan ~20-30 elementos UI (botones, labels, etc.)
- Se hacen clicks determinísticos en los botones correctos
- La suma se completa exitosamente

---

## 🔒 Permisos de macOS

### Verificar Permisos:
```bash
./verify-permissions.sh
```

O manualmente:
1. **System Settings** → **Privacy & Security** → **Accessibility**
2. Verificar que **IU** está en la lista y ✅ habilitado

### Otorgar Permisos (si faltan):
La app los solicitará automáticamente la primera vez, o puedes agregarla manualmente:
1. Click **+** en Accessibility
2. Navegar a `/Applications/IU.app`
3. Agregar y habilitar

---

## 📦 Estructura del Build

```
/Applications/IU.app/
├── Contents/
│   ├── MacOS/
│   │   └── IU                          ← Ejecutable principal
│   └── Resources/
│       ├── app.asar                     ← Código JavaScript empaquetado
│       │   ├── main.js
│       │   ├── SimpleAxAgent.js
│       │   ├── ScreenAgent.js
│       │   └── ...
│       ├── app.asar.unpacked/           ← Módulos nativos desempaquetados
│       │   ├── node_modules/
│       │   │   ├── playwright/
│       │   │   ├── sharp/
│       │   │   └── @nut-tree-fork/
│       └── build/
│           └── Release/
│               └── ax_native.node       ← ✨ ADDON NATIVO (54KB)
```

---

## 🧪 Troubleshooting

### Addon no se carga:
```
⚠️ [SimpleAxAgent] Native addon not found at: [path]
📂 [SimpleAxAgent] Fallback to osascript: ...
```

**Solución:**
```bash
cd /Users/felipemaldonado/Documents/U/iu-os
npm install  # Recompila addon
./rebuild-app.sh  # Reconstruye IU.app
```

### Permission denied en runtime:
```
⚠️ [SimpleAxAgent] Diagnostic: PERMISSION_DENIED
```

**Solución:**
1. Verificar permisos de Accessibility (ver arriba)
2. Si persiste, remover y re-agregar IU.app en Accessibility
3. Reiniciar IU.app

### Addon compila pero no funciona:
```bash
# Verificar que el addon existe
ls -lh /Applications/IU.app/Contents/Resources/build/Release/ax_native.node

# Debería mostrar:
-rwxr-xr-x  1 user  admin  54K  ax_native.node
```

Si no existe, verificar `package.json` → `build.extraResources` incluye:
```json
{
  "from": "build/Release",
  "to": "build/Release"
}
```

---

## 🔮 Próximos Pasos (Opcionales)

### Performance:
- [ ] Cache inteligente de AX tree (actualmente 3s)
- [ ] Filtrado de elementos por área visible
- [ ] Soporte para apps multi-ventana

### Funcionalidad:
- [ ] Click en coordenadas específicas (no solo centros)
- [ ] Detección de estado de elementos (enabled/disabled, checked/unchecked)
- [ ] Soporte para arrastrar elementos (drag & drop)

### Cross-platform:
- [ ] Implementación Windows (UIA - UI Automation)
- [ ] Implementación Linux (AT-SPI)

---

## 📝 Notas de Implementación

### Por qué C++ en lugar de Pure JavaScript:
1. **Imposible con JS puro**: No hay forma de llamar `AXUIElement` APIs desde JavaScript sin subprocess
2. **Permisos de macOS**: Solo el proceso principal (que tiene permisos) puede hacer las llamadas
3. **Performance**: C++ es más rápido para traversar árboles grandes

### Por qué node-gyp:
- **Estándar de Node.js**: Es la forma oficial de crear addons nativos
- **Cross-platform**: Funciona en macOS, Linux, Windows
- **Integración con npm**: Se compila automáticamente en `npm install`

### Alternativas descartadas:
- ❌ **osascript subprocess**: Problem de permisos (razón original)
- ❌ **Electron IPC + AppleScript**: Mismo problema de permisos
- ❌ **Compilar script como .app standalone**: Funcionaría, pero agrega complejidad de deployment
- ❌ **`@nut-tree/nut-js` AX APIs**: No provee traversal de AX tree, solo control de mouse/teclado

---

## 👨‍💻 Autor

Implementado por **Antigravity AI** para el proyecto **iu-os** de Felipe Maldonado.

**Fecha**: 2026-02-13

**Tecnologías**: Electron 28, Node.js 24, macOS Accessibility APIs, C++17, Objective-C with ARC

---

## 📄 Licencia

MIT (mismo que iu-os)

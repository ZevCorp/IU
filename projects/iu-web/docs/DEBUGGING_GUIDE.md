# 🔍 Guía de Debugging - Verificación Biométrica

## Problema Reportado
La verificación se queda en 0% incluso con la misma cara registrada.

## Pasos para Debuggear

### 1. Abrir la Consola del Navegador

**Windows/Linux:**
- Presiona `F12` o `Ctrl + Shift + I`

**Mac:**
- Presiona `Cmd + Option + I`

### 2. Ir a la pestaña "Console"

### 3. Limpiar la consola
- Click en el ícono 🚫 (Clear console) o presiona `Ctrl + L`

### 4. Intentar una Transferencia

1. Llena el formulario de transferencia
2. Click en "Realizar Transferencia"  
3. Mira a la cámara

### 5. Revisar los Mensajes en la Consola

Deberías ver mensajes como estos:

```
[BankTransferDemo] Starting verification
[BankTransferDemo] Camera started
[BankTransferDemo] Received landmarks for verification: 468
[BiometricAuthManager] Starting verification
[BiometricAuthManager] Verification result: { success: true|false, confidence: XX }
[BankTransferDemo] Verification result: { success: true|false, confidence: XX }
```

## 🔴 Posibles Errores y Soluciones

### Error 1: "Received landmarks for verification: undefined"
**Causa**: La cámara no está capturando landmarks  
**Solución**: 
- Asegúrate de dar permiso de cámara
- Centra tu rostro en la imagen
- Mejora la iluminación

### Error 2: "Usuario no registrado"
**Causa**: El perfil no se guardó correctamente  
**Solución**:
- Vuelve a registrar tu perfil
- Abre las DevTools → Application → Local Storage → localhost:3000
- Busca una key que empiece con `biometric_profile_`
- Si no existe, el perfil no se guardó

### Error 3: "Calidad de imagen insuficiente"
**Causa**: La foto actual tiene baja calidad  
**Solución**:
- Mejora la iluminación
- Acércate a la cámara
- Baja el umbral de calidad en configuración

### Error 4: Confidence siempre 0
**Causa**: Problema en la comparación de templates  
**Solución**:
- Abre DevTools → Application → Local Storage
- Elimina la key `biometric_profile_user_default`
- Recarga la página (F5)
- Registra tu perfil de nuevo
- Intenta verificar otra vez

## 🔧 Acciones Rápidas

### Reiniciar Todo

1. Abre DevTools (F12)
2. Ve a Application → Local Storage → localhost:3000
3. Click derecho → Clear
4. Recarga la página (F5)
5. Re-registra tu perfil

### Bajar los Umbrales

En la página, ajusta:
- **Umbral de Confianza**: Baja a 60%
- **Calidad Mínima**: Baja a 40%

Esto hace el sistema más permisivo.

## 📋 Información a Reportar

Si el problema persiste, copia y pega esto de la consola:

1. Todos los mensajes que empiecen con `[BankTransferDemo]`
2. Todos los mensajes que empiecen con `[BiometricAuthManager]`
3. Cualquier mensaje de error (en rojo)

También revisa:

**DevTools → Application → Local Storage → localhost:3000**
- ¿Existe la key `biometric_profile_user_default`?
- ¿Cuál es su tamaño aproximado?

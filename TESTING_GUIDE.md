# 🧪 Guía de Pruebas - Sistema de Autenticación Biométrica

## Preparación

✅ **Servidor corriendo**: El servidor ya está activo en `http://localhost:3000`

### Paso 0: Abrir la Demo

1. Abre tu navegador (Chrome, Edge o Firefox recomendados)
2. Navega a: **`http://localhost:3000/biometric-demo.html`**
3. Permite acceso a la cámara cuando se solicite

---

## 🧩 Test Suite Completo

### Test 1: Registro Biométrico Exitoso ✅

**Objetivo**: Verificar que el sistema puede registrar un perfil facial correctamente

**Pasos**:
1. ✅ Click en botón **"Registrar Perfil"**
2. ✅ Se abre modal con título "Registro Biométrico"
3. ✅ Se muestra el feed de cámara dentro del círculo
4. ✅ Posiciona tu rostro centrado en el marco circular
5. ✅ Observa los 3 pasos en la parte superior (1, 2, 3)
6. ✅ Observa el indicador de "Calidad de captura" (debe ser >60%)
7. ✅ Espera a que el sistema capture 3 imágenes automáticamente
   - El círculo se pone VERDE cuando acepta una captura
   - Los números 1→2→3 se van completando
8. ✅ Al completar, ver mensaje "Perfil registrado exitosamente" ✅
9. ✅ El modal se cierra automáticamente después de 2 segundos
10. ✅ Verificar que el badge cambia a "✓ Registrado" (verde)
11. ✅ Verificar que el botón de transferencia ya NO está deshabilitado

**Resultado esperado**: 
- Badge verde "✓ Registrado"
- Botón "Eliminar Perfil" ahora visible
- Botón "Realizar Transferencia" habilitado

---

### Test 2: Transferencia con Verificación Exitosa ✅

**Objetivo**: Verificar que la transferencia se aprueba con rostro correcto

**Pre-requisito**: Haber completado Test 1

**Pasos**:
1. ✅ Llenar formulario de transferencia:
   - **Monto**: `1000`
   - **Destinatario**: `Ana García`
   - **Cuenta**: `9876-5432-1098`
2. ✅ Click en **"🔒 Realizar Transferencia"**
3. ✅ Se abre modal "Verificación de Identidad"
4. ✅ Se muestra feed de cámara
5. ✅ Observa la barra "Confianza de verificación" (debe ir subiendo)
6. ✅ Mantén tu rostro centrado (el mismo que registraste)
7. ✅ La barra de confianza debe llegar a >75% (verde)
8. ✅ Ver mensaje "Verificación exitosa" ✅
9. ✅ El modal se cierra automáticamente
10. ✅ Ver resultado "✅ Transferencia Exitosa" en la tarjeta
11. ✅ Ver detalles: "Transferencia de $1000 a Ana García completada exitosamente"

**Resultado esperado**:
- Cuadro verde con ✅
- Mensaje de transferencia completada
- Formulario se limpia automáticamente

---

### Test 3: Rechazo por Calidad Baja ⚠️

**Objetivo**: Verificar que el sistema rechaza capturas de mala calidad

**Pasos**:
1. ✅ Intenta registrar perfil NUEVO (elimina el actual primero)
2. ✅ Durante el registro, cubre parcialmente la cámara con tu mano
3. ✅ O aléjate mucho de la cámara
4. ✅ Observa el indicador de "Calidad de captura"
5. ✅ Debe mostrar < 60% en rojo/naranja
6. ✅ El círculo NO se pone verde
7. ✅ Mensaje: "Calidad baja. Por favor, mejora la iluminación y posición"
8. ✅ El paso NO avanza (sigue en el mismo número)

**Resultado esperado**:
- Sistema no acepta la captura
- Mensaje de error claro
- Permite reintentar

---

### Test 4: Rechazo por Rostro Diferente ❌

**Objetivo**: Verificar que el sistema rechaza rostros no registrados

**Pre-requisito**: Perfil registrado con TU rostro

**Pasos**:
1. ✅ Llenar formulario de transferencia
2. ✅ Click en "Realizar Transferencia"
3. ✅ **IMPORTANTE**: Pide a otra persona que mire a la cámara
   - O usa una foto tuya desde tu teléfono frente a la cámara
4. ✅ Observa la barra de confianza (debe quedarse BAJA < 60%)
5. ✅ Ver mensaje "Verificación fallida" ❌
6. ✅ Ver "Intentos restantes: X"
7. ✅ Ver resultado "❌ Transferencia Fallida"
8. ✅ Mensaje: "Transferencia cancelada: Verificación fallida"

**Resultado esperado**:
- Cuadro rojo con ❌
- Transferencia NO se procesa
- Opción de "Reintentar" disponible

---

### Test 5: Bloqueo por Múltiples Fallos 🔒

**Objetivo**: Verificar el sistema de intentos máximos

**Configuración previa**:
1. ✅ Ajustar en "Configuración del Sistema":
   - **Intentos Máximos**: Mover slider a `2`

**Pasos**:
1. ✅ Llenar formulario de transferencia
2. ✅ Click en "Realizar Transferencia"
3. ✅ Primer intento: Usa rostro diferente → Falla (Quedan 1 intento)
4. ✅ Click en "Reintentar"
5. ✅ Segundo intento: Usa rostro diferente → Falla (Quedan 0 intentos)
6. ✅ Ver mensaje "Cuenta bloqueada por demasiados intentos fallidos"
7. ✅ Modal se cierra automáticamente
8. ✅ NO hay opción de reintentar

**Resultado esperado**:
- Cuenta bloqueada después de X fallos
- No permite más intentos
- Transferencia definitivamente rechazada

**Para desbloquear**: Recarga la página (F5)

---

### Test 6: Ajuste de Configuración en Tiempo Real ⚙️

**Objetivo**: Verificar que los parámetros se actualizan correctamente

**Pasos**:
1. ✅ En "Configuración del Sistema", ajustar:
   - **Umbral de Confianza**: Mover a `90%` (muy estricto)
2. ✅ Intentar transferencia con TU rostro
3. ✅ Observar que es MÁS DIFÍCIL pasar (necesita >90% confianza)
4. ✅ Puede fallar incluso con rostro correcto si no es perfecto
5. ✅ Mover umbral a `60%` (más permisivo)
6. ✅ Intentar de nuevo
7. ✅ Ahora debe aprobar más fácilmente

**Pasos para Calidad Mínima**:
1. ✅ Ajustar **Calidad Mínima** a `40%`
2. ✅ Intentar registro con iluminación pobre
3. ✅ Debería aceptar capturas de menor calidad
4. ✅ Subir a `80%`
5. ✅ Ahora es muy estricto, solo acepta condiciones óptimas

**Resultado esperado**:
- Los valores en pantalla se actualizan
- El comportamiento del sistema cambia inmediatamente
- Más estricto = más difícil de pasar
- Más permisivo = más fácil de pasar

---

### Test 7: Eliminación de Perfil 🗑️

**Objetivo**: Verificar que se puede eliminar el perfil

**Pasos**:
1. ✅ Con perfil registrado, click en **"Eliminar Perfil"** (botón rojo)
2. ✅ Confirmar en el diálogo de confirmación
3. ✅ Ver toast "Perfil biométrico eliminado"
4. ✅ Badge vuelve a "No registrado" (naranja)
5. ✅ Botón "Eliminar Perfil" desaparece
6. ✅ Botón "Realizar Transferencia" vuelve a estar deshabilitado

**Resultado esperado**:
- Perfil completamente eliminado
- UI vuelve al estado inicial
- No se puede hacer transferencia sin registrar de nuevo

---

## 📊 Checklist de Verificación Rápida

Marca cada item cuando lo hayas probado:

### Funcionalidad Core
- [ ] Registro biométrico exitoso (3 capturas)
- [ ] Verificación exitosa con rostro correcto
- [ ] Rechazo de rostro incorrecto
- [ ] Bloqueo por intentos máximos
- [ ] Eliminación de perfil

### Calidad
- [ ] Rechazo de capturas de baja calidad
- [ ] Indicador de calidad funciona en tiempo real
- [ ] Barra de confianza sube/baja correctamente

### UI/UX
- [ ] Modal de registro se ve bien
- [ ] Modal de verificación se ve bien
- [ ] Animaciones fluidas (scan line, pulse)
- [ ] Mensajes claros de éxito/error
- [ ] Formulario se limpia tras éxito

### Configuración
- [ ] Slider de umbral de confianza funciona
- [ ] Slider de intentos máximos funciona
- [ ] Slider de calidad mínima funciona
- [ ] Cambios se aplican en tiempo real

---

## 🐛 Problemas Comunes y Soluciones

### "No se detecta mi rostro"
- ✅ Asegúrate de dar permiso de cámara
- ✅ Verifica que hay buena iluminación
- ✅ Centra tu rostro en el círculo
- ✅ No uses gafas oscuras o máscaras

### "La calidad siempre es baja"
- ✅ Mejora la iluminación (luz frontal)
- ✅ Limpia el lente de la cámara
- ✅ Acércate más a la cámara
- ✅ Reduce el umbral de calidad en configuración

### "Siempre falla la verificación"
- ✅ Usa el MISMO rostro que registraste
- ✅ Baja el umbral de confianza a 60-70%
- ✅ Verifica que la iluminación es similar al registro
- ✅ Mantén el rostro centrado y quieto

### "El modal no se cierra"
- ✅ Click en "Cancelar"
- ✅ Recarga la página (F5)
- ✅ Verifica la consola del navegador (F12) por errores

---

## 📸 Capturas de Pantalla Esperadas

### Página Inicial
- Header azul con título "🔐 Autenticación Biométrica"
- 2 cards: "Registro Biométrico" y "Transferencia Bancaria"
- Panel de configuración en la parte inferior
- Badge "No registrado" (naranja)

### Durante Registro
- Modal oscuro con fondo blur
- Círculo con feed de cámara
- 3 números (1, 2, 3) en la parte superior
- Indicador de calidad
- Línea de escaneo animada (cuando captura)

### Verificación Exitosa
- Modal con tu rostro
- Barra de confianza en ~75-95% (verde)
- Mensaje "Verificación exitosa" ✅
- Círculo verde

### Error
- Barra de confianza baja <60% (roja)
- Mensaje "Verificación fallida" ❌
- Círculo rojo
- Opción "Reintentar"

---

## ✅ Criterio de Éxito

El sistema pasa todas las pruebas si:

1. ✅ **Registro**: Puede capturar 3 imágenes y crear perfil
2. ✅ **Verificación positiva**: Aprueba rostro correcto con >75% confianza
3. ✅ **Verificación negativa**: Rechaza rostro diferente con <60% confianza
4. ✅ **Seguridad**: Bloquea tras X intentos fallidos
5. ✅ **Calidad**: Solo acepta capturas de buena calidad
6. ✅ **Configuración**: Todos los sliders modifican comportamiento
7. ✅ **UI**: Todas las animaciones y estados visuales funcionan
8. ✅ **Gestión**: Se puede eliminar y re-registrar perfil

---

## 🎯 Siguiente Paso

1. Abre `http://localhost:3000/biometric-demo.html`
2. Sigue los tests en orden (1 → 7)
3. Marca cada checkbox al completar
4. Reporta cualquier problema que encuentres

¡Buena suerte con las pruebas! 🚀

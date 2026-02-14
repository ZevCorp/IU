# 🚀 Quick Start: Native AX System

## ¿Qué hace?

Permite controlar apps de macOS con comandos de voz. Por ejemplo:
- *"abre calculator y suma 5 + 5 + 5"*
- *"abre safari y busca hoteles en paris"*
- *"abre messages y envía hola a mamá"*

## ⚡ Inicio Rápido

### 1. Verificar que todo funciona:
```bash
cd /Users/felipemaldonado/Documents/U/iu-os
./test-native-ax.sh
```

Deberías ver:
```
✅ ALL TESTS PASSED!
```

### 2. Ejecutar IU.app:
```bash
killall IU 2>/dev/null
/Applications/IU.app/Contents/MacOS/IU
```

### 3. Usar comandos de voz:

1. **Abre la ventana de chat** (click en el ícono de chat en IU.app)
2. **Escribe un comando**, por ejemplo:
   ```
   abre calculator y suma 5 + 5 + 5
   ```
3. **Presiona Enter**
4. **Confirma la acción** en la ventana principal de IU
5. **¡Observa la magia!**

---

## 🛠️ Si algo falla

### Error: "Native addon not found"
```bash
npm install  # Recompila el addon
./rebuild-app.sh  # Reconstruye IU.app
```

### Error: "Permission denied"
1. Ve a **System Settings** → **Privacy & Security** → **Accessibility**
2. Busca **IU** en la lista
3. Asegúrate de que esté ✅ habilitado
4. Si no está, haz click **+** y agrega `/Applications/IU.app`

### Error: "Command failed"
```bash
# Ver logs completos
killall IU
/Applications/IU.app/Contents/MacOS/IU 2>&1 | tee iu-debug.log

# Busca líneas con:
# ✅ [SimpleAxAgent] Using NATIVE addon
# ✅ [SimpleAxAgent] Success!
```

---

## 📖 Documentación Completa

- **Técnica**: `NATIVE_AX_SYSTEM.md`
- **Resumen**: `PROJECT_SUMMARY.md`
- **General**: `README.md`

---

## 🎯 Ejemplos de Comandos

### Calculadora:
- "abre calculator y suma 10 + 20"
- "abre calculator y multiplica 5 por 8"
- "abre calculator y calcula el 15% de 200"

### Safari:
- "abre safari y busca recetas de pasta"
- "abre safari y ve a google.com"
- "abre safari y busca noticias de tecnología"

### Messages (en desarrollo):
- "abre messages y envía hola a Juan"
- "abre messages y manda buenos días al grupo familia"

---

## 💡 Tips

1. **Sé específico**: Mientras más claro el comando, mejor funciona
2. **Apps simples primero**: Calculator, Safari funcionan muy bien
3. **Confirma las acciones**: Revisa lo que IU va a hacer antes de confirmar
4. **Reporta errores**: Si algo falla, guarda los logs y reporta

---

## 🎉 ¡Listo!

Ahora puedes controlar tu Mac con tu voz a través de IU.

**Disfruta el poder de la automatización inteligente!** 🚀

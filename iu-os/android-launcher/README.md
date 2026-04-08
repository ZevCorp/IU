# IU Android Launcher

Base rápida para iteración móvil:

- Nivel 1: vista principal inspirada en la ventana principal actual.
- Nivel 2: metas y notas usando `chat.html/chat.js/chat.css`.
- Nivel 3: filtro de notificaciones retenidas.

## Build esperado

```bash
cd /Users/felipemaldonado/Documents/U/iu-os/android-launcher
./gradlew assembleDebug
```

APK esperado:

```bash
app/build/outputs/apk/debug/app-debug.apk
```

## Estado actual

El proyecto quedó listo, pero esta máquina todavía no tiene:

- Java runtime
- Android SDK / build-tools

En cuanto estén instalados, el build de debug debería ser el primer paso útil para iterar.

# ScreenAgent — Documentación Técnica

## Qué es

`ScreenAgent.js` es el módulo de automatización visual de IÜ OS. Permite que el asistente **controle la Mac del usuario** (mouse + teclado) para completar tareas en cualquier app, guiado por visión artificial (GPT-4.1-mini).

---

## Arquitectura Actual (v3 — Unified Pipeline)

```
┌─────────────────────────────────────────────────────────────┐
│                    LOOP (max 15 iteraciones)                │
│                                                             │
│  1. Esconder ventana de IÜ                                  │
│  2. screencapture → downscale Retina → imagen LIMPIA        │
│  3. Enviar screenshot a GPT-4.1-mini (vision + tools)       │
│  4. Modelo analiza pantalla + llama UNA función:             │
│     • click(x, y)      — coordenadas normalizadas 0-1      │
│     • type_text(text)   — escribir en campo enfocado        │
│     • key_press(key)    — Enter, Tab, Escape, etc.          │
│     • goal_reached()    — objetivo completado               │
│  5. Denormalizar coords → ejecutar con nut-js               │
│  6. Esperar UI update → repetir                             │
└─────────────────────────────────────────────────────────────┘
```

### Un solo modelo, un solo paso

GPT-4.1-mini recibe el screenshot, razona sobre el estado de la UI, y directamente llama una función tool. No hay modelo intermedio ni paso de análisis separado.

---

## Evolución del diseño (decisiones tomadas)

### v1 — Dos modelos con cuadrícula (descartado)
- **GPT-4.1** analizaba el screenshot y devolvía affordances (JSON con coordenadas absolutas en píxeles)
- **GPT-4.1-mini** recibía la lista de affordances y elegía cuál clickear
- **Problema**: el mini model no veía la pantalla, perdía contexto del estado visual. Clickeaba cosas que no existían o asumía que acciones previas habían funcionado.

### v2 — Pipeline unificado con cuadrícula (descartado)
- Se fusionó todo en un solo GPT-4.1-mini con vision + function calling
- Se mantuvo la cuadrícula roja (líneas cada 100px, etiquetas cada 200px) sobre el screenshot
- **Problema**: coordenadas absolutas en píxeles forzaban razonamiento geométrico innecesario. La cuadrícula ocluía elementos de UI. Los botones entre líneas de grid generaban error sistemático.

### v3 — Coordenadas normalizadas sin cuadrícula (actual) ✅
- Screenshot **limpio** (sin overlay)
- Coordenadas **normalizadas 0.0–1.0** (proporciones relativas)
- Denormalización a píxeles en el momento de ejecutar: `pixel = normalized × screenSize`
- **Ventajas**: el modelo razona mejor en proporciones, no depende de resolución, imagen más limpia = mejor visión.

---

## Coordenadas normalizadas

El modelo devuelve coordenadas entre 0.0 y 1.0:

| Posición | x | y |
|----------|-----|-----|
| Esquina superior izquierda | 0.0 | 0.0 |
| Centro de pantalla | 0.5 | 0.5 |
| Esquina inferior derecha | 1.0 | 1.0 |

La denormalización ocurre en `_executeTool()`:
```javascript
const px = Math.round(args.x * this.screenWidth);   // ej: 0.19 * 1440 = 274
const py = Math.round(args.y * this.screenHeight);   // ej: 0.75 * 900  = 675
```

---

## Function calling tools

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `click` | Click en elemento UI | `x`, `y` (0-1), `label`, `reasoning` |
| `type_text` | Escribir texto en campo enfocado | `text`, `label`, `reasoning` |
| `key_press` | Tecla especial | `key` (enter/tab/escape/...), `label`, `reasoning` |
| `goal_reached` | Objetivo completado | `summary` |

---

## Reglas del sistema (prompt)

1. **Una función por turno** — analiza y actúa en un solo paso
2. **Click antes de type** — primero click en el campo, luego type_text en el siguiente turno
3. **Verificación obligatoria** — antes de avanzar, el modelo debe confirmar visualmente que la acción anterior tuvo efecto
4. **Reintento si falla** — si la pantalla no cambió, repetir con coordenadas corregidas
5. **goal_reached solo visual** — solo declarar completado si se confirma visualmente

---

## Manejo de Retina

macOS con Retina produce screenshots a 2x (ej: 2880×1800). Se downscalea a resolución lógica (1440×900) para que las coordenadas normalizadas mapeen correctamente a las coordenadas de nut-js (que opera en espacio lógico).

---

## Debug

Los screenshots de debug se guardan en `~/u_debug/` con un crosshair verde en el punto de click (coordenadas ya denormalizadas a píxeles).

```bash
open ~/u_debug/
```

Cada archivo: `iter_{N}_{action}_{px}_{py}.png`

---

## Gestión de tokens

La conversación persiste entre iteraciones (el modelo recuerda lo que hizo). Para evitar explotar el contexto:
- `_trimMessages()` mantiene solo los últimos 3 screenshots
- Los screenshots viejos se reemplazan con un resumen de texto

---

## Dependencias clave

| Paquete | Uso |
|---------|-----|
| `sharp` | Procesamiento de imágenes (resize, compositing SVG) |
| `@nut-tree-fork/nut-js` | Control nativo de mouse y teclado |
| `openai` | API de GPT-4.1-mini (vision + function calling) |
| `electron` (screen) | Obtener dimensiones de display y scale factor |

---

## Problemas conocidos / áreas de mejora

1. **Precisión de clicks** — Las coordenadas normalizadas son mejores que la cuadrícula, pero aún dependen de la capacidad del vision model para estimar posiciones relativas. Podría mejorar con bounding boxes o un modelo de detección de objetos dedicado.
2. **Velocidad** — Cada iteración toma ~2-4s (screenshot + API call + ejecución). Podría optimizarse con streaming o modelos más rápidos.
3. **Scroll** — No hay soporte actual para scroll. Si un elemento no es visible, el agente no puede alcanzarlo.
4. **Multi-monitor** — Solo usa el display primario.
5. **Verificación de acciones** — Actualmente es por prompting. Podría reforzarse con diff de screenshots (comparar antes/después programáticamente).

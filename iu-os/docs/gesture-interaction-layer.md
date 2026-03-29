# Gesture Interaction Layer

Esta capa vive principalmente en [app.js](/Users/felipemaldonado/Documents/U/iu-os/renderer/app.js) y coordina cuatro comportamientos que compiten por los mismos eventos de puntero y trackpad:

- `side-scroll` global para transferencia horizontal.
- `pinch` global para cambio de tamano de ventana.
- drag manual de la ventana principal.
- interaccion normal del prompt chat embebido bajo la cara.

## Por que se interfieren

La ventana principal usa `setIgnoreMouseEvents(..., { forward: true })`, asi que una parte del hit-testing llega reenviada al renderer. Eso hace que `event.target` por si solo no sea confiable para decidir si el usuario esta sobre una superficie interactiva. Ademas, `wheel`, `gesture*`, hover y foco son reutilizados por varias capas al mismo tiempo.

## Piezas principales

### 1. Hit-testing centralizado

Las funciones `getInteractionContext()`, `getInteractionContextFromEvent()` e `isWithinPromptChatSurface()` son la fuente de verdad para clasificar la interaccion actual.

Detalles importantes:

- combinan `event.target` con `document.elementsFromPoint(...)`
- calculan si el puntero cae dentro de `PROMPT_CHAT_SURFACE_SELECTOR`
- reutilizan la misma lectura para `no-drag`, superficies interactivas y excepciones del chat

Si aparece un nuevo caso interactivo, conviene extender selectores y helpers aqui primero, no agregar chequeos sueltos en listeners individuales.

### 2. Sesion de interaccion del prompt chat

`promptChatInteractionState` representa si el chat debe tener prioridad temporal sobre la ventana.

La sesion se mantiene viva con:

- hover sobre `#prompt-chat-dock`
- foco dentro del dock
- actividad reciente de `wheel` o `scroll`
- gestos nativos reclamados por el prompt

Las funciones clave son:

- `beginPromptChatInteractionSession()`
- `reconcilePromptChatInteractionSession()`
- `schedulePromptChatReleaseCheck()`

La idea es evitar que el pass-through vuelva a activarse en mitad de un scroll inercial o de una seleccion de texto.

### 3. Click-through de la ventana principal

`setMainWindowClickThrough()` decide si la ventana deja pasar o no los eventos de mouse.

Flujo:

1. renderer: `setMainWindowClickThrough(enabled)`
2. preload: `window.iuOS.setClickThrough(...)`
3. main: IPC `set-click-through`
4. Electron: `mainWindow.setIgnoreMouseEvents(enabled, { forward: true })`

Cuando el prompt chat esta activo, el click-through debe quedar deshabilitado para que el chat pueda recibir scroll, foco y seleccion.

### 4. Gestos globales

Hay dos zonas donde los gestos globales deben respetar la excepcion del prompt:

- En `init()`, el `wheel` horizontal dispara la transferencia global.
- En `setupWindowModes()`, `ctrl+wheel` y `gesturestart/gesturechange/gestureend` manejan el cambio de tamano.

En ambos casos, si `getInteractionContextFromEvent(...)` indica que el evento cae dentro del prompt chat, el listener debe salir temprano y cederle la prioridad al dock.

### 5. Drag manual

`setupManualDrag()` ya no depende de exclusiones locales separadas. Usa la misma capa de hit-testing para decidir si la superficie actual cae dentro de `withinNoDragSurface`.

Eso evita divergencias entre:

- zonas no draggables
- zonas interactivas
- zonas donde el chat debe quedarse con el gesto

## Detalle importante del fix de scroll

El problema no era solo de gestos. El historial del prompt tambien necesitaba un layout mas simple para que el overflow vertical se materializara correctamente.

La solucion final dejo `.prompt-chat-history` en [styles.css](/Users/felipemaldonado/Documents/U/iu-os/renderer/styles.css) como un contenedor de flujo simple (`display: block`) con separacion entre hijos, en vez de layouts mas complejos que estaban colapsando la altura scrolleable.

## Reglas para futuros cambios

- Si agregas una nueva superficie interactiva, actualiza los selectores y helpers centrales antes que los listeners.
- No confies solo en `event.target` cuando la ventana este usando forwarded mouse events.
- Si tocas `wheel`, `ctrl+wheel` o `gesture*`, revisa siempre la excepcion del prompt chat.
- Si el chat vuelve a perder scroll, valida tambien el `scrollHeight/clientHeight` real del historial; no asumas que todo es culpa del routing de eventos.
- Evita meter `stopPropagation()` o logging global de depuracion salvo que sea estrictamente necesario; esta capa es sensible y pequenos cambios alteran el comportamiento de la ventana completa.

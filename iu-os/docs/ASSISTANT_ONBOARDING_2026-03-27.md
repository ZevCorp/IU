# Asistente IU - Onboarding y Metas (2026-03-27)

## Objetivo producto (definido)
Construir un asistente de chat que sea puente directo entre el usuario y su contexto digital, capaz de:
- Escribir, editar, borrar y anidar notas.
- Crear, editar, borrar y organizar metas.
- Mantener notas/metas sincronizadas con lo que el usuario dice en conversación.
- Ejecutar tareas en el computador mediante herramientas (function calling + agentes de pantalla/browser).

## Lo que YA existe (listo hoy)

### 1) Base sólida de ejecución agéntica
- `ActionPlanner` con function-calling para acciones de pantalla y recordatorios.
- `ScreenAgent` + AX nativo para operar interfaz de macOS.
- `BrowserAgent` para acciones en navegador.
- Flujo de confirmación de acciones con `action-confirm-request`.

### 2) Infraestructura de modelo y herramientas
- `ModelSwitch` funcional con múltiples providers.
- Llamadas con tools y `tool_choice` en pipeline principal.
- Ruteo entre conversación normal y acciones ejecutables.

### 3) Sistema de notas (persistente)
- `NotebookExecutionManager` con CRUD de tabs/notas.
- Persistencia en `userData/chat-notebooks/notebooks.json`.
- Variables persistentes/contextuales extraídas desde nota + conversación.
- Integración de payload de chat con contexto de nota activa.

### 4) Sistema de metas (UI avanzada)
- UI de metas/notas en `renderer/chat.js` + `renderer/chat.html`.
- Crear/eliminar metas, anidar notas, reordenar por drag & drop.
- Agente de meta (`meta-agent-run`) que sugiere notas existentes y crea notas de profundización.
- Inferencia de links de aprendizaje entre notas.

### 5) Calidad mínima de ingeniería
- Tests existentes y pasando para onboarding, reactividad browser y execution sessions.

## Lo que NO está listo (gaps críticos)

### 1) Falta toolset explícito para CRUD de notas/metas desde el chat
Hoy el chat usa tools para `execute_screen_action`/`schedule_reminder`, pero no hay tools explícitos tipo:
- `create_note`, `update_note`, `delete_note`
- `create_goal`, `update_goal`, `delete_goal`
- `attach_note_to_goal`, `detach_note_from_goal`

### 2) Metas no están en un backend/capa única de dominio
- Metas se guardan en `localStorage` (`iu_metas_v4`) dentro del renderer.
- Notas viven en `NotebookExecutionManager` (main process + JSON).
- Esto deja el dominio partido (notas en main, metas en renderer).

### 3) No hay política estable de “memoria conversacional -> mutación de notas/metas”
- No existe un "commit policy" determinista para cuándo aplicar cambios automáticos.
- Falta modo borrador vs aplicado, trazabilidad y undo/rollback.

### 4) Falta gobernanza para acciones de alto riesgo
- Hay confirmación para acciones de pantalla, pero no una política completa por tipo de mutación de conocimiento (sobrescribir, borrar, fusionar).

## Metas propuestas por fases

## Fase 1 - MVP de conocimiento editable por chat (prioridad máxima)
1. Definir API interna de conocimiento (main process):
   - notas, metas, enlaces nota-meta, snippets.
2. Exponer IPC único (`knowledge-*`) para CRUD total.
3. Crear tools LLM explícitas para CRUD y anidado.
4. Conectar `chat-send-message` y `prompt-agent-run` para que puedan invocar esas tools.
5. Agregar auditoría mínima (`knowledge-events.log`) y undo básico.

Criterio de salida:
- Desde chat, el asistente puede crear/editar/borrar/anidar notas y metas con confirmación opcional.

## Fase 2 - Sincronización conversacional inteligente
1. Política de actualización:
   - auto-aplicar cambios de bajo riesgo,
   - pedir confirmación para cambios destructivos.
2. Detección semántica de “actualiza mi meta/nota” vs conversación casual.
3. Resúmenes de cambio post-acción (qué cambió exactamente).

Criterio de salida:
- El asistente mantiene notas y metas al día de forma consistente con la conversación.

## Fase 3 - Orquestación total de tareas
1. Unificar herramientas de conocimiento + pantalla/browser en un solo router de acciones.
2. Planner con elección de estrategia: editar conocimiento vs ejecutar en PC vs ambas.
3. Reglas de seguridad por riesgo y contexto.

Criterio de salida:
- Asistente operativo end-to-end: pensar, actualizar contexto y ejecutar tareas con trazabilidad.

## Backlog técnico inmediato (sprint sugerido)
1. Crear `KnowledgeService.js` (fuente única para notas + metas + vínculos + snippets).
2. Migrar metas de `localStorage` a persistencia de main process.
3. Añadir IPC:
   - `knowledge-list`, `knowledge-create`, `knowledge-update`, `knowledge-delete`, `knowledge-link`.
4. Añadir tools en planner:
   - CRUD notas/metas/snippets + link/unlink.
5. Tests:
   - unitarios del servicio,
   - integración de tool-calls,
   - regresión de chat pipeline.

## Estado resumido
- Arquitectura y capacidades base: fuertes.
- Experiencia de notas/metas en UI: avanzada.
- Gap principal: falta cerrar el loop de edición estructurada vía function-calling de conocimiento.
- Riesgo principal: dominio fragmentado (metas en renderer, notas en main).

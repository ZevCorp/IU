# Time Manager - Arquitectura Inicial (2026-03-28)

## Objetivo
Construir un agente gemelo del asistente principal, con la misma estructura de runtime, prompt, tools y workflow de function calling, pero especializado en decidir **cuando** interrumpir al usuario y **cuando no**.

La decisión primaria debe venir del modelo, igual que en el agente principal. No se diseña como un motor heurístico con un LLM encima, sino como un runtime agéntico donde el modelo decide y usa herramientas para programar la entrega.

## Decisiones base cerradas

### 1. Patrón de agente
- `Time Manager` será un runtime separado, no un helper del planner general.
- Mantiene el patrón del agente principal:
  - prompt del sistema fuerte,
  - loop de `chatCompletion`,
  - tools explícitas,
  - ejecución secuencial de tool calls,
  - memoria/auditoría de decisiones.

### 2. Política de bloqueo de notificaciones
- El modo base será **modo enfoque / no molestar completo del sistema operativo**.
- Time Manager asume que el OS está bloqueando la entrega normal.
- El sistema recibe la notificación en segundo plano y luego la re-entrega cuando Time Manager lo decida.

### 3. Mobile multiplataforma
- La arquitectura móvil se diseña desde ya para **Android + iOS**.
- Elegimos:
  - **UI compartida web** entre Electron, Android e iOS.
  - **Capacitor** como shell móvil único.
  - **plugins nativos**:
    - Kotlin en Android
    - Swift en iOS
- Esto evita una reescritura futura y preserva la promesa de una app móvil visualmente idéntica a desktop.

## Arquitectura de alto nivel

```text
Desktop Electron
  ├─ Main Runtime
  │   ├─ Main Assistant Runtime
  │   ├─ Time Manager Runtime
  │   └─ Shared Memory / Audit / Sync
  └─ Shared Web UI

Mobile Shell (Capacitor)
  ├─ Shared Web UI
  ├─ Native Notification Bridge
  ├─ Native Focus / DND Bridge
  ├─ Native Location Bridge
  ├─ Native App Activity Bridge
  └─ Native Ambient Audio Bridge
```

## Repartición de responsabilidades

### Shared domain
Debe vivir en módulos neutrales a plataforma:
- contratos de notificación,
- contratos de triggers,
- contratos de decisiones,
- contratos de delivery.

Esto permite que Android, iOS y Electron hablen el mismo idioma de negocio.

### Runtime central
Vive en desktop/shared backend:
- ingestión de notificaciones,
- llamada al modelo,
- consulta opcional al asistente principal,
- decisión final,
- persistencia,
- emisión de plan de entrega.

### Capa nativa móvil
Se limita a:
- capturar eventos del OS,
- aplicar DND/focus,
- observar señales nativas,
- reproducir audio/mostrar cara,
- reportar contexto al runtime.

## Flujo v1

1. El móvil activa modo enfoque/no molestar completo.
2. Una notificación entra por el bridge nativo.
3. Se normaliza a `NotificationEnvelope`.
4. `TimeManagerRuntime` consulta al modelo.
5. El modelo usa tools para:
   - entregar ahora,
   - programar por tiempo,
   - programar por ubicación,
   - programar por apertura de app,
   - programar por palabra clave,
   - programar por ambiente,
   - consultar al asistente principal,
   - suprimir.
6. Se guarda una `InterruptionDecision`.
7. El bridge nativo espera la condición.
8. Al cumplirse:
   - reproduce `hey_pss_pss`,
   - muestra el rostro,
   - expone la notificación.

## Contratos de dominio mínimos

### NotificationEnvelope
- `id`
- `sourceApp`
- `packageName`
- `title`
- `body`
- `sender`
- `category`
- `receivedAt`
- `priorityHint`
- `contextTags`

### InterruptionDecision
- `notificationId`
- `kind`
- `importance`
- `summary`
- `reasoning`
- `createdAt`
- `plan`

### DeliveryPlan
- `kind`
- `trigger`
- `surface`
- `shieldMode`
- `speakCue`
- `facePreset`

### Trigger
- `immediate`
- `time`
- `location`
- `app_open`
- `keyword`
- `ambient_audio`
- `manual_window`
- `agent_signal`

## Tools iniciales de Time Manager
- `ask_main_assistant`
- `deliver_notification_now`
- `schedule_notification_delivery`
- `suppress_notification`

En esta etapa, esas tools son suficientes para fijar el patrón agéntico correcto. Después se pueden expandir sin romper la arquitectura.

## Estrategia de iOS desde ya

### Lo compartido
- renderer web,
- contratos de dominio,
- runtime de decisión,
- store y auditoría,
- protocolo de sync.

### Lo nativo por plataforma
- permisos,
- APIs de notificaciones,
- focus mode / DND,
- geofencing,
- detección de app abierta,
- audio ambiental,
- background execution.

## Riesgos reales
- iOS tendrá límites más estrictos que Android para background execution y observación de actividad.
- Por eso la arquitectura debe tratar las señales nativas como capacidades opcionales, no como supuestos.
- El contrato compartido debe permitir que una plataforma reporte:
  - `supported`
  - `unsupported`
  - `degraded`

## Siguiente implementación recomendada
1. Integrar `TimeManagerRuntime` al proceso principal.
2. Crear IPC dedicado para:
   - ingestión de notificaciones,
   - consulta de decisiones,
   - ack de delivery.
3. Extraer la UI compartida del asistente y metas/notas para que Electron y Capacitor usen el mismo bundle.
4. Implementar plugin nativo Android primero y el mismo contrato en Swift después.

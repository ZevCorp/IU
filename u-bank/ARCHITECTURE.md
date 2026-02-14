# Ü Bank — Asistente Bancario Autónomo

## Visión

Ü controla el teléfono Android del usuario para ejecutar operaciones bancarias en Bancolombia (y cualquier app consecutivamente). El usuario habla con Ü, Ü entiende la intención, planifica la ruta de navegación, y ejecuta los taps/swipes en el teléfono.

**"El sistema no sabe hacer nada, pero lo puede hacer todo"** — Ü es una capa de abstracción sobre la GUI, igual que Jobs puso GUI sobre CLI en 1984.

---

## Arquitectura de 3 Nodos

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANDROID (Ü App)                                │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  Ü Face (SVG)   │  │  AccessibilityService │  │  Executor    │  │
│  │  Voice Input     │  │  → UI Tree Walker     │  │  → performAction│
│  │  Wake Detection  │  │  → Graph Extractor     │  │  → tap/swipe │  │
│  │                  │  │  → State Observer      │  │  → fill text │  │
│  └────────┬─────────┘  └──────────┬───────────┘  └──────┬──────┘  │
│           │                       │                       │        │
│           └───────────┬───────────┴───────────────────────┘        │
│                       │ WebSocket                                  │
└───────────────────────┼────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              RENDER BACKEND (WebSocket Relay)                     │
│              iu-rw9m.onrender.com                                 │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Android Bridge — same pattern as jetson-bridge.ts        │   │
│  │  Routes: android↔jetson, stores graph cache               │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              JETSON ORIN NANO                                     │
│                                                                   │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  SLM          │  │  Graph Compiler   │  │  HRM (27M)       │  │
│  │  (Gemma 2B)   │  │  Intent → Grid    │  │  Grid → Path     │  │
│  │               │  │  JSON → 30x30     │  │  Maze solver     │  │
│  │  NLU:         │  │  maze tokens      │  │  ~5ms inference  │  │
│  │  "Envía 50k   │  │                   │  │                   │  │
│  │   a María"    │  │  Checkpoints:     │  │  Output:          │  │
│  │   → intent    │  │  [open_app,       │  │  Sequence of      │  │
│  │   → params    │  │   nav_to_send,    │  │  grid positions   │  │
│  │   → target    │  │   select_pocket,  │  │  → mapped back    │  │
│  │              │  │   enter_amount,   │  │  to UI actions    │  │
│  │               │  │   confirm]        │  │                   │  │
│  └──────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flujo Completo

```
1. USUARIO habla: "Envía 50 mil a María del bolsillo de ahorros"
                    │
2. ANDROID captura audio → envía transcripción al Jetson
                    │
3. JETSON SLM procesa:
   {
     "intent": "send_money",
     "amount": 50000,
     "recipient": "María",
     "source": "bolsillo_ahorros",
     "app": "bancolombia"
   }
                    │
4. JETSON Graph Compiler:
   - Carga el grafo de Bancolombia (JSON)
   - Identifica nodo actual (home_screen o app_launcher)
   - Identifica nodo destino (send_money_confirm)
   - Genera sub-checkpoints:
     [open_bancolombia, navigate_to_transfer, select_pocket,
      enter_amount, search_recipient, confirm_send]
   - Para CADA transición entre checkpoints:
     → Compila un maze 30x30 con START y TARGET
     → Envía a HRM
                    │
5. JETSON HRM resuelve cada maze:
   - Input: grid 900 tokens (30x30 flattened)
   - Output: path óptimo [(r,c), (r,c), ...]
   - Cada posición del path mapea a un nodo del grafo
                    │
6. JETSON envía plan de ejecución al Android:
   {
     "type": "execute_plan",
     "steps": [
       {"action": "tap", "target": "bancolombia_icon", "accessibility_id": "..."},
       {"action": "tap", "target": "transferir_btn", "selector": "..."},
       {"action": "tap", "target": "bolsillo_ahorros", "selector": "..."},
       {"action": "fill", "target": "amount_field", "value": "50000"},
       {"action": "tap", "target": "search_recipient", "selector": "..."},
       {"action": "fill", "target": "search_field", "value": "María"},
       {"action": "tap", "target": "recipient_maria", "selector": "..."},
       {"action": "tap", "target": "confirm_btn", "selector": "..."}
     ]
   }
                    │
7. ANDROID Executor ejecuta paso a paso:
   - Usa AccessibilityService.performAction()
   - Después de cada acción, verifica el nuevo estado
   - Si el estado no coincide con lo esperado → re-planifica
   - Reporta progreso al Jetson
                    │
8. Ü Face muestra progreso visual al usuario
```

---

## El Grafo: Formato Óptimo para HRM

### Por qué un grid 30x30

HRM fue entrenado con mazes de 30x30 (900 tokens). Su checkpoint `sapientinc/HRM-checkpoint-maze-30x30-hard` está optimizado para este tamaño exacto. El vocabulario es de 6 tokens:

| Token | Significado | Uso en UI Graph |
|-------|-------------|-----------------|
| 0 | WALL | Transición imposible / padding |
| 1 | PATH | Transición posible entre screens |
| 2 | START | Pantalla actual del usuario |
| 3 | TARGET | Pantalla destino |
| 4 | SOLUTION | (output) Ruta óptima marcada por HRM |
| 5 | ERROR | (output) Error de inferencia |

### Estructura del Grafo JSON (pre-compilación a maze)

```json
{
  "app": "com.bancolombia.app",
  "version": "1.0.0",
  "extracted_at": "2026-02-12T19:00:00Z",
  "nodes": {
    "home": {
      "id": "home",
      "label": "Pantalla Principal",
      "package": "com.bancolombia.app",
      "activity": ".ui.home.HomeActivity",
      "accessibility_snapshot": {
        "root_class": "android.widget.FrameLayout",
        "key_elements": [
          {
            "id": "btn_transferir",
            "class": "android.widget.Button",
            "text": "Transferir",
            "content_desc": "Transferir dinero",
            "bounds": [120, 400, 280, 460],
            "clickable": true
          }
        ]
      },
      "edges": ["transfer_menu", "payments", "pockets", "qr_scan", "settings"]
    },
    "transfer_menu": {
      "id": "transfer_menu",
      "label": "Menú Transferencias",
      "edges": ["send_to_contact", "send_to_account", "send_to_pocket", "home"]
    },
    "pockets": {
      "id": "pockets",
      "label": "Bolsillos",
      "edges": ["pocket_detail", "home"],
      "dynamic": true,
      "list_type": "pocket_list"
    }
  },
  "edges": [
    {
      "from": "home",
      "to": "transfer_menu",
      "action": {
        "type": "tap",
        "selector": {"id": "btn_transferir"},
        "fallback_selector": {"text": "Transferir", "class": "android.widget.Button"}
      },
      "weight": 1
    }
  ]
}
```

### Compilación a Maze 30x30

El `GraphCompiler` en el Jetson convierte el grafo JSON a un maze:

1. **Asigna coordenadas** a cada nodo en el grid 30x30 usando un layout algorithm (force-directed o grid-based)
2. **Traza paths** entre nodos conectados (edges) usando celdas PATH(1)
3. **Rellena** el resto con WALL(0)
4. **Marca** el nodo actual como START(2) y el destino como TARGET(3)
5. **Flattens** el grid a 900 tokens y envía a HRM

```
Ejemplo: home → transfer_menu → send_to_contact

Grid 30x30 (simplificado a 7x7 para visualización):

███████████
█·········█
█·S·█·····█    S = home (START)
█·│·█·····█    T = send_to_contact (TARGET)
█·│·█·····█
█·└──→P···█    P = transfer_menu (PATH node)
█·····│···█
█·····└→T·█
█·········█
███████████
```

### Por qué este formato es óptimo para HRM

1. **Sequence-to-sequence nativo**: HRM toma 900 tokens, devuelve 900 tokens. Sin overhead.
2. **Vocabulario mínimo (6 tokens)**: Exactamente lo que HRM fue entrenado para entender.
3. **Spatial reasoning**: HRM excels en pathfinding espacial — es literalmente su benchmark principal.
4. **Single forward pass**: ~5ms en Jetson con CUDA. No necesita CoT ni múltiples inferencias.
5. **Escalable**: Un grafo de 100+ pantallas cabe en 30x30 con room to spare.

---

## Extracción del Grafo desde Android

### AccessibilityService

Android provee `AccessibilityService` que puede:
- Leer el **árbol completo de UI** (`AccessibilityNodeInfo`)
- Detectar **cambios de ventana** (`TYPE_WINDOW_STATE_CHANGED`)
- **Ejecutar acciones** (`performAction(ACTION_CLICK)`)
- Leer **content descriptions**, **text**, **class names**, **bounds**

### Proceso de Exploración (Graph Builder)

```
Fase 1: EXPLORACIÓN AUTOMÁTICA
   ┌─────────────────────────────────────────┐
   │ 1. Abrir app Bancolombia                │
   │ 2. Capturar UI tree del estado actual    │
   │ 3. Identificar todos los elementos       │
   │    clickables (botones, links, tabs)     │
   │ 4. Para cada elemento clickable:         │
   │    a. Click                              │
   │    b. Capturar nuevo UI tree             │
   │    c. ¿Es un nuevo estado?               │
   │       → Sí: Agregar nodo + edge al grafo │
   │       → No: Marcar como mismo estado     │
   │    d. Navegar back                       │
   │ 5. Repetir recursivamente (DFS)          │
   │ 6. Max depth: 5 niveles                  │
   └─────────────────────────────────────────┘

Fase 2: REFINAMIENTO
   - Eliminar nodos duplicados (mismo UI tree hash)
   - Detectar loops (A→B→A)
   - Marcar nodos dinámicos (listas, scroll)
   - Guardar accessibility selectors para cada edge

Fase 3: EXPORT
   - Generar JSON del grafo
   - Enviar al Jetson para compilación
   - Cache local en el Android
```

### Fingerprinting de Estados

Para saber si dos pantallas son "el mismo estado":

```kotlin
fun fingerprintScreen(root: AccessibilityNodeInfo): String {
    val sb = StringBuilder()
    sb.append(root.className)
    sb.append("|")
    // Hash de la estructura (no del contenido dinámico)
    traverseTree(root) { node ->
        sb.append(node.className)
        sb.append(node.viewIdResourceName ?: "")
        sb.append(if (node.isClickable) "C" else "")
        sb.append(if (node.isScrollable) "S" else "")
        sb.append(",")
    }
    return sb.toString().hashCode().toString(16)
}
```

---

## Estructura del Proyecto

```
U/
├── u-bank/                          ← ESTE PROYECTO
│   ├── ARCHITECTURE.md              ← Este documento
│   │
│   ├── android/                     ← App Android (Kotlin)
│   │   ├── app/
│   │   │   └── src/main/
│   │   │       ├── java/com/u/bank/
│   │   │       │   ├── UBankApp.kt              ← Application class
│   │   │       │   ├── MainActivity.kt           ← Ü Face + Voice
│   │   │       │   ├── service/
│   │   │       │   │   ├── UAccessibilityService.kt  ← Core: UI tree reading
│   │   │       │   │   ├── GraphExplorer.kt          ← Automated DFS exploration
│   │   │       │   │   ├── ScreenFingerprint.kt      ← State deduplication
│   │   │       │   │   └── ActionExecutor.kt         ← Tap/swipe/fill execution
│   │   │       │   ├── graph/
│   │   │       │   │   ├── AppGraph.kt               ← Graph data structure
│   │   │       │   │   ├── GraphNode.kt              ← Screen node
│   │   │       │   │   ├── GraphEdge.kt              ← Transition edge
│   │   │       │   │   └── GraphStorage.kt           ← JSON persistence
│   │   │       │   ├── network/
│   │   │       │   │   ├── JetsonClient.kt           ← WebSocket to Render
│   │   │       │   │   └── Protocol.kt               ← Message types
│   │   │       │   ├── face/
│   │   │       │   │   ├── UFaceView.kt              ← SVG face renderer
│   │   │       │   │   └── FacePresets.kt            ← Expression presets
│   │   │       │   └── voice/
│   │   │       │       ├── WakeWordDetector.kt       ← "Ü" wake word
│   │   │       │       ├── SpeechRecognizer.kt       ← STT
│   │   │       │       └── VoiceManager.kt           ← Orchestrator
│   │   │       └── res/
│   │   │           └── layout/
│   │   │               └── activity_main.xml
│   │   └── build.gradle.kts
│   │
│   ├── jetson/                      ← Jetson modules (Python)
│   │   ├── slm_service.py           ← SLM: NLU intent extraction
│   │   ├── graph_compiler.py        ← JSON graph → 30x30 maze
│   │   ├── planner.py               ← Intent → checkpoints → execution plan
│   │   └── bank_service.py          ← Main orchestrator (extends hrm_service.py)
│   │
│   └── server/                      ← Render backend extensions
│       └── android-bridge.ts        ← WebSocket handler for Android
```

---

## Protocolo WebSocket

### Android → Server → Jetson

```typescript
// Android registra conexión
{ type: "register", deviceId: "android-pixel-7", payload: { deviceType: "android", app: "u-bank" } }

// Android envía UI state actual
{ type: "ui_state", payload: { screenFingerprint: "a3f2b1", uiTree: {...}, currentApp: "com.bancolombia.app" } }

// Android envía grafo explorado
{ type: "graph_update", payload: { app: "com.bancolombia.app", graph: {...} } }

// Android envía transcripción de voz
{ type: "voice_command", payload: { text: "Envía 50 mil a María", confidence: 0.95 } }

// Android reporta resultado de acción
{ type: "action_result", payload: { stepIndex: 3, success: true, newScreenFingerprint: "b4c3d2" } }
```

### Jetson → Server → Android

```typescript
// Jetson envía plan de ejecución
{ type: "execute_plan", requestId: "plan-001", payload: { 
    steps: [
      { action: "tap", selector: { id: "btn_transferir" }, expectedScreen: "transfer_menu" },
      { action: "fill", selector: { id: "amount_input" }, value: "50000" },
      { action: "tap", selector: { text: "Confirmar" } }
    ]
  }
}

// Jetson pide explorar más
{ type: "explore_request", payload: { fromScreen: "transfer_menu", depth: 2 } }

// Jetson confirma intent
{ type: "intent_confirmed", payload: { 
    intent: "send_money", 
    summary: "Enviar $50,000 a María desde bolsillo de ahorros",
    requiresConfirmation: true 
  }
}
```

---

## SLM en Jetson

**Modelo**: Gemma 2B (o Phi-3-mini 3.8B) — corre en Jetson Orin Nano con 8GB

**Rol**: Procesamiento de lenguaje natural puro. No navega, no ejecuta. Solo entiende.

```python
SYSTEM_PROMPT = """Eres el módulo NLU de Ü, un asistente bancario.
Extrae la intención del usuario en JSON estructurado.

Intenciones soportadas:
- send_money: Enviar dinero a alguien
- check_balance: Consultar saldo
- transfer_pocket: Mover dinero entre bolsillos
- pay_bill: Pagar un servicio
- transaction_history: Ver movimientos

Responde SOLO con JSON válido."""

# Output esperado:
{
  "intent": "send_money",
  "confidence": 0.95,
  "params": {
    "amount": 50000,
    "recipient": "María",
    "source": "bolsillo_ahorros"
  },
  "checkpoints": [
    "open_bancolombia",
    "navigate_to_transfers",
    "select_source_pocket",
    "enter_amount",
    "search_recipient",
    "confirm_transaction"
  ]
}
```

---

## Fase de Implementación

### Fase 1: Graph Extraction (Android)
- [ ] AccessibilityService básico que lee UI trees
- [ ] Screen fingerprinting
- [ ] DFS explorer automático
- [ ] JSON export del grafo

### Fase 2: Graph Compilation (Jetson)
- [ ] JSON → 30x30 maze compiler
- [ ] Node layout algorithm
- [ ] Path tracing entre nodos
- [ ] Integration con HRM existente

### Fase 3: SLM Pipeline (Jetson)
- [ ] Gemma 2B / Phi-3 setup
- [ ] Intent extraction prompt engineering
- [ ] Checkpoint generation
- [ ] Plan assembly

### Fase 4: Execution (Android)
- [ ] Action executor (tap, swipe, fill)
- [ ] State verification after each action
- [ ] Error recovery / re-planning
- [ ] Progress reporting

### Fase 5: Ü Face + Voice (Android)
- [ ] SVG face renderer (port from IU OS)
- [ ] Wake word detection
- [ ] Speech-to-text
- [ ] Visual feedback during execution

---

**Fecha**: 2026-02-12
**Versión**: 1.0.0 — Diseño inicial

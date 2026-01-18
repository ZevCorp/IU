# IU - Arquitectura del Sistema de Navegación AI

## 🏗️ Visión General

El sistema IU está diseñado para permitir **navegación AI-powered** a través de interfaces de usuario en **múltiples plataformas** (Web, Windows, Android) utilizando un modelo HRM (Hierarchical Reasoning Model) que se ejecuta en una Jetson Orin Nano.

## 📐 Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACES                       │
│  (Web DOM, Windows UI Tree, Android View Hierarchy)     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              PLATFORM-SPECIFIC FORMALIZERS               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Web (DOM)   │  │ Windows (UI  │  │ Android (View) │  │
│  │ Formalizer  │  │ Automation)  │  │ Hierarchy)     │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│       ↓                  ↓                   ↓           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                  UNIVERSAL MAZE FORMAT                   │
│                  (Grid Representation)                   │
│                                                          │
│  Grid: number[][]                                        │
│  Tokens: 0=WALL, 1=WALKABLE, 2=CURRENT, 3=TARGET       │
│  Metadata: { width, height, stateMap }                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    HRM SOLVER (Jetson)                   │
│                    + BFS Fallback                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    ACTION SEQUENCE                       │
│              (Platform-agnostic path)                    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              PLATFORM-SPECIFIC EXECUTORS                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Playwright  │  │ Windows      │  │ Android        │  │
│  │ (Web)       │  │ Automation   │  │ UIAutomator    │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 🔧 Módulos del Sistema

### 1. Formalizers (Plataforma-específica)

**Responsabilidad:** Convertir el árbol de UI de cada plataforma al formato de Maze universal.

#### Web (DOM) - `src/medical-demo/formalizer.ts`
```typescript
// Entrada: Playwright Page
// Salida: UIGrid (formato estándar)

export async function buildNode(page: Page): Promise<UINode>
export function graphToGrid(graph: UIGraph, current: string, target: string): UIGrid
```

**Proceso:**
1. Extrae elementos interactivos del DOM
2. Normaliza el estado (elimina timestamps, sesiones dinámicas)
3. Genera hash único del estado
4. Construye grafo de estados y transiciones
5. Convierte grafo a grid 2D

#### Windows (futuro)
```typescript
// Entrada: Windows UI Automation Tree
// Salida: UIGrid (mismo formato)
```

#### Android (futuro)
```typescript
// Entrada: Android View Hierarchy
// Salida: UIGrid (mismo formato)
```

### 2. Formato Universal de Maze - `src/medical-demo/types.ts`

**Este formato NO DEBE cambiar entre plataformas.**

```typescript
export interface UIGrid {
    grid: number[][];              // Matriz 2D del maze
    sequence: number[];            // Versión aplanada para HRM
    width: number;                 // Ancho del grid
    height: number;                // Alto del grid
    currentPos: [number, number];  // Posición actual
    targetPos: [number, number];   // Posición objetivo
    positionToState: Map<string, string>;  // "row,col" → stateId
    stateToPosition: Map<string, [number, number]>;  // stateId → [row,col]
}

export enum GridToken {
    WALL = 0,        // Sin transición válida
    WALKABLE = 1,    // Estado UI válido
    CURRENT = 2,     // Posición inicial
    TARGET = 3       // Estado objetivo
}
```

### 3. Solver - `src/medical-demo/solver.ts` + Jetson

**Responsabilidad:** Encontrar el camino óptimo en el maze.

#### Modo Local (BFS)
```typescript
export function solveBFS(
    grid: number[][],
    start: [number, number],
    target: [number, number]
): [number, number][] | null
```

#### Modo Jetson (HRM)
```python
# jetson/hrm_service.py
def infer(grid: List[int], width: int, height: int) -> Tuple[List[Tuple[int, int]], bool]
```

**El solver recibe SIEMPRE el mismo formato UIGrid, independiente de la plataforma.**

### 4. Executors (Plataforma-específica)

**Responsabilidad:** Ejecutar la secuencia de acciones en la plataforma real.

#### Web - `src/medical-demo/executor.ts`
```typescript
export async function executeAction(page: Page, action: UIAction): Promise<boolean>
```

## 🔄 Flujo de Datos Completo

```
1. Usuario en Dashboard (Web)
   ↓
2. Formalizer extrae DOM → UIGraph
   ↓
3. UIGraph → UIGrid (maze estándar)
   ↓
4. UIGrid enviado a Jetson HRM
   ↓
5. HRM calcula path: [[1,3], [1,4], [1,5], [2,5], [3,5]]
   ↓
6. Path → UIActions (usando graph)
   ↓
7. Executor ejecuta acciones en Playwright
   ↓
8. Usuario ahora en Patient Detail
```

## 📁 Estructura de Directorios

```
IU/
├── src/
│   └── medical-demo/           # Demo de navegación médica (Web)
│       ├── types.ts            # ✅ UNIVERSAL - Tipos compartidos
│       ├── formalizer.ts       # 🌐 PLATAFORMA - DOM → Maze
│       ├── solver.ts           # ✅ UNIVERSAL - Maze → Path
│       ├── executor.ts         # 🌐 PLATAFORMA - Path → Actions (Playwright)
│       ├── graph-builder.ts    # 🌐 PLATAFORMA - Exploración DOM
│       └── emr-app/            # App de ejemplo
│
├── jetson/
│   ├── hrm_service.py          # ✅ UNIVERSAL - HRM Solver
│   └── requirements.txt
│
├── server/
│   ├── server.js               # Backend WebSocket
│   └── jetson-bridge.js        # Puente Render ↔ Jetson
│
└── dist/
    └── medical/                # Deploy Web
        ├── hrm-client.js       # Cliente WS
        └── hrm-debug.js        # ⚠️ TEMPORAL - Debe usar formalizer

└── docs/
    └── ARCHITECTURE.md         # 📄 Este documento
```

## 🎯 Principios de Diseño

### 1. **Separación de Responsabilidades**

- ✅ **Formalizers**: Específicos de plataforma
- ✅ **Maze Format**: Universal (nunca cambia)
- ✅ **Solver**: Universal (recibe maze estándar)
- ✅ **Executors**: Específicos de plataforma

### 2. **Reusabilidad**

El mismo HRM en Jetson puede:
- Navegar apps web (usando formalizer DOM)
- Navegar apps Windows (usando formalizer UI Automation)
- Navegar apps Android (usando formalizer View Hierarchy)

### 3. **Mantenibilidad**

Cambios en una plataforma NO afectan:
- El formato del maze
- El solver HRM
- Otras plataformas

### 4. **Testabilidad**

Cada capa se puede testear independientemente:
```typescript
// Test: Formalizer
const grid = await domToGrid(mockPage);
expect(grid.width).toBe(7);

// Test: Solver
const path = solveBFS(mockGrid, [1,1], [3,5]);
expect(path).toHaveLength(5);

// Test: Executor
await executeAction(mockPage, mockAction);
verify(mockPage.click).wasCalledWith('#btn');
```

## 🚨 Problemas Actuales y Soluciones

### Problema: `hrm-debug.js` duplica lógica

**Estado Actual:**
```javascript
// ❌ INCORRECTO: Lógica hardcoded
const states = [
    { name: 'Login', page: 'index', row: 1, col: 1 },
    // ...
];
```

**Solución:**
```javascript
// ✅ CORRECTO: Usar formalizer compilado
import { buildMazeFromDOM } from './formalizer.bundle.js';
const grid = await buildMazeFromDOM();
```

### Problema: Formalizer está en TypeScript

**Solución a corto plazo:**
1. Compilar `formalizer.ts` → `formalizer.bundle.js` con esbuild/webpack
2. Incluir en `dist/medical/`

**Solución a largo plazo:**
1. Publicar `@iu/maze-core` como npm package
2. Usar en todos los proyectos

## 📝 Próximos Pasos

1. **Corto plazo:**
   - [ ] Compilar formalizer.ts para uso en browser
   - [ ] Actualizar hrm-debug.js para usar formalizer real
   - [ ] Agregar tests unitarios a cada capa

2. **Mediano plazo:**
   - [ ] Crear formalizer para Windows UI Automation
   - [ ] Crear formalizer para Android View Hierarchy
   - [ ] Unificar en package `@iu/maze-core`

3. **Largo plazo:**
   - [ ] Reemplazar BFS con HRM real (modelo 27M params)
   - [ ] Optimizar serialización del maze
   - [ ] Cache de grafos explorados

## 🔗 Referencias

- **HRM Paper**: Hierarchical Reasoning Models (DeepMind)
- **Grid Format**: Basado en maze-hard benchmark
- **WebSocket Protocol**: Ver `server/jetson-bridge.ts`
- **Type Definitions**: Ver `src/medical-demo/types.ts`

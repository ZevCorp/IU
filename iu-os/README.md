# IÜ OS

**"Simple. Minuciosamente concebido."** — Inspirado en Steve Jobs

Una aplicación overlay para macOS que presenta el rostro vectorial de Ü, activación por eye-tracking, y visualización neural de navegación HRM en tiempo real.

---

## 🚀 Quick Start

```bash
# Navegar al directorio
cd /Users/felipemaldonado/Documents/U/iu-os

# Instalar dependencias (si no lo has hecho)
npm install

# Ejecutar la aplicación
npm run dev
```

---

## 🎯 Funcionalidades

### 1. Overlay Always-on-Top
- Barra lateral derecha de 300px
- Siempre visible sobre todas las apps
- Click-through cuando está en modo idle
- Persiste entre cambios de ventana y Mission Control

### 2. Activación por Eye Tracking
- Usa MediaPipe Face Mesh (468 landmarks faciales)
- 3 zonas de activación en la esquina superior derecha
- Tiempo de activación: 500ms mirando a una zona
- Métricas de precisión y eficiencia

### 3. Rostro de Ü
- SVG vectorial minimalista
- Expresiones: idle, happy, thinking, attention
- Parpadeo aleatorio
- Sigue la mirada del usuario

### 4. Visualización Neural
- Grafo de nodos como red neuronal
- Animación de "disparos" sinápticos
- Partículas viajando entre nodos
- Refleja navegación HRM en tiempo real

### 5. Sistema de Recordatorios
- Prioridades 0-100
- Ajuste automático por menciones en conversación
- Decay temporal de prioridades
- Top 3-5 visibles en interfaz

---

## 🎹 Controles

| Tecla | Acción |
|-------|--------|
| `Espacio` | Toggle modo activo/idle |
| `Escape` | Volver a modo idle |
| `1`, `2`, `3` | Disparar neuronas manualmente |
| `Click` en punto de activación | Activar interfaz |

---

## 📁 Estructura del Proyecto

```
iu-os/
├── package.json          # Dependencias y scripts
├── main.js               # Proceso principal Electron
├── preload.js            # Bridge seguro main↔renderer
└── renderer/
    ├── index.html        # Estructura HTML
    ├── styles.css        # Estilos (glassmorphism, neon)
    ├── main.js           # Orquestador de subsistemas
    ├── eye-tracker.js    # Eye tracking con MediaPipe
    ├── neural-graph.js   # Visualización canvas
    ├── face/
    │   └── index.js      # Rostro SVG de Ü
    └── reminders/
        └── manager.js    # Sistema de recordatorios
```

---

## 🔧 Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN                        │
│  • Ventana frameless, transparent, always-on-top       │
│  • Posicionamiento automático borde derecho            │
│  • IPC para control de click-through                   │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC
┌─────────────────────▼───────────────────────────────────┐
│                  RENDERER PROCESS                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ EyeTracker  │  │ NeuralGraph │  │   UFace     │    │
│  │             │  │             │  │             │    │
│  │ • MediaPipe │  │ • Canvas 2D │  │ • SVG       │    │
│  │ • Gaze      │  │ • Particles │  │ • GSAP      │    │
│  │ • Zones     │  │ • Animation │  │ • Express.  │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                 │            │
│         └────────────────┼─────────────────┘            │
│                          │                              │
│                  ┌───────▼───────┐                      │
│                  │   main.js     │                      │
│                  │ (Orchestrator)│                      │
│                  └───────┬───────┘                      │
│                          │                              │
│                  ┌───────▼───────┐                      │
│                  │   Reminders   │                      │
│                  │   Manager     │                      │
│                  └───────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Métricas Medidas

| Métrica | Descripción |
|---------|-------------|
| **Activation** | Tiempo desde mirar zona hasta activación |
| **Accuracy** | % de activaciones intencionales vs falsas |
| **HRM** | Latencia de inferencia del grafo neural |

---

## 🔮 Integración con HRM

El grafo neural puede cargarse desde el sistema HRM existente:

```javascript
import { graphToGrid } from '../src/core/hrm/index.js';

// Cargar grafo desde HRM
neuralGraph.loadFromUIGraph(uiGraph);

// Animar resultado de navegación
neuralGraph.animatePath(['state-a', 'state-b', 'state-c'], 300);
```

---

## 🎨 Diseño Visual

- **Colores**: Negro profundo, cyan neón (#00d4ff), púrpura (#b042ff), rosa (#ff006e)
- **Tipografía**: Inter (Google Fonts)
- **Efectos**: Glassmorphism, blur, gradientes radiales
- **Animaciones**: 60fps, cubic-bezier transitions

---

## 📝 Licencia

MIT © Felipe Maldonado

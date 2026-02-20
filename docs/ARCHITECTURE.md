# IU - Arquitectura del Sistema de Navegación AI

## 🎯 Visión

Aplicación Windows de escritorio que controla el PC completo, navegando automáticamente cualquier interfaz (Web, Windows, Android) usando un modelo HRM en Jetson Orin Nano.

## 🏗️ Arquitectura Final (Validada)

```
┌─────────────────────────────────────────────────────────────┐
│          CONTROLADOR (Tu PC / App Windows)                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  PLAYWRIGHT CONTROLLER (hrm-controller.ts)            │   │
│  │  - Abre browser                                       │   │
│  │  - Lee DOM con page.evaluate()                        │   │
│  │  - Genera maze                                        │   │
│  │  - Conecta a Render/Jetson                            │   │
│  │  - Ejecuta clicks con page.click()                    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket
                               ↓
┌─────────────────────────────────────────────────────────────┐
│          RENDER BACKEND (iu-rw9m.onrender.com)               │
│          WebSocket Relay                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket
                               ↓
┌─────────────────────────────────────────────────────────────┐
│          JETSON ORIN NANO                                    │
│          HRM Service (hrm_service.py)                        │
│          - Recibe maze (grid 7x7 = 49 tokens)               │
│          - Calcula path óptimo (BFS placeholder → HRM)       │
│          - Retorna secuencia de posiciones                  │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Estructura de Archivos

```
IU/
├── src/
│   └── medical-demo/
│       ├── hrm-controller.ts    ✅ PRINCIPAL - Controlador Playwright
│       ├── formalizer.ts        📖 Referencia - DOM → Maze
│       ├── executor.ts          📖 Referencia - Path → Actions
│       ├── solver.ts            📖 Referencia - BFS solver
│       ├── types.ts             📖 TypeScript types
│       └── emr-app/             📖 Fuente del EMR demo
│
├── dist/medical/                🌐 EMR DESPLEGADO EN HOSTINGER
│   ├── index.html               ← Sin scripts HRM (limpio)
│   ├── dashboard.html           ← Sin scripts HRM
│   ├── patients.html            ← Sin scripts HRM
│   ├── orders.html              ← Sin scripts HRM
│   ├── patient-detail.html      ← Sin scripts HRM
│   ├── styles.css
│   └── app.js
│
├── server/                      🔧 BACKEND EN RENDER
│   ├── server.js                ← WebSocket server
│   └── jetson-bridge.js         ← Relay a Jetson
│
├── jetson/                      🤖 EN JETSON ORIN NANO
│   └── hrm_service.py           ← HRM solver + WebSocket client
│
└── docs/
    └── ARCHITECTURE.md          📚 Este documento
```

## 🚀 Uso

### Ejecutar navegación HRM:

```bash
cd c:\Users\Chriz\Desktop\IU
npx tsx src/medical-demo/hrm-controller.ts
```

### Resultado:
1. Playwright abre browser
2. Navega a `https://iü.space/medical/`
3. Login automático
4. Genera maze del estado actual
5. Envía a Jetson vía Render
6. Recibe path
7. Ejecuta clicks automáticamente
8. Navegación completada

## 📊 Logs Esperados

```
╔═══════════════════════════════════════════════════════════╗
║     HRM Navigation Controller (Playwright)                ║
╚═══════════════════════════════════════════════════════════╝

[HRM] ✅ Connected to Render
[Controller] Navigating to https://iü.space/medical/...
[Main] ✅ Logged in

[Controller] === HRM Navigation ===
[Controller] Current: dashboard
[Controller] Target: orders
[Controller] Maze:
   ███████
   █··S··█
   █·█·█·█
   █T··█·█
   ███████

[HRM] 🧭 Sending navigation request: dashboard → orders
[Controller] ✅ Path received: 5 positions
[Controller] 🖱️ Clicking: #nav-orders
[Controller] ✅ Navigated to: state-orders

✅ Navigation completed successfully!
```

## 🎯 Principios de Diseño

### 1. **Playwright como usuario externo**
- NO inyectamos scripts en las páginas
- Solo usamos APIs públicas: `page.click()`, `page.fill()`, `page.evaluate()`
- Funciona con CUALQUIER sitio web

### 2. **Separación de responsabilidades**
- **Controlador (PC)**: Lee UI, genera maze, ejecuta acciones
- **Render**: Relay WebSocket
- **Jetson**: Procesa maze, calcula path óptimo

### 3. **Formato universal de maze**
```typescript
interface UIGrid {
    grid: number[][];  // 0=WALL, 1=WALKABLE, 2=CURRENT, 3=TARGET
    width: number;
    height: number;
    currentPos: [number, number];
    targetPos: [number, number];
}
```

## 🔄 Próximos Pasos

1. **App Windows**: Crear UI con Electron/Tauri
2. **Windows UI Automation**: Agregar formalizer para apps nativas
3. **HRM Real**: Reemplazar BFS con modelo 27M params
4. **Más sitios**: Probar con Wikipedia, Amazon, etc.

---

**Fecha**: 2026-01-18
**Versión**: 2.0.0 - Arquitectura Playwright funcionando

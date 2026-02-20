# Architecture Map 🗺️

Herramienta interactiva para visualizar y planificar la arquitectura de código usando Cytoscape.js

## 🚀 Características

- **Visualización de Grafos**: Múltiples layouts automáticos (Dagre, CoSE, Breadthfirst, etc.)
- **Análisis Inteligente**: Detecta ciclos circulares, god objects, y nodos aislados
- **Zoom Multinivel**: 3 niveles de detalle (general → archivos → funciones)
- **Planificación**: Agrega notas adhesivas y TODOs sobre el grafo
- **Persistencia Local**: Guarda y carga mapas en JSON
- **Export**: Exporta visualizaciones como PNG

## 📁 Estructura del Proyecto

```
architecture-map/
├── src/
│   ├── components/
│   │   └── ArchitectureMap.js    # Componente principal Cytoscape
│   ├── utils/
│   │   ├── parser.js              # Parser genérico de código
│   │   └── graphAnalyzer.js       # Análisis de grafos
│   ├── styles/
│   │   └── main.css               # Estilos globales
│   └── main.js                    # Punto de entrada
├── index.html
├── package.json
└── vite.config.js
```

## 🛠️ Instalación

```bash
npm install
```

## 🏃 Ejecutar

```bash
npm run dev
```

## 📖 Uso

1. **Cargar Proyecto**: Click en "📁 Cargar Proyecto" y selecciona una carpeta
2. **Cambiar Layout**: Usa el selector para cambiar entre diferentes layouts
3. **Agregar Notas**: Click derecho en un nodo → "📝 Agregar Nota"
4. **Zoom**: Usa la rueda del mouse para hacer zoom
5. **Guardar**: Ctrl+S o click en "💾 Guardar"

## ⌨️ Atajos de Teclado

- `N` - Nueva nota adhesiva
- `T` - Nuevo TODO
- `F` - Fit al contenido
- `Ctrl+S` - Guardar mapa
- `Ctrl+E` - Exportar PNG

## 🎨 Arquitectura del Código

### Separación de Responsabilidades

- **`CodeParser`**: Análisis de estructura de archivos y dependencias
- **`GraphAnalyzer`**: Algoritmos de análisis de grafos
- **`ArchitectureMap`**: Gestión de Cytoscape y visualización
- **`main.js`**: Controlador de eventos UI

### Flujo de Datos

```
User Input → main.js → ArchitectureMap → CodeParser/GraphAnalyzer → Cytoscape
```

## 📊 Análisis Soportado

- ✅ Dependencias circulares
- ✅ Nodos aislados
- ✅ God objects (nodos sobrecargados)
- ✅ Centralidad de nodos
- ✅ Profundidad del grafo
- ✅ Métricas generales

## 🔧 Tecnologías

- **Cytoscape.js** - Motor de grafos
- **Vite** - Build tool y dev server
- **Vanilla JS** - Sin frameworks, máxima simplicidad

## 📝 Licencia

ISC

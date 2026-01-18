# HRM Service for Jetson Orin Nano

Este servicio ejecuta el modelo **HRM (Hierarchical Reasoning Model)** en un Jetson Orin Nano Super Dev Kit, conectándose a un backend en Render para resolver laberintos en tiempo real.

## 🔑 Punto Clave: HRM NO es un paquete pip

**HRM no se puede instalar con `pip install`**. El repositorio no tiene `setup.py` ni `pyproject.toml`. 

La forma correcta de usarlo es:
1. **Clonar el repositorio**: `git clone https://github.com/sapientinc/HRM.git`
2. **Añadir al PYTHONPATH**: `export PYTHONPATH="${PYTHONPATH}:$(pwd)/HRM"`
3. **Ejecutar el script** con el PYTHONPATH modificado

## 📦 Estructura del Proyecto

```
jetson/
├── HRM/                    # ← Repositorio HRM clonado (NO pip-instalado)
│   ├── models/
│   │   └── hrm/
│   │       └── hrm_act_v1.py
│   ├── pretrain.py
│   ├── evaluate.py
│   ├── utils/
│   └── requirements.txt
├── hrm_service.py          # ← Nuestro servicio WebSocket
├── run_hrm_service.sh      # ← Script que configura PYTHONPATH
├── setup.sh                # ← Setup completo
├── requirements.txt        # ← Dependencias adicionales
└── README.md               # ← Este archivo
```

## 🚀 Instalación Rápida

```bash
# En la Jetson:
cd ~/IU/jetson

# Ejecutar setup (hace todo automáticamente)
chmod +x setup.sh
./setup.sh
```

## 📋 Instalación Manual

Si prefieres hacer todo manualmente:

```bash
# 1. Instalar PyTorch para Jetson (con CUDA)
pip3 install torch torchvision --extra-index-url https://developer.download.nvidia.com/compute/pytorch/whl/cu118

# 2. Clonar HRM (NO pip install)
git clone --recursive https://github.com/sapientinc/HRM.git

# 3. Instalar dependencias de HRM
pip3 install -r HRM/requirements.txt

# 4. Instalar dependencias del servicio
pip3 install -r requirements.txt

# 5. Configurar PYTHONPATH y ejecutar
export PYTHONPATH="${PYTHONPATH}:$(pwd)/HRM"
python3 hrm_service.py --server wss://iu-rw9m.onrender.com
```

## ▶️ Ejecución

### Opción 1: Usando el script (Recomendado)

```bash
./run_hrm_service.sh --server wss://iu-rw9m.onrender.com
```

### Opción 2: Manual con PYTHONPATH

```bash
export PYTHONPATH="${PYTHONPATH}:$(pwd)/HRM"
python3 hrm_service.py --server wss://iu-rw9m.onrender.com
```

### Opciones disponibles

| Opción | Descripción |
|--------|-------------|
| `--server URL` | URL del servidor WebSocket |
| `--model ID` | ID del modelo en HuggingFace (default: `sapientinc/HRM-checkpoint-maze-30x30-hard`) |
| `--hrm-path PATH` | Ruta al repositorio HRM |
| `--bfs-only` | Usar solo BFS (sin cargar HRM) |
| `--test` | Solo probar conexión |

## 🧠 Cómo Funciona HRM

1. **Descarga de Checkpoint**: El modelo se descarga automáticamente de HuggingFace:
   - `sapientinc/HRM-checkpoint-maze-30x30-hard` (~109MB)
   - Se guarda en `~/.cache/hrm/`

2. **Arquitectura**: HRM usa una arquitectura de razonamiento jerárquico con:
   - Dos niveles de razonamiento (H-level y L-level)
   - Adaptive Computation Time (ACT) para decidir cuándo parar
   - ~27M parámetros

3. **Inferencia**: Para cada laberinto:
   - Recibe grid como tokens (0=wall, 1=path, 2=start, 3=target)
   - Ejecuta ciclos de razonamiento hasta convergencia
   - Retorna el camino óptimo

4. **Fallback**: Si HRM falla, usa BFS (Breadth-First Search) como respaldo.

## 📊 Checkpoints Disponibles

| Modelo | Descripción | HuggingFace ID |
|--------|-------------|----------------|
| Maze 30x30 Hard | Laberintos 30x30 difíciles | `sapientinc/HRM-checkpoint-maze-30x30-hard` |
| Sudoku Extreme | Sudoku nivel extremo | `sapientinc/HRM-checkpoint-sudoku-extreme` |
| ARC-AGI-2 | Razonamiento abstracto | `sapientinc/HRM-checkpoint-ARC-2` |

## 🔧 Troubleshooting

### Error: "No module named 'pretrain'"
```bash
# HRM no está en PYTHONPATH
export PYTHONPATH="${PYTHONPATH}:$(pwd)/HRM"
```

### Error: "CUDA not available"
```bash
# Verificar instalación de PyTorch para Jetson
python3 -c "import torch; print(torch.cuda.is_available())"
```

### Error: "neither 'setup.py' nor 'pyproject.toml' found"
Este error aparece si intentas `pip install -e ./HRM`. **NO hagas esto**. HRM no es un paquete pip. Solo clónalo y usa PYTHONPATH.

### Error: "Failed to load model: ..."
El servicio caerá automáticamente a BFS. Los logs mostrarán `[BFS]` en vez de `[HRM]` para cada solicitud.

## 📝 Logs

```
2026-01-18 11:20:40 [INFO] Server: wss://iu-rw9m.onrender.com
2026-01-18 11:20:40 [INFO] Model: sapientinc/HRM-checkpoint-maze-30x30-hard
2026-01-18 11:20:43 [INFO] Using CUDA: Orin Nano (8.0 GB)
2026-01-18 11:21:15 [INFO] ✅ HRM Model loaded! Parameters: 27,345,678 (~27.3M)
2026-01-18 11:21:36 [INFO] Connected to wss://iu-rw9m.onrender.com
2026-01-18 11:21:40 [INFO] Inference (HRM) completed in 42.15ms, path length: 89
```

## 🔗 Referencias

- [HRM GitHub Repository](https://github.com/sapientinc/HRM)
- [HRM Paper (arXiv)](https://arxiv.org/abs/2506.21734)
- [Checkpoints on HuggingFace](https://huggingface.co/sapientinc)

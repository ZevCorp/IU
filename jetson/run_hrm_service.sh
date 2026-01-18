#!/bin/bash
# ==============================================================================
# Run HRM Service with proper PYTHONPATH
# ==============================================================================
#
# This script ensures HRM repository is in PYTHONPATH before running the service.
# HRM is NOT a pip-installable package - it must be available as a module path.
#
# Usage:
#   ./run_hrm_service.sh [options]
#
# Options:
#   --server URL     WebSocket server URL (default: wss://iu-rw9m.onrender.com)
#   --bfs-only       Use BFS fallback (skip HRM model loading)
#   --test           Test connection only
#   --help           Show help
#
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Add HRM to PYTHONPATH
if [ -d "${SCRIPT_DIR}/HRM" ]; then
    export PYTHONPATH="${SCRIPT_DIR}/HRM:${PYTHONPATH}"
    echo "[INFO] Added HRM to PYTHONPATH: ${SCRIPT_DIR}/HRM"
else
    echo "[WARNING] HRM directory not found at ${SCRIPT_DIR}/HRM"
    echo "[WARNING] Run setup.sh first or clone HRM manually:"
    echo "  git clone https://github.com/sapientinc/HRM.git ${SCRIPT_DIR}/HRM"
fi

# Activate virtual environment if it exists
if [ -f "${SCRIPT_DIR}/.venv/bin/activate" ]; then
    source "${SCRIPT_DIR}/.venv/bin/activate"
    echo "[INFO] Activated virtual environment"
fi

# Set CUDA paths if not already set
if [ -d "/usr/local/cuda" ]; then
    export PATH="/usr/local/cuda/bin:${PATH}"
    export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"
fi

# Run the HRM service
echo "[INFO] Starting HRM Service..."
echo "=============================================="
python3 "${SCRIPT_DIR}/hrm_service.py" "$@"

#!/bin/bash
# ==============================================================================
# Run HRM Service
# ==============================================================================
#
# Uses the parent directory's venv (~/IU/.venv) which should have:
# - PyTorch with CUDA (inherited from system via --system-site-packages)
# - websockets, huggingface_hub, etc.
#
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# Add CUDA to path
export PATH="/usr/local/cuda/bin:${PATH}"
export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

# Add HRM to PYTHONPATH
export PYTHONPATH="${SCRIPT_DIR}/HRM:${PYTHONPATH}"

# Activate parent venv (~/IU/.venv) if exists, otherwise try local
if [ -f "${PARENT_DIR}/.venv/bin/activate" ]; then
    echo "[INFO] Using parent venv: ${PARENT_DIR}/.venv"
    source "${PARENT_DIR}/.venv/bin/activate"
elif [ -f "${SCRIPT_DIR}/.venv/bin/activate" ]; then
    echo "[INFO] Using local venv: ${SCRIPT_DIR}/.venv"
    source "${SCRIPT_DIR}/.venv/bin/activate"
else
    echo "[WARNING] No venv found, using system Python"
fi

# Quick verification
echo "[INFO] Python: $(which python3)"
python3 -c "import torch; print(f'[INFO] PyTorch {torch.__version__}, CUDA: {torch.cuda.is_available()}')" 2>/dev/null || echo "[WARNING] PyTorch not available"

echo ""
echo "[INFO] Starting HRM Service..."
echo "=============================================="

# Run service
python3 "${SCRIPT_DIR}/hrm_service.py" "$@"

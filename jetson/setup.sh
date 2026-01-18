#!/bin/bash
# ==============================================================================
# HRM Service Setup Script - Jetson Orin Nano Super Dev Kit
# ==============================================================================
#
# Prerequisites:
#   - PyTorch with CUDA installed at system level
#   - venv created with: python3 -m venv --system-site-packages .venv
#
# Usage:
#   source .venv/bin/activate
#   ./setup.sh
#
# ==============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "=========================================="
echo "  HRM Service Setup - Jetson Orin Nano"
echo "=========================================="
echo ""

# ==============================================================================
# Step 1: Verify Environment
# ==============================================================================
echo -e "${BLUE}Step 1: Verifying environment...${NC}"

# Check if we're in a venv
if [ -z "$VIRTUAL_ENV" ]; then
    echo -e "${YELLOW}⚠ Virtual environment not activated${NC}"
    if [ -f ".venv/bin/activate" ]; then
        echo "Activating .venv..."
        source .venv/bin/activate
    else
        echo -e "${RED}✗ No .venv found. Create one first:${NC}"
        echo "  python3 -m venv --system-site-packages .venv"
        echo "  source .venv/bin/activate"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Virtual environment: $VIRTUAL_ENV${NC}"

# Check PyTorch with CUDA
if python3 -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
    TORCH_VERSION=$(python3 -c "import torch; print(torch.__version__)")
    GPU_NAME=$(python3 -c "import torch; print(torch.cuda.get_device_name(0))")
    echo -e "${GREEN}✓ PyTorch ${TORCH_VERSION} with CUDA${NC}"
    echo -e "${GREEN}✓ GPU: ${GPU_NAME}${NC}"
else
    echo -e "${RED}✗ PyTorch with CUDA not available${NC}"
    echo "Install PyTorch at system level first:"
    echo "  pip3 install torch torchvision --index-url https://pypi.jetson-ai-lab.dev/jp6/cu126"
    exit 1
fi

echo ""

# ==============================================================================
# Step 2: Install Dependencies
# ==============================================================================
echo -e "${BLUE}Step 2: Installing dependencies...${NC}"

pip install --quiet --upgrade pip

# Core service dependencies
echo "Installing core dependencies..."
pip install --quiet \
    websockets>=12.0 \
    huggingface_hub>=0.20.0 \
    PyYAML>=6.0

# HRM dependencies (for model loading)
echo "Installing HRM dependencies..."
pip install --quiet \
    einops>=0.7.0 \
    tqdm>=4.66.0 \
    coolname>=2.2.0 \
    pydantic>=2.0.0 \
    omegaconf>=2.3.0 \
    hydra-core>=1.3.0

echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""

# ==============================================================================
# Step 3: Clone HRM Repository
# ==============================================================================
echo -e "${BLUE}Step 3: Setting up HRM repository...${NC}"

if [ -d "HRM" ]; then
    echo -e "${GREEN}✓ HRM repository exists${NC}"
    # Try to update
    cd HRM && git pull --quiet 2>/dev/null || true && cd ..
else
    echo "Cloning HRM from GitHub..."
    git clone --recursive https://github.com/sapientinc/HRM.git
    echo -e "${GREEN}✓ HRM cloned${NC}"
fi

# Verify structure
if [ -f "HRM/pretrain.py" ] && [ -d "HRM/models" ]; then
    echo -e "${GREEN}✓ HRM structure verified${NC}"
else
    echo -e "${RED}✗ HRM structure incomplete${NC}"
    exit 1
fi

echo ""

# ==============================================================================
# Step 4: Create Run Script
# ==============================================================================
echo -e "${BLUE}Step 4: Creating run script...${NC}"

cat > run_hrm_service.sh << 'RUNSCRIPT'
#!/bin/bash
# Run HRM Service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# CUDA paths
export PATH="/usr/local/cuda/bin:${PATH}"
export LD_LIBRARY_PATH="/usr/local/cuda/lib64:${LD_LIBRARY_PATH}"

# HRM in PYTHONPATH
export PYTHONPATH="${SCRIPT_DIR}/HRM:${PYTHONPATH}"

# Activate venv
source "${SCRIPT_DIR}/.venv/bin/activate"

# Run
python3 "${SCRIPT_DIR}/hrm_service.py" "$@"
RUNSCRIPT

chmod +x run_hrm_service.sh
echo -e "${GREEN}✓ Created run_hrm_service.sh${NC}"

echo ""

# ==============================================================================
# Step 5: Verify Everything
# ==============================================================================
echo -e "${BLUE}Step 5: Final verification...${NC}"

export PYTHONPATH="$(pwd)/HRM:${PYTHONPATH}"

python3 << 'VERIFY'
import sys
print(f"Python: {sys.version.split()[0]}")

# PyTorch
import torch
print(f"PyTorch: {torch.__version__}")
print(f"  CUDA: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"  GPU: {torch.cuda.get_device_name(0)}")

# HRM imports
try:
    from pretrain import PretrainConfig
    print("HRM pretrain: ✓")
except ImportError as e:
    print(f"HRM pretrain: ✗ ({e})")

try:
    from utils.functions import load_model_class
    print("HRM utils: ✓")
except ImportError as e:
    print(f"HRM utils: ✗ ({e})")

# Service deps
for pkg in ['websockets', 'huggingface_hub', 'yaml', 'einops', 'pydantic']:
    try:
        __import__(pkg)
        print(f"{pkg}: ✓")
    except ImportError:
        print(f"{pkg}: ✗")
VERIFY

echo ""

# ==============================================================================
# Step 6: Test Connection (optional)
# ==============================================================================
echo -e "${BLUE}Step 6: Testing connection...${NC}"

python3 hrm_service.py --test --bfs-only 2>&1 | head -20 || echo -e "${YELLOW}⚠ Connection test failed (server may be offline)${NC}"

echo ""

# ==============================================================================
# Done!
# ==============================================================================
echo "=========================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "To run the HRM service:"
echo ""
echo "  ./run_hrm_service.sh --server wss://iu-rw9m.onrender.com"
echo ""
echo "Options:"
echo "  --bfs-only    Use BFS only (skip HRM model loading)"
echo "  --test        Test connection only"
echo ""
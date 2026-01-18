#!/bin/bash
# ==============================================================================
# HRM Service Setup Script - Jetson Orin Nano Super Dev Kit
# ==============================================================================
#
# IMPORTANT: HRM is NOT a pip-installable package!
# This script properly sets up HRM by:
# 1. Cloning the HRM repository 
# 2. Installing dependencies
# 3. Adding HRM to PYTHONPATH
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# ==============================================================================

set -e  # Exit on error

echo "=========================================="
echo "  HRM Service Setup - Jetson Orin Nano"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on Jetson
if [ -f /etc/nv_tegra_release ]; then
    echo -e "${GREEN}✓ Detected Jetson device${NC}"
    cat /etc/nv_tegra_release
else
    echo -e "${YELLOW}⚠ Warning: Not running on Jetson. Some optimizations may not work.${NC}"
fi

echo ""

# ==============================================================================
# Step 1: Check/Install CUDA
# ==============================================================================
echo "Step 1: Checking CUDA..."

if command -v nvcc &> /dev/null; then
    CUDA_VERSION=$(nvcc --version | grep release | awk '{print $6}' | cut -d',' -f1)
    echo -e "${GREEN}✓ CUDA detected: ${CUDA_VERSION}${NC}"
else
    echo -e "${YELLOW}⚠ CUDA nvcc not in PATH. Checking for installation...${NC}"
    
    if [ -d /usr/local/cuda ]; then
        export PATH="/usr/local/cuda/bin:$PATH"
        export LD_LIBRARY_PATH="/usr/local/cuda/lib64:$LD_LIBRARY_PATH"
        echo -e "${GREEN}✓ Found CUDA at /usr/local/cuda${NC}"
    else
        echo -e "${RED}✗ CUDA not found. Please install CUDA toolkit:${NC}"
        echo "  sudo apt-get update && sudo apt-get install nvidia-cuda-toolkit"
        # Continue anyway - some Jetsons have CUDA but not nvcc
    fi
fi

echo ""

# ==============================================================================
# Step 2: Create/Activate Virtual Environment (optional but recommended)
# ==============================================================================
echo "Step 2: Setting up Python environment..."

if [ -d ".venv" ]; then
    echo -e "${GREEN}✓ Virtual environment exists${NC}"
    source .venv/bin/activate 2>/dev/null || true
else
    echo "Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

echo ""

# ==============================================================================
# Step 3: Install PyTorch for Jetson
# ==============================================================================
echo "Step 3: Installing PyTorch for Jetson..."

# Check if PyTorch is already installed with CUDA
if python3 -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
    TORCH_VERSION=$(python3 -c "import torch; print(torch.__version__)")
    echo -e "${GREEN}✓ PyTorch ${TORCH_VERSION} with CUDA already installed${NC}"
else
    echo "Installing PyTorch for Jetson (CUDA enabled)..."
    
    # For Jetson Orin (JetPack 5.x / 6.x), use the NVIDIA wheel index
    pip3 install --upgrade pip
    pip3 install torch torchvision torchaudio --extra-index-url https://developer.download.nvidia.com/compute/pytorch/whl/cu118
    
    # Verify installation
    if python3 -c "import torch; print(f'PyTorch {torch.__version__}, CUDA: {torch.cuda.is_available()}')" 2>/dev/null; then
        echo -e "${GREEN}✓ PyTorch installed successfully${NC}"
    else
        echo -e "${YELLOW}⚠ PyTorch installed but CUDA may not be available${NC}"
    fi
fi

echo ""

# ==============================================================================
# Step 4: Clone HRM Repository (NOT pip install!)
# ==============================================================================
echo "Step 4: Setting up HRM repository..."

if [ -d "HRM" ]; then
    echo -e "${GREEN}✓ HRM repository already exists${NC}"
    cd HRM
    git pull origin main || echo -e "${YELLOW}⚠ Could not update HRM (might be offline)${NC}"
    cd ..
else
    echo "Cloning HRM from GitHub..."
    git clone --recursive https://github.com/sapientinc/HRM.git
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ HRM repository cloned${NC}"
    else
        echo -e "${RED}✗ Failed to clone HRM repository${NC}"
        exit 1
    fi
fi

# Verify HRM structure
if [ -f "HRM/pretrain.py" ] && [ -d "HRM/models" ]; then
    echo -e "${GREEN}✓ HRM repository structure verified${NC}"
else
    echo -e "${RED}✗ HRM repository appears incomplete. Try re-cloning:${NC}"
    echo "  rm -rf HRM && git clone --recursive https://github.com/sapientinc/HRM.git"
    exit 1
fi

echo ""

# ==============================================================================
# Step 5: Install HRM Dependencies
# ==============================================================================
echo "Step 5: Installing dependencies..."

# Install HRM's own requirements
if [ -f "HRM/requirements.txt" ]; then
    echo "Installing HRM requirements..."
    pip3 install -r HRM/requirements.txt
fi

# Install our service requirements
if [ -f "requirements.txt" ]; then
    echo "Installing service requirements..."
    pip3 install -r requirements.txt
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""

# ==============================================================================
# Step 6: Install FlashAttention (optional, improves performance)
# ==============================================================================
echo "Step 6: Checking FlashAttention..."

if python3 -c "import flash_attn" 2>/dev/null; then
    echo -e "${GREEN}✓ FlashAttention already installed${NC}"
else
    echo "Attempting to install FlashAttention..."
    pip3 install flash-attn 2>/dev/null || {
        echo -e "${YELLOW}⚠ FlashAttention installation failed (optional, HRM will work without it)${NC}"
        echo "  For best performance on supported GPUs, install manually:"
        echo "  pip3 install flash-attn"
    }
fi

echo ""

# ==============================================================================
# Step 7: Create run script with PYTHONPATH
# ==============================================================================
echo "Step 7: Creating run script..."

cat > run_hrm_service.sh << 'EOF'
#!/bin/bash
# Run HRM Service with proper PYTHONPATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Add HRM to PYTHONPATH
export PYTHONPATH="${SCRIPT_DIR}/HRM:${PYTHONPATH}"

# Activate venv if exists
if [ -f "${SCRIPT_DIR}/.venv/bin/activate" ]; then
    source "${SCRIPT_DIR}/.venv/bin/activate"
fi

# Run the service
python3 "${SCRIPT_DIR}/hrm_service.py" "$@"
EOF

chmod +x run_hrm_service.sh

echo -e "${GREEN}✓ Run script created: run_hrm_service.sh${NC}"

echo ""

# ==============================================================================
# Step 8: Test the setup
# ==============================================================================
echo "Step 8: Testing setup..."

# Set PYTHONPATH for testing
export PYTHONPATH="$(pwd)/HRM:${PYTHONPATH}"

# Test imports
echo "Testing Python imports..."
python3 -c "
import sys
print(f'Python: {sys.version}')

import torch
print(f'PyTorch: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'GPU: {torch.cuda.get_device_name(0)}')

# Test HRM imports
try:
    from pretrain import PretrainConfig
    from utils.functions import load_model_class
    print('HRM imports: ✓')
except ImportError as e:
    print(f'HRM imports: ✗ ({e})')

# Test huggingface_hub
try:
    from huggingface_hub import snapshot_download
    print('HuggingFace Hub: ✓')
except ImportError:
    print('HuggingFace Hub: ✗')

# Test websockets
try:
    import websockets
    print('WebSockets: ✓')
except ImportError:
    print('WebSockets: ✗')
"

echo ""

# ==============================================================================
# Step 9: Quick connectivity test
# ==============================================================================
echo "Step 9: Running connectivity test..."

python3 hrm_service.py --test --bfs-only || echo -e "${YELLOW}⚠ Connectivity test failed (server may be offline)${NC}"

echo ""

# ==============================================================================
# Complete!
# ==============================================================================
echo "=========================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "To run the HRM service:"
echo ""
echo "  Option 1 (Recommended):"
echo "    ./run_hrm_service.sh --server wss://iu-rw9m.onrender.com"
echo ""
echo "  Option 2 (Manual):"
echo "    export PYTHONPATH=\"\$(pwd)/HRM:\${PYTHONPATH}\""
echo "    python3 hrm_service.py --server wss://iu-rw9m.onrender.com"
echo ""
echo "Options:"
echo "  --bfs-only    Use BFS fallback instead of HRM (faster startup)"
echo "  --test        Test connection only"
echo "  --hrm-path    Path to HRM repository (default: ./HRM)"
echo ""
echo "Logs will show [HRM] or [BFS] for each solve request."
echo ""
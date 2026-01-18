#!/bin/bash
# Setup script for HRM Service on Jetson Orin Nano Super Dev Kit
# Run this script to install all dependencies

echo "=========================================="
echo "  HRM Service Setup - Jetson Orin Nano"
echo "=========================================="

# Check if running on Jetson
if [ -f /etc/nv_tegra_release ]; then
    echo "✓ Detected Jetson device"
else
    echo "⚠ Warning: Not running on Jetson. Some optimizations may not work."
fi

# Check CUDA
if command -v nvcc &> /dev/null; then
    echo "✓ CUDA detected: $(nvcc --version | grep release | awk '{print $6}')"
else
    echo "✗ CUDA not found. Please install CUDA toolkit."
    echo "  Run: sudo apt-get install nvidia-cuda-toolkit"
fi

# Install PyTorch for Jetson
echo ""
echo "Installing PyTorch for Jetson..."
pip3 install torch torchvision --extra-index-url https://developer.download.nvidia.com/compute/pytorch/whl/cu118

# Verify PyTorch installation
python3 -c "import torch; print(f'PyTorch {torch.__version__}, CUDA available: {torch.cuda.is_available()}')"

# Install other dependencies
echo ""
echo "Installing HRM dependencies..."
pip3 install -r requirements.txt

# Clone HRM repo (for model architecture)
echo ""
echo "Installing HRM package..."
if [ ! -d "HRM" ]; then
    git clone https://github.com/sapientinc/HRM.git
fi
cd HRM && pip3 install -e . && cd ..

# Test the service
echo ""
echo "Testing HRM service..."
python3 hrm_service.py --test --bfs-only

echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
echo "To run the service:"
echo "  python3 hrm_service.py --server wss://iu-rw9m.onrender.com"
echo ""
echo "Options:"
echo "  --bfs-only    Use BFS instead of HRM (faster startup)"
echo "  --test        Test connection only"
echo ""

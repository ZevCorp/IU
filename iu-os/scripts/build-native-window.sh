#!/bin/bash

# Ensure we are in the project root or adjust paths
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
SOURCE_DIR="$PROJECT_ROOT/native/GlassWindow"
DIST_DIR="$PROJECT_ROOT/dist"

echo "🔨 Building Native GlassWindow..."

# Check requirements
if ! command -v swiftc &> /dev/null; then
    echo "❌ Error: swiftc not found. Please install Xcode Command Line Tools."
    exit 1
fi

mkdir -p "$DIST_DIR"

# Compile
# -O: Optimization
# -target: macOS target
swiftc "$SOURCE_DIR/main.swift" "$SOURCE_DIR/GlassWindow.swift" "$SOURCE_DIR/FaceView.swift" \
    -o "$DIST_DIR/GlassWindowApp" \
    -framework Cocoa \
    -framework WebKit \
    -O

if [ $? -eq 0 ]; then
    echo "✅ Build successful: $DIST_DIR/GlassWindowApp"
else
    echo "❌ Build failed"
    exit 1
fi

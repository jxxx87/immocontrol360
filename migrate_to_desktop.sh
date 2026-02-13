#!/bin/bash
set -e
SOURCE_DIR=$(pwd)
TARGET_DIR="$HOME/Desktop/immo-web-local"

echo "Copying to $TARGET_DIR..."
# Ensure target exists
mkdir -p "$TARGET_DIR"

# Copy files using rsync for speed and exclusion
rsync -av --exclude 'node_modules' --exclude 'dist' --exclude '.git' . "$TARGET_DIR"

# Navigate to target
cd "$TARGET_DIR"

echo "Installing dependencies..."
npm install

echo "Preparing to open..."
# Try to open in VS Code if available, otherwise open folder
if command -v code &> /dev/null; then
    code .
else
    open .
fi

echo "Done! Project ready at $TARGET_DIR"

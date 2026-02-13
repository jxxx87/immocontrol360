#!/bin/bash
set -e
TARGET="/tmp/immo-web-temp"
echo "Cleaning up old temp..."
rm -rf "$TARGET"
mkdir -p "$TARGET"

echo "Copying files to $TARGET (excluding node_modules)..."
rsync -av --exclude 'node_modules' --exclude 'dist' --exclude '.git' . "$TARGET"

cd "$TARGET"
echo "Installing dependencies in $TARGET..."
npm install

echo "Starting server..."
npm run dev -- --host

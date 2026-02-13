#!/bin/bash
TARGET="$HOME/Desktop/immo-web-local"

if [ -d "$TARGET" ]; then
    echo "Starting server in $TARGET..."
    cd "$TARGET"
    # --open tries to open the browser automatically
    npm run dev -- --open
else
    echo "Error: Target directory $TARGET not found."
    exit 1
fi

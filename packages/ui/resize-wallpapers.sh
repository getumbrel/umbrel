#!/bin/bash

# Directory containing original wallpapers
WALLPAPERS_DIR="public/wallpapers"

# Directory to store thumbnails
THUMBS_DIR="${WALLPAPERS_DIR}/generated-thumbs"
SMALL_DIR="${WALLPAPERS_DIR}/generated-small"

# Check if GraphicsMagick is installed
if ! command -v gm &> /dev/null
then
    echo "GraphicsMagick is not installed. Please install it to use this script."
    exit 1
fi

# Create thumbnails directory if it doesn't exist
mkdir -p "$THUMBS_DIR"
mkdir -p "$SMALL_DIR"

# Resize images
for img in "${WALLPAPERS_DIR}"/*.jpg; do
    # Skip if directory is empty
    [ -e "$img" ] || continue

    # Get filename without path
    filename=$(basename "$img")

    # Resize (only width specified, height automatically adjusted) and save in thumbs directory using GraphicsMagick
    # gm convert "$img" -resize 200 "${THUMBS_DIR}/${filename}"
    gm convert "$img" -resize 800 "${SMALL_DIR}/${filename}"
done

echo "Thumbnail creation complete."

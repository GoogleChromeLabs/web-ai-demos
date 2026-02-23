#!/bin/bash

# A script to zip the necessary files for the Chrome extension
# for Web Store compatibility.

# Define the name of the output zip file.
OUTPUT_ZIP="built-in-ai-extension.zip"

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "Error: 'dist' directory not found. Please run 'npm run build' first."
  exit 1
fi

# Check if an old zip file exists and remove it.
if [ -f "$OUTPUT_ZIP" ]; then
  echo "Removing old archive: $OUTPUT_ZIP"
  rm "$OUTPUT_ZIP"
fi

echo "Creating new archive named '$OUTPUT_ZIP' from 'dist' directory..."

# Create the zip file from the dist directory.
# Using 'cd dist' ensures the paths inside the zip are relative to the root of the extension.
cd dist
zip -r "../$OUTPUT_ZIP" .
cd ..

echo "✅ Successfully created '$OUTPUT_ZIP'."
echo "You can now upload this file to the Chrome Web Store."

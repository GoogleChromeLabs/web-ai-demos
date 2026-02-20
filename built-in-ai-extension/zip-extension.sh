#!/bin/bash

# A script to zip the necessary files for the Chrome extension,
# automatically stripping localhost patterns for Web Store compatibility.

# Define the name of the output zip file.
OUTPUT_ZIP="built-in-ai-extension.zip"

# Define the list of files to be included in the archive.
# We exclude node_modules and other development files.
FILES_TO_ZIP=(
  "manifest.json"
  "src/content.js"
  "src/background.js"
  "src/main-world-entry.js"
  "options/options.html"
  "options/options.js"
  "options/options.css"
  "icons/icon128.png"
  "icons/icon512.png"
  "offscreen"
  "lib" # Include the entire lib directory with polyfills
)

# Check if an old zip file exists and remove it.
if [ -f "$OUTPUT_ZIP" ]; then
  echo "Removing old archive: $OUTPUT_ZIP"
  rm "$OUTPUT_ZIP"
fi

# Create a build directory for a clean zip.
mkdir -p build
echo "Prepared build directory."

# Copy files and directories to the build directory.
for item in "${FILES_TO_ZIP[@]}"; do
  cp -r "$item" build/
done

echo "Creating new archive named '$OUTPUT_ZIP'..."

# Create the zip file from the build directory.
cd build
zip -r "../$OUTPUT_ZIP" *
cd ..

# Clean up.
rm -rf build
echo "Cleaned up build directory."

echo "✅ Successfully created '$OUTPUT_ZIP'."
echo "You can now upload this file to the Chrome Web Store."

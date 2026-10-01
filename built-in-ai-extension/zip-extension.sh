#!/bin/bash
#
# Copyright 2026 Google LLC
# SPDX-License-Identifier: Apache-2.0
#
# A script to zip the necessary files for the Chrome extension
# for Web Store compatibility.
#
# By default the extension is rebuilt first, so the archive can never contain a
# stale or half-written 'dist'. Pass --no-build to archive the existing 'dist'
# as-is.

# Abort on any failing command, unset variable, or failure inside a pipeline.
set -euo pipefail

# Always operate on the project, no matter where the script is invoked from.
cd "$(dirname "$0")"

# Define the name of the output zip file.
OUTPUT_ZIP="built-in-ai-extension.zip"

# Parse arguments.
RUN_BUILD=true
for arg in "$@"; do
  case "$arg" in
    --no-build)
      RUN_BUILD=false
      ;;
    -h | --help)
      echo "Usage: $(basename "$0") [--no-build]"
      echo
      echo "  --no-build  Archive the existing 'dist' instead of rebuilding it."
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$arg'. Try --help."
      exit 1
      ;;
  esac
done

# Rebuild so that 'dist' matches the current sources. A failed build leaves a
# populated but incomplete 'dist' behind, so bailing out here is what keeps a
# broken package from being uploaded.
if [ "$RUN_BUILD" = true ]; then
  echo "Building the extension..."
  npm run build
else
  echo "Skipping the build (--no-build)."
fi

# Check if dist exists.
if [ ! -d "dist" ]; then
  echo "Error: 'dist' directory not found. Please run 'npm run build' first."
  exit 1
fi

# A 'dist' without a manifest is not an extension, which means the build wrote
# something unexpected.
if [ ! -f "dist/manifest.json" ]; then
  echo "Error: 'dist/manifest.json' not found. The build looks incomplete."
  exit 1
fi

# Check if an old zip file exists and remove it.
if [ -f "$OUTPUT_ZIP" ]; then
  echo "Removing old archive: $OUTPUT_ZIP"
  rm "$OUTPUT_ZIP"
fi

echo "Creating new archive named '$OUTPUT_ZIP' from 'dist' directory..."

# Create the zip file from the dist directory.
# Using 'cd dist' ensures the paths inside the zip are relative to the root of
# the extension. The subshell keeps that 'cd' from leaking into the rest of the
# script, and '-x' keeps macOS metadata out of the upload.
(
  cd dist
  zip -r -X "../$OUTPUT_ZIP" . -x '.DS_Store' -x '*/.DS_Store' -x '__MACOSX/*'
)

# Report what was built, so the version can be checked against the Web Store
# listing before uploading.
VERSION=$(node -p "require('./dist/manifest.json').version")
SIZE=$(du -h "$OUTPUT_ZIP" | awk '{print $1}')

echo "✅ Successfully created '$OUTPUT_ZIP' (version $VERSION, $SIZE)."
echo "You can now upload this file to the Chrome Web Store."

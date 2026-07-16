/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds all test HTML pages (plus the index) as a standalone static
 * site, with all imports (including node_modules packages like
 * firebase, openai, @google/genai, @mlc-ai/web-llm and
 * @huggingface/transformers) bundled so the output can be served
 * without a dev server.
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-demos',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'test-default': resolve(__dirname, 'test-default.html'),
        'test-firebase': resolve(__dirname, 'test-firebase.html'),
        'test-gemini': resolve(__dirname, 'test-gemini.html'),
        'test-openai': resolve(__dirname, 'test-openai.html'),
        'test-transformers': resolve(__dirname, 'test-transformers.html'),
        'test-webllm': resolve(__dirname, 'test-webllm.html'),
      },
    },
    target: 'esnext',
  },
});

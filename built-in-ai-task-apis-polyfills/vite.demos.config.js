/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds all demo HTML pages (plus the index) as a standalone static
 * site, with all imports (including node_modules packages like
 * prompt-api-polyfill and @huggingface/transformers) bundled so the
 * output can be served without a dev server.
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
        classifier: resolve(__dirname, 'demo-classifier.html'),
        'language-detector': resolve(
          __dirname,
          'demo-language-detector.html'
        ),
        rewriter: resolve(__dirname, 'demo-rewriter.html'),
        'semantic-embedder': resolve(
          __dirname,
          'demo-semantic-embedder.html'
        ),
        summarizer: resolve(__dirname, 'demo-summarizer.html'),
        translator: resolve(__dirname, 'demo-translator.html'),
        writer: resolve(__dirname, 'demo-writer.html'),
      },
    },
    target: 'esnext',
  },
});

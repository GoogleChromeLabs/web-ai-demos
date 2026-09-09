/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the demo HTML pages (plus the index) as a standalone static site,
 * so the output can be served without a dev server.
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
        writer: resolve(__dirname, 'demo-writer.html'),
        rewriter: resolve(__dirname, 'demo-rewriter.html'),
      },
    },
    target: 'esnext',
  },
});

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    fs: {
      strict: false,
      allow: [resolve(__dirname)],
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'index.js'),
        writer: resolve(__dirname, 'writer-api-polyfill.js'),
        rewriter: resolve(__dirname, 'rewriter-api-polyfill.js'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    target: 'esnext',
  },
});

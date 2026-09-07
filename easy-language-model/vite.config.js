/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';

// Library build. `npm run build` emits `dist/`.
// The demo is built separately with `vite.demo.config.js`.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.js',
      name: 'EasyLanguageModel',
      fileName: 'easy-language-model',
    },
    rollupOptions: {
      // A declared dependency, so consumers resolve their own copy rather than
      // getting a second one baked in here.
      external: ['streaming-markdown-html'],
      output: {
        globals: { 'streaming-markdown-html': 'StreamingMarkdownHtml' },
      },
    },
    sourcemap: true,
  },
});

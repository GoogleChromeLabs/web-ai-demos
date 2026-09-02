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
    sourcemap: true,
  },
});

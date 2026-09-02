/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';

// Demo build. `npm run build:demo` emits `dist-demo/`.
export default defineConfig({
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
});

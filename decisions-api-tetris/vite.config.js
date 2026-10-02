/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';

// The DecisionModel polyfill starts its worker from its own module URL
// (`new Worker(import.meta.url)`), so the worker loads whatever chunk that
// module ends up in, plus everything the chunk imports. None of it may touch
// `document`. Same setup as the polyfill's own demo build.
export default defineConfig({
  build: {
    // Vite's preload wrapper around dynamic imports reaches for `document`.
    modulePreload: false,
    rollupOptions: {
      output: {
        // Keep the polyfill out of the app's entry chunk, which runs the game,
        // and keep the preload helper out of the polyfill's chunk: the entry
        // imports the helper statically, which would run the polyfill (and
        // define `DecisionModel`) on page load.
        advancedChunks: {
          groups: [
            { name: 'preload-helper', test: /vite\/preload-helper/ },
            {
              name: 'decision-model',
              test: /built-in-ai-task-apis-polyfills[\\/]dist[\\/](decision-model|base-task-model)/,
            },
          ],
        },
      },
    },
  },
});

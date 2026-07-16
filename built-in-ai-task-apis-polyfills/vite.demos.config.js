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
    // semantic-embedder-api-polyfill.js re-loads itself as a worker via
    // `new Worker(import.meta.url)`. Vite's modulepreload machinery
    // (the injected polyfill, and the `__vitePreload` wrapper it adds
    // around dynamic imports) unconditionally touches `document`/`window`,
    // which don't exist inside that worker. Disabling it avoids both:
    // no polyfill import is injected, and dynamic imports no longer get
    // wrapped with document-touching preload logic.
    modulePreload: false,
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
      output: {
        // semantic-embedder-api-polyfill.js spawns its own worker by
        // pointing `new Worker()` at its own `import.meta.url`. That only
        // works if the worker's URL resolves to a chunk containing solely
        // that module's code — if bundling inlines it into the demo page's
        // entry chunk instead, the worker re-executes the whole page bundle
        // (including its DOM-touching top-level code) in a context with no
        // `document`, and throws. Force it into an isolated chunk so the
        // worker only ever (re-)loads itself.
        advancedChunks: {
          groups: [
            {
              name: 'semantic-embedder-api-polyfill',
              test: /semantic-embedder-api-polyfill\.js$/,
            },
          ],
        },
      },
    },
    target: 'esnext',
  },
});

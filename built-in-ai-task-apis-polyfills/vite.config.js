/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// The semantic embedder spawns a worker with
// `new Worker(new URL('./semantic-embedder-worker.js', import.meta.url))`.
// That spelling is what tells a bundler to emit the worker as its own chunk
// with its imports resolved, and it has to survive all the way into whatever
// app bundles this package. Building these files here would destroy it: Vite's
// library mode rewrites one reference to an inlined base64 `data:` URL and the
// other to an absolute `/assets/…` path marked `@vite-ignore`, neither of which
// a downstream bundler can follow. So they ship as plain source, copied into
// `dist/` untouched, and the consumer's own bundler handles the worker.
const EMBEDDER_SOURCES = [
  'semantic-embedder-api-polyfill.js',
  'semantic-embedder-worker.js',
  'semantic-embedder-constants.js',
];

const isEmbedderSource = (id) =>
  EMBEDDER_SOURCES.some((file) => id.endsWith(file));

/** Copies the embedder sources into `dist/` verbatim. */
function copyEmbedderSources() {
  return {
    name: 'copy-embedder-sources',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      fs.mkdirSync(outDir, { recursive: true });
      for (const file of EMBEDDER_SOURCES) {
        fs.copyFileSync(resolve(__dirname, file), resolve(outDir, file));
      }
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    exclude: ['prompt-api-polyfill'],
  },
  server: {
    fs: {
      strict: false,
      allow: [resolve(__dirname)],
    },
  },
  plugins: [copyEmbedderSources()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'index.js'),
        summarizer: resolve(__dirname, 'summarizer-api-polyfill.js'),
        writer: resolve(__dirname, 'writer-api-polyfill.js'),
        rewriter: resolve(__dirname, 'rewriter-api-polyfill.js'),
        'language-detector': resolve(
          __dirname,
          'language-detector-api-polyfill.js',
        ),
        translator: resolve(__dirname, 'translator-api-polyfill.js'),
        classifier: resolve(__dirname, 'classifier-api-polyfill.js'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // Keeping the embedder sources external leaves `dist/index.js` with a
      // plain `import './semantic-embedder-api-polyfill.js'`, which resolves to
      // the copy this build drops next to it.
      external: (id) =>
        id === 'prompt-api-polyfill' ||
        id === '@huggingface/transformers' ||
        isEmbedderSource(id),
    },
    target: 'esnext',
  },
});

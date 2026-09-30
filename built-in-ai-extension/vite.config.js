/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Stops the ONNX runtime's unused wasm fallback from pulling a 26 MB binary
 * into the bundle.
 *
 * The runtime falls back to `new URL(<wasm>, import.meta.url)` when nothing
 * told it where its binaries live. Transformers.js always sets `wasmPaths`
 * before a session is created, so that branch never runs, but Vite still
 * resolves the expression and emits a copy of the binary for it. That happens
 * once per bundle carrying the runtime, and the semantic embedder's worker is a
 * bundle of its own, so the cost is paid twice. Rewriting the expression to a
 * plain string emits nothing, and still names the copy that
 * copy-transformers-assets ships, should the branch ever be reached.
 */
function localizeOrtWasmUrl() {
  return {
    name: 'localize-ort-wasm-url',
    // 'pre' puts this ahead of Vite's own `new URL(..., import.meta.url)`
    // handling, which is what turns the expression into an emitted asset.
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web')) {
        return null;
      }
      const pattern =
        /new URL\(\s*"(ort-wasm-simd-threaded[^"]*\.wasm)"\s*,\s*import\.meta\.url\s*\)\.href/g;
      if (!pattern.test(code)) {
        return null;
      }
      pattern.lastIndex = 0;
      return {
        code: code.replace(pattern, (_match, file) =>
          JSON.stringify(`/src/transformers-assets/${file}`)
        ),
        map: null,
      };
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    // Keeps a single copy of the library in the main bundle. The semantic
    // embedder's worker is a separate bundle for a separate realm, so it
    // necessarily carries its own.
    dedupe: ['@huggingface/transformers'],
    alias: {
      // Avoid including remotely hosted code in a Manifest V3 item
      // to pass Chrome Web Store validation.
      // Pointing prompt-api-polyfill at its monorepo source makes Vite process
      // the source from scratch, at which point this alias fires correctly.
      'firebase/app-check': resolve(__dirname, 'src/firebase-mock-appcheck.js'),
      'prompt-api-polyfill': resolve(
        __dirname,
        '../prompt-api-polyfill/prompt-api-polyfill.js'
      ),
    },
  },
  esbuild: {
    keepNames: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
    // Disable hashing so filenames in manifest.json remain valid
    rollupOptions: {
      input: {
        options: resolve(__dirname, 'options/options.html'),
        offscreen: resolve(__dirname, 'offscreen/offscreen.html'),
        background: resolve(__dirname, 'src/background.js'),
        content: resolve(__dirname, 'src/content.js'),
        'main-world-entry': resolve(__dirname, 'src/main-world-entry.js'),
      },
      output: {
        entryFileNames: `src/[name].js`,
        chunkFileNames: `src/chunks/[name]-[hash].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
    // We want to keep the extension structure clean
    outDir: 'dist',
    emptyOutDir: true,
  },
  // The SemanticEmbedder polyfill declares its worker the way bundlers expect,
  // so Vite bundles it on its own. Naming that output predictably instead of
  // with a content hash is what lets manifest.json list it as a web-accessible
  // resource and the content script hand the polyfill its URL.
  worker: {
    format: 'es',
    // The worker is bundled separately and does not inherit `plugins` above.
    plugins: () => [localizeOrtWasmUrl()],
    rollupOptions: {
      output: {
        entryFileNames: `src/semantic-embedder-worker.js`,
        chunkFileNames: `src/chunks/[name]-[hash].js`,
      },
    },
  },
  plugins: [
    {
      name: 'virtual-url-stub',
      // 'pre' forces this plugin to run before Vite's core resolution logic
      enforce: 'pre',
      resolveId(id) {
        if (id === 'url') {
          return '\0virtual:url-stub';
        }
      },
      load(id) {
        if (id === '\0virtual:url-stub') {
          return 'export default {}; export const fileURLToPath = (url) => "/";';
        }
      },
    },
    localizeOrtWasmUrl(),
    {
      name: 'copy-transformers-assets',
      closeBundle() {
        const transformersAssetsDir = resolve(
          __dirname,
          'dist/src/transformers-assets'
        );
        if (!fs.existsSync(transformersAssetsDir)) {
          fs.mkdirSync(transformersAssetsDir, { recursive: true });
        }
        const transformersDistDir = resolve(
          __dirname,
          'node_modules/onnxruntime-web/dist'
        );
        if (fs.existsSync(transformersDistDir)) {
          fs.readdirSync(transformersDistDir)
            .filter((file) => file.startsWith('ort-wasm-simd-threaded.'))
            .forEach((file) => {
              console.log(`Copying ${file} to ${transformersAssetsDir}...`);
              fs.copyFileSync(
                resolve(transformersDistDir, file),
                resolve(transformersAssetsDir, file)
              );
            });
        }
      },
    },
  ],
});

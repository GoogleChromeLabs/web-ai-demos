import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    // The SemanticEmbedder polyfill re-loads itself as a worker through
    // `new Worker(import.meta.url)`. Vite's modulepreload machinery touches
    // `document`, which does not exist inside that worker.
    modulePreload: false,
    rollupOptions: {
      output: {
        // For the same reason the polyfill has to stay in a chunk of its own:
        // inlined into the app chunk, the worker would re-run this whole app
        // in a context with no DOM.
        codeSplitting: {
          groups: [
            {
              name: "semantic-embedder-polyfill",
              test: /semantic-embedder/,
            },
          ],
        },
      },
    },
    target: "esnext",
  },
});

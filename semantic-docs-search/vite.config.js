import { defineConfig } from "vite";

// GitHub Pages runs the output through Jekyll unless this file is present, and
// Jekyll drops anything whose name starts with an underscore — which is how
// hashed chunk and wasm names can come out.
const nojekyll = {
  name: "nojekyll",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
  },
};

export default defineConfig({
  // Relative, so the site works from a repository subpath such as
  // /web-ai-demos/semantic-docs-search/ as well as from a domain root.
  base: "./",
  plugins: [nojekyll],
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // The polyfill re-loads itself as a worker, so its chunk must
              // hold the polyfill and nothing else. Being imported dynamically
              // already earns it one, but the dynamic-import helper is shared
              // with the entry, and unless the helper has a chunk of its own
              // the polyfill chunk imports the entry to reach it — which makes
              // the worker execute this whole page in a context with no DOM.
              name: "runtime",
              test: /preload-helper/,
            },
          ],
        },
      },
    },
    // The modulepreload helper touches `document`, which does not exist in the
    // worker the polyfill starts.
    modulePreload: false,
    target: "esnext",
  },
});

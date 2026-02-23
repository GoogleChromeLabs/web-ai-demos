import { defineConfig } from 'vite';
import { resolve } from 'path';
import { discoverBackends } from './scripts/backend-discovery.js';

const backends = discoverBackends();

export default defineConfig({
  build: {
    lib: {
      entry: {
        'prompt-api-polyfill': resolve(__dirname, 'prompt-api-polyfill.js'),
        ...Object.fromEntries(
          backends.map((b) => [`backends/${b.name}`, b.fullPath])
        ),
      },
      name: 'PromptAPIPolyfill',
      formats: ['es'],
    },
    rollupOptions: {
      // Ensure to externalize dependencies that shouldn't be bundled
      // into your library
      external: [
        'firebase/app',
        'firebase/ai',
        'openai',
        '@google/genai',
        '@huggingface/transformers',
      ],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  optimizeDeps: {
    // Exclude WPT tests from dependency scanning as they are many and static
    entries: [resolve(__dirname, 'prompt-api-polyfill.js')],
  },
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..', '.'],
    },
  },
});

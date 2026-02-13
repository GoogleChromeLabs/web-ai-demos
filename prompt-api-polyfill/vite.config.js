import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'prompt-api-polyfill': resolve(__dirname, 'prompt-api-polyfill.js'),
        'backends/firebase': resolve(__dirname, 'backends/firebase.js'),
        'backends/gemini': resolve(__dirname, 'backends/gemini.js'),
        'backends/openai': resolve(__dirname, 'backends/openai.js'),
        'backends/transformers': resolve(__dirname, 'backends/transformers.js'),
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
        '@huggingface/transformers'
      ],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  optimizeDeps: {
    // Exclude WPT tests from dependency scanning as they are many and static
    entries: [
      resolve(__dirname, 'prompt-api-polyfill.js'),
    ],
  },
});

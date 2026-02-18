import { defineConfig } from 'vite';
import { resolve } from 'path';

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
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'index.js'),
        summarizer: resolve(__dirname, 'summarizer-api-polyfill.js'),
        writer: resolve(__dirname, 'writer-api-polyfill.js'),
        rewriter: resolve(__dirname, 'rewriter-api-polyfill.js'),
        'language-detector': resolve(
          __dirname,
          'language-detector-api-polyfill.js'
        ),
        translator: resolve(__dirname, 'translator-api-polyfill.js'),
        taxonomizer: resolve(__dirname, 'taxonomizer-api-polyfill.js'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['prompt-api-polyfill'],
    },
    target: 'esnext',
  },
});

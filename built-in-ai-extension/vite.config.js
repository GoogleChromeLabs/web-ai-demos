import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  esbuild: {
    keepNames: true,
  },
  build: {
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
  plugins: [
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
          'node_modules/@huggingface/transformers/dist'
        );
        if (fs.existsSync(transformersDistDir)) {
          fs.readdirSync(transformersDistDir)
            .filter((file) => file.startsWith('ort-wasm-simd-threaded.jsep.'))
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

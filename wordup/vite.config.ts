import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    'process.env.DEBUG': JSON.stringify(process.env.DEBUG || '0')
  },
  build: {
    target: 'chrome148',
    minify: 'esbuild'
  }
})

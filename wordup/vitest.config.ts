import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  resolve: {
    conditions: ['browser']
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/*.{test,spec}.svelte.ts'],
  },
});

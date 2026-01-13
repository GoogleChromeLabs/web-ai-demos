import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        testTimeout: 60000,
        alias: {
            'https://esm.run/firebase/app': 'firebase/app',
            'https://esm.run/firebase/ai': '@firebase/ai',
        },
    },
});

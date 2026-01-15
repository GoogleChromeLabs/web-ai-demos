import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
    root: './',
    test: {

        globals: true,
        testTimeout: 60000,
        alias: {
            'https://esm.run/firebase/app': 'firebase/app',
            'https://esm.run/firebase/ai': '@firebase/ai',
            'https://esm.run/@google/generative-ai': '@google/generative-ai',
            'https://esm.run/openai': 'openai',
        },
        browser: {
            enabled: true,
            provider: playwright(),
            instances: [
                {
                    browser: 'chromium',
                },
            ],
            headless: true,
            screenshotFailures: false,
        },
    },
});

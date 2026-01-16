import { describe, it, expect, beforeAll } from 'vitest';
import Ajv from 'ajv';
import '../prompt-api-polyfill.js';

// Load the dynamically discovered backends
import activeBackends from './active-backends.json';


const ajv = new Ajv();

describe.each(activeBackends)('Prompt API Polyfill Browser ($name Backend)', (backend) => {
    beforeAll(async () => {
        // Clear all potential backend configs
        const allPossibleConfigs = ['FIREBASE_CONFIG', 'GEMINI_CONFIG', 'DEFAULT_CONFIG'];
        allPossibleConfigs.forEach(key => {
            delete window[key];
        });

        // Set the current config
        window[backend.configKey] = backend.config;

        // Force the polyfill to load even if native implementation exists
        window.__FORCE_PROMPT_API_POLYFILL__ = true;
    });

    describe('Static Methods', () => {
        it('LanguageModel.availability() should return "available"', async () => {
            const availability = await window.LanguageModel.availability();
            expect(availability).toBe('available');
        });

        it('LanguageModel.params() should return default values', async () => {
            const params = await window.LanguageModel.params();
            expect(params).toHaveProperty('defaultTemperature');
            expect(params).toHaveProperty('defaultTopK');
            expect(params).toHaveProperty('maxTemperature');
            expect(params).toHaveProperty('maxTopK');
        });

        it('LanguageModel.create() should create a session', async () => {
            const session = await window.LanguageModel.create();
            expect(session).toBeInstanceOf(window.LanguageModel);
            session.destroy();
        });

        it('should be the polyfill implementation (Sanity Check)', () => {
            expect(window.LanguageModel.__isPolyfill).toBe(true);
        });
    });

    describe('Instance Methods', () => {
        let session;

        beforeAll(async () => {
            session = await window.LanguageModel.create({
                temperature: 0,
                topK: 1,
            });
        });

        it('session.prompt() should return a response', async () => {
            const response = await session.prompt('What is the capital of France?');
            expect(response.toLowerCase()).toContain('paris');
        }, 30000);

        it('session should maintain conversation history', async () => {
            const historySession = await window.LanguageModel.create({ temperature: 0, topK: 1 });
            try {
                await historySession.prompt('What is the capital of France?');
                await historySession.prompt('What is the capital of Germany?');
                const finalResponse = await historySession.prompt('What were the two cities I just asked about?');

                const lowerResponse = finalResponse.toLowerCase();
                expect(lowerResponse).toContain('paris');
                expect(lowerResponse).toContain('berlin');
            } finally {
                historySession.destroy();
            }
        }, 60000);

        it('session.promptStreaming() should return chunks', async () => {
            const stream = session.promptStreaming('Count from 1 to 3');
            let fullText = '';
            for await (const chunk of stream) {
                fullText += chunk;
            }
            expect(fullText.length).toBeGreaterThan(0);
        }, 30000);

        it('session should support multimodal input (image recognition)', async () => {
            const multimodalSession = await window.LanguageModel.create({
                expectedInputs: [
                    { type: 'text', languages: ['en'] },
                    { type: 'image', languages: ['en'] }
                ],
                expectedOutputs: [
                    { type: 'text', languages: ['en'] }
                ]
            });
            try {
                const response = await fetch('/gemini.webp');
                const imageBlob = await response.blob();
                const imageBuffer = await imageBlob.arrayBuffer();

                const aiResponse = await multimodalSession.prompt([
                    {
                        role: 'user',
                        content: [
                            { type: 'text', value: 'What does the text in this image say?' },
                            { type: 'image', value: imageBuffer }
                        ]
                    }
                ]);

                expect(aiResponse.toLowerCase()).toContain('gemini');
            } finally {
                multimodalSession.destroy();
            }
        }, 60000);

        it('session should support multimodal input (audio transcription)', async () => {
            // Note: Audio transcription might be slow or not supported by all backends/models
            const multimodalSession = await window.LanguageModel.create({
                expectedInputs: [
                    { type: 'text', languages: ['en'] },
                    { type: 'audio', languages: ['en'] }
                ],
                expectedOutputs: [
                    { type: 'text', languages: ['en'] }
                ]
            });
            try {
                const response = await fetch('/jfk.wav');
                const audioBlob = await response.blob();
                const audioBuffer = await audioBlob.arrayBuffer();

                const aiResponse = await multimodalSession.prompt([
                    {
                        role: 'user',
                        content: [
                            { type: 'text', value: 'Transcribe this audio.' },
                            { type: 'audio', value: audioBuffer }
                        ]
                    }
                ]);

                expect(aiResponse.toLowerCase()).toContain('country');
            } finally {
                multimodalSession.destroy();
            }
        }, 60000);

        it('session.measureInputUsage() should return a number', async () => {
            const usage = await session.measureInputUsage('Hello world');
            expect(typeof usage).toBe('number');
            expect(usage).toBeGreaterThan(0);
        });

        it('session.clone() should create a new session and preserve history', async () => {
            const originalSession = await window.LanguageModel.create({
                temperature: 0,
                topK: 1,
            });
            try {
                // Establish history
                await originalSession.prompt('My secret name is "Prompty McPromptface".');

                // Clone it
                const cloned = await originalSession.clone();
                expect(cloned).toBeInstanceOf(window.LanguageModel);
                expect(cloned.temperature).toBe(originalSession.temperature);

                // Verify history in clone
                const response = await cloned.prompt('What is my secret name?');
                expect(response.toLowerCase()).toContain('prompty');

                cloned.destroy();
            } finally {
                originalSession.destroy();
            }
        }, 60000);
    });

    describe('Structured Output', () => {
        it('session.prompt() should respect responseConstraint (JSON Schema)', async () => {
            const session = await window.LanguageModel.create({ temperature: 0, topK: 1 });
            const schema = {
                type: 'object',
                required: ['capital'],
                properties: {
                    capital: { type: 'string' },
                },
            };

            const response = await session.prompt('What is the capital of Germany? Respond in JSON.', {
                responseConstraint: schema,
            });

            let json;
            try {
                json = JSON.parse(response);
            } catch (e) {
                throw new Error(`Failed to parse JSON response: ${response}`);
            }

            const validate = ajv.compile(schema);
            const valid = validate(json);

            expect(valid).toBe(true);
            expect(json.capital.toLowerCase()).toContain('berlin');

            session.destroy();
        }, 30000);
    });
});

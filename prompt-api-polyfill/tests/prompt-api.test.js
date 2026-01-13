import { describe, it, expect, beforeAll } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const firebaseConfig = JSON.parse(
    readFileSync(join(process.cwd(), '.env.json'), 'utf8')
);

const ajv = new Ajv();

describe('Prompt API Polyfill', () => {
    beforeAll(async () => {
        // Set up the environment for the polyfill
        global.window = global;
        window.FIREBASE_CONFIG = firebaseConfig;

        // Load the polyfill
        // Note: Since it's an IIFE that attaches to window, we just import it for side effects.
        await import('../prompt-api-polyfill.js');
    });

    describe('Static Methods', () => {
        it('LanguageModel.availability() should return "available"', async () => {
            const availability = await LanguageModel.availability();
            expect(availability).toBe('available');
        });

        it('LanguageModel.params() should return default values', async () => {
            const params = await LanguageModel.params();
            expect(params).toHaveProperty('defaultTemperature');
            expect(params).toHaveProperty('defaultTopK');
            expect(params).toHaveProperty('maxTemperature');
            expect(params).toHaveProperty('maxTopK');
            expect(params.maxTemperature).toBeGreaterThan(0);
        });

        it('LanguageModel.create() should create a session', async () => {
            const session = await LanguageModel.create();
            expect(session).toBeInstanceOf(LanguageModel);
            session.destroy();
        });

        it('LanguageModel.create() with options should work', async () => {
            const session = await LanguageModel.create({
                temperature: 0.5,
                topK: 10,
            });
            expect(session.temperature).toBe(0.5);
            expect(session.topK).toBe(10);
            session.destroy();
        });

        it('LanguageModel.create() with initialPrompts should work', async () => {
            const session = await LanguageModel.create({
                initialPrompts: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Hello!' },
                ],
            });
            expect(session).toBeInstanceOf(LanguageModel);
            session.destroy();
        });
    });

    describe('Instance Methods', () => {
        let session;

        beforeAll(async () => {
            session = await LanguageModel.create({
                temperature: 0, // Deterministic as possible
                topK: 1,
            });
        });

        it('session.prompt() should return a response (fuzzy match)', async () => {
            const response = await session.prompt('What is the capital of France?');
            expect(response.toLowerCase()).toContain('paris');
        }, 30000);

        it('session should maintain conversation history', async () => {
            const historySession = await LanguageModel.create({ temperature: 0, topK: 1 });
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
            const multimodalSession = await LanguageModel.create({
                expectedInputs: [
                    { type: 'text', languages: ['en'] },
                    { type: 'image', languages: ['en'] }
                ],
                expectedOutputs: [
                    { type: 'text', languages: ['en'] }
                ]
            });
            try {
                const imageBuffer = readFileSync(join(process.cwd(), 'gemini.webp'));

                const response = await multimodalSession.prompt([
                    {
                        role: 'user',
                        content: [
                            { type: 'text', value: 'What does the text in this image say?' },
                            { type: 'image', value: imageBuffer }
                        ]
                    }
                ]);

                expect(response.toLowerCase()).toContain('gemini');
            } finally {
                multimodalSession.destroy();
            }
        }, 60000);

        it('session should support multimodal input (audio transcription)', async () => {
            const multimodalSession = await LanguageModel.create({
                expectedInputs: [
                    { type: 'text', languages: ['en'] },
                    { type: 'audio', languages: ['en'] }
                ],
                expectedOutputs: [
                    { type: 'text', languages: ['en'] }
                ]
            });
            try {
                const nodeBuffer = readFileSync(join(process.cwd(), 'jfk.wav'));
                const audioBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);

                const response = await multimodalSession.prompt([
                    {
                        role: 'user',
                        content: [
                            { type: 'text', value: 'Transcribe this audio.' },
                            { type: 'audio', value: audioBuffer }
                        ]
                    }
                ]);

                expect(response.toLowerCase()).toContain('country');
            } finally {
                multimodalSession.destroy();
            }
        }, 60000);

        it('session.measureInputUsage() should return a number', async () => {
            const usage = await session.measureInputUsage('Hello world');
            expect(typeof usage).toBe('number');
            expect(usage).toBeGreaterThan(0);
        });

        it('session.append() should work', async () => {
            const initialUsage = session.inputUsage;
            const context = 'This is some context.';
            const contextUsage = await session.measureInputUsage(context);
            await session.append(context);
            const usage = session.inputUsage;
            // Token counts are not always perfectly additive due to message overhead
            expect(usage).toBeGreaterThanOrEqual(initialUsage + contextUsage);
            expect(usage).toBeLessThanOrEqual(initialUsage + contextUsage + 10);
        });

        it('session.clone() should create a new session with same state', async () => {
            const cloned = await session.clone();
            expect(cloned).toBeInstanceOf(LanguageModel);
            expect(cloned.temperature).toBe(session.temperature);
            cloned.destroy();
        });

        it('session.destroy() should mark session as destroyed', async () => {
            const tempSession = await LanguageModel.create();
            tempSession.destroy();
            // Since it's private field #destroyed, we check if methods throw
            await expect(tempSession.prompt('foo')).rejects.toThrow('Session is destroyed');
        });
    });

    describe('Structured Output', () => {
        it('session.prompt() should respect responseConstraint (JSON Schema)', async () => {
            const session = await LanguageModel.create({ temperature: 0, topK: 1 });
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

            if (!valid) {
                console.error('JSON Schema validation errors:', validate.errors);
            }

            expect(valid).toBe(true);
            expect(json.capital.toLowerCase()).toBe('berlin');

            session.destroy();
        }, 30000);
    });

    describe('Attributes', () => {
        it('session should have inputUsage and inputQuota', async () => {
            const session = await LanguageModel.create();
            expect(typeof session.inputUsage).toBe('number');
            expect(typeof session.inputQuota).toBe('number');
            session.destroy();
        });

        it('session.onquotaoverflow should be settable', async () => {
            const session = await LanguageModel.create();
            const handler = () => { };
            session.onquotaoverflow = handler;
            expect(session.onquotaoverflow).toBe(handler);
            session.destroy();
        });
    });
});

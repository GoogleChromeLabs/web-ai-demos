import OpenAI from 'https://esm.run/openai';
import PolyfillBackend from './base.js';

/**
 * OpenAI API Backend
 */
export default class OpenAIBackend extends PolyfillBackend {
    constructor(config) {
        super();
        this.config = config;
        this.openai = new OpenAI({
            apiKey: config.apiKey,
            dangerouslyAllowBrowser: true // Required for client-side usage
        });
        this.defaultModel = config.modelName || 'gpt-4o';
    }

    async createSession(options, inCloudParams) {
        // OpenAI doesn't have a "session" object like Gemini, so we return a context object
        // tailored for our generate methods.
        return {
            model: options.modelName || this.defaultModel,
            temperature: inCloudParams.generationConfig?.temperature,
            top_p: 1.0, // Default to 1.0 as topK is not directly supported the same way
            systemInstruction: inCloudParams.systemInstruction
        };
    }

    #validateContent(messages) {
        let hasImage = false;
        let hasAudio = false;

        for (const msg of messages) {
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'image_url') hasImage = true;
                    if (part.type === 'input_audio') hasAudio = true;
                }
            }
        }

        if (hasImage && hasAudio) {
            throw new Error("OpenAI backend does not support mixing images and audio in the same session. Please start a new session.");
        }

        return { hasImage, hasAudio };
    }

    #routeModel(modelContext, hasAudio) {
        // If the user explicitly provided a model in the session options, respect it.
        // Otherwise, pick based on content.
        if (modelContext.model !== this.defaultModel) {
            return modelContext.model;
        }

        return hasAudio ? 'gpt-4o-audio-preview' : 'gpt-4o';
    }

    async generateContent(modelContext, contents) {
        const { messages } = this.#convertContentsToInput(contents, modelContext.systemInstruction);
        const { hasAudio } = this.#validateContent(messages);
        const model = this.#routeModel(modelContext, hasAudio);

        const options = {
            model: model,
            messages: messages,
        };

        if (modelContext.temperature > 0) {
            options.temperature = modelContext.temperature;
        }

        try {
            const response = await this.openai.chat.completions.create(options);

            const choice = response.choices[0];
            const text = choice.message.content;
            const usage = response.usage?.total_tokens || 0;

            return { text, usage };
        } catch (error) {
            console.error("OpenAI Generate Content Error:", error);
            throw error;
        }
    }

    async generateContentStream(modelContext, contents) {
        const { messages } = this.#convertContentsToInput(contents, modelContext.systemInstruction);
        const { hasAudio } = this.#validateContent(messages);
        const model = this.#routeModel(modelContext, hasAudio);

        const options = {
            model: model,
            messages: messages,
            stream: true,
        };

        if (modelContext.temperature > 0) {
            options.temperature = modelContext.temperature;
        }

        try {
            const stream = await this.openai.chat.completions.create(options);

            // Convert OpenAI stream to an AsyncIterable that yields chunks 
            return (async function* () {
                for await (const chunk of stream) {
                    const text = chunk.choices[0]?.delta?.content;
                    if (text) {
                        yield {
                            text: () => text,
                            usageMetadata: { totalTokenCount: 0 }
                        };
                    }
                }
            })();

        } catch (error) {
            console.error("OpenAI Generate Content Stream Error:", error);
            throw error;
        }
    }

    async countTokens(modelContext, contents) {
        // OpenAI does not provide a public API endpoint for counting tokens before generation.
        // Implementing countTokens strictly requires a tokenizer like `tiktoken`.
        // For this initial implementation, we use a character-based approximation (e.g., text.length / 4)
        // to avoid adding heavy WASM dependencies (`tiktoken`) to the polyfill.
        let totalText = "";
        if (modelContext.systemInstruction) {
            totalText += modelContext.systemInstruction;
        }

        for (const content of contents) {
            for (const part of content.parts) {
                if (part.text) {
                    totalText += part.text;
                } else if (part.inlineData) {
                    // Approximate image token cost (e.g., ~1000 chars worth)
                    totalText += " ".repeat(1000);
                }
            }
        }

        return Math.ceil(totalText.length / 4);
    }

    #convertContentsToInput(contents, systemInstruction) {
        const messages = [];

        // System instructions
        if (systemInstruction) {
            messages.push({
                role: 'system',
                content: systemInstruction
            });
        }

        for (const content of contents) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const contentParts = [];

            for (const part of content.parts) {
                if (part.text) {
                    contentParts.push({ type: 'text', text: part.text });
                } else if (part.inlineData) {
                    const { data, mimeType } = part.inlineData;
                    if (mimeType.startsWith('image/')) {
                        contentParts.push({
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${data}` }
                        });
                    } else if (mimeType.startsWith('audio/')) {
                        contentParts.push({
                            type: 'input_audio',
                            input_audio: {
                                data: data,
                                format: mimeType.split('/')[1] === 'mpeg' ? 'mp3' : 'wav'
                            }
                        });
                    }
                }
            }

            // Simplification: if only one text part, just send string content for better compatibility
            // but multimodal models usually prefer the array format. 
            // We'll keep the array format for consistency with multimodal inputs.
            messages.push({ role, content: contentParts });
        }

        return { messages };
    }
}

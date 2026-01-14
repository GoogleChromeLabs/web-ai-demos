/**
 * Abstract class representing a backend for the LanguageModel polyfill.
 */
export default class PolyfillBackend {
    /**
     * @param {string} modelName - The name of the model.
     */
    constructor(modelName) {
        this.modelName = modelName;
    }

    /**
     * Creates a model session.
     * @param {Object} options - LanguageModel options.
     * @param {Object} inCloudParams - Backend-specific params (like generationConfig).
     * @returns {any} The backend-specific model instance.
     */
    createSession(options, inCloudParams) {
        throw new Error('Not implemented');
    }

    /**
     * Generates content (non-streaming).
     * @param {any} model - The model instance returned by createSession.
     * @param {Array} content - The history + new message content.
     * @returns {Promise<{text: string, usage: number}>}
     */
    async generateContent(model, content) {
        throw new Error('Not implemented');
    }

    /**
     * Generates content stream.
     * @param {any} model - The model instance.
     * @param {Array} content - The history + new content.
     * @returns {Promise<AsyncIterable>} Stream of chunks.
     */
    async generateContentStream(model, content) {
        throw new Error('Not implemented');
    }

    /**
     * Counts tokens.
     * @param {any} model - The model instance.
     * @param {Array} content - The content to count.
     * @returns {Promise<number>} Total tokens.
     */
    async countTokens(model, content) {
        throw new Error('Not implemented');
    }
}

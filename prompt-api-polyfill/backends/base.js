/**
 * Abstract class representing a backend for the LanguageModel polyfill.
 */
export default class PolyfillBackend {
    #model;

    /**
     * @param {string} modelName - The name of the model.
     */
    constructor(modelName) {
        this.modelName = modelName;
    }

    /**
     * Creates a model session and stores it.
     * @param {Object} options - LanguageModel options.
     * @param {Object} inCloudParams - Backend-specific params (like generationConfig).
     * @returns {any} The backend-specific model instance.
     */
    createSession(options, inCloudParams) {
        throw new Error('Not implemented');
    }

    /**
     * Generates content (non-streaming).
     * @param {Array} content - The history + new message content.
     * @returns {Promise<{text: string, usage: number}>}
     */
    async generateContent(content) {
        throw new Error('Not implemented');
    }

    /**
     * Generates content stream.
     * @param {Array} content - The history + new content.
     * @returns {Promise<AsyncIterable>} Stream of chunks.
     */
    async generateContentStream(content) {
        throw new Error('Not implemented');
    }

    /**
     * Counts tokens.
     * @param {Array} content - The content to count.
     * @returns {Promise<number>} Total tokens.
     */
    async countTokens(content) {
        throw new Error('Not implemented');
    }
}

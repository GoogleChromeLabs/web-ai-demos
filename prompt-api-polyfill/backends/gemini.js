import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Google Gemini API Backend
 */
export default class GeminiBackend extends PolyfillBackend {
    constructor(config) {
        super(config.modelName || DEFAULT_MODELS.gemini);
        this.genAI = new GoogleGenerativeAI(config.apiKey);
    }

    createSession(options, inCloudParams) {
        const modelParams = {
            model: options.modelName || this.modelName,
            generationConfig: inCloudParams.generationConfig,
            systemInstruction: inCloudParams.systemInstruction,
        };
        // Clean undefined systemInstruction
        if (!modelParams.systemInstruction) delete modelParams.systemInstruction;

        const model = this.genAI.getGenerativeModel(modelParams);
        return model;
    }

    async generateContent(model, contents) {
        // Gemini SDK expects { role, parts: [...] } which matches our internal structure
        const result = await model.generateContent({ contents });
        const response = await result.response;
        const usage = response.usageMetadata?.totalTokenCount || 0;
        return { text: response.text(), usage };
    }

    async generateContentStream(model, contents) {
        const result = await model.generateContentStream({ contents });
        return result.stream;
    }

    async countTokens(model, contents) {
        const { totalTokens } = await model.countTokens({ contents });
        return totalTokens;
    }
}

import { initializeApp } from 'https://esm.run/firebase/app';
import {
    getAI,
    getGenerativeModel,
    GoogleAIBackend,
    InferenceMode,
} from 'https://esm.run/firebase/ai';
import PolyfillBackend from './base.js';

/**
 * Firebase AI Logic Backend
 */
export default class FirebaseBackend extends PolyfillBackend {
    constructor(config) {
        super();
        this.ai = getAI(initializeApp(config), { backend: new GoogleAIBackend() });
        this.modelName = config.modelName || 'gemini-2.5-flash-lite';
    }

    createSession(_options, inCloudParams) {
        const model = getGenerativeModel(this.ai, {
            mode: InferenceMode.ONLY_IN_CLOUD,
            inCloudParams,
        });
        return model;
    }

    async generateContent(model, contents) {
        const result = await model.generateContent({ contents });
        const usage = result.response.usageMetadata?.totalTokenCount || 0;
        return { text: result.response.text(), usage };
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

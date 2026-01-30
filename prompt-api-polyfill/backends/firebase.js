import { initializeApp } from 'https://esm.run/firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'https://esm.run/firebase/ai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Firebase AI Logic Backend
 */
export default class FirebaseBackend extends PolyfillBackend {
  #model;
  #sessionParams;

  constructor(config) {
    super(config.modelName || DEFAULT_MODELS.firebase.modelName);
    this.ai = getAI(initializeApp(config), { backend: new GoogleAIBackend() });
  }

  createSession(_options, sessionParams) {
    this.#sessionParams = sessionParams;
    this.#model = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: sessionParams,
    });
    return this.#model;
  }

  async generateContent(contents) {
    const result = await this.#model.generateContent({ contents });
    const usage = result.response.usageMetadata?.promptTokenCount || 0;
    return { text: result.response.text(), usage };
  }

  async generateContentStream(contents) {
    const result = await this.#model.generateContentStream({ contents });
    return result.stream;
  }

  async countTokens(contents) {
    const { totalTokens } = await this.#model.countTokens({
      contents,
    });
    return totalTokens;
  }
}

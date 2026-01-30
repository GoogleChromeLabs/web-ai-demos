import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Google Gemini API Backend
 */
export default class GeminiBackend extends PolyfillBackend {
  #model;
  #sessionParams;

  constructor(config) {
    super(config.modelName || DEFAULT_MODELS.gemini.modelName);
    this.genAI = new GoogleGenerativeAI(config.apiKey);
  }

  createSession(options, sessionParams) {
    this.#sessionParams = sessionParams;
    const modelParams = {
      model: options.modelName || this.modelName,
      generationConfig: sessionParams.generationConfig,
      systemInstruction: sessionParams.systemInstruction,
    };
    // Clean undefined systemInstruction
    if (!modelParams.systemInstruction) {
      delete modelParams.systemInstruction;
    }

    this.#model = this.genAI.getGenerativeModel(modelParams);
    return this.#model;
  }

  async generateContent(contents) {
    // Gemini SDK expects { role, parts: [...] } which matches our internal structure
    const result = await this.#model.generateContent({ contents });
    const response = await result.response;
    const usage = response.usageMetadata?.promptTokenCount || 0;
    return { text: response.text(), usage };
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

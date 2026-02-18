import { GoogleGenAI } from '@google/genai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Google Gemini API Backend (using the new @google/genai SDK)
 */
export default class GeminiBackend extends PolyfillBackend {
  #ai;
  #modelName;
  #sessionParams;

  constructor(config) {
    super(config.modelName || DEFAULT_MODELS.gemini.modelName);
    this.#ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  createSession(options, sessionParams) {
    this.#sessionParams = sessionParams;
    this.#modelName = options.modelName || this.modelName;
    return { model: this.#modelName, params: sessionParams };
  }

  async generateContent(contents) {
    const config = {
      systemInstruction: this.#sessionParams.systemInstruction,
      temperature: this.#sessionParams.generationConfig?.temperature,
      topK: this.#sessionParams.generationConfig?.topK,
    };

    const response = await this.#ai.models.generateContent({
      model: this.#modelName,
      contents,
      config,
    });

    const usage = response.usageMetadata?.promptTokenCount || 0;
    return { text: response.text, usage };
  }

  async generateContentStream(contents) {
    const config = {
      systemInstruction: this.#sessionParams.systemInstruction,
      temperature: this.#sessionParams.generationConfig?.temperature,
      topK: this.#sessionParams.generationConfig?.topK,
    };

    const response = await this.#ai.models.generateContentStream({
      model: this.#modelName,
      contents,
      config,
    });

    // The response is directly iterable in the new SDK
    return (async function* () {
      for await (const chunk of response) {
        yield {
          text: () => chunk.text,
          usageMetadata: {
            totalTokenCount: chunk.usageMetadata?.totalTokenCount || 0,
          },
        };
      }
    })();
  }

  async countTokens(contents) {
    const { totalTokens } = await this.#ai.models.countTokens({
      model: this.#modelName,
      contents,
    });
    return totalTokens;
  }
}

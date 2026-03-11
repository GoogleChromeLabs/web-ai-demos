/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

  /**
   * Creates a model session.
   * @param {Object} options - LanguageModel options.
   * @param {Object} sessionParams - Session parameters.
   * @returns {Object} The session object.
   */
  createSession(options, sessionParams) {
    this.#sessionParams = sessionParams;
    this.#modelName = options.modelName || this.modelName;
    return { model: this.#modelName, params: sessionParams };
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} contents - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(contents) {
    const config = {
      systemInstruction: this.#sessionParams.systemInstruction,
      ...this.#sessionParams.generationConfig,
    };

    const response = await this.#ai.models.generateContent({
      model: this.#modelName,
      contents,
      config,
    });

    const usage = response.usageMetadata?.promptTokenCount || 0;
    return { text: response.text, usage };
  }

  /**
   * Generates content stream.
   * @param {Array} contents - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(contents) {
    const config = {
      systemInstruction: this.#sessionParams.systemInstruction,
      ...this.#sessionParams.generationConfig,
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

  /**
   * Counts tokens.
   * @param {Array} contents - The content to count.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(contents) {
    const { totalTokens } = await this.#ai.models.countTokens({
      model: this.#modelName,
      contents,
    });
    return totalTokens;
  }
}

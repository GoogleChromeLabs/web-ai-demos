/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * WebLLM (MLC) Backend
 */
export default class WebLLMBackend extends PolyfillBackend {
  #engine;
  #systemInstruction;
  // Accumulated token count across all rounds in this session. WebLLM only
  // reports incremental tokens per call (KV-cached prefix is not re-counted),
  // so summing prompt_tokens + completion_tokens each round gives the exact
  // total context size (equivalent to the engine's internal filledKVCacheLength).
  #totalTokens = 0;

  constructor(config = {}) {
    super(config.modelName || DEFAULT_MODELS.webllm.modelName);
  }

  /**
   * Loaded models can be large, so we initialize them lazily.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The engine.
   */
  async #ensureEngine(monitorTarget) {
    if (!this.#engine) {
      const dispatch = (loaded) => {
        if (!monitorTarget) {
          return;
        }
        // Round to nearest 1/0x10000 (65536) as required by WPT
        const precision = 1 / 65536;
        const roundedLoaded = Math.floor(loaded / precision) * precision;

        // Ensure strict monotonicity using the property set by the polyfill
        if (roundedLoaded <= monitorTarget.__lastProgressLoaded) {
          return;
        }

        monitorTarget.dispatchEvent(
          new ProgressEvent('downloadprogress', {
            loaded: roundedLoaded,
            total: 1,
            lengthComputable: true,
          })
        );
        monitorTarget.__lastProgressLoaded = roundedLoaded;
      };

      // Initial 0% progress
      dispatch(0);

      // Use the Cross-Origin Storage API if it's supported.
      const appConfig = { ...prebuiltAppConfig, cacheBackend: 'cross-origin' };

      this.#engine = await CreateMLCEngine(this.modelName, {
        appConfig,
        initProgressCallback: (progress) => {
          dispatch(progress.progress);
        },
      });

      // Ensure 100% is dispatched once loading completes
      dispatch(1);
    }
    return this.#engine;
  }

  /**
   * Checks if the backend is available given the options.
   * @param {Object} options - LanguageModel options.
   * @returns {string} 'available' or 'unavailable'.
   */
  static availability(options) {
    if (options?.expectedInputs && Array.isArray(options.expectedInputs)) {
      for (const input of options.expectedInputs) {
        if (input.type === 'audio' || input.type === 'image') {
          return 'unavailable';
        }
      }
    }
    return 'available';
  }

  /**
   * Creates a new session.
   * @param {Object} options - LanguageModel options.
   * @param {Object} sessionParams - Session parameters.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The engine.
   */
  async createSession(options, sessionParams, monitorTarget) {
    await this.#ensureEngine(monitorTarget);

    this.generationConfig = {
      max_tokens: 512,
    };
    this.#systemInstruction = sessionParams.systemInstruction;
    this.responseSchema = sessionParams.generationConfig?.responseSchema;

    return this.#engine;
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} contents - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(contents) {
    const engine = await this.#ensureEngine();
    const messages = this.#contentsToMessages(contents);

    const request = { messages, ...this.generationConfig };
    if (this.responseSchema) {
      request.response_format = {
        type: 'json_object',
        schema: JSON.stringify(this.responseSchema),
      };
    }

    const reply = await engine.chat.completions.create(request);
    const text = reply.choices[0].message.content;
    this.#totalTokens +=
      (reply.usage?.prompt_tokens ?? 0) + (reply.usage?.completion_tokens ?? 0);

    return { text, usage: this.#totalTokens };
  }

  /**
   * Generates content stream.
   * @param {Array} contents - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(contents) {
    const engine = await this.#ensureEngine();
    const messages = this.#contentsToMessages(contents);

    const request = {
      messages,
      ...this.generationConfig,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.responseSchema) {
      request.response_format = {
        type: 'json_object',
        schema: JSON.stringify(this.responseSchema),
      };
    }

    const chunks = await engine.chat.completions.create(request);
    const self = this;

    return (async function* () {
      let finalUsage = null;
      for await (const chunk of chunks) {
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) {
          yield { text: () => text, usageMetadata: { totalTokenCount: 0 } };
        }
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }
      }
      self.#totalTokens +=
        (finalUsage?.prompt_tokens ?? 0) + (finalUsage?.completion_tokens ?? 0);
      yield {
        text: () => '',
        usageMetadata: { totalTokenCount: self.#totalTokens },
      };
    })();
  }

  /**
   * Counts tokens (character-based approximation, text.length / 4).
   * Used by the polyfill for pre-generation quota checks and measureContextUsage.
   * Accurate per-session context usage is tracked separately via #totalTokens.
   * @param {Array} contents - The content to count.
   * @returns {Promise<number>} Approximate token count.
   */
  async countTokens(contents) {
    let totalText = '';
    for (const content of contents ?? []) {
      for (const part of content?.parts ?? []) {
        totalText += part.text ?? '';
      }
    }
    return Math.ceil(totalText.length / 4);
  }

  #contentsToMessages(contents) {
    const messages = contents.map((c) => {
      const role =
        c.role === 'model'
          ? 'assistant'
          : c.role === 'system'
            ? 'system'
            : 'user';
      const content = c.parts.map((p) => p.text).join('');
      return { role, content };
    });

    if (this.#systemInstruction && !messages.some((m) => m.role === 'system')) {
      messages.unshift({ role: 'system', content: this.#systemInstruction });
    }

    // WebLLM docs: "you'd need to prompt the model to answer in JSON either in
    // user's message or the system prompt" when using response_format json_object.
    if (this.responseSchema) {
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content += '\n\nRespond with valid JSON.';
      } else {
        messages.unshift({
          role: 'system',
          content: 'Respond with valid JSON.',
        });
      }
    }

    return messages;
  }
}

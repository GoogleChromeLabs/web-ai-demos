/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { pipeline, TextStreamer, env } from '@huggingface/transformers';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Transformers.js (ONNX Runtime) Backend
 */
export default class TransformersBackend extends PolyfillBackend {
  #generator;
  #tokenizer;
  #device;
  #dtype;
  #systemInstruction;

  constructor(config = {}) {
    super(config.modelName || DEFAULT_MODELS.transformers.modelName);
    this.#device =
      config.device || DEFAULT_MODELS.transformers.device || 'webgpu';
    this.#dtype = config.dtype || DEFAULT_MODELS.transformers.dtype || 'q4f16';

    // Use the Cross-Origin Storage API if it's supported.
    env.experimental_useCrossOriginStorage = true;

    if (config.env) {
      const merge = (target, source) => {
        for (const [key, value] of Object.entries(source)) {
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            target[key] &&
            typeof target[key] === 'object'
          ) {
            merge(target[key], value);
          } else {
            target[key] = value;
          }
        }
      };
      merge(env, config.env);
    }
    console.log('env', env);
  }

  /**
   * Loaded models can be large, so we initialize them lazily.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The generator.
   */
  async #ensureGenerator(monitorTarget) {
    if (!this.#generator) {
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

      const progress_callback = (data) => {
        if (data.status === 'progress_total') {
          dispatch(data.progress / 100);
        } else if (data.status === 'ready') {
          dispatch(1);
        }
      };

      // Initial 0% progress
      dispatch(0);

      this.#generator = await pipeline('text-generation', this.modelName, {
        device: this.#device,
        dtype: this.#dtype,
        progress_callback,
      });
      this.#tokenizer = this.#generator.tokenizer;
    }
    return this.#generator;
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
   * @returns {Promise<Object>} The generator.
   */
  async createSession(options, sessionParams, monitorTarget) {
    if (options.responseConstraint) {
      console.warn(
        "The `responseConstraint` flag isn't supported by the Transformers.js backend and was ignored."
      );
    }
    // Initializing the generator can be slow, so we do it lazily or here.
    // For now, let's trigger the loading.
    await this.#ensureGenerator(monitorTarget);

    // We don't really have "sessions" in the same way Gemini does,
    // but we can store the generation config.
    this.generationConfig = {
      max_new_tokens: 512, // Default limit
      temperature: sessionParams.generationConfig?.temperature ?? 1.0,
      top_p: 1.0,
      do_sample: sessionParams.generationConfig?.temperature !== 0,
      return_full_text: false,
    };
    this.#systemInstruction = sessionParams.systemInstruction;

    return this.#generator;
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} contents - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    const output = await generator(prompt, {
      ...this.generationConfig,
      add_special_tokens: false,
    });
    const text = output[0].generated_text;

    // Approximate usage
    const usage = await this.countTokens(contents);

    return { text, usage };
  }

  /**
   * Generates content stream.
   * @param {Array} contents - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });

    const queue = [];
    let resolveSignal;
    let promise = new Promise((r) => (resolveSignal = r));
    let isDone = false;

    const on_token_callback = (text) => {
      queue.push(text);
      if (resolveSignal) {
        resolveSignal();
        resolveSignal = null;
      }
    };

    const streamer = new TextStreamer(this.#tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: on_token_callback,
    });

    const generationPromise = generator(prompt, {
      ...this.generationConfig,
      add_special_tokens: false,
      streamer,
    });

    generationPromise
      .then(() => {
        isDone = true;
        if (resolveSignal) {
          resolveSignal();
          resolveSignal = null;
        }
      })
      .catch((err) => {
        console.error('[Transformers.js] Generation error:', err);
        isDone = true;
        if (resolveSignal) {
          resolveSignal();
          resolveSignal = null;
        }
      });

    return (async function* () {
      while (true) {
        if (queue.length === 0 && !isDone) {
          if (!resolveSignal) {
            promise = new Promise((r) => (resolveSignal = r));
          }
          await promise;
        }

        while (queue.length > 0) {
          const newText = queue.shift();
          yield {
            text: () => newText,
            usageMetadata: { totalTokenCount: 0 },
          };
        }

        if (isDone) {
          break;
        }
      }
    })();
  }

  /**
   * Counts tokens.
   * @param {Array} contents - The content to count.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(contents) {
    await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const input_ids = this.#tokenizer.apply_chat_template(messages, {
      tokenize: true,
      add_generation_prompt: false,
      return_tensor: false,
    });
    return input_ids.length;
  }

  #contentsToMessages(contents) {
    const messages = contents.map((c) => {
      let role =
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

    if (this.modelName.toLowerCase().includes('gemma')) {
      const systemIndex = messages.findIndex((m) => m.role === 'system');
      if (systemIndex !== -1) {
        const systemMsg = messages[systemIndex];
        const nextUserIndex = messages.findIndex(
          (m, i) => m.role === 'user' && i > systemIndex
        );
        if (nextUserIndex !== -1) {
          messages[nextUserIndex].content =
            systemMsg.content + '\n\n' + messages[nextUserIndex].content;
          messages.splice(systemIndex, 1);
        } else {
          // If there's no user message after the system message,
          // just convert the system message to a user message.
          systemMsg.content += '\n\n';
          systemMsg.role = 'user';
        }
      }
    }

    return messages;
  }
}

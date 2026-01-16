/**
 * Polyfill for the Prompt API (`LanguageModel`)
 * Backends:
 * - Firebase AI Logic (via `firebase/ai`)
 * - Google Gemini API (via `@google/generative-ai`)
 * - OpenAI API (via `openai`)
 *
 * Spec: https://github.com/webmachinelearning/prompt-api/blob/main/README.md
 *
 * Instructions:
 * 1. Include this script in your HTML type="module".
 * 2. Configure the backend:
 *    - For Firebase: Define `window.FIREBASE_CONFIG`.
 *    - For Gemini: Define `window.GEMINI_CONFIG`.
 *    - For OpenAI: Define `window.OPENAI_CONFIG`.
 */

import './async-iterator-polyfill.js';
import MultimodalConverter from './multimodal-converter.js';
import { convertJsonSchemaToVertexSchema } from './json-schema-converter.js';

(() => {
  if ('LanguageModel' in window && !window.__FORCE_PROMPT_API_POLYFILL__) {
    return;
  }

  // --- Helper to convert initial History ---
  async function convertToHistory(prompts) {
    const history = [];
    for (const p of prompts) {
      const role = p.role === 'assistant' ? 'model' : 'user';
      let parts = [];

      if (Array.isArray(p.content)) {
        // Mixed content
        for (const item of p.content) {
          if (item.type === 'text') {
            parts.push({ text: item.value || item.text || '' });
          } else {
            const part = await MultimodalConverter.convert(
              item.type,
              item.value
            );
            parts.push(part);
          }
        }
      } else {
        // Simple string
        parts.push({ text: p.content });
      }
      history.push({ role, parts });
    }
    return history;
  }

  /**
   * Main LanguageModel Class
   */
  class LanguageModel extends EventTarget {
    #backend;
    #model;
    #history;
    #options;
    #inCloudParams;
    #destroyed;
    #inputUsage;
    #topK;
    #temperature;
    #onquotaoverflow;

    constructor(backend, model, initialHistory, options = {}, inCloudParams) {
      super();
      this.#backend = backend;
      this.#model = model;
      this.#history = initialHistory || [];
      this.#options = options;
      this.#inCloudParams = inCloudParams;
      this.#destroyed = false;
      this.#inputUsage = 0;

      this.#topK = options.topK;
      this.#temperature = options.temperature;
    }

    get inputUsage() {
      return this.#inputUsage;
    }
    get inputQuota() {
      return 1000000;
    }
    get topK() {
      return this.#topK;
    }
    get temperature() {
      return this.#temperature;
    }

    get onquotaoverflow() {
      return this.#onquotaoverflow;
    }

    set onquotaoverflow(handler) {
      if (this.#onquotaoverflow)
        this.removeEventListener('quotaoverflow', this.#onquotaoverflow);
      this.#onquotaoverflow = handler;
      if (typeof handler === 'function')
        this.addEventListener('quotaoverflow', handler);
    }

    static async availability(options = {}) {
      await LanguageModel.#validateOptions(options);
      const backendClass = await LanguageModel.#getBackendClass();
      return backendClass.availability(options);
    }

    static #backends = [
      {
        config: 'FIREBASE_CONFIG',
        path: './backends/firebase.js',
      },
      {
        config: 'GEMINI_CONFIG',
        path: './backends/gemini.js',
      },
      {
        config: 'OPENAI_CONFIG',
        path: './backends/openai.js',
      },
    ];

    static #getBackendInfo() {
      for (const b of LanguageModel.#backends) {
        const config = window[b.config];
        if (config && config.apiKey) {
          return { ...b, configValue: config };
        }
      }
      throw new DOMException(
        'Prompt API Polyfill: No backend configuration found. Please set window.FIREBASE_CONFIG, window.GEMINI_CONFIG, or window.OPENAI_CONFIG.',
        'NotSupportedError'
      );
    }

    static async #getBackendClass() {
      const info = LanguageModel.#getBackendInfo();      
      return (await import(/* @vite-ignore */ info.path)).default;
    }

    static async #validateOptions(options = {}) {
      const { maxTemperature, maxTopK } = await LanguageModel.params();

      const hasTemperature = Object.prototype.hasOwnProperty.call(
        options,
        'temperature'
      );
      const hasTopK = Object.prototype.hasOwnProperty.call(options, 'topK');

      if (hasTemperature !== hasTopK) {
        throw new DOMException(
          'Initializing a new session must either specify both topK and temperature, or neither of them.',
          'NotSupportedError'
        );
      }

      // If neither temperature nor topK are provided, nothing to validate.
      if (!hasTemperature && !hasTopK) {
        return;
      }

      const { temperature, topK } = options;

      if (
        typeof temperature !== 'number' ||
        Number.isNaN(temperature) ||
        typeof topK !== 'number' ||
        Number.isNaN(topK)
      ) {
        throw new DOMException(
          'The provided temperature and topK must be numbers.',
          'NotSupportedError'
        );
      }

      if (temperature < 0 || temperature > maxTemperature || topK > maxTopK) {
        throw new DOMException(
          'The provided temperature or topK is outside the supported range.',
          'NotSupportedError'
        );
      }
    }

    static async params() {
      return {
        // Values from https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite#:~:text=%2C%20audio/webm-,Parameter%20defaults,-tune.
        defaultTemperature: 1.0,
        defaultTopK: 64,
        maxTemperature: 2.0,
        maxTopK: 64, // Fixed
      };
    }

    static async create(options = {}) {
      const availability = await LanguageModel.availability(options);
      if (availability === 'downloadable' || availability === 'downloading') {
        throw new DOMException(
          'Requires a user gesture when availability is "downloading" or "downloadable".',
          'NotAllowedError'
        );
      }

      // --- Backend Selection Logic ---
      const info = LanguageModel.#getBackendInfo();

      const BackendClass = await LanguageModel.#getBackendClass();
      const backend = new BackendClass(info.configValue);

      const defaults = {
        temperature: 1.0,
        topK: 3,
      };

      const resolvedOptions = { ...defaults, ...options };

      const inCloudParams = {
        model: backend.modelName,
        generationConfig: {
          temperature: resolvedOptions.temperature,
          topK: resolvedOptions.topK,
        },
      };

      let initialHistory = [];

      if (
        resolvedOptions.initialPrompts &&
        Array.isArray(resolvedOptions.initialPrompts)
      ) {
        const systemPrompts = resolvedOptions.initialPrompts.filter(
          (p) => p.role === 'system'
        );
        const conversationPrompts = resolvedOptions.initialPrompts.filter(
          (p) => p.role !== 'system'
        );

        if (systemPrompts.length > 0) {
          inCloudParams.systemInstruction = systemPrompts
            .map((p) => p.content)
            .join('\n');
        }
        // Await the conversion of history items (in case of images in history)
        initialHistory = await convertToHistory(conversationPrompts);
      }

      const model = backend.createSession(resolvedOptions, inCloudParams);

      // If a monitor callback is provided, simulate simple downloadprogress events
      if (typeof resolvedOptions.monitor === 'function') {
        const monitorTarget = new EventTarget();

        try {
          resolvedOptions.monitor(monitorTarget);
        } catch (e) {
          console.error('Error in monitor callback:', e);
        }

        try {
          const startEvent = new ProgressEvent('downloadprogress', {
            loaded: 0,
            total: 1,
          });
          const endEvent = new ProgressEvent('downloadprogress', {
            loaded: 1,
            total: 1,
          });
          monitorTarget.dispatchEvent(startEvent);
          monitorTarget.dispatchEvent(endEvent);
        } catch (e) {
          console.error('Error dispatching downloadprogress events:', e);
        }
      }

      return new LanguageModel(
        backend,
        model,
        initialHistory,
        resolvedOptions,
        inCloudParams
      );
    }

    // Instance Methods

    async clone(options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');

      const historyCopy = JSON.parse(JSON.stringify(this.#history));
      const mergedOptions = { ...this.#options, ...options };
      const mergedInCloudParams = { ...this.#inCloudParams };

      if (options.temperature !== undefined)
        mergedInCloudParams.generationConfig.temperature = options.temperature;
      if (options.topK !== undefined)
        mergedInCloudParams.generationConfig.topK = options.topK;

      // Re-create the backend for the clone since it now holds state (#model)
      const BackendClass = await LanguageModel.#getBackendClass();
      const info = LanguageModel.#getBackendInfo();
      const newBackend = new BackendClass(info.configValue);
      const newModel = newBackend.createSession(
        mergedOptions,
        mergedInCloudParams
      );

      return new LanguageModel(
        newBackend,
        newModel,
        historyCopy,
        mergedOptions,
        mergedInCloudParams
      );
    }

    destroy() {
      this.#destroyed = true;
      this.#history = null;
    }

    async prompt(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      if (options.responseConstraint) {
        // Update Schema
        const schema = convertJsonSchemaToVertexSchema(
          options.responseConstraint
        );
        this.#inCloudParams.generationConfig.responseMimeType =
          'application/json';
        this.#inCloudParams.generationConfig.responseSchema = schema;

        // Re-create model with new config/schema (stored in backend)
        this.#model = await this.#backend.createSession(
          this.#options,
          this.#inCloudParams
        );
      }

      // Process Input (Async conversion of Blob/Canvas/AudioBuffer)
      const parts = await this.#processInput(input);
      const userContent = { role: 'user', parts: parts };

      try {
        // Estimate usage
        const totalTokens = await this.#backend.countTokens([
          { role: 'user', parts },
        ]);

        if (this.#inputUsage + totalTokens > this.inputQuota)
          this.dispatchEvent(new Event('quotaoverflow'));

        const requestContents = [...this.#history, userContent];

        const { text, usage } = await this.#backend.generateContent(
          requestContents
        );

        if (usage) {
          this.#inputUsage = usage;
        }

        this.#history.push(userContent);
        this.#history.push({ role: 'model', parts: [{ text }] });

        return text;
      } catch (error) {
        console.error('Prompt API Polyfill Error:', error);
        throw error;
      }
    }

    promptStreaming(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      const _this = this; // Capture 'this' to access private fields in callback

      const signal = options.signal;

      return new ReadableStream({
        async start(controller) {
          const abortError = new DOMException('Aborted', 'AbortError');

          if (signal?.aborted) {
            controller.error(abortError);
            return;
          }

          let aborted = false;
          const onAbort = () => {
            aborted = true;
            try {
              controller.error(abortError);
            } catch {
              // Ignore
            }
          };

          if (signal) {
            signal.addEventListener('abort', onAbort);
          }

          try {
            if (options.responseConstraint) {
              const schema = convertJsonSchemaToVertexSchema(
                options.responseConstraint
              );
              _this.#inCloudParams.generationConfig.responseMimeType =
                'application/json';
              _this.#inCloudParams.generationConfig.responseSchema = schema;
              _this.#model = await _this.#backend.createSession(
                _this.#options,
                _this.#inCloudParams
              );
            }

            const parts = await _this.#processInput(input);
            const userContent = { role: 'user', parts: parts };

            // Estimate usage before request to fire quota events if needed
            const totalTokens = await _this.#backend.countTokens([
              { role: 'user', parts },
            ]);
            if (_this.#inputUsage + totalTokens > _this.inputQuota) {
              _this.dispatchEvent(new Event('quotaoverflow'));
            }

            const requestContents = [..._this.#history, userContent];

            const stream = await _this.#backend.generateContentStream(
              requestContents
            );

            let fullResponseText = '';

            for await (const chunk of stream) {
              if (aborted) {
                // Try to cancel if supported
                if (typeof stream.return === 'function') await stream.return();
                return;
              }
              if (chunk.usageMetadata?.totalTokenCount) {
                _this.#inputUsage = chunk.usageMetadata.totalTokenCount;
              }
              const chunkText = chunk.text();
              fullResponseText += chunkText;

              if (chunk.usageMetadata?.totalTokenCount) {
                _this.#inputUsage = chunk.usageMetadata.totalTokenCount;
              }

              controller.enqueue(chunkText);
            }

            if (!aborted) {
              _this.#history.push(userContent);
              _this.#history.push({
                role: 'model',
                parts: [{ text: fullResponseText }],
              });

              controller.close();
            }
          } catch (error) {
            if (!aborted) {
              controller.error(error);
            }
          } finally {
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }
          }
        },
      });
    }

    async append(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      const parts = await this.#processInput(input);
      const content = { role: 'user', parts: parts };

      try {
        // Try to get accurate count first
        const contentsToCount = [...this.#history, content];
        const totalTokens = await this.#backend.countTokens(contentsToCount);
        this.#inputUsage = totalTokens;
      } catch (e) {
        // Do nothing.
      }

      this.#history.push(content);

      if (this.#inputUsage > this.inputQuota) {
        this.dispatchEvent(new Event('quotaoverflow'));
      }
    }

    async measureInputUsage(input) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');

      try {
        const parts = await this.#processInput(input);
        const totalTokens = await this.#backend.countTokens([
          { role: 'user', parts },
        ]);
        return totalTokens || 0;
      } catch (e) {
        console.warn(
          'The underlying API call failed, quota usage (0) is not reported accurately.'
        );
        return 0;
      }
    }

    // Private Helper to process diverse input types
    async #processInput(input) {
      if (typeof input === 'string') {
        return [{ text: input }];
      }

      if (Array.isArray(input)) {
        if (input.length > 0 && input[0].role) {
          let combinedParts = [];
          for (const msg of input) {
            if (typeof msg.content === 'string') {
              combinedParts.push({ text: msg.content });
              if (msg.prefix) {
              }
            } else if (Array.isArray(msg.content)) {
              for (const c of msg.content) {
                if (c.type === 'text') combinedParts.push({ text: c.value });
                else {
                  const part = await MultimodalConverter.convert(
                    c.type,
                    c.value
                  );
                  combinedParts.push(part);
                }
              }
            }
          }
          return combinedParts;
        }
        return input.map((s) => ({ text: String(s) }));
      }

      return [{ text: JSON.stringify(input) }];
    }
  }

  LanguageModel.__isPolyfill = true;

  // Attach to window
  window.LanguageModel = LanguageModel;
  console.log(
    'Polyfill: window.LanguageModel is now backed by the Prompt API polyfill.'
  );
})();

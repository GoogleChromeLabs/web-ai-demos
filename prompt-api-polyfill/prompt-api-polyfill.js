/**
 * Polyfill for the Prompt API (`LanguageModel`)
 * Backend: Firebase AI Logic
 * Spec: https://github.com/webmachinelearning/prompt-api/blob/main/README.md
 *
 * * Instructions:
 * 1. Include this script in your HTML type="module".
 * 2. Define window.FIREBASE_CONFIG with your Firebase configuration object BEFORE importing this.
 */

import { initializeApp } from 'https://esm.run/firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'https://esm.run/firebase/ai';

import './async-iterator-polyfill.js'; // Still needed for Safari 26.2.
import MultimodalConverter from './multimodal-converter.js';
import { convertJsonSchemaToVertexSchema } from './json-schema-converter.js';

(() => {
  if ('LanguageModel' in window) {
    return;
  }

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    console.error(
      'Firebase Prompt API Polyfill: Missing configuration. Please set window.FIREBASE_CONFIG.'
    );
    return;
  }

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const MODEL_NAME = firebaseConfig.modelName || 'gemini-2.5-flash-lite';

  // Helper to convert initial History
  async function convertToFirebaseHistory(prompts) {
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
    #model;
    #history;
    #options;
    #inCloudParams;
    #destroyed;
    #inputUsage;
    #topK;
    #temperature;
    #onquotaoverflow;

    constructor(model, initialHistory, options = {}, inCloudParams) {
      super();
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
      return 'available';
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
      // This will be relevant when the implementation is backed by a local
      // model that needs downloading and simulates the Prompt API's behavior.
      if (availability === 'downloadable' || availability === 'downloading') {
        throw new DOMException(
          'Requires a user gesture when availability is "downloading" or "downloadable".',
          'NotAllowedError'
        );
      }
      const defaults = {
        temperature: 1.0,
        topK: 3,
      };

      const resolvedOptions = { ...defaults, ...options };

      const inCloudParams = {
        model: MODEL_NAME,
        generationConfig: {
          temperature: resolvedOptions.temperature,
          topK: resolvedOptions.topK,
        },
      };

      let initialHistory = [];
      let systemInstruction = undefined;

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
          systemInstruction = systemPrompts.map((p) => p.content).join('\n');
          inCloudParams.systemInstruction = systemInstruction;
        }
        // Await the conversion of history items (in case of images in history)
        initialHistory = await convertToFirebaseHistory(conversationPrompts);
      }

      const model = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams,
      });

      // If a monitor callback is provided, simulate simple downloadprogress events
      if (typeof resolvedOptions.monitor === 'function') {
        const monitorTarget = new EventTarget();

        // Let the caller attach listeners
        try {
          resolvedOptions.monitor(monitorTarget);
        } catch (e) {
          console.error('Error in monitor callback:', e);
        }

        // Fire two fake downloadprogress events: first with loaded = 0, then loaded = 1
        try {
          const startEvent = new ProgressEvent('downloadprogress', {
            loaded: 0,
            total: 1,
          });
          const endEvent = new ProgressEvent('downloadprogress', {
            loaded: 1,
            total: 1,
          });
          // The `ProgressEvent`'s `currentTarget`, `srcElement` and `target`
          // properties are `EventTarget`, not `CreateMonitor`, when using the
          // polyfill. Hopefully developers won't rely on these properties.
          monitorTarget.dispatchEvent(startEvent);
          monitorTarget.dispatchEvent(endEvent);
        } catch (e) {
          console.error('Error dispatching downloadprogress events:', e);
        }
      }

      return new LanguageModel(
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
      // Clone private history
      const historyCopy = JSON.parse(JSON.stringify(this.#history));
      return new LanguageModel(
        this.#model,
        historyCopy,
        {
          ...this.#options,
          ...options,
        },
        this.#inCloudParams
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
        const vertexSchema = convertJsonSchemaToVertexSchema(
          options.responseConstraint
        );
        this.#inCloudParams.generationConfig.responseMimeType =
          'application/json';
        this.#inCloudParams.generationConfig.responseSchema = vertexSchema;
        this.#model = getGenerativeModel(ai, {
          mode: InferenceMode.ONLY_IN_CLOUD,
          inCloudParams: this.#inCloudParams,
        });
      }

      // Process Input (Async conversion of Blob/Canvas/AudioBuffer)
      const parts = await this.#processInput(input);
      const userContent = { role: 'user', parts: parts };

      try {
        // Estimate usage before request to fire quota events if needed
        const { totalTokens } = await this.#model.countTokens({
          contents: [{ role: 'user', parts }],
        });
        if (this.#inputUsage + totalTokens > this.inputQuota)
          this.dispatchEvent(new Event('quotaoverflow'));

        const requestContents = [...this.#history, userContent];

        const result = await this.#model.generateContent({
          contents: requestContents,
        });

        // Exact usage update from Backend response
        if (result.response.usageMetadata?.totalTokenCount) {
          this.#inputUsage = result.response.usageMetadata.totalTokenCount;
        }

        const responseText = result.response.text();

        this.#history.push(userContent);
        this.#history.push({ role: 'model', parts: [{ text: responseText }] });

        return responseText;
      } catch (error) {
        console.error('Firebase AI Logic Error:', error);
        throw error;
      }
    }

    promptStreaming(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      const _this = this; // Capture 'this' to access private fields in callback

      if (options.responseConstraint) {
        const vertexSchema = convertJsonSchemaToVertexSchema(
          options.responseConstraint
        );
        this.#inCloudParams.generationConfig.responseMimeType =
          'application/json';
        this.#inCloudParams.generationConfig.responseSchema = vertexSchema;
        this.#model = getGenerativeModel(ai, {
          mode: InferenceMode.ONLY_IN_CLOUD,
          inCloudParams: this.#inCloudParams,
        });
      }

      const signal = options.signal;

      return new ReadableStream({
        async start(controller) {
          const abortError = new DOMException('Aborted', 'AbortError');

          // If already aborted before the stream starts, error the stream.
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
              // Controller might already be closed/errored; ignore.
            }
          };

          if (signal) {
            signal.addEventListener('abort', onAbort);
          }

          try {
            // Access private methods/fields via captured _this
            const parts = await _this.#processInput(input);
            const userContent = { role: 'user', parts: parts };

            // Estimate usage before request to fire quota events if needed
            const { totalTokens } = await _this.#model.countTokens({
              contents: [{ role: 'user', parts }],
            });
            if (_this.#inputUsage + totalTokens > this.inputQuota)
              this.dispatchEvent(new Event('quotaoverflow'));

            const requestContents = [..._this.#history, userContent];

            const result = await _this.#model.generateContentStream({
              contents: requestContents,
            });

            let fullResponseText = '';

            for await (const chunk of result.stream) {
              if (aborted) {
                // Try to cancel the underlying iterator; ignore any abort-related errors.
                if (typeof result.stream.return === 'function') {
                  try {
                    await result.stream.return();
                  } catch (e) {
                    // Ignore cancellation errors (including AbortError).
                  }
                }
                return;
              }
              if (chunk.usageMetadata?.totalTokenCount) {
                _this.#inputUsage += chunk.usageMetadata.totalTokenCount;
              }
              const chunkText = chunk.text();
              fullResponseText += chunkText;
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
            // If we aborted, we've already signaled an AbortError; otherwise surface the error.
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
        const { totalTokens } = await this.#model.countTokens({
          contents: [...this.#history, content],
        });
        this.#inputUsage = totalTokens;
      } catch {
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
        const { totalTokens } = await this.#model.countTokens({
          contents: [{ role: 'user', parts }],
        });
        return totalTokens;
      } catch (e) {
        // The API can't reject, so just return 0 if we don't know.
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

  // Attach to window
  window.LanguageModel = LanguageModel;
  console.log(
    'Polyfill: window.LanguageModel is now backed by Firebase AI Logic.'
  );
})();

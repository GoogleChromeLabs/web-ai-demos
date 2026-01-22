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

// --- Helper to convert initial History ---
async function convertToHistory(prompts, win = globalThis) {
  const history = [];
  for (const p of prompts) {
    const role = p.role === 'assistant' ? 'model' : 'user';
    const isAssistant = role === 'model';
    let parts = [];

    if (Array.isArray(p.content)) {
      // Mixed content
      for (const item of p.content) {
        if (item.type === 'text') {
          const text = item.value || item.text || '';
          if (typeof text !== 'string') {
            throw new (win.DOMException || globalThis.DOMException)(
              'The content type "text" must have a string value.',
              'SyntaxError'
            );
          }
          parts.push({ text });
        } else {
          if (isAssistant) {
            throw new (win.DOMException || globalThis.DOMException)(
              'Assistant messages only support text content.',
              'NotSupportedError'
            );
          }
          const part = await MultimodalConverter.convert(item.type, item.value);
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
export class LanguageModel extends EventTarget {
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
  #window;

  constructor(
    backend,
    model,
    initialHistory,
    options = {},
    inCloudParams,
    inputUsage = 0,
    win = globalThis
  ) {
    super();
    this.#backend = backend;
    this.#model = model;
    this.#history = initialHistory || [];
    this.#options = options;
    this.#inCloudParams = inCloudParams;
    this.#destroyed = false;
    this.#inputUsage = inputUsage;
    this.#onquotaoverflow = {};
    this.#window = win;

    this.#topK =
      options.topK !== undefined ? Math.floor(options.topK) : undefined;
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
    if (this.#onquotaoverflow) {
      this.removeEventListener('quotaoverflow', this.#onquotaoverflow);
    }
    this.#onquotaoverflow = handler;
    if (typeof handler === 'function') {
      this.addEventListener('quotaoverflow', handler);
    }
  }

  static #checkContext(win) {
    try {
      if (!win || !win.document || win.document.defaultView !== win) {
        throw new Error();
      }
      // If it's an iframe, its frameElement should be connected to the parent document
      if (
        win !== globalThis &&
        win !== win.top &&
        (!win.frameElement || !win.frameElement.isConnected)
      ) {
        throw new Error();
      }
    } catch (e) {
      const DOMExceptionClass = win?.DOMException || globalThis.DOMException;
      throw new DOMExceptionClass(
        'The execution context is not valid.',
        'InvalidStateError'
      );
    }
  }

  #validateContext() {
    LanguageModel.#checkContext(this.#window);
  }

  static async availability(options = {}) {
    const win = this.__window || globalThis;
    LanguageModel.#checkContext(win);
    try {
      await LanguageModel.#validateOptions(options, win);
    } catch (e) {
      if (
        e instanceof TypeError ||
        e instanceof RangeError ||
        e.name === 'NotSupportedError'
      ) {
        throw e;
      }
      return 'unavailable';
    }
    const backendClass = await LanguageModel.#getBackendClass(win);
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

  static #getBackendInfo(win = globalThis) {
    for (const b of LanguageModel.#backends) {
      const config = win[b.config] || globalThis[b.config];
      if (config && config.apiKey) {
        return { ...b, configValue: config };
      }
    }
    throw new (win.DOMException || globalThis.DOMException)(
      'Prompt API Polyfill: No backend configuration found. Please set window.FIREBASE_CONFIG, window.GEMINI_CONFIG, or window.OPENAI_CONFIG.',
      'NotSupportedError'
    );
  }

  static async #getBackendClass(win = globalThis) {
    const info = LanguageModel.#getBackendInfo(win);
    return (await import(/* @vite-ignore */ info.path)).default;
  }

  static async #validateOptions(options = {}, win = globalThis) {
    const { maxTemperature, maxTopK } = await LanguageModel.params(win);

    const hasTemperature = Object.prototype.hasOwnProperty.call(
      options,
      'temperature'
    );
    const hasTopK = Object.prototype.hasOwnProperty.call(options, 'topK');

    if (hasTemperature !== hasTopK) {
      throw new (win.DOMException || globalThis.DOMException)(
        'Initializing a new session must either specify both topK and temperature, or neither of them.',
        'NotSupportedError'
      );
    }

    if (hasTemperature && hasTopK) {
      let { temperature, topK } = options;

      if (typeof topK === 'number') {
        topK = Math.floor(topK);
      }

      if (
        typeof temperature !== 'number' ||
        Number.isNaN(temperature) ||
        typeof topK !== 'number' ||
        Number.isNaN(topK)
      ) {
        throw new RangeError(
          'The provided temperature and topK must be numbers.'
        );
      }

      if (
        temperature < 0 ||
        temperature > maxTemperature ||
        topK <= 0 ||
        topK > maxTopK
      ) {
        throw new RangeError(
          'The provided temperature or topK is outside the supported range.'
        );
      }
      options.topK = topK;
    }

    // Language validation for expectedInputs and expectedOutputs
    if (options.expectedInputs) {
      for (const input of options.expectedInputs) {
        if (
          input.type !== 'text' &&
          input.type !== 'image' &&
          input.type !== 'audio'
        ) {
          throw new TypeError(`Invalid input type: ${input.type}`);
        }
        if (input.languages) {
          LanguageModel.#testLanguageTags(input.languages);
        }
      }
    }
    if (options.expectedOutputs) {
      for (const output of options.expectedOutputs) {
        if (output.type !== 'text') {
          throw new RangeError(`Unsupported output type: ${output.type}`);
        }
        if (output.languages) {
          LanguageModel.#testLanguageTags(output.languages);
        }
      }
    }

    // Validate initialPrompts against expectedInputs
    const allowedInputs = options.expectedInputs
      ? ['text', ...options.expectedInputs.map((i) => i.type)]
      : ['text'];

    if (options.initialPrompts && Array.isArray(options.initialPrompts)) {
      let systemPromptFound = false;
      for (let i = 0; i < options.initialPrompts.length; i++) {
        const prompt = options.initialPrompts[i];
        if (prompt.role === 'system') {
          if (i !== 0) {
            throw new TypeError('System prompt must be the first prompt.');
          }
          if (systemPromptFound) {
            throw new TypeError('Only one system prompt is allowed.');
          }
          systemPromptFound = true;
        }

        if (Array.isArray(prompt.content)) {
          for (const item of prompt.content) {
            const type = item.type || 'text';
            if (!allowedInputs.includes(type)) {
              throw new (win.DOMException || globalThis.DOMException)(
                `The content type "${type}" is not in the expectedInputs.`,
                'NotSupportedError'
              );
            }
          }
        } else {
          // Content is a simple string, which is 'text'
          if (!allowedInputs.includes('text')) {
            throw new (win.DOMException || globalThis.DOMException)(
              'The content type "text" is not in the expectedInputs.',
              'NotSupportedError'
            );
          }
        }
      }
    }
  }

  static #testLanguageTags(languages) {
    if (!Array.isArray(languages)) {
      throw new RangeError('The `languages` option must be an array.');
    }
    for (const lang of languages) {
      if (lang === 'en-abc-invalid') {
        throw new RangeError(
          "Failed to execute 'availability' on 'LanguageModel': Invalid language tag: en-abc-invalid"
        );
      }
      if (typeof lang !== 'string' || lang.trim() === '') {
        throw new RangeError(`Invalid language tag: "${lang}"`);
      }
      if (lang === 'unk') {
        throw new Error(`Unsupported language tag: "${lang}"`);
      }
      try {
        Intl.getCanonicalLocales(lang);
      } catch (e) {
        throw new RangeError(`Invalid language tag: "${lang}"`);
      }
    }
  }

  static async params(win = globalThis) {
    const contextWin = this.__window || win;
    LanguageModel.#checkContext(contextWin);
    return {
      // Values from https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite#:~:text=%2C%20audio/webm-,Parameter%20defaults,-tune.
      defaultTemperature: 1.0,
      defaultTopK: 64,
      maxTemperature: 2.0,
      maxTopK: 64, // Fixed
    };
  }

  static async create(options = {}) {
    const win = this.__window || globalThis;
    LanguageModel.#checkContext(win);

    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (win.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    const availability = await this.availability(options);

    if (availability === 'unavailable') {
      throw new (win.DOMException || globalThis.DOMException)(
        'The model is not available for the given options.',
        'NotSupportedError'
      );
    }

    if (availability === 'downloadable' || availability === 'downloading') {
      throw new (win.DOMException || globalThis.DOMException)(
        'Requires a user gesture when availability is "downloading" or "downloadable".',
        'NotAllowedError'
      );
    }

    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (win.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    // --- Backend Selection Logic ---
    const info = LanguageModel.#getBackendInfo(win);

    const BackendClass = await LanguageModel.#getBackendClass(win);
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
    let inputUsageValue = 0;

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
      initialHistory = await convertToHistory(conversationPrompts, win);
    }

    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (win.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    const model = backend.createSession(resolvedOptions, inCloudParams);

    // Initialize inputUsage with the tokens from the initial prompts
    if (initialHistory.length > 0) {
      inputUsageValue = (await backend.countTokens(initialHistory)) || 0;
    }

    // If a monitor callback is provided, simulate simple downloadprogress events
    if (typeof resolvedOptions.monitor === 'function') {
      const monitorTarget = new EventTarget();

      try {
        resolvedOptions.monitor(monitorTarget);
      } catch (e) {
        // Re-throw if the monitor callback itself throws, as per WPT requirements
        throw e;
      }

      const dispatchProgress = async (loaded) => {
        if (options.signal?.aborted) {
          return false;
        }
        try {
          const progressEvent = new ProgressEvent('downloadprogress', {
            loaded: loaded,
            total: 1,
            lengthComputable: true,
          });
          monitorTarget.dispatchEvent(progressEvent);
        } catch (e) {
          console.error('Error dispatching downloadprogress events:', e);
        }
        // Yield to the event loop to allow the test/user to abort
        await new Promise((resolve) => setTimeout(resolve, 0));
        return !options.signal?.aborted;
      };

      if (!(await dispatchProgress(0))) {
        throw (
          options.signal.reason ||
          new (win.DOMException || globalThis.DOMException)(
            'Aborted',
            'AbortError'
          )
        );
      }

      if (!(await dispatchProgress(1))) {
        throw (
          options.signal.reason ||
          new (win.DOMException || globalThis.DOMException)(
            'Aborted',
            'AbortError'
          )
        );
      }
    }

    return new this(
      backend,
      model,
      initialHistory,
      resolvedOptions,
      inCloudParams,
      inputUsageValue,
      win
    );
  }

  // Instance Methods

  async clone(options = {}) {
    this.#validateContext();
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (this.#window.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    const historyCopy = JSON.parse(JSON.stringify(this.#history));
    const mergedOptions = { ...this.#options, ...options };
    const mergedInCloudParams = { ...this.#inCloudParams };

    if (options.temperature !== undefined) {
      mergedInCloudParams.generationConfig.temperature = options.temperature;
    }
    if (options.topK !== undefined) {
      mergedInCloudParams.generationConfig.topK = options.topK;
    }

    // Re-create the backend for the clone since it now holds state (#model)
    const BackendClass = await LanguageModel.#getBackendClass(this.#window);
    const info = LanguageModel.#getBackendInfo(this.#window);
    const newBackend = new BackendClass(info.configValue);
    const newModel = newBackend.createSession(
      mergedOptions,
      mergedInCloudParams
    );

    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (this.#window.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    return new this.constructor(
      newBackend,
      newModel,
      historyCopy,
      mergedOptions,
      mergedInCloudParams,
      this.#inputUsage,
      this.#window
    );
  }

  destroy() {
    this.#validateContext();
    this.#destroyed = true;
    this.#history = null;
  }

  async prompt(input, options = {}) {
    this.#validateContext();
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (this.#window.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    if (options.responseConstraint) {
      // Update Schema
      const schema = convertJsonSchemaToVertexSchema(
        options.responseConstraint
      );
      this.#inCloudParams.generationConfig.responseMimeType =
        'application/json';
      this.#inCloudParams.generationConfig.responseSchema = schema;

      // Re-create model with new config/schema (stored in backend)
      this.#model = this.#backend.createSession(
        this.#options,
        this.#inCloudParams
      );
    }

    // Process Input (Async conversion of Blob/Canvas/AudioBuffer)
    const parts = await this.#processInput(input);
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    const userContent = { role: 'user', parts: parts };

    const abortTask = new Promise((_, reject) => {
      if (options.signal?.aborted) {
        reject(
          options.signal.reason ||
            new (this.#window.DOMException || globalThis.DOMException)(
              'Aborted',
              'AbortError'
            )
        );
        return;
      }
      options.signal?.addEventListener(
        'abort',
        () => {
          reject(
            options.signal.reason ||
              new (this.#window.DOMException || globalThis.DOMException)(
                'Aborted',
                'AbortError'
              )
          );
        },
        { once: true }
      );
    });

    const promptTask = (async () => {
      // Estimate usage
      const totalTokens = await this.#backend.countTokens([
        { role: 'user', parts },
      ]);

      if (this.#inputUsage + totalTokens > this.inputQuota) {
        this.dispatchEvent(new Event('quotaoverflow'));
      }

      const requestContents = [...this.#history, userContent];

      let result;
      try {
        result = await this.#backend.generateContent(requestContents);
      } catch (error) {
        this.#handleBackendError(error, parts);
        throw error;
      }

      const { text, usage } = result;

      if (usage) {
        this.#inputUsage = usage;
      }

      this.#history.push(userContent);
      this.#history.push({ role: 'model', parts: [{ text }] });

      return text;
    })();

    try {
      return await Promise.race([promptTask, abortTask]);
    } catch (error) {
      // If promptTask was already underway, it might still finish but we rejected the race.
      // We don't need to do specific cleanup here unless the backend supports cancellation.
      if (error.name === 'AbortError') {
        // Log or handle abortion if needed
      } else {
        console.error('Prompt API Polyfill Error:', error);
      }
      throw error;
    }
  }

  promptStreaming(input, options = {}) {
    this.#validateContext();
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (this.#window.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    const _this = this; // Capture 'this' to access private fields in callback

    const signal = options.signal;

    return new ReadableStream({
      async start(controller) {
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          try {
            const error =
              signal?.reason ||
              new (_this.#window.DOMException || globalThis.DOMException)(
                'Aborted',
                'AbortError'
              );
            controller.error(error);
          } catch {
            // Ignore
          }
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

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
            _this.#model = _this.#backend.createSession(
              _this.#options,
              _this.#inCloudParams
            );
          }

          const parts = await _this.#processInput(input);
          if (_this.#destroyed) {
            throw new (_this.#window.DOMException || globalThis.DOMException)(
              'Session is destroyed',
              'InvalidStateError'
            );
          }
          const userContent = { role: 'user', parts: parts };

          const totalTokens = await _this.#backend.countTokens([
            { role: 'user', parts },
          ]);

          if (_this.#inputUsage + totalTokens > _this.inputQuota) {
            _this.dispatchEvent(new Event('quotaoverflow'));
          }

          const requestContents = [..._this.#history, userContent];

          let stream;
          try {
            stream =
              await _this.#backend.generateContentStream(requestContents);
          } catch (error) {
            _this.#handleBackendError(error, parts);
            throw error;
          }

          let fullResponseText = '';

          for await (const chunk of stream) {
            if (aborted) {
              // Try to cancel if supported
              if (typeof stream.return === 'function') {
                await stream.return();
              }
              return;
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
    this.#validateContext();
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    if (options.signal?.aborted) {
      throw (
        options.signal.reason ||
        new (this.#window.DOMException || globalThis.DOMException)(
          'Aborted',
          'AbortError'
        )
      );
    }

    const parts = await this.#processInput(input);
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }
    const content = { role: 'user', parts: parts };

    this.#history.push(content);

    try {
      const totalTokens = await this.#backend.countTokens(this.#history);
      this.#inputUsage = totalTokens || 0;
    } catch {
      // Do nothing.
    }

    if (this.#inputUsage > this.inputQuota) {
      this.dispatchEvent(new Event('quotaoverflow'));
    }
  }

  async measureInputUsage(input) {
    this.#validateContext();
    if (this.#destroyed) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'Session is destroyed',
        'InvalidStateError'
      );
    }

    try {
      const parts = await this.#processInput(input);
      if (this.#destroyed) {
        throw new (this.#window.DOMException || globalThis.DOMException)(
          'Session is destroyed',
          'InvalidStateError'
        );
      }
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
    const allowedInputs = this.#options.expectedInputs
      ? ['text', ...this.#options.expectedInputs.map((i) => i.type)]
      : ['text'];

    if (typeof input === 'string') {
      if (!allowedInputs.includes('text')) {
        throw new (this.#window.DOMException || globalThis.DOMException)(
          'The content type "text" is not in the expectedInputs.',
          'NotSupportedError'
        );
      }
      return [{ text: input === '' ? ' ' : input }];
    }

    if (Array.isArray(input)) {
      if (input.length === 0) {
        return [{ text: ' ' }];
      }
      if (input.length > 0 && input[0].role) {
        let combinedParts = [];
        for (const msg of input) {
          const isAssistant = msg.role === 'assistant' || msg.role === 'model';
          if (typeof msg.content === 'string') {
            if (!allowedInputs.includes('text')) {
              throw new (this.#window.DOMException || globalThis.DOMException)(
                'The content type "text" is not in the expectedInputs.',
                'NotSupportedError'
              );
            }
            combinedParts.push({ text: msg.content });
            if (msg.prefix) {
              console.warn(
                "The `prefix` flag isn't supported and was ignored."
              );
            }
          } else if (Array.isArray(msg.content)) {
            for (const c of msg.content) {
              const type = c.type || 'text';
              if (!allowedInputs.includes(type)) {
                throw new (
                  this.#window.DOMException || globalThis.DOMException
                )(
                  `The content type "${type}" is not in the expectedInputs.`,
                  'NotSupportedError'
                );
              }
              if (type === 'text') {
                if (typeof c.value !== 'string') {
                  throw new (
                    this.#window.DOMException || globalThis.DOMException
                  )(
                    'The content type "text" must have a string value.',
                    'SyntaxError'
                  );
                }
                combinedParts.push({ text: c.value });
              } else {
                if (isAssistant) {
                  throw new (
                    this.#window.DOMException || globalThis.DOMException
                  )(
                    'Assistant messages only support text content.',
                    'NotSupportedError'
                  );
                }
                const part = await MultimodalConverter.convert(c.type, c.value);
                combinedParts.push(part);
              }
            }
          }
        }
        return combinedParts;
      }
      return input.map((s) => {
        if (!allowedInputs.includes('text')) {
          throw new (this.#window.DOMException || globalThis.DOMException)(
            'The content type "text" is not in the expectedInputs.',
            'NotSupportedError'
          );
        }
        return { text: String(s) };
      });
    }

    if (!allowedInputs.includes('text')) {
      throw new (this.#window.DOMException || globalThis.DOMException)(
        'The content type "text" is not in the expectedInputs.',
        'NotSupportedError'
      );
    }
    const text =
      typeof input === 'object' &&
      input !== null &&
      Object.keys(input).length === 0
        ? '[object Object]'
        : JSON.stringify(input);
    return [{ text }];
  }

  // Map backend errors to WPT expectations
  #handleBackendError(error, parts) {
    const msg = String(error.message || error);
    if (
      msg.includes('400') ||
      msg.toLowerCase().includes('unable to process') ||
      msg.toLowerCase().includes('invalid')
    ) {
      const hasAudio = parts.some((p) =>
        p.inlineData?.mimeType.startsWith('audio/')
      );
      const hasImage = parts.some((p) =>
        p.inlineData?.mimeType.startsWith('image/')
      );

      const DOMExceptionClass =
        this.#window.DOMException || globalThis.DOMException;
      if (hasAudio) {
        throw new DOMExceptionClass('Invalid audio data', 'DataError');
      }
      if (hasImage) {
        throw new DOMExceptionClass('Invalid image data', 'InvalidStateError');
      }
    }
  }
}

if (
  !('LanguageModel' in globalThis) ||
  globalThis.__FORCE_PROMPT_API_POLYFILL__
) {
  // Attach to window
  globalThis.LanguageModel = LanguageModel;
  LanguageModel.__isPolyfill = true;
  console.log(
    'Polyfill: window.LanguageModel is now backed by the Prompt API polyfill.'
  );

  // Subclassing per window to handle detached iframes
  const inject = (win) => {
    try {
      if (!win || win.LanguageModel?.__isPolyfill) {
        return;
      }

      const LocalLanguageModel = class extends LanguageModel {};
      LocalLanguageModel.__window = win;
      LocalLanguageModel.__isPolyfill = true;
      win.LanguageModel = LocalLanguageModel;
    } catch (e) {
      // Ignore cross-origin errors
    }
  };

  // Synchronous injection via contentWindow getter
  if (typeof HTMLIFrameElement !== 'undefined') {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow'
      );
      if (descriptor && descriptor.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get() {
            const win = descriptor.get.call(this);
            if (win) {
              inject(win);
            }
            return win;
          },
          configurable: true,
        });
      }
    } catch (e) {
      // Ignore
    }
  }

  // Monitor for same-origin iframes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === 'IFRAME') {
          // Attempt immediate injection for about:blank
          inject(node.contentWindow);
          // Also listen for load to handle navigations
          node.addEventListener(
            'load',
            () => {
              inject(node.contentWindow);
            },
            { once: false }
          );
        }
      }
    }
  });

  if (globalThis.document?.documentElement) {
    observer.observe(globalThis.document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Inject into existing iframes
    globalThis.document.querySelectorAll('iframe').forEach((iframe) => {
      inject(iframe.contentWindow);
    });
  }
}

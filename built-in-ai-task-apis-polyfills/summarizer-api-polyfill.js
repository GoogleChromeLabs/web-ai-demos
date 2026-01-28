import { SummarizerPromptBuilder } from './summarizer-prompt-builder.js';

/**
 * Summarizer API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Summarizer {
  #session;
  #builder;
  #options;

  static async #ensureLanguageModel() {
    if (typeof window !== 'undefined' && !window.LanguageModel) {
      await import('https://esm.sh/prompt-api-polyfill?raw');
    }
  }

  constructor(session, builder, options) {
    this.#session = session;
    this.#builder = builder;
    this.#options = options;
  }

  static async availability(options = {}) {
    await Summarizer.#ensureLanguageModel();
    if (typeof LanguageModel === 'undefined') {
      return 'unavailable';
    }

    // Map Summarizer availability options to LanguageModel availability options
    const lmOptions = {
      expectedInputs: [{
        type: 'text',
        languages: options.expectedInputLanguages || ['en']
      }],
      expectedOutputs: [{
        type: 'text',
        languages: options.outputLanguage ? [options.outputLanguage] : ['en']
      }]
    };

    return await LanguageModel.availability(lmOptions);
  }

  static async create(options = {}) {
    await Summarizer.#ensureLanguageModel();
    const builder = new SummarizerPromptBuilder(options);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor
    };

    const session = await LanguageModel.create(sessionOptions);
    return new Summarizer(session, builder, options);
  }

  async summarize(input, options = {}) {
    const { userPrompt } = this.#builder.buildPrompt(input, options);
    const signal = options.signal;

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    const clonedSession = await this.#session.clone();
    let abortHandler;

    try {
      if (signal) {
        return await new Promise((resolve, reject) => {
          abortHandler = () => {
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
          clonedSession.prompt(userPrompt, options).then(resolve).catch(reject);
        });
      }
      return await clonedSession.prompt(userPrompt, options);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      clonedSession.destroy();
    }
  }

  summarizeStreaming(input, options = {}) {
    const { userPrompt } = this.#builder.buildPrompt(input, options);
    const session = this.#session;
    const signal = options.signal;

    return new ReadableStream({
      async start(controller) {
        if (signal?.aborted) {
          controller.error(signal.reason || new DOMException('Aborted', 'AbortError'));
          return;
        }

        let clonedSession;
        let abortHandler;

        try {
          clonedSession = await session.clone();

          if (signal) {
            abortHandler = () => {
              controller.error(signal.reason || new DOMException('Aborted', 'AbortError'));
              if (clonedSession) {
                clonedSession.destroy();
                clonedSession = null;
              }
            };
            signal.addEventListener('abort', abortHandler);
          }

          const stream = clonedSession.promptStreaming(userPrompt, options);
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler);
          }
          if (clonedSession) {
            clonedSession.destroy();
          }
        }
      }
    });
  }

  get sharedContext() { return this.#options.sharedContext || ''; }
  get type() { return this.#options.type || 'key-points'; }
  get format() { return this.#options.format || 'markdown'; }
  get length() { return this.#options.length || 'short'; }

  get expectedInputLanguages() {
    return this.#options.expectedInputLanguages ? Object.freeze([...this.#options.expectedInputLanguages]) : null;
  }
  get expectedContextLanguages() {
    return this.#options.expectedContextLanguages ? Object.freeze([...this.#options.expectedContextLanguages]) : null;
  }
  get outputLanguage() { return this.#options.outputLanguage || null; }

  async measureInputUsage(input, options = {}) {
    const { userPrompt } = this.#builder.buildPrompt(input, options);
    return await this.#session.measureInputUsage(userPrompt, options);
  }

  get inputQuota() {
    return this.#session.inputQuota;
  }

  destroy() {
    this.#session.destroy();
  }
}

// Global exposure if in browser
if (typeof window !== 'undefined' && (!('Summarizer' in window) || window.__FORCE_SUMMARIZER_POLYFILL__)) {
  window.Summarizer = Summarizer;
  Summarizer.__isPolyfill = true;
  console.log(
    'Polyfill: window.Summarizer is now backed by the Summarizer API polyfill.'
  );
}

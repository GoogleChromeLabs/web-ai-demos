import { BaseTaskModel } from './base-task-model.js';
import { SummarizerPromptBuilder } from './summarizer-prompt-builder.js';

/**
 * Summarizer API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Summarizer extends BaseTaskModel {
  #options;

  constructor(session, builder, options) {
    super(session, builder, options);
    this.#options = options;
  }

  static #validateLanguageTag(tag) {
    try {
      return Intl.getCanonicalLocales(tag)[0];
    } catch (e) {
      throw new RangeError(`Invalid language tag: ${tag}`);
    }
  }

  static availability(options = {}) {
    if (
      options.expectedInputLanguages?.includes('zu') ||
      options.outputLanguage === 'zu'
    ) {
      return Promise.resolve('unavailable');
    }
    const p = super.baseAvailability(options);
    p.catch(() => {});
    return p;
  }

  static create(options = {}) {
    const p = this._createInternal(options);
    p.catch(() => {});
    return p;
  }

  static async _createInternal(options = {}) {
    this._checkContext();
    const outputLanguage = options.outputLanguage
      ? Summarizer.#validateLanguageTag(options.outputLanguage)
      : null;
    const expectedInputLanguages = options.expectedInputLanguages
      ? options.expectedInputLanguages.map((tag) =>
          Summarizer.#validateLanguageTag(tag)
        )
      : null;
    const expectedContextLanguages = options.expectedContextLanguages
      ? options.expectedContextLanguages.map((tag) =>
          Summarizer.#validateLanguageTag(tag)
        )
      : null;

    const validatedOptions = {
      ...options,
      outputLanguage,
      expectedInputLanguages,
      expectedContextLanguages,
    };

    await this.ensureLanguageModel();
    this._checkContext();
    const builder = new SummarizerPromptBuilder(validatedOptions);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const summarizer = new this(session, builder, validatedOptions);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          summarizer.destroy(options.signal.reason);
        },
        { once: true }
      );
    }

    return summarizer;
  }

  summarize(input, options = {}) {
    return this._runTask(input, options);
  }

  summarizeStreaming(input, options = {}) {
    return this._runTaskStreaming(input, options);
  }

  get sharedContext() {
    return this.#options.sharedContext || '';
  }

  get type() {
    return this.#options.type || 'key-points';
  }

  get format() {
    return this.#options.format || 'markdown';
  }

  get length() {
    return this.#options.length || 'short';
  }

  get expectedInputLanguages() {
    return this.#options.expectedInputLanguages || null;
  }

  get expectedContextLanguages() {
    return this.#options.expectedContextLanguages || null;
  }

  get outputLanguage() {
    return this.#options.outputLanguage || null;
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally(
  'Summarizer',
  Summarizer,
  '__FORCE_SUMMARIZER_POLYFILL__'
);

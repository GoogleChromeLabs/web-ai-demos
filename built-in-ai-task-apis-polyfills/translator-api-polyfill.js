import { BaseTaskModel } from './base-task-model.js';
import { TranslatorPromptBuilder } from './translator-prompt-builder.js';

/**
 * Translator API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Translator extends BaseTaskModel {
  #sourceLanguage;
  #targetLanguage;

  constructor(session, builder, sourceLanguage, targetLanguage) {
    super(session, builder);
    this.#sourceLanguage = sourceLanguage;
    this.#targetLanguage = targetLanguage;
  }

  static availability(options) {
    if (!options || !options.sourceLanguage || !options.targetLanguage) {
      throw new TypeError('sourceLanguage and targetLanguage are required');
    }
    const p = super.baseAvailability(options);
    p.catch(() => {});
    return p;
  }

  static create(options) {
    if (!options || !options.sourceLanguage || !options.targetLanguage) {
      return Promise.reject(
        new TypeError('sourceLanguage and targetLanguage are required')
      );
    }
    const p = this._createInternal(options);
    p.catch(() => {});
    return p;
  }

  static async _createInternal(options) {
    this._checkContext();
    const sourceLanguage = this._validateLanguageTag(options.sourceLanguage);
    const targetLanguage = this._validateLanguageTag(options.targetLanguage);

    await this.ensureLanguageModel();
    this._checkContext();

    const builder = new TranslatorPromptBuilder();
    const { systemPrompt, initialPrompts } = builder.buildPrompt(
      '',
      sourceLanguage,
      targetLanguage
    );

    const sessionOptions = {
      initialPrompts: [
        { role: 'system', content: systemPrompt },
        ...initialPrompts,
      ],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const translator = new this(
      session,
      builder,
      sourceLanguage,
      targetLanguage
    );

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          translator.destroy(options.signal.reason);
        },
        { once: true }
      );
    }

    return translator;
  }

  translate(input, options = {}) {
    this._checkContext();
    return this._runTask(input, options, (inputText) =>
      this._builder.buildPrompt(
        inputText,
        this.#sourceLanguage,
        this.#targetLanguage
      )
    );
  }

  translateStreaming(input, options = {}) {
    this._checkContext();
    return this._runTaskStreaming(input, options, (inputText) =>
      this._builder.buildPrompt(
        inputText,
        this.#sourceLanguage,
        this.#targetLanguage
      )
    );
  }

  get sourceLanguage() {
    return this.#sourceLanguage;
  }

  get targetLanguage() {
    return this.#targetLanguage;
  }

  measureInputUsage(input, options = {}) {
    return super.measureInputUsage(input, options);
  }

  get inputQuota() {
    return super.inputQuota;
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally(
  'Translator',
  Translator,
  '__FORCE_TRANSLATOR_POLYFILL__'
);

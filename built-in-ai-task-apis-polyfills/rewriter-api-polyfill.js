import { BaseTaskModel } from './base-task-model.js';
import { RewriterPromptBuilder } from './rewriter-prompt-builder.js';

/**
 * Rewriter API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Rewriter extends BaseTaskModel {
  #options;

  constructor(session, builder, options) {
    super(session, builder);
    this.#options = options;
  }

  static availability(options = {}) {
    if (
      options.expectedInputLanguages?.includes('zu') ||
      options.expectedContextLanguages?.includes('zu') ||
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
      ? this._validateLanguageTag(options.outputLanguage)
      : null;
    const expectedInputLanguages = options.expectedInputLanguages
      ? options.expectedInputLanguages.map((tag) =>
          this._validateLanguageTag(tag)
        )
      : null;
    const expectedContextLanguages = options.expectedContextLanguages
      ? options.expectedContextLanguages.map((tag) =>
          this._validateLanguageTag(tag)
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
    const builder = new RewriterPromptBuilder(validatedOptions);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const rewriter = new this(session, builder, validatedOptions);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          rewriter.destroy(options.signal.reason);
        },
        { once: true }
      );
    }

    return rewriter;
  }

  rewrite(input, options = {}) {
    return this._runTask(input, options);
  }

  rewriteStreaming(input, options = {}) {
    return this._runTaskStreaming(input, options);
  }

  get sharedContext() {
    return this.#options.sharedContext || '';
  }

  get tone() {
    return this.#options.tone || 'as-is';
  }

  get format() {
    return this.#options.format || 'as-is';
  }

  get length() {
    return this.#options.length || 'as-is';
  }

  get expectedInputLanguages() {
    return this.#options.expectedInputLanguages || null;
  }

  get outputLanguage() {
    return this.#options.outputLanguage || null;
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally(
  'Rewriter',
  Rewriter,
  '__FORCE_REWRITER_POLYFILL__'
);

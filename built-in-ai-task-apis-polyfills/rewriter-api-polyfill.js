import { BaseTaskModel } from './base-task-model.js';
import { RewriterPromptBuilder } from './rewriter-prompt-builder.js';

/**
 * Rewriter API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Rewriter extends BaseTaskModel {
  #options;

  constructor(session, builder, options) {
    super(session, builder, options);
    this.#options = options;
  }

  static async availability(options = {}) {
    return await super.baseAvailability(options);
  }

  static async create(options = {}) {
    const p = this._createInternal(options);
    p.catch(() => {});
    return await p;
  }

  static async _createInternal(options = {}) {
    this._checkContext();
    await this.ensureLanguageModel();
    this._checkContext();
    const builder = new RewriterPromptBuilder(options);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    return new this(session, builder, options);
  }

  async rewrite(input, options = {}) {
    return await this._runTask(input, options);
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
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally(
  'Rewriter',
  Rewriter,
  '__FORCE_REWRITER_POLYFILL__'
);

import { BaseTaskModel } from './base-task-model.js';
import { WriterPromptBuilder } from './writer-prompt-builder.js';

/**
 * Writer API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Writer extends BaseTaskModel {
  #options;

  constructor(session, builder, options) {
    super(session, builder, options);
    this.#options = options;
  }

  static async availability(options = {}) {
    return await super.baseAvailability(options);
  }

  static create(options = {}) {
    const p = this._createInternal(options);
    p.catch(() => {});
    return p;
  }

  static async _createInternal(options = {}) {
    this._checkContext();
    await this.ensureLanguageModel();
    this._checkContext();
    const builder = new WriterPromptBuilder(options);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const writer = new this(session, builder, options);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          writer.destroy(options.signal.reason);
        },
        { once: true }
      );
    }

    return writer;
  }

  write(input, options = {}) {
    return this._runTask(input, options);
  }

  writeStreaming(input, options = {}) {
    return this._runTaskStreaming(input, options);
  }

  get tone() {
    return this.#options.tone || 'neutral';
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally('Writer', Writer, '__FORCE_WRITER_POLYFILL__');

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

  static async create(options = {}) {
    await this.ensureLanguageModel();
    const builder = new WriterPromptBuilder(options);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor
    };

    const session = await LanguageModel.create(sessionOptions);
    return new Writer(session, builder, options);
  }

  async write(input, options = {}) {
    return await this._runTask(input, options);
  }

  writeStreaming(input, options = {}) {
    return this._runTaskStreaming(input, options);
  }

  get tone() { return this.#options.tone || 'neutral'; }
}

// Global exposure if in browser
if (typeof window !== 'undefined' && (!('Writer' in window) || window.__FORCE_WRITER_POLYFILL__)) {
  window.Writer = Writer;
  Writer.__isPolyfill = true;
  console.log(
    'Polyfill: window.Writer is now backed by the Writer API polyfill.'
  );
}

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTaskModel } from './base-task-model.js';
import { WriterPromptBuilder } from './writer-prompt-builder.js';

/**
 * Writer API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Writer extends BaseTaskModel {
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
    const builder = new WriterPromptBuilder(validatedOptions);
    const { systemPrompt } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [{ role: 'system', content: systemPrompt }],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const writer = new this(session, builder, validatedOptions);

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

  get sharedContext() {
    return this.#options.sharedContext || '';
  }

  get format() {
    return this.#options.format || 'plain-text';
  }

  get length() {
    return this.#options.length || 'short';
  }

  get expectedInputLanguages() {
    return this.#options.expectedInputLanguages || null;
  }

  get outputLanguage() {
    return this.#options.outputLanguage || null;
  }

  get tone() {
    return this.#options.tone || 'neutral';
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally('Writer', Writer, '__FORCE_WRITER_POLYFILL__');

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createRawSession,
  isPromptApiSupported,
  toCoreOptions,
} from './create-session.js';
import { EasySession } from './easy-session.js';

/** Options handled by the wrapper rather than forwarded to the Prompt API. */
const EASY_OPTION_KEYS = new Set([
  'sanitizer',
  'ignoreFencedCode',
  'unsafeOutput',
  'onUnsafeOutput',
  'onDownloadProgress',
  'onDownloadStateChange',
  'progress',
  'userActivation',
  'onUserActivationRequired',
  'compact',
  // Replaced by the wrapper's own monitor, which then calls this one.
  'monitor',
]);

function splitOptions(options) {
  const easy = {};
  const createOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (EASY_OPTION_KEYS.has(key)) {
      easy[key] = value;
    } else {
      createOptions[key] = value;
    }
  }
  return { easy, createOptions };
}

/**
 * The wrapper's own create options, on top of everything the Prompt API takes.
 *
 * @typedef {object} EasyCreateOptions
 * @property {Sanitizer|SanitizerConfig|'default'|false} [sanitizer] Vets model
 *   output. `false` turns the check off. Default: the Sanitizer API default.
 * @property {boolean} [ignoreFencedCode] Exempt fenced and inline code from the
 *   check, so asking for an HTML snippet isn't flagged. Default `true`.
 * @property {'throw'|'stop'} [unsafeOutput] What to do when the sanitizer
 *   removes something. Default `'throw'`.
 * @property {(detail: {output: string, sanitized: string, partialOutput: string}) => void} [onUnsafeOutput]
 *   Always called on detection, whichever strategy is set.
 * @property {(progress: {resource: string, loaded: number, total: number, percent: number}) => void} [onDownloadProgress]
 * @property {(state: string, detail: object) => void} [onDownloadStateChange]
 * @property {HTMLProgressElement} [progress] Driven automatically, including
 *   the indeterminate phase while the model is unpacked.
 * @property {'wait'|'throw'|'ignore'} [userActivation] What to do when a
 *   download needs a gesture the page doesn't have. Default `'wait'`.
 * @property {() => void} [onUserActivationRequired] Your cue to prompt for a click.
 * @property {object} [compact] Defaults for `session.compact()`.
 */

/**
 * A near drop-in replacement for the global `LanguageModel`.
 *
 * Same shape, same options, same return values, with the boilerplate that
 * every production Prompt API app ends up writing folded in:
 *
 * - Output is vetted with the Sanitizer API before it can reach the DOM.
 * - `promptStreamingHTML()` streams sanitized HTML instead of Markdown.
 * - `session.compact()` summarizes a conversation to reclaim context.
 * - Download progress is reported without opting in.
 * - The user activation requirement is handled for you.
 */
export class EasyLanguageModel {
  /** Whether the Prompt API exists in this browser. */
  static get supported() {
    return isPromptApiSupported();
  }

  /**
   * Same as `LanguageModel.availability()`. Only the core options matter, so
   * the wrapper's own options can be passed straight through.
   *
   * @returns {Promise<'unavailable'|'downloadable'|'downloading'|'available'>}
   */
  static async availability(options = {}) {
    if (!isPromptApiSupported()) {
      return 'unavailable';
    }
    return LanguageModel.availability(toCoreOptions(options));
  }

  /** Same as `LanguageModel.params()`. Extension and experimental contexts only. */
  static params() {
    return LanguageModel.params();
  }

  /**
   * Creates a session.
   *
   * Everything `LanguageModel.create()` accepts is forwarded untouched. The
   * options below are the wrapper's own.
   *
   * @param {LanguageModelCreateOptions & EasyCreateOptions} [options]
   * @returns {Promise<EasySession>}
   */
  static async create(options = {}) {
    const { easy, createOptions } = splitOptions(options);
    const session = await createRawSession(createOptions, easy);
    // The signal belongs to this one call and can't be reused when the session
    // is rebuilt by compact().
    const { signal, ...reusableOptions } = createOptions;
    return new EasySession(session, { createOptions: reusableOptions, easy });
  }
}

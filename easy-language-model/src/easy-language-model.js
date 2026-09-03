/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Compactor } from './compact.js';
import { createRawSession, isPromptApiSupported } from './create-session.js';
import {
  LanguageModelUnavailableError,
  UnsafeModelOutputError,
} from './errors.js';
import { createHtmlTokenStreamer } from './markdown-html.js';
import { createOutputGuard } from './sanitizer.js';

async function* readStream(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Wraps an async generator in a `ReadableStream`, like the Prompt API returns. */
function toReadableStream(generator) {
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      generator.return?.(reason);
    },
  });
  // Chrome supports async iteration of streams natively; keep `for await`
  // working everywhere else too.
  if (!(Symbol.asyncIterator in stream)) {
    stream[Symbol.asyncIterator] = () => readStream(stream);
  }
  return stream;
}

/**
 * Finds where an unfinished HTML tag starts at the end of `text`, or -1.
 *
 * A tag only becomes detectable once it's complete, so emitting text right up
 * to the last chunk boundary can hand out the first half of `<img src=x
 * onerror=…` before the sanitizer has anything to object to. Holding back from
 * the opening `<` closes that window. A bare `<` in prose (`1 < 2`) isn't a tag
 * start and isn't held back, so this doesn't stall ordinary text.
 */
function pendingTagStart(text) {
  const match = /<[a-zA-Z!/][^>]*$/.exec(text);
  return match ? match.index : -1;
}

/** Normalizes a `LanguageModelPrompt` into history entries. */
function toHistoryEntries(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (Array.isArray(input)) {
    return input.map((message) => ({
      role: message.role ?? 'user',
      content: message.content,
    }));
  }
  return [{ role: 'user', content: input }];
}

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
 * Like `LanguageModel`, this is both the way in and what you get back:
 * `EasyLanguageModel.create()` resolves with an `EasyLanguageModel`. Same
 * shape, same options, same return values, with the boilerplate that every
 * production Prompt API app ends up writing folded in:
 *
 * - Output is vetted with the Sanitizer API before it can reach the DOM.
 * - `promptHTML()` and `promptStreamingHTML()` return HTML rather than Markdown.
 * - `compact()` summarizes a conversation to reclaim context.
 * - Download progress is reported without opting in.
 * - The user activation requirement is handled for you.
 */
export class EasyLanguageModel {
  /** Whether the Prompt API exists in this browser. */
  static get supported() {
    return isPromptApiSupported();
  }

  /**
   * Same as `LanguageModel.availability()`. The wrapper's own options can be
   * passed straight through, so one object serves this and `create()`.
   *
   * @returns {Promise<'unavailable'|'downloadable'|'downloading'|'available'>}
   */
  static async availability(options = {}) {
    if (!isPromptApiSupported()) {
      return 'unavailable';
    }
    return LanguageModel.availability(splitOptions(options).createOptions);
  }

  /**
   * Creates a session.
   *
   * Everything `LanguageModel.create()` accepts is forwarded untouched. The
   * options below are the wrapper's own.
   *
   * @param {LanguageModelCreateOptions & EasyCreateOptions} [options]
   * @returns {Promise<EasyLanguageModel>}
   */
  static async create(options = {}) {
    const { easy, createOptions } = splitOptions(options);
    const session = await createRawSession(createOptions, easy);
    // The signal belongs to this one call and can't be reused when the session
    // is rebuilt by compact().
    const { signal, ...reusableOptions } = createOptions;
    return new EasyLanguageModel(session, {
      createOptions: reusableOptions,
      easy,
    });
  }

  // ── Instance ───────────────────────────────────────────────────────────────

  #session;
  #createOptions;
  #easy;
  #guard;
  #compactor = null;

  // The conversation as the current session sees it: replaced by the summaries
  // on every compaction.
  #history = [];
  // Every message in its original form, never replaced. Used to rebuild the
  // session if a compaction fails after the old one is already gone.
  #fullHistory = [];

  #listeners = [];
  #oncontextoverflow = null;

  /** @internal Use `EasyLanguageModel.create()`. */
  constructor(session, { createOptions, easy }) {
    this.#session = session;
    this.#createOptions = createOptions;
    this.#easy = easy;
    this.#guard = createOutputGuard({
      sanitizer: easy.sanitizer,
      ignoreFencedCode: easy.ignoreFencedCode,
    });
    for (const message of createOptions.initialPrompts ?? []) {
      this.#history.push({ role: message.role, content: message.content });
      this.#fullHistory.push({ role: message.role, content: message.content });
    }
  }

  // ── Pass-throughs ──────────────────────────────────────────────────────────

  get contextUsage() {
    return this.#session.contextUsage;
  }

  get contextWindow() {
    return this.#session.contextWindow;
  }

  get samplingMode() {
    return this.#session.samplingMode;
  }

  /** The conversation so far, as the current session sees it. */
  get history() {
    return this.#history.map((message) => ({ ...message }));
  }

  /**
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelPromptOptions} [options]
   */
  measureContextUsage(input, options) {
    return this.#session.measureContextUsage(input, options);
  }

  /**
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelAppendOptions} [options]
   */
  async append(input, options) {
    await this.#session.append(input, options);
    this.#record(toHistoryEntries(input));
  }

  addEventListener(type, listener, options) {
    this.#listeners.push({ type, listener, options });
    this.#session.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    this.#listeners = this.#listeners.filter(
      (entry) => entry.type !== type || entry.listener !== listener
    );
    this.#session.removeEventListener(type, listener, options);
  }

  get oncontextoverflow() {
    return this.#oncontextoverflow;
  }

  set oncontextoverflow(handler) {
    this.#oncontextoverflow = handler;
    this.#session.oncontextoverflow = handler;
  }

  destroy() {
    this.#session.destroy();
    this.#compactor?.destroy();
    this.#compactor = null;
  }

  /** @param {LanguageModelCloneOptions} [options] */
  async clone(options) {
    const clone = new EasyLanguageModel(await this.#session.clone(options), {
      createOptions: this.#createOptions,
      easy: this.#easy,
    });
    clone.#history = this.history;
    clone.#fullHistory = this.#fullHistory.map((message) => ({ ...message }));
    return clone;
  }

  // ── Prompting ──────────────────────────────────────────────────────────────

  /**
   * Like `LanguageModel.prompt()`, but the response is checked with the
   * Sanitizer API before you get it.
   *
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelPromptOptions} [options] Passed through to the raw session.
   * @returns {Promise<string>}
   */
  async prompt(input, options) {
    const entries = toHistoryEntries(input);
    const output = await this.#session.prompt(input, options);
    const { removed, sanitized } = this.#guard.check(output);
    if (removed) {
      // Throws unless `unsafeOutput: 'stop'`, in which case the flagged text is
      // handed back but kept out of the history.
      this.#reportUnsafe({ output, sanitized, partialOutput: '' });
      return output;
    }
    this.#record([...entries, { role: 'assistant', content: output }]);
    return output;
  }

  /**
   * Like `LanguageModel.promptStreaming()`, but every chunk is vetted before
   * it's handed over.
   *
   * The check runs against everything received so far, not each chunk in
   * isolation, because a tag can straddle a chunk boundary. The moment the
   * sanitizer would remove something, the stream stops.
   *
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelPromptOptions} [options]
   * @returns {ReadableStream<string>} Markdown chunks.
   */
  promptStreaming(input, options) {
    return toReadableStream(this.#streamText(input, options));
  }

  async *#streamText(input, options) {
    const entries = toHistoryEntries(input);
    let full = '';
    // How much of `full` has been handed out. The tail is held back while a tag
    // is still being written.
    let emittedLength = 0;

    for await (const chunk of readStream(
      this.#session.promptStreaming(input, options)
    )) {
      full += chunk;
      const { removed, sanitized } = this.#guard.check(full);
      if (removed) {
        this.#reportUnsafe({
          output: full,
          sanitized,
          partialOutput: full.slice(0, emittedLength),
        });
        return;
      }

      const pending = pendingTagStart(full);
      const boundary = pending === -1 ? full.length : pending;
      if (boundary > emittedLength) {
        const piece = full.slice(emittedLength, boundary);
        emittedLength = boundary;
        yield piece;
      }
    }

    // The response is complete and vetted, so anything held back is safe now:
    // an unterminated tag at the end is inert.
    if (emittedLength < full.length) {
      yield full.slice(emittedLength);
    }

    this.#record([...entries, { role: 'assistant', content: full }]);
  }

  /**
   * Like `prompt()`, but the response comes back as HTML instead of Markdown.
   *
   * The whole response in one string, so it can go straight into a container.
   * It is safe to assign: every tag came from the Markdown parser's fixed set
   * and all text was escaped by the DOM serializer, so nothing the model wrote
   * survives as markup. `setHTML()` costs nothing extra if you would rather
   * not have `innerHTML` in your code at all.
   *
   * ```js
   * output.setHTML(await session.promptHTML(prompt));
   * ```
   *
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelPromptOptions} [options]
   * @returns {Promise<string>} The complete HTML.
   */
  async promptHTML(input, options) {
    let html = '';
    for await (const chunk of this.#streamHtml(input, options)) {
      html += chunk;
    }
    return html;
  }

  /**
   * Streams the response as HTML instead of Markdown.
   *
   * Chunks arrive at the granularity the Markdown parser works at — an opening
   * tag, a run of text, a closing tag — so output appears as fast as the model
   * produces it rather than a block at a time. A chunk is therefore not a
   * balanced fragment: `<p>` arrives before its text. Concatenating every chunk
   * yields the complete, well-formed HTML.
   *
   * Consuming the stream has no side effects. To put the response on screen,
   * pipe it into `renderStreamingHTML()`:
   *
   * ```js
   * await session
   *   .promptStreamingHTML(prompt)
   *   .pipeTo(renderStreamingHTML(output));
   * ```
   *
   * @param {LanguageModelPrompt} input
   * @param {LanguageModelPromptOptions & {onMarkdownChunk?: (chunk: string) => void}} [options]
   *   The stream yields the HTML. `onMarkdownChunk` hands back the Markdown it
   *   was converted from, as it arrives, so one response can drive both views
   *   without paying for a second inference.
   * @returns {ReadableStream<string>} HTML chunks.
   */
  promptStreamingHTML(input, options) {
    return toReadableStream(this.#streamHtml(input, options));
  }

  async *#streamHtml(input, { onMarkdownChunk, ...options } = {}) {
    const entries = toHistoryEntries(input);
    const pending = [];
    let unsafeAttribute = null;

    const streamer = createHtmlTokenStreamer({
      onHtml: (html) => pending.push(html),
      onUnsafe: (detail) => {
        unsafeAttribute = detail;
      },
    });

    let full = '';
    let emitted = '';
    // How much of the raw Markdown `onMarkdownChunk` has seen. Held back at a tag
    // boundary exactly like promptStreaming(), so both hand out the same
    // vetted text.
    let markdownEmitted = 0;

    const reportUnsafeAttribute = () => {
      this.#reportUnsafe({
        output: `${unsafeAttribute.attribute}="${unsafeAttribute.value}"`,
        sanitized: '',
        partialOutput: emitted,
      });
    };

    for await (const chunk of readStream(
      this.#session.promptStreaming(input, options)
    )) {
      full += chunk;
      // Guard the raw Markdown first: a Markdown renderer escapes stray HTML
      // into text, so a bad response would render harmlessly, but an injection
      // attempt is still a reason to stop rather than to display it.
      const { removed, sanitized } = this.#guard.check(full);
      if (removed) {
        this.#reportUnsafe({ output: full, sanitized, partialOutput: emitted });
        return;
      }

      if (onMarkdownChunk) {
        const tagStart = pendingTagStart(full);
        const boundary = tagStart === -1 ? full.length : tagStart;
        if (boundary > markdownEmitted) {
          onMarkdownChunk(full.slice(markdownEmitted, boundary));
          markdownEmitted = boundary;
        }
      }

      streamer.write(chunk);
      if (unsafeAttribute) {
        reportUnsafeAttribute();
        return;
      }
      while (pending.length > 0) {
        const html = pending.shift();
        emitted += html;
        yield html;
      }
    }

    // The response is complete and vetted, so anything held back is safe now.
    if (onMarkdownChunk && markdownEmitted < full.length) {
      onMarkdownChunk(full.slice(markdownEmitted));
    }

    // Markdown can only close the trailing tags at the very end.
    streamer.end();
    if (unsafeAttribute) {
      reportUnsafeAttribute();
      return;
    }
    while (pending.length > 0) {
      yield pending.shift();
    }

    this.#record([...entries, { role: 'assistant', content: full }]);
  }

  // ── Compacting ─────────────────────────────────────────────────────────────

  /**
   * Summarizes the conversation and restarts the session with the summaries as
   * `initialPrompts`, freeing context without losing the thread.
   *
   * The browser doesn't evict `initialPrompts` during overflow handling, so
   * what survives compaction stays anchored for the rest of the session. This
   * swaps the underlying session in place: event listeners registered through
   * this wrapper are re-attached, and the object stays usable throughout.
   *
   * @param {object} [options]
   * @param {(status: string) => void} [options.onStatus]
   * @param {boolean} [options.preserveCodeFences] Keep fenced code verbatim. Default `true`.
   * @param {number} [options.confidenceThreshold] Language detection cutoff. Default `0.7`.
   * @returns {Promise<{before: object, after: object, saved: number, reduction: number, messages: number, languages: string[]}>}
   */
  async compact(options = {}) {
    const compactOptions = { ...this.#easy.compact, ...options };
    this.#compactor ??= new Compactor({
      onDownloadProgress: this.#easy.onDownloadProgress,
      ...compactOptions,
    });

    const before = {
      usage: this.#session.contextUsage,
      window: this.#session.contextWindow,
    };

    const { messages, languages } = await this.#compactor.compact(
      this.#history
    );

    // Nothing can be recovered from a session that's already gone, so the old
    // one is only released once the summaries are in hand.
    this.#session.destroy();

    try {
      this.#session = await this.#createSession(messages, languages);
      this.#history = messages;
    } catch (error) {
      // Fall back to the untouched history. That may land close to capacity
      // again, but the conversation is at least alive and can be compacted
      // again.
      this.#session = await this.#createSession(this.#fullHistory, languages);
      this.#history = this.#fullHistory.map((message) => ({ ...message }));
      this.#reattachListeners();
      throw error;
    }

    this.#reattachListeners();

    const after = {
      usage: this.#session.contextUsage,
      window: this.#session.contextWindow,
    };
    const saved = before.usage - after.usage;

    return {
      before,
      after,
      saved,
      reduction: before.usage > 0 ? saved / before.usage : 0,
      messages: messages.length,
      languages,
    };
  }

  #createSession(initialPrompts, languages) {
    const options = { ...this.#createOptions, initialPrompts };
    // Only derive expected languages when the caller didn't state them: their
    // configuration is deliberate and shouldn't be second-guessed.
    if (!options.expectedInputs && languages?.length) {
      options.expectedInputs = [{ type: 'text', languages }];
    }
    if (!options.expectedOutputs && languages?.length) {
      options.expectedOutputs = [{ type: 'text', languages }];
    }
    return createRawSession(options, this.#easy);
  }

  #reattachListeners() {
    for (const { type, listener, options } of this.#listeners) {
      this.#session.addEventListener(type, listener, options);
    }
    if (this.#oncontextoverflow) {
      this.#session.oncontextoverflow = this.#oncontextoverflow;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #record(entries) {
    for (const entry of entries) {
      this.#history.push(entry);
      this.#fullHistory.push({ ...entry });
    }
  }

  #reportUnsafe(detail) {
    this.#easy.onUnsafeOutput?.(detail);
    if ((this.#easy.unsafeOutput ?? 'throw') !== 'stop') {
      throw new UnsafeModelOutputError(
        'The model produced output containing markup that the Sanitizer API ' +
          'removed. Rendering was stopped.',
        detail
      );
    }
  }
}

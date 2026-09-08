/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Compactor } from './compact.js';
import { createRawSession, isPromptApiSupported } from './create-session.js';
import { unsafeOutputError } from './unsafe-output.js';
import { createHtmlTokenStreamer } from 'streaming-markdown-html';
import { createOutputGuard } from './sanitizer.js';
import {
  isToolUseSupported,
  runToolCall,
  splitTools,
  withToolExpectations,
} from './tools.js';

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

/**
 * Splits one non-streaming turn into its text and the tools it asked for.
 *
 * `prompt()` resolves to a plain string when the model just talks, and to an
 * array of parts when it wants a tool.
 */
function partsOfTurn(result) {
  if (typeof result === 'string') {
    return { text: result, calls: [] };
  }
  const parts = Array.isArray(result) ? result : [result];
  return {
    text: parts
      .filter((part) => part.type === 'text')
      .map((part) => part.value)
      .join(''),
    calls: parts
      .filter((part) => part.type === 'tool-call')
      .map((part) => part.value),
  };
}

/**
 * The error raised when the model keeps asking for tools without answering.
 *
 * `OperationError` is the Prompt API's own name for a prompt that failed "for
 * any other reason", which is what this is. The calls it was still asking for
 * ride along, and `toolCalls` is what tells this apart from an
 * `OperationError` the model itself raised.
 */
function toolLoopError(rounds, calls) {
  const error = new DOMException(
    `The model asked for tools ${rounds} times without answering. ` +
      'Raise `maxToolRounds`, or give it a tool that does more per call.',
    'OperationError'
  );
  Object.assign(error, { toolRounds: rounds, toolCalls: calls });
  return error;
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
  'onDownloadProgress',
  'downloadProgress',
  'activationButton',
  'activationHint',
  'tools',
  'maxToolRounds',
  'onToolCall',
  // Replaced by the wrapper's own monitor, which then calls this one.
  'monitor',
]);

/**
 * What the Prompt API is asked for when you don't say. Both calls go through
 * `splitOptions()`, so `availability()` and `create()` fill the gap the same
 * way and can't end up asking about different models.
 */
const DEFAULT_EXPECTED = [{ type: 'text', languages: ['en'] }];

/** How many times the model may ask for tools before the loop gives up. */
const DEFAULT_MAX_TOOL_ROUNDS = 8;

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
  createOptions.expectedInputs ??= DEFAULT_EXPECTED;
  createOptions.expectedOutputs ??= DEFAULT_EXPECTED;

  if (easy.tools?.length) {
    // The model is shown the declarations; `execute` stays on this side.
    createOptions.tools = splitTools(easy.tools).declarations;
    Object.assign(createOptions, withToolExpectations(createOptions));
  }
  return { easy, createOptions };
}

/**
 * The wrapper's own create options, on top of everything the Prompt API takes.
 *
 * @typedef {object} EasyCreateOptions
 * @property {Sanitizer|SanitizerConfig|'default'|false} [sanitizer] Sanitizes
 *   model output. Pass `false` to turn the check off. Default: the Sanitizer
 *   API default.
 * @property {boolean} [ignoreFencedCode] Exempt fenced and inline code from the
 *   check, so asking for an HTML snippet isn't flagged. Default `true`.
 *   Always called on detection, whichever strategy is set.
 * @property {HTMLProgressElement} [downloadProgress] Driven automatically,
 *   including the indeterminate phase while the model is unpacked.
 * @property {(progress: {resource: string, loaded: number, total: number, percent: number}) => void} [onDownloadProgress]
 *   The same events as a callback. Independent of `downloadProgress`: pass
 *   either, both, or neither.
 * @property {HTMLElement} [activationButton] Revealed when the download needs
 *   a gesture, and hidden once it's clicked. Without one, `create()` is called
 *   as it stands and rejects if the page has no activation.
 * @property {HTMLElement} [activationHint] Shown and hidden with the button,
 *   for the line of text saying why it appeared.
 * @property {Array<{name: string, description: string, inputSchema: object, execute: (args: object) => unknown}>} [tools]
 *   Tools the model may call. `execute` is yours and never reaches the Prompt
 *   API; the rest is the declaration the model sees. Every prompting method
 *   runs the calls and feeds the results back until the model answers.
 * @property {number} [maxToolRounds] How many rounds of tool calls to allow
 *   before giving up. Default 8. A round can carry several calls.
 * @property {(call: {name: string, arguments: object}) => void} [onToolCall]
 *   Fires as each call is about to run, for a line of UI saying what is
 *   happening.
 */

/**
 * A near drop-in replacement for the global `LanguageModel`.
 *
 * Like `LanguageModel`, this is both the way in and what you get back:
 * `EasyLanguageModel.create()` resolves with an `EasyLanguageModel`. Same
 * shape, same options, same return values, with the boilerplate that every
 * production Prompt API app ends up writing folded in:
 *
 * - Output is sanitized with the Sanitizer API before it can reach the DOM.
 * - `promptHTML()` and `promptStreamingHTML()` return HTML rather than Markdown.
 * - `compact()` summarizes a conversation to reclaim context.
 * - Download progress is reported without opting in.
 * - The user activation requirement is handled for you.
 */
export class EasyLanguageModel {
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
    // Asking for tools where they don't exist is a session this browser can't
    // give you, which is what 'unavailable' means. Throwing here would make
    // feature detection something you have to wrap in a try.
    if (options.tools?.length && !isToolUseSupported()) {
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
    if (options.tools?.length && !isToolUseSupported()) {
      throw new TypeError(
        "This browser doesn't support tool calling. Enable " +
          'chrome://flags/#prompt-api-tool-use, or create the session without ' +
          '`tools`. `availability()` reports this as `unavailable`.'
      );
    }
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

  /** Name to tool, for dispatching what the model asks for. */
  #toolsByName = new Map();

  /** @internal Use `EasyLanguageModel.create()`. */
  constructor(session, { createOptions, easy }) {
    this.#session = session;
    this.#createOptions = createOptions;
    this.#easy = easy;
    this.#guard = createOutputGuard({
      sanitizer: easy.sanitizer,
      ignoreFencedCode: easy.ignoreFencedCode,
    });
    if (easy.tools?.length) {
      this.#toolsByName = splitTools(easy.tools).byName;
    }
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
    const pending = toHistoryEntries(input);
    let next = input;
    let rounds = 0;
    const seen = new Set();

    for (;;) {
      const { text, calls } = partsOfTurn(
        await this.#session.prompt(next, options)
      );
      if (calls.length === 0) {
        const { removed, sanitized } = this.#guard.check(text);
        if (removed) {
          this.#reportUnsafe({ output: text, sanitized, partialOutput: '' });
        }
        this.#record([...pending, { role: 'assistant', content: text }]);
        return text;
      }
      if (this.#toolRoundsExhausted(++rounds)) {
        throw toolLoopError(rounds - 1, calls);
      }
      next = await this.#toolRound(calls, { text, rounds, seen, pending });
    }
  }

  /**
   * Like `LanguageModel.promptStreaming()`, but every chunk is sanitized before
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
    const pending = toHistoryEntries(input);
    let next = input;
    let rounds = 0;
    const seen = new Set();

    for (;;) {
      const calls = [];
      const text = yield* this.#streamTurn(next, options, calls);
      if (calls.length === 0) {
        this.#record([...pending, { role: 'assistant', content: text }]);
        return;
      }
      if (this.#toolRoundsExhausted(++rounds)) {
        throw toolLoopError(rounds - 1, calls);
      }
      next = await this.#toolRound(calls, { text, rounds, seen, pending });
    }
  }

  /**
   * Streams one model turn, yielding sanitized text and collecting the tool
   * calls into `calls`. Returns the turn's complete text.
   *
   * `promptStreaming()` yields a heterogeneous stream: text arrives as plain
   * strings, and each tool call as its own structured chunk.
   */
  async *#streamTurn(input, options, calls) {
    let full = '';
    // How much of `full` has been handed out. The tail is held back while a tag
    // is still being written.
    let emittedLength = 0;

    for await (const chunk of readStream(
      this.#session.promptStreaming(input, options)
    )) {
      if (typeof chunk !== 'string') {
        if (chunk.type === 'tool-call') {
          calls.push(chunk.value);
        }
        continue;
      }
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

    // The response is complete and sanitized, so anything held back is safe now:
    // an unterminated tag at the end is inert.
    if (emittedLength < full.length) {
      yield full.slice(emittedLength);
    }

    return full;
  }

  /**
   * Like `prompt()`, but the response comes back as HTML instead of Markdown.
   *
   * The whole response in one string, so it can go straight into a container.
   * It is safe to assign: every tag came from the Markdown parser's fixed set
   * and all text was escaped by the DOM serializer, so nothing the model wrote
   * survives as markup. Using `setHTML()` costs nothing extra if you would
   * rather not have `innerHTML` in your code at all.
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
   * @param {LanguageModelPromptOptions} [options] Passed through to the raw session.
   * @returns {ReadableStream<string>} HTML chunks.
   */
  promptStreamingHTML(input, options) {
    return toReadableStream(this.#streamHtml(input, options));
  }

  async *#streamHtml(input, options) {
    const history = toHistoryEntries(input);
    const htmlChunks = [];

    // Nothing here sanitizes the response, because nothing here can render it
    // unsafely. The parser escapes every run of text, emits only tags it chose
    // itself, and drops an `href` or `src` whose scheme isn't safe, so markup
    // the model wrote arrives as visible text rather than as elements. Stopping
    // on top of that refuses answers that were never dangerous, and a question
    // like "how do I show an image?" is answered with an inline `<img>` all the
    // time. The string methods are where the check earns its place: those hand
    // back text whose destination this can't know.
    //
    // One parser spans every round, so a tool call part-way through doesn't
    // start a second document: what the model says before and after its tools
    // is one piece of prose, and only the last round can close the tags.
    const streamer = createHtmlTokenStreamer({
      onHtml: (html) => htmlChunks.push(html),
    });

    let next = input;
    let rounds = 0;
    const seen = new Set();

    for (;;) {
      const calls = [];
      let full = '';

      for await (const chunk of readStream(
        this.#session.promptStreaming(next, options)
      )) {
        if (typeof chunk !== 'string') {
          if (chunk.type === 'tool-call') {
            calls.push(chunk.value);
          }
          continue;
        }
        full += chunk;
        streamer.write(chunk);
        while (htmlChunks.length > 0) {
          yield htmlChunks.shift();
        }
      }

      if (calls.length === 0) {
        // Markdown can only close the trailing tags at the very end.
        streamer.end();
        while (htmlChunks.length > 0) {
          yield htmlChunks.shift();
        }
        this.#record([...history, { role: 'assistant', content: full }]);
        return;
      }

      if (this.#toolRoundsExhausted(++rounds)) {
        throw toolLoopError(rounds - 1, calls);
      }
      next = await this.#toolRound(calls, {
        text: full,
        rounds,
        seen,
        pending: history,
      });
    }
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
   * @param {(status: string) => void} [options.onStatus] Called once per
   *   message, since each is a separate Summarizer call and a long
   *   conversation takes a while.
   * @returns {Promise<{before: {contextUsage: number, contextWindow: number}, after: {contextUsage: number, contextWindow: number}, saved: number, reduction: number, percent: number, messages: number, languages: string[]}>}
   */
  async compact(options = {}) {
    this.#compactor ??= new Compactor({
      onDownloadProgress: this.#easy.onDownloadProgress,
      ...options,
    });

    const before = {
      contextUsage: this.#session.contextUsage,
      contextWindow: this.#session.contextWindow,
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
      contextUsage: this.#session.contextUsage,
      contextWindow: this.#session.contextWindow,
    };
    const saved = before.contextUsage - after.contextUsage;
    const reduction = before.contextUsage > 0 ? saved / before.contextUsage : 0;

    return {
      before,
      after,
      saved,
      reduction,
      percent: Math.round(reduction * 100),
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

  /**
   * Runs the tools one round asked for, and records both halves of the round.
   *
   * Returns the next prompt input, or `null` when the loop has to stop. The
   * caller has already had its `rounds` incremented, so `rounds` here is the
   * number of rounds spent including this one.
   */
  async #toolRound(calls, { text, rounds, seen, pending }) {
    const maxRounds = this.#easy.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    // Held rather than recorded: like any other turn, a round only reaches the
    // history once the exchange it belongs to finishes, so an abort part-way
    // leaves nothing behind for `compact()` to read.
    pending.push({
      role: 'assistant',
      content: [
        ...(text ? [{ type: 'text', value: text }] : []),
        ...calls.map((call) => ({ type: 'tool-call', value: call })),
      ],
    });

    const content = [];
    for (const call of calls) {
      this.#easy.onToolCall?.({ name: call.name, arguments: call.arguments });
      content.push(await runToolCall(call, this.#toolsByName, { seen }));
    }

    // On the last round the results go back with notice that no more tools are
    // coming, so the model spends its final turn answering rather than asking
    // again and being cut off mid-thought.
    if (rounds >= maxRounds) {
      content.push({
        type: 'text',
        value:
          'This is the last tool result you will receive. Answer from what ' +
          'you have now, and do not call any more tools.',
      });
    }

    pending.push({ role: 'user', content });
    return [{ role: 'user', content }];
  }

  /** Whether the loop may take another round after the one just counted. */
  #toolRoundsExhausted(rounds) {
    return rounds > (this.#easy.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS);
  }

  #record(entries) {
    for (const entry of entries) {
      this.#history.push(entry);
      this.#fullHistory.push({ ...entry });
    }
  }

  #reportUnsafe(detail) {
    throw unsafeOutputError(
      'The model produced output containing markup that the Sanitizer API ' +
        'removed. Rendering was stopped.',
      detail
    );
  }
}

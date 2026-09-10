/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Stand-ins for the built-in AI globals, so the wrapper can be tested alone. */

class FakeMonitor extends EventTarget {}

/**
 * The tool-calling globals, which Node has no equivalent of.
 *
 * The Prompt API rejects a plain object where one of these is expected, so the
 * wrapper constructs them and the tests need the constructors to exist.
 */
export function installToolGlobals() {
  const define = (name, fields) => {
    globalThis[name] = class {
      constructor(init = {}) {
        for (const field of fields) {
          this[field] = init[field];
        }
      }
    };
    Object.defineProperty(globalThis[name], 'name', { value: name });
  };
  define('LanguageModelToolCall', ['callID', 'name', 'arguments']);
  define('LanguageModelToolSuccess', ['callID', 'name', 'result']);
  define('LanguageModelToolError', ['callID', 'name', 'errorMessage']);
  return () => {
    for (const name of [
      'LanguageModelToolCall',
      'LanguageModelToolSuccess',
      'LanguageModelToolError',
    ]) {
      delete globalThis[name];
    }
  };
}

/** A tool call the way the model delivers one. */
export function toolCall(name, args, callID = `${name}-1`) {
  return new LanguageModelToolCall({ callID, name, arguments: args });
}

/** Fires a `downloadprogress` event on a freshly built monitor. */
export function fireProgress(monitor, ...details) {
  const m = new FakeMonitor();
  monitor?.(m);
  for (const detail of details) {
    m.dispatchEvent(Object.assign(new Event('downloadprogress'), detail));
  }
}

/** A `LanguageModel` session that replays whatever `script.response` holds. */
export class FakeSession extends EventTarget {
  constructor(options, script) {
    super();
    this.options = options;
    this.script = script;
    this.destroyed = false;
    this.contextUsage = script.contextUsage ?? 100;
    this.contextWindow = 4096;
  }

  /** The next scripted turn, or the plain response when none is scripted. */
  #nextTurn(input) {
    this.prompts = this.prompts ?? [];
    this.prompts.push(input);
    if (!this.script.turns) {
      return this.script.response;
    }
    const turn = this.script.turns[this.turnIndex ?? 0];
    this.turnIndex = (this.turnIndex ?? 0) + 1;
    return turn ?? this.script.response;
  }

  async prompt(input) {
    return this.#nextTurn(input);
  }

  promptStreaming(input) {
    const turn = this.#nextTurn(input);
    // A turn carrying tool calls streams them as their own chunks, the way the
    // Prompt API does: text as strings, each call as a structured chunk.
    if (typeof turn !== 'string') {
      const chunks = turn.map((part) =>
        part.type === 'text' ? part.value : part
      );
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
    }
    // Chunked small and mid-construct on purpose: that is where the awkward
    // cases live.
    const parts = turn.match(/[\s\S]{1,7}/g) ?? [];
    return new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });
  }

  async append() {}

  async clone() {
    return new FakeSession(this.options, this.script);
  }

  destroy() {
    this.destroyed = true;
  }
}

/**
 * Replaces globals for the duration of a test.
 *
 * @returns {() => void} Restores what was there before.
 */
export function stubGlobals(values) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  };
}

/**
 * A `LanguageModel` stub. `script` is shared with every session it makes, so a
 * test can change `script.response` between calls.
 */
export function fakeLanguageModel(
  script,
  { availability = [], onCreate, createRejects = false } = {}
) {
  const queue = [...availability];
  return {
    sessions: script.sessions,
    async availability() {
      return queue.length > 0 ? queue.shift() : 'available';
    },
    async create(options) {
      onCreate?.(options);
      if (createRejects) {
        // What the Prompt API itself throws for a model it can't provide.
        const error = new Error('The model is unavailable on this device.');
        error.name = 'InvalidStateError';
        throw error;
      }
      fireProgress(options.monitor, ...(script.progress ?? []));
      const session = new FakeSession(options, script);
      script.sessions.push(session);
      return session;
    },
  };
}

/** Summarizer and LanguageDetector stubs, enough for `compact()`. */
export function fakeCompactionApis({ words = 3 } = {}) {
  return {
    Summarizer: {
      async availability() {
        return 'available';
      },
      async create() {
        return {
          async summarize(text) {
            return text.split(/\s+/).slice(0, words).join(' ');
          },
          destroy() {},
        };
      },
    },
    LanguageDetector: {
      async availability() {
        return 'available';
      },
      async create() {
        return {
          async detect() {
            return [{ detectedLanguage: 'en', confidence: 0.99 }];
          },
          destroy() {},
        };
      },
    },
  };
}

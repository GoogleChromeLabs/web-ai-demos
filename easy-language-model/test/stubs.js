/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Stand-ins for the built-in AI globals, so the wrapper can be tested alone. */

class FakeMonitor extends EventTarget {}

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

  async prompt() {
    return this.script.response;
  }

  promptStreaming() {
    // Chunked small and mid-construct on purpose: that is where the awkward
    // cases live.
    const parts = this.script.response.match(/[\s\S]{1,7}/g) ?? [];
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

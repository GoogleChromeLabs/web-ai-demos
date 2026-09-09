/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base class for the Writer and Rewriter polyfills.
 *
 * Both are backed exclusively by the LanguageModel API the browser itself
 * provides. There is deliberately no fallback: this package never loads the
 * `prompt-api-polyfill`, so when `window.LanguageModel` is missing,
 * `availability()` resolves with `'unavailable'` and `create()` rejects with a
 * `NotSupportedError`.
 */
export class BaseTaskModel {
  #session;
  #builder;
  #destroyed = false;
  #activeSessions = new Set();
  #destructionController = new AbortController();
  #destructionReason = null;

  /**
   * Human-readable name of the API, used in error messages. Subclasses
   * override it.
   */
  static _label = 'task model';

  constructor(session, builder) {
    this.#session = session;
    this.#builder = builder;
  }

  static _validateLanguageTag(tag) {
    try {
      return Intl.getCanonicalLocales(tag)[0];
    } catch {
      throw new RangeError(`Invalid language tag: ${tag}`);
    }
  }

  static _checkContext() {
    const win =
      this.__window || (typeof globalThis !== 'undefined' ? globalThis : null);
    let isDestroyed = false;
    try {
      if (
        !win ||
        win.closed ||
        (win.document && win.document.defaultView !== win)
      ) {
        isDestroyed = true;
      }
    } catch {
      isDestroyed = true;
    }

    if (isDestroyed) {
      let EX;
      try {
        EX = win?.DOMException || globalThis.DOMException || Error;
      } catch {
        EX = globalThis.DOMException || Error;
      }
      throw new EX('The execution context is not valid.', 'InvalidStateError');
    }
  }

  _checkContext() {
    this.constructor._checkContext();
  }

  /**
   * Reports whether the browser exposes a LanguageModel implementation. Unlike
   * the other Built-in AI Task API polyfills, this package never loads the
   * Prompt API polyfill to stand in for a missing one.
   * @returns {boolean} Whether a LanguageModel is available.
   */
  static hasLanguageModel() {
    const win = this.__window || globalThis;
    if (typeof win === 'undefined' || !win) {
      return false;
    }
    return !!win.LanguageModel;
  }

  /**
   * Throws a `NotSupportedError` when there is no LanguageModel to build on.
   */
  static _requireLanguageModel() {
    if (!this.hasLanguageModel()) {
      throw new DOMException(
        `The ${this._label} polyfill requires the LanguageModel API, which is not available.`,
        'NotSupportedError',
      );
    }
  }

  static baseAvailability(options = {}) {
    try {
      this._checkContext();
    } catch (e) {
      const p = Promise.reject(e);
      p.catch(() => {});
      return p;
    }
    const p = (async () => {
      if (!this.hasLanguageModel()) {
        return 'unavailable';
      }
      const lmOptions = {
        expectedInputs: [
          {
            type: 'text',
            languages: options.expectedInputLanguages || ['en'],
          },
        ],
        expectedOutputs: [
          {
            type: 'text',
            languages: options.outputLanguage
              ? [options.outputLanguage]
              : ['en'],
          },
        ],
      };

      const win = this.__window || globalThis;
      return await win.LanguageModel.availability(lmOptions);
    })();
    p.catch(() => {});
    return p;
  }

  _isWhitespaceOnly(input) {
    return typeof input === 'string' && /^[\s\x00-\x1f]*$/.test(input);
  }

  #destroyedError() {
    return (
      this.#destructionReason ||
      new DOMException(
        `The ${this.constructor._label} has been destroyed.`,
        'AbortError',
      )
    );
  }

  _runTask(input, options = {}) {
    if (this._isWhitespaceOnly(input)) {
      const p = Promise.resolve(input);
      p.catch(() => {});
      return p;
    }
    const p = this._runTaskInternal(input, options);
    p.catch(() => {});
    return p;
  }

  async _runTaskInternal(input, options = {}) {
    this._checkContext();
    if (this.#destroyed) {
      const p = Promise.reject(this.#destroyedError());
      p.catch(() => {});
      return p;
    }
    const { userPrompt } = this.#builder.buildPrompt(input, options);

    const combinedSignal = AbortSignal.any(
      [this.#destructionController.signal, options.signal].filter(Boolean),
    );

    if (combinedSignal.aborted) {
      const p = Promise.reject(
        combinedSignal.reason || new DOMException('Aborted', 'AbortError'),
      );
      p.catch(() => {});
      return p;
    }

    const mergedOptions = { ...options, signal: combinedSignal };
    const clonedSession = await this.#session.clone(mergedOptions);
    this.#activeSessions.add(clonedSession);

    try {
      return await new Promise((resolve, reject) => {
        const onAbort = () => {
          reject(
            combinedSignal.reason || new DOMException('Aborted', 'AbortError'),
          );
        };
        if (combinedSignal.aborted) {
          onAbort();
          return;
        }
        combinedSignal.addEventListener('abort', onAbort, { once: true });

        clonedSession
          .prompt(userPrompt, mergedOptions)
          .then(resolve)
          .catch(reject)
          .finally(() => {
            combinedSignal.removeEventListener('abort', onAbort);
          });
      });
    } finally {
      clonedSession.destroy();
      this.#activeSessions.delete(clonedSession);
    }
  }

  _runTaskStreaming(input, options = {}) {
    this._checkContext();

    if (this._isWhitespaceOnly(input)) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(input);
          controller.close();
        },
      });
    }

    const { userPrompt } = this.#builder.buildPrompt(input, options);
    const session = this.#session;
    const signal = options.signal;

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    const _this = this;
    const combinedSignal = AbortSignal.any(
      [this.#destructionController.signal, options.signal].filter(Boolean),
    );

    if (combinedSignal.aborted) {
      throw combinedSignal.reason || new DOMException('Aborted', 'AbortError');
    }

    return new ReadableStream({
      async start(controller) {
        if (_this.#destroyed) {
          controller.error(_this.#destroyedError());
          return;
        }
        let clonedSession;
        let reader;

        const cleanup = () => {
          if (reader) {
            reader.cancel().catch(() => {});
            reader = null;
          }
          if (clonedSession) {
            clonedSession.destroy();
            _this.#activeSessions.delete(clonedSession);
            clonedSession = null;
          }
        };

        const onAbort = () => {
          if (clonedSession) {
            cleanup();
          }
          try {
            controller.error(
              combinedSignal.reason ||
                new DOMException('Aborted', 'AbortError'),
            );
          } catch {
            // Ignore if already closed/errored
          }
        };
        combinedSignal.addEventListener('abort', onAbort, { once: true });

        try {
          const mergedOptions = { ...options, signal: combinedSignal };
          clonedSession = await session.clone(mergedOptions);
          _this.#activeSessions.add(clonedSession);

          // Check if it was aborted while cloning
          if (combinedSignal.aborted) {
            onAbort();
            return;
          }

          const stream = clonedSession.promptStreaming(
            userPrompt,
            mergedOptions,
          );
          reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          combinedSignal.removeEventListener('abort', onAbort);
          cleanup();
        }
      },
    });
  }

  measureInputUsage(input, options = {}) {
    this._checkContext();
    if (this.#destroyed) {
      const p = Promise.reject(this.#destroyedError());
      p.catch(() => {});
      return p;
    }

    const combinedSignal = AbortSignal.any(
      [this.#destructionController.signal, options.signal].filter(Boolean),
    );

    if (combinedSignal.aborted) {
      const p = Promise.reject(
        combinedSignal.reason || new DOMException('Aborted', 'AbortError'),
      );
      p.catch(() => {});
      return p;
    }

    const p = new Promise((resolve, reject) => {
      const onAbort = () =>
        reject(
          combinedSignal.reason || new DOMException('Aborted', 'AbortError'),
        );

      combinedSignal.addEventListener('abort', onAbort, {
        once: true,
      });

      this.#session
        .measureInputUsage(input)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          combinedSignal.removeEventListener('abort', onAbort);
        });
    });
    p.catch(() => {});
    return p;
  }

  get inputQuota() {
    return this.#session.inputQuota;
  }

  destroy(reason) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#destructionReason = reason || this.#destroyedError();
    this.#destructionController.abort(this.#destructionReason);

    for (const session of this.#activeSessions) {
      session.destroy();
    }
    this.#activeSessions.clear();
    this.#session.destroy();
  }

  /**
   * Helper to expose an API globally and auto-inject it into iframes.
   * @param {string} apiName The name of the API (e.g., 'Writer')
   * @param {function} apiClass The API class to expose
   * @param {string} forceFlag The name of the force flag (e.g., '__FORCE_WRITER_POLYFILL__')
   */
  static exposeAPIGlobally(apiName, apiClass, forceFlag) {
    if (typeof globalThis === 'undefined' || !globalThis.document) {
      return;
    }

    const isForced = !!globalThis[forceFlag];

    const inject = (win) => {
      try {
        if (!win || (win[apiName] && win[apiName].__isPolyfill)) {
          return;
        }

        if (!(apiName in win) || isForced) {
          const LocalAPI = { [apiName]: class extends apiClass {} }[apiName];
          LocalAPI.prototype[Symbol.toStringTag] = apiName;
          LocalAPI.__window = win;
          LocalAPI.__isPolyfill = true;

          // Bind essential static methods to the constructor so they work when detached.
          if (typeof LocalAPI.create === 'function') {
            LocalAPI.create = LocalAPI.create.bind(LocalAPI);
          }
          if (typeof LocalAPI.availability === 'function') {
            LocalAPI.availability = LocalAPI.availability.bind(LocalAPI);
          }

          // A plain assignment silently no-ops (or throws, caught below) when
          // a native implementation already defined this as a non-writable
          // property. defineProperty succeeds as long as it's configurable,
          // which WebIDL interface objects are per spec.
          Object.defineProperty(win, apiName, {
            value: LocalAPI,
            writable: true,
            configurable: true,
            enumerable: false,
          });

          // Ensure QuotaExceededError is also available in the iframe for WPT tests
          if (win.DOMException) {
            win.QuotaExceededError = win.DOMException;
          }
        }
      } catch {
        // Ignore cross-origin errors
      }
    };

    // Main exposure
    inject(globalThis);

    // Injection logic for iframes
    if (typeof HTMLIFrameElement !== 'undefined') {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLIFrameElement.prototype,
          'contentWindow',
        );
        if (descriptor && descriptor.get) {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get() {
              const win = descriptor.get.call(this);
              if (win) {
                inject(win);
              }
              return win;
            },
            configurable: true,
          });
        }
      } catch {
        // Ignore
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.tagName === 'IFRAME') {
            inject(node.contentWindow);
            node.addEventListener('load', () => inject(node.contentWindow), {
              once: false,
            });
          }
        }
      }
    });

    if (globalThis.document?.documentElement) {
      observer.observe(globalThis.document.documentElement, {
        childList: true,
        subtree: true,
      });
      globalThis.document.querySelectorAll('iframe').forEach((iframe) => {
        inject(iframe.contentWindow);
        iframe.addEventListener('load', () => inject(iframe.contentWindow), {
          once: false,
        });
      });
    }

    if (globalThis[apiName] && globalThis[apiName].__isPolyfill) {
      console.log(
        `Polyfill: window.${apiName} is now backed by the ${apiName} API polyfill.`,
      );
    }
  }
}

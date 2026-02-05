/**
 * Base class for Task APIs (Summarizer, Writer, Rewriter)
 */
export class BaseTaskModel {
  #session;
  #builder;
  #options;
  #destroyed = false;
  #activeSessions = new Set();
  #destructionController = new AbortController();
  #destructionReason = null;

  constructor(session, builder, options = {}) {
    this.#session = session;
    this.#builder = builder;
    this.#options = options;
  }

  get options() {
    return this.#options;
  }

  get sharedContext() {
    return this.#options.sharedContext || '';
  }

  get format() {
    return this.#options.format || null;
  }

  get length() {
    return this.#options.length || null;
  }

  get expectedInputLanguages() {
    return this.#options.expectedInputLanguages || null;
  }

  get expectedContextLanguages() {
    return this.#options.expectedContextLanguages || null;
  }

  get outputLanguage() {
    return this.#options.outputLanguage || null;
  }

  get tone() {
    return this.#options.tone || null;
  }

  get type() {
    return this.#options.type || null;
  }

  static _validateLanguageTag(tag) {
    try {
      return Intl.getCanonicalLocales(tag)[0];
    } catch (e) {
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
    } catch (e) {
      isDestroyed = true;
    }

    if (isDestroyed) {
      let EX;
      try {
        EX = win?.DOMException || globalThis.DOMException || Error;
      } catch (e) {
        EX = globalThis.DOMException || Error;
      }
      throw new EX('The execution context is not valid.', 'InvalidStateError');
    }
  }

  _checkContext() {
    this.constructor._checkContext();
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
      await this.ensureLanguageModel();
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

  static async ensureLanguageModel() {
    const win = this.__window || globalThis;
    if (typeof win !== 'undefined' && !win.LanguageModel) {
      await import('https://esm.sh/prompt-api-polyfill?raw');
    }
  }

  static availability(options = {}) {
    const p = (async () => {
      this._checkContext();
      await this.ensureLanguageModel();
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

      return await globalThis.LanguageModel.availability(lmOptions);
    })();
    p.catch(() => {});
    return p;
  }

  _runTask(input, options = {}) {
    if (typeof input === 'string' && input.trim() === '') {
      const p = Promise.resolve('');
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
      const p = Promise.reject(
        this.#destructionReason ||
          new DOMException('The summarizer has been destroyed.', 'AbortError')
      );
      p.catch(() => {});
      return p;
    }
    const { userPrompt } = this.#builder.buildPrompt(input, options);

    const combinedSignal = AbortSignal.any(
      [this.#destructionController.signal, options.signal].filter(Boolean)
    );

    if (combinedSignal.aborted) {
      const p = Promise.reject(
        combinedSignal.reason || new DOMException('Aborted', 'AbortError')
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
            combinedSignal.reason || new DOMException('Aborted', 'AbortError')
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

    if (typeof input === 'string' && input.trim() === '') {
      return new ReadableStream({
        start(controller) {
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
      [this.#destructionController.signal, options.signal].filter(Boolean)
    );

    if (combinedSignal.aborted) {
      throw combinedSignal.reason || new DOMException('Aborted', 'AbortError');
    }

    return new ReadableStream({
      async start(controller) {
        if (_this.#destroyed) {
          controller.error(
            _this.#destructionReason ||
              new DOMException(
                'The summarizer has been destroyed.',
                'AbortError'
              )
          );
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
              combinedSignal.reason || new DOMException('Aborted', 'AbortError')
            );
          } catch (e) {
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
            mergedOptions
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
      const p = Promise.reject(
        this.#destructionReason ||
          new DOMException('The summarizer has been destroyed.', 'AbortError')
      );
      p.catch(() => {});
      return p;
    }

    const combinedSignal = AbortSignal.any(
      [this.#destructionController.signal, options.signal].filter(Boolean)
    );

    if (combinedSignal.aborted) {
      const p = Promise.reject(
        combinedSignal.reason || new DOMException('Aborted', 'AbortError')
      );
      p.catch(() => {});
      return p;
    }

    const p = new Promise((resolve, reject) => {
      const onAbort = () =>
        reject(
          combinedSignal.reason || new DOMException('Aborted', 'AbortError')
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

  get tokensUsage() {
    return this.#session.inputUsage;
  }

  get tokensLeft() {
    return this.#session.inputQuota - this.#session.inputUsage;
  }

  get maxTokens() {
    return this.#session.inputQuota;
  }

  destroy(reason) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#destructionReason =
      reason ||
      new DOMException('The summarizer has been destroyed.', 'AbortError');
    this.#destructionController.abort(this.#destructionReason);

    for (const session of this.#activeSessions) {
      session.destroy();
    }
    this.#activeSessions.clear();
    this.#session.destroy();
  }

  /**
   * Helper to expose an API globally and auto-inject it into iframes.
   * @param {string} apiName The name of the API (e.g., 'Summarizer')
   * @param {function} apiClass The API class to expose
   * @param {string} forceFlag The name of the force flag (e.g., '__FORCE_SUMMARIZER_POLYFILL__')
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

          win[apiName] = LocalAPI;

          // Ensure QuotaExceededError is also available in the iframe for WPT tests
          if (win.DOMException) {
            win.QuotaExceededError = win.DOMException;
          }
        }
      } catch (e) {
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
          'contentWindow'
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
      } catch (e) {
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
        `Polyfill: window.${apiName} is now backed by the ${apiName} API polyfill.`
      );
    }
  }
}

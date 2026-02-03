/**
 * Base class for Task APIs (Summarizer, Writer, Rewriter)
 */
export class BaseTaskModel {
  #session;
  #builder;

  constructor(session, builder) {
    this.#session = session;
    this.#builder = builder;
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

  static async baseAvailability(options = {}) {
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
          languages: options.outputLanguage ? [options.outputLanguage] : ['en'],
        },
      ],
    };

    return await globalThis.LanguageModel.availability(lmOptions);
  }

  static async ensureLanguageModel() {
    const win = this.__window || globalThis;
    if (typeof win !== 'undefined' && !win.LanguageModel) {
      await import('https://esm.sh/prompt-api-polyfill?raw');
    }
  }

  static async availability(options = {}) {
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
          languages: options.outputLanguage ? [options.outputLanguage] : ['en'],
        },
      ],
    };

    return await globalThis.LanguageModel.availability(lmOptions);
  }

  async _runTask(input, options = {}) {
    const p = this._runTaskInternal(input, options);
    p.catch(() => {});
    return await p;
  }

  async _runTaskInternal(input, options = {}) {
    this._checkContext();
    const { userPrompt } = this.#builder.buildPrompt(input, options);
    const signal = options.signal;

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    const clonedSession = await this.#session.clone(options);
    let abortHandler;

    try {
      if (signal) {
        return await new Promise((resolve, reject) => {
          abortHandler = () => {
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          };
          signal.addEventListener('abort', abortHandler, { once: true });
          clonedSession.prompt(userPrompt, options).then(resolve).catch(reject);
        });
      }
      return await clonedSession.prompt(userPrompt, options);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      clonedSession.destroy();
    }
  }

  _runTaskStreaming(input, options = {}) {
    this._checkContext();
    const { userPrompt } = this.#builder.buildPrompt(input, options);
    const session = this.#session;
    const signal = options.signal;

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    return new ReadableStream({
      async start(controller) {
        let clonedSession;
        let abortHandler;
        let reader;

        const cleanup = () => {
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler);
            abortHandler = null;
          }
          if (reader) {
            reader.cancel().catch(() => {});
            reader = null;
          }
          if (clonedSession) {
            clonedSession.destroy();
            clonedSession = null;
          }
        };

        try {
          if (signal) {
            abortHandler = () => {
              controller.error(
                signal.reason || new DOMException('Aborted', 'AbortError')
              );
              cleanup();
            };
            signal.addEventListener('abort', abortHandler);
          }

          clonedSession = await session.clone(options);

          // Check if it was aborted while cloning
          if (signal?.aborted) {
            cleanup();
            return;
          }

          const stream = clonedSession.promptStreaming(userPrompt, options);
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
          if (!signal?.aborted) {
            controller.error(err);
          }
        } finally {
          cleanup();
        }
      },
    });
  }

  async measureInputUsage(input) {
    return await this.#session.measureInputUsage(input);
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

  destroy() {
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
          const LocalAPI = class extends apiClass {};
          LocalAPI.__window = win;
          LocalAPI.__isPolyfill = true;
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

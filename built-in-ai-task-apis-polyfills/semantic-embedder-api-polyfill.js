/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SemanticEmbedder API Polyfill
 * Backed by EmbeddingGemma (https://huggingface.co/litert-community/embeddinggemma-300m),
 * the same 300M-parameter model Chrome's built-in SemanticEmbedder API uses
 * on-device. This polyfill runs the equivalent ONNX conversion
 * (onnx-community/embeddinggemma-300m-ONNX) in-browser via
 * @huggingface/transformers, producing 768-dimensional Float32Array vectors.
 *
 * The optional `taskType` passed to embed() selects a task-specific prefix
 * so the embedding is optimized for that use case. When omitted, the raw
 * string is embedded as-is with no prefix.
 *
 * This module is the main-thread half and never imports Transformers.js: the
 * model runs in `semantic-embedder-worker.js`, which is spawned from a URL of
 * its own. Pointing the worker at this module's own `import.meta.url` instead
 * would make it re-execute whatever chunk a downstream bundler happened to
 * merge this file into, which is how it came to run page-level DOM code in a
 * context that has no `document`.
 */

import {
  DEFAULT_DTYPE,
  DEFAULT_MODEL,
  EMBEDDING_SPACE,
  MAX_INPUT_TOKENS,
  VALID_TASK_TYPES,
} from './semantic-embedder-constants.js';

// Tracks which model IDs are currently being downloaded.
const downloadingModels = new Set();

/**
 * Transformers.js `env` overrides to hand the worker.
 *
 * The worker is a separate realm and cannot read any of this itself, so it
 * travels in every message. `TRANSFORMERS_CONFIG` is the global the Prompt API
 * polyfill's Transformers.js backend already reads, so a host that configures
 * one gets the other for free.
 *
 * @returns {Object|undefined} A partial `env` object, if one is configured.
 */
function getEnvOverrides() {
  return (
    globalThis.SEMANTIC_EMBEDDER_CONFIG?.env ??
    globalThis.TRANSFORMERS_CONFIG?.env
  );
}

/**
 * Spawns the embedder worker.
 *
 * By default the worker comes from this module's sibling
 * `semantic-embedder-worker.js`, written as
 * `new Worker(new URL(...), { type: 'module' })` because that exact spelling is
 * what tells a bundler to emit the worker as its own chunk with its imports
 * resolved. Anything less literal, such as hoisting the URL into a variable,
 * gets the file copied out verbatim instead, leaving its bare
 * `@huggingface/transformers` import unresolvable at runtime.
 *
 * A worker script also has to be same-origin with the document, which it is not
 * when a browser extension injects this polyfill into a page. Such hosts bundle
 * `built-in-ai-task-apis-polyfills/semantic-embedder-worker` into a script of
 * their own and point `SEMANTIC_EMBEDDER_CONFIG.workerUrl` at it; it is then
 * loaded through a same-origin blob that imports it.
 *
 * @returns {{worker: Worker, revoke: (() => void)}} The worker, and a callback
 *     that releases the blob URL when one was needed.
 */
function spawnWorker() {
  const configuredUrl = globalThis.SEMANTIC_EMBEDDER_CONFIG?.workerUrl;

  if (configuredUrl) {
    const href = String(configuredUrl);
    let sameOrigin = false;
    try {
      sameOrigin =
        !!globalThis.location &&
        new URL(href, globalThis.location.href).origin ===
          globalThis.location.origin;
    } catch {
      // An unparseable URL is handed to Worker as-is and allowed to throw.
    }

    if (sameOrigin) {
      return {
        worker: new Worker(href, { type: 'module' }),
        revoke: () => {},
      };
    }

    const blobUrl = URL.createObjectURL(
      new Blob([`import ${JSON.stringify(href)};`], {
        type: 'application/javascript',
      }),
    );
    return {
      worker: new Worker(blobUrl, { type: 'module' }),
      revoke: () => URL.revokeObjectURL(blobUrl),
    };
  }

  return {
    worker: new Worker(
      new URL('./semantic-embedder-worker.js', import.meta.url),
      { type: 'module' },
    ),
    revoke: () => {},
  };
}

function runInTemporaryWorker(action, payload = {}) {
  const { worker, revoke } = spawnWorker();
  return new Promise((resolve, reject) => {
    const finish = (fn, arg) => {
      worker.terminate();
      revoke();
      fn(arg);
    };
    worker.onmessage = (e) => {
      const { type, result, error } = e.data;
      if (type === 'response') {
        finish(resolve, result);
      } else if (type === 'error') {
        finish(reject, new Error(error));
      }
    };
    worker.onerror = (err) => {
      finish(reject, err);
    };
    worker.postMessage({ action, payload, env: getEnvOverrides() });
  });
}

export class SemanticEmbedder {
  #worker = null;
  #destroyed = false;
  #destructionReason = null;
  #pendingRequests = new Map();
  #nextRequestId = 0;

  constructor(worker) {
    this.#worker = worker;

    this.#worker.onmessage = (e) => {
      if (this.#destroyed) {
        return;
      }
      const msg = e.data;
      if (msg.type === 'embed-response') {
        const req = this.#pendingRequests.get(msg.requestId);
        if (req) {
          this.#pendingRequests.delete(msg.requestId);
          req.resolve(msg.result);
        }
      } else if (msg.type === 'embed-error') {
        const req = this.#pendingRequests.get(msg.requestId);
        if (req) {
          this.#pendingRequests.delete(msg.requestId);
          const EX = globalThis[msg.name] || DOMException || Error;
          req.reject(new EX(msg.error, msg.name));
        }
      }
    };

    this.#worker.onerror = (err) => {
      if (this.#destroyed) {
        return;
      }
      const error = new Error('Web Worker error: ' + err.message);
      for (const req of this.#pendingRequests.values()) {
        req.reject(error);
      }
      this.#pendingRequests.clear();
      this.destroy(error);
    };
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

  static availability() {
    const p = (async () => {
      this._checkContext();
      if (typeof WebAssembly === 'undefined') {
        return 'unavailable';
      }
      const modelId = DEFAULT_MODEL;
      if (downloadingModels.has(modelId)) {
        return 'downloading';
      }
      const status = await runInTemporaryWorker('availability', {
        modelId,
        dtype: DEFAULT_DTYPE,
      });
      return status;
    })();
    p.catch(() => {});
    return p;
  }

  // Deliberate divergence from Chrome's current native behavior: the spec
  // notes download monitoring isn't implemented there yet, so create()
  // fails unless availability() is already 'available'. This polyfill
  // instead downloads on demand and fires `monitor` downloadprogress
  // events, since that's the only way to bootstrap the model on the
  // vast majority of browsers with no native implementation to fall
  // back on, and the spec frames the native gap as temporary.
  static create(options = {}) {
    const p = this._createInternal(options);
    p.catch(() => {});
    return p;
  }

  static async _createInternal(options = {}) {
    this._checkContext();

    if (options.signal?.aborted) {
      throw options.signal.reason || new DOMException('Aborted', 'AbortError');
    }

    const modelId = options.model || DEFAULT_MODEL;
    const dtype = options.dtype || DEFAULT_DTYPE;

    let fireProgressEvent = null;
    if (options.monitor) {
      const monitorTarget = new EventTarget();
      options.monitor(monitorTarget);
      fireProgressEvent = (loaded) => {
        monitorTarget.dispatchEvent(
          new ProgressEvent('downloadprogress', {
            loaded,
            total: 1,
            lengthComputable: true,
          }),
        );
      };
    }

    fireProgressEvent?.(0);

    downloadingModels.add(modelId);

    const { worker, revoke } = spawnWorker();

    let cleanup = null;

    const readyPromise = new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          fireProgressEvent?.(msg.loaded);
        } else if (msg.type === 'ready') {
          revoke();
          resolve();
        } else if (msg.type === 'init-error') {
          revoke();
          const EX = globalThis[msg.name] || DOMException || Error;
          reject(new EX(msg.error, msg.name));
        }
      };

      const onError = (err) => {
        revoke();
        reject(err);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
    });

    let abortHandler = null;
    if (options.signal) {
      abortHandler = () => {
        cleanup?.();
        worker.terminate();
        revoke();
        downloadingModels.delete(modelId);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      worker.postMessage({
        type: 'init',
        modelId,
        dtype,
        hasMonitor: !!options.monitor,
        env: getEnvOverrides(),
      });

      await readyPromise;
    } catch (err) {
      worker.terminate();
      throw err;
    } finally {
      cleanup?.();
      if (options.signal && abortHandler) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      downloadingModels.delete(modelId);
    }

    fireProgressEvent?.(1);

    const embedder = new this(worker);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          embedder.destroy(options.signal.reason);
        },
        { once: true },
      );
    }

    return embedder;
  }

  embed(input, options = {}) {
    if (this.#destroyed) {
      const p = Promise.reject(
        this.#destructionReason ||
          new DOMException('The embedder has been destroyed.', 'AbortError'),
      );
      p.catch(() => {});
      return p;
    }
    const p = this.#embedInternal(input, options);
    p.catch(() => {});
    return p;
  }

  async #embedInternal(input, options = {}) {
    this._checkContext();

    const signal = options.signal;
    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    if (
      options.taskType !== undefined &&
      !VALID_TASK_TYPES.has(options.taskType)
    ) {
      throw new TypeError(
        `Failed to execute 'embed': The provided value '${options.taskType}' is not a valid enum value of type EmbedderTaskType.`,
      );
    }

    const inputs = Array.isArray(input) ? input : [input];

    if (inputs.length === 0) {
      return {
        embeddings: [],
        metadata: {
          embeddingSpace: EMBEDDING_SPACE,
          maxInputTokens: MAX_INPUT_TOKENS,
        },
      };
    }

    const requestId = ++this.#nextRequestId;

    return new Promise((resolve, reject) => {
      let onAbort = null;

      if (signal) {
        onAbort = () => {
          this.#pendingRequests.delete(requestId);
          this.#worker?.postMessage({ type: 'abort-embed', requestId });
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.#pendingRequests.set(requestId, {
        resolve: (result) => {
          if (onAbort) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve(result);
        },
        reject: (err) => {
          if (onAbort) {
            signal.removeEventListener('abort', onAbort);
          }
          reject(err);
        },
      });

      this.#worker?.postMessage({
        type: 'embed',
        requestId,
        inputs,
        options: {
          taskType: options.taskType,
        },
      });
    });
  }

  destroy(reason) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#destructionReason =
      reason ||
      new DOMException('The embedder has been destroyed.', 'AbortError');

    const err = this.#destructionReason;
    for (const req of this.#pendingRequests.values()) {
      req.reject(err);
    }
    this.#pendingRequests.clear();

    this.#worker?.terminate();
    this.#worker = null;
  }
}

// Global exposure if in browser
if (typeof globalThis !== 'undefined' && globalThis.document) {
  const apiName = 'SemanticEmbedder';
  const forceFlag = '__FORCE_SEMANTIC_EMBEDDER_POLYFILL__';
  const isForced = !!globalThis[forceFlag];

  const inject = (win) => {
    try {
      if (!win || (win[apiName] && win[apiName].__isPolyfill)) {
        return;
      }
      if (!(apiName in win) || isForced) {
        const LocalAPI = {
          [apiName]: class extends SemanticEmbedder {},
        }[apiName];
        LocalAPI.prototype[Symbol.toStringTag] = apiName;
        LocalAPI.__window = win;
        LocalAPI.__isPolyfill = true;
        LocalAPI.create = LocalAPI.create.bind(LocalAPI);
        LocalAPI.availability = LocalAPI.availability.bind(LocalAPI);
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
      }
    } catch {
      // Ignore cross-origin errors
    }
  };

  inject(globalThis);

  if (typeof HTMLIFrameElement !== 'undefined') {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow',
      );
      if (descriptor?.get) {
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

  if (globalThis[apiName]?.__isPolyfill) {
    console.log(
      `Polyfill: window.${apiName} is now backed by the ${apiName} API polyfill.`,
    );
  }
}

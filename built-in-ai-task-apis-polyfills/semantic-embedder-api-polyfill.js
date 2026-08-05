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
 */

const DEFAULT_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
// EmbeddingGemma activations do not support fp16. q8 gives a good balance of
// model size and quality in the browser.
const DEFAULT_DTYPE = 'q8';
const MAX_INPUT_TOKENS = 2048;

// EmbeddingGemma task-type prefixes (must match the model's training setup).
// See https://ai.google.dev/gemma/docs/embeddinggemma/model_card for the
// full prompt table.
const TASK_PREFIXES = {
  'semantic-similarity': 'task: sentence similarity | query: ',
  'retrieval-query': 'task: search result | query: ',
  'retrieval-document': 'title: none | text: ',
  classification: 'task: classification | query: ',
  clustering: 'task: clustering | query: ',
};

const VALID_TASK_TYPES = new Set(Object.keys(TASK_PREFIXES));

// Tracks which model IDs are currently being downloaded.
const downloadingModels = new Set();

let transformersModule = null;

async function ensureTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@huggingface/transformers');
    // Share cached model weights across different origins when the
    // Cross-Origin Storage extension is present.
    transformersModule.env.experimental_useCrossOriginStorage = true;
  }
  return transformersModule;
}

function applyPrefix(text, taskType) {
  // No taskType means the raw input is embedded as-is, with no prefix.
  const prefix = taskType ? TASK_PREFIXES[taskType] : undefined;
  return prefix ? `${prefix}${text}` : text;
}

async function isModelCached(modelId, dtype) {
  try {
    const { ModelRegistry } = await ensureTransformers();
    // include_processor: false avoids a network request for preprocessor_config.json,
    // which this model doesn't have and would otherwise produce a 404.
    const result = await ModelRegistry.is_cached_files(modelId, {
      dtype,
      include_processor: false,
    });
    // generation_config.json is an optional text-generation config that the
    // transformers.js cache doesn't always persist; exclude it from the check.
    const essential = result.files.filter(
      (f) => f.file !== 'generation_config.json'
    );
    return essential.length > 0 && essential.every((f) => f.cached);
  } catch {
    return false;
  }
}

const isWorker =
  typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

function getWorkerUrl() {
  const url = import.meta.url;
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.location &&
      new URL(url).origin !== globalThis.location.origin
    ) {
      const blobCode = `import ${JSON.stringify(url)};`;
      const blob = new Blob([blobCode], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fallback to original URL
  }
  return url;
}

function runInTemporaryWorker(action, payload = {}) {
  const url = getWorkerUrl();
  const worker = new Worker(url, { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const { type, result, error } = e.data;
      if (type === 'response') {
        resolve(result);
        worker.terminate();
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      } else if (type === 'error') {
        reject(new Error(error));
        worker.terminate();
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
    worker.postMessage({ action, payload });
  });
}

if (isWorker) {
  const abortedRequests = new Set();
  let workerTokenizer = null;
  let workerModel = null;

  const initWorkerModel = async (modelId, dtype, hasMonitor) => {
    const { AutoModel, AutoTokenizer } = await ensureTransformers();

    let progressCallback = null;
    if (hasMonitor) {
      progressCallback = (progress) => {
        if (progress.status === 'progress_total') {
          self.postMessage({
            type: 'progress',
            loaded: progress.total > 0 ? progress.loaded / progress.total : 0,
          });
        }
      };
    }

    [workerTokenizer, workerModel] = await Promise.all([
      AutoTokenizer.from_pretrained(modelId, {
        progress_callback: progressCallback,
      }),
      AutoModel.from_pretrained(modelId, {
        dtype,
        progress_callback: progressCallback,
      }),
    ]);
  };

  const checkAvailability = async (modelId, dtype) => {
    if (typeof WebAssembly === 'undefined') {
      return 'unavailable';
    }
    if (await isModelCached(modelId, dtype)) {
      return 'available';
    }
    return 'downloadable';
  };

  self.onmessage = async (e) => {
    const msg = e.data;

    // Support static actions from temporary workers
    if (msg.action === 'availability') {
      try {
        const { modelId, dtype } = msg.payload;
        const status = await checkAvailability(modelId, dtype);
        self.postMessage({ type: 'response', result: status });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      }
      return;
    }

    // Instance-level actions
    if (msg.type === 'init') {
      try {
        await initWorkerModel(msg.modelId, msg.dtype, msg.hasMonitor);
        self.postMessage({ type: 'ready' });
      } catch (err) {
        self.postMessage({
          type: 'init-error',
          error: err.message,
          name: err.name || 'Error',
        });
      }
    } else if (msg.type === 'embed') {
      const { requestId, inputs, options } = msg;
      try {
        if (!workerModel || !workerTokenizer) {
          throw new Error('Model is not initialized in the worker.');
        }

        const prefixedInputs = inputs.map((text) =>
          applyPrefix(text, options.taskType)
        );

        const tokenized = await workerTokenizer(prefixedInputs, {
          padding: true,
          truncation: true,
          max_length: MAX_INPUT_TOKENS,
        });

        if (abortedRequests.has(requestId)) {
          abortedRequests.delete(requestId);
          throw new DOMException('Aborted', 'AbortError');
        }

        const { sentence_embedding } = await workerModel(tokenized);

        if (abortedRequests.has(requestId)) {
          abortedRequests.delete(requestId);
          throw new DOMException('Aborted', 'AbortError');
        }

        const dim = sentence_embedding.dims[1];
        const data = sentence_embedding.data; // flat Float32Array

        const embeddings = inputs.map((_, i) => ({
          values: data.slice(i * dim, (i + 1) * dim),
        }));

        const result = { embeddings };

        self.postMessage({ type: 'embed-response', requestId, result });
      } catch (err) {
        abortedRequests.delete(requestId);
        self.postMessage({
          type: 'embed-error',
          requestId,
          error: err.message,
          name: err.name || 'Error',
        });
      }
    } else if (msg.type === 'abort-embed') {
      abortedRequests.add(msg.requestId);
    }
  };
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
          })
        );
      };
    }

    fireProgressEvent?.(0);

    downloadingModels.add(modelId);

    const url = getWorkerUrl();
    const worker = new Worker(url, { type: 'module' });

    let cleanup = null;

    const readyPromise = new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          fireProgressEvent?.(msg.loaded);
        } else if (msg.type === 'ready') {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          resolve();
        } else if (msg.type === 'init-error') {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
          }
          const EX = globalThis[msg.name] || DOMException || Error;
          reject(new EX(msg.error, msg.name));
        }
      };

      const onError = (err) => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
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
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
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
        { once: true }
      );
    }

    return embedder;
  }

  embed(input, options = {}) {
    if (this.#destroyed) {
      const p = Promise.reject(
        this.#destructionReason ||
          new DOMException('The embedder has been destroyed.', 'AbortError')
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
        `Failed to execute 'embed': The provided value '${options.taskType}' is not a valid enum value of type EmbedderTaskType.`
      );
    }

    const inputs = Array.isArray(input) ? input : [input];

    if (inputs.length === 0) {
      return { embeddings: [] };
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
        'contentWindow'
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
      `Polyfill: window.${apiName} is now backed by the ${apiName} API polyfill.`
    );
  }
}

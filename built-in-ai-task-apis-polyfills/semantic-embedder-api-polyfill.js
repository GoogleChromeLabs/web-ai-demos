/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SemanticEmbedder API Polyfill
 * Backed by EmbeddingGemma (onnx-community/embeddinggemma-300m-ONNX) via
 * @huggingface/transformers, matching the model Chrome's built-in
 * SemanticEmbedder API uses on-device.
 *
 * EmbeddingGemma is Google's 300M-parameter embedding model built on Gemma 3,
 * producing 768-dimensional vectors. It requires task-specific prefixes on
 * inputs so that query and document embeddings are optimized for retrieval.
 */

const DEFAULT_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
// EmbeddingGemma activations do not support fp16. q8 gives a good balance of
// model size and quality in the browser.
const DEFAULT_DTYPE = 'q8';
const MAX_INPUT_TOKENS = 2048;

// EmbeddingGemma task-type prefixes (must match the model's training setup).
const TASK_PREFIXES = {
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
  classification: 'task: classification | text: ',
};

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
  const prefix = TASK_PREFIXES[taskType] ?? TASK_PREFIXES.document;
  return `${prefix}${text}`;
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

export class SemanticEmbedder {
  #tokenizer = null;
  #model = null;
  #modelId = DEFAULT_MODEL;
  #destroyed = false;
  #destructionReason = null;

  constructor(tokenizer, model, modelId) {
    this.#tokenizer = tokenizer;
    this.#model = model;
    this.#modelId = modelId;
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
      if (await isModelCached(modelId, DEFAULT_DTYPE)) {
        return 'available';
      }
      return 'downloadable';
    })();
    p.catch(() => {});
    return p;
  }

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

    const { AutoModel, AutoTokenizer } = await ensureTransformers();

    const modelId = options.model || DEFAULT_MODEL;
    const dtype = options.dtype || DEFAULT_DTYPE;

    // Per spec §5.2 "create an AI model object": fireProgressEvent is an
    // algorithm taking a single `loaded` argument (0–1 fraction); total is
    // always 1 and lengthComputable is always true.
    let fireProgressEvent = null;
    let progressCallback = null;
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
      // AutoModel.from_pretrained() automatically wraps the callback with
      // DefaultProgressCallback, which aggregates per-file events into a
      // single 'progress_total' event covering all model files. We listen
      // only to that status so progress is monotonically 0→1 and not
      // confused by per-file events from the tokenizer or individual ONNX
      // shards, which each independently go 0→100%.
      progressCallback = (progress) => {
        if (progress.status === 'progress_total') {
          fireProgressEvent(
            progress.total > 0 ? progress.loaded / progress.total : 0
          );
        }
      };
    }

    // Spec: fire loaded=0 before the download/initialization begins.
    fireProgressEvent?.(0);

    downloadingModels.add(modelId);
    let tokenizer, model;
    try {
      [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(modelId, {
          progress_callback: progressCallback,
        }),
        AutoModel.from_pretrained(modelId, {
          dtype,
          progress_callback: progressCallback,
        }),
      ]);
    } finally {
      downloadingModels.delete(modelId);
    }

    if (options.signal?.aborted) {
      model.dispose?.();
      throw options.signal.reason || new DOMException('Aborted', 'AbortError');
    }

    // Spec: fire loaded=1 once the model is fully loaded and ready.
    fireProgressEvent?.(1);

    const embedder = new this(tokenizer, model, modelId);

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

    const inputs = Array.isArray(input) ? input : [input];

    if (inputs.length === 0) {
      return {
        embeddings: [],
        metadata: {
          embeddingSpace: this.#modelId,
          maxInputTokens: MAX_INPUT_TOKENS,
        },
      };
    }

    // Apply EmbeddingGemma's task-specific prefixes before tokenization.
    const taskType = options.taskType ?? 'document';
    const prefixedInputs = inputs.map((text) => applyPrefix(text, taskType));

    const tokenized = await this.#tokenizer(prefixedInputs, {
      padding: true,
      truncation: true,
      max_length: MAX_INPUT_TOKENS,
    });

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    // EmbeddingGemma returns `sentence_embedding` directly — a [n, 768] tensor.
    const { sentence_embedding } = await this.#model(tokenized);

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }

    const dim = sentence_embedding.dims[1];
    const data = sentence_embedding.data; // flat Float32Array of length n*768

    const embeddings = inputs.map((_, i) => ({
      values: data.slice(i * dim, (i + 1) * dim),
    }));

    return {
      embeddings,
      metadata: {
        embeddingSpace: this.#modelId,
        maxInputTokens: MAX_INPUT_TOKENS,
      },
    };
  }

  /**
   * Computes cosine similarity between two embedding vectors.
   * Useful for semantic search ranking.
   */
  static cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new RangeError('Embedding vectors must have the same dimension.');
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  get inputQuota() {
    return MAX_INPUT_TOKENS;
  }

  destroy(reason) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#destructionReason =
      reason ||
      new DOMException('The embedder has been destroyed.', 'AbortError');
    this.#model?.dispose?.();
    this.#model = null;
    this.#tokenizer = null;
  }
}

// Global exposure if in browser
if (typeof globalThis !== 'undefined' && globalThis.document) {
  const apiName = 'SemanticEmbedder';
  const forceFlag = '__FORCE_SEMANTIC_EMBEDDER_POLYFILL__';
  const isForced = !!globalThis[forceFlag];

  const inject = (win) => {
    try {
      if (!win || (win[apiName] && !win[apiName].__isPolyfill)) {
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
        win[apiName] = LocalAPI;
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

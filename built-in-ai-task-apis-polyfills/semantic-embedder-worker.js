/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker half of the SemanticEmbedder polyfill: everything that touches
 * Transformers.js runs here, and nothing here touches the DOM.
 *
 * Transformers.js is imported statically on purpose. A dynamic `import()` is
 * rewritten by bundlers into a preload helper that reaches for `document` to
 * inject `<link rel="modulepreload">` tags whenever the import pulls in
 * dependency chunks, which throws `document is not defined` the moment this
 * module runs as a worker. A static import carries no such wrapper. Laziness
 * is preserved regardless, because the main thread only ever reaches this
 * module by spawning a worker from it.
 */

import {
  AutoModel,
  AutoTokenizer,
  ModelRegistry,
  env,
} from '@huggingface/transformers';
import {
  applyPrefix,
  EMBEDDING_SPACE,
  MAX_INPUT_TOKENS,
} from './semantic-embedder-constants.js';

// Share cached model weights across different origins when the
// Cross-Origin Storage extension is present.
env.experimental_useCrossOriginStorage = true;

let envConfigured = false;

/**
 * Applies caller-supplied Transformers.js `env` overrides, once, before any
 * model is loaded.
 *
 * The main reason this exists is `backends.onnx.wasm.wasmPaths`. Left alone,
 * Transformers.js points the ONNX runtime at a jsDelivr CDN, so the WebAssembly
 * binaries are fetched from the network at runtime. Callers that must not load
 * remote code, such as a Chrome extension bound by the Manifest V3 rule against
 * remotely hosted code, pass a local directory here instead.
 *
 * @param {Object} [overrides] - A partial Transformers.js `env` object.
 */
function configureEnv(overrides) {
  if (envConfigured || !overrides) {
    return;
  }
  envConfigured = true;

  const merge = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        target[key] &&
        typeof target[key] === 'object'
      ) {
        merge(target[key], value);
      } else {
        target[key] = value;
      }
    }
  };
  merge(env, overrides);
}

async function isModelCached(modelId, dtype) {
  try {
    // include_processor: false avoids a network request for preprocessor_config.json,
    // which this model doesn't have and would otherwise produce a 404.
    const result = await ModelRegistry.is_cached_files(modelId, {
      dtype,
      include_processor: false,
    });
    // generation_config.json is an optional text-generation config that the
    // transformers.js cache doesn't always persist; exclude it from the check.
    const essential = result.files.filter(
      (f) => f.file !== 'generation_config.json',
    );
    return essential.length > 0 && essential.every((f) => f.cached);
  } catch {
    return false;
  }
}

const abortedRequests = new Set();
let workerTokenizer = null;
let workerModel = null;

const initWorkerModel = async (modelId, dtype, hasMonitor) => {
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

  // Every entry point carries the env overrides, because a temporary worker
  // handling `availability` may be the only one this page ever spawns.
  configureEnv(msg.env ?? msg.payload?.env);

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
        applyPrefix(text, options.taskType),
      );

      // Measure each input on its own first, so the reported token count is
      // the length of the text as given rather than of the padded, truncated
      // batch. Counting the batch in one pass is not an option: padding it
      // to an over-long member throws inside the tokenizer.
      const tokenCounts = prefixedInputs.map((text) =>
        workerTokenizer(text).input_ids.dims.at(-1),
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
        statistics: {
          tokenCount: tokenCounts[i],
          truncated: tokenCounts[i] > MAX_INPUT_TOKENS,
        },
      }));

      const result = {
        embeddings,
        metadata: {
          embeddingSpace: EMBEDDING_SPACE,
          maxInputTokens: MAX_INPUT_TOKENS,
        },
      };

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

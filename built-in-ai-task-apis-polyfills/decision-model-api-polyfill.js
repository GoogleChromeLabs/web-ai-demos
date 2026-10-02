/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DecisionModel API Polyfill
 * Implements the proposed Decisions API
 * (https://github.com/explainers-by-googlers/decisions-api) on top of one of
 * two in-browser "System One" decision model runtimes. Pick one by setting
 * `window.DECISION_MODEL_CONFIG.backend` before calling `create()`:
 *
 * - `'laya'` (default): Laya (https://github.com/johnhenry/laya-js) runs the
 *   Laya ModernBERT checkpoints on WebGPU, or on the CPU without it.
 * - `'open-jev'`: open-jev (https://github.com/nico-martin/open-jev) runs the
 *   kev and open-jev ONNX models via @huggingface/transformers, on WebGPU or
 *   WebAssembly.
 *
 * Both score the schema's options in a single forward pass, so every answer
 * is one of the options the caller defined. Like the SemanticEmbedder
 * polyfill, the model runs in a dedicated worker that re-loads this module,
 * which keeps inference off the main thread.
 */

/* global WorkerGlobalScope */

import { BaseTaskModel } from './base-task-model.js';

const CONFIG_GLOBAL = 'DECISION_MODEL_CONFIG';
const DEFAULT_BACKEND = 'laya';

const BACKENDS = {
  'open-jev': {
    defaultModel: 'kev-0.6b',
    // All of open-jev's models are trained on English text only.
    languages: ['en'],
  },
  laya: {
    defaultModel: 'convaiinnovations/laya',
    // The default repo holds an English checkpoint at its root and an mmBERT
    // one, which covers many more languages, in `multilingual/`.
    multilingualSubfolder: 'multilingual',
    languages: ['en'],
  },
};

const QUESTION_TYPES = new Set(['binary', 'categorical', 'ordinal']);
const BINARY_LABELS = ['true', 'false'];

// The explainer asks for bounded numeric precision to limit fingerprinting.
const PRECISION = 1e4;

// Tracks which models are currently being downloaded.
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

function createError(name, message) {
  if (['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(name)) {
    return new globalThis[name](message);
  }
  return new DOMException(message, name);
}

function abortError(signal) {
  return signal?.reason || new DOMException('Aborted', 'AbortError');
}

// Option text as the models see it, so descriptions inform the scoring.
function optionText({ label, description }) {
  return description ? `${label}: ${description}` : label;
}

// Developer text, kept apart from the user's input, which goes into the state.
function instructionsFor(question, context) {
  return context ? `${context}\n${question.prompt}` : question.prompt;
}

/**
 * Validates a schema and returns a structured-cloneable copy of it. Throws a
 * `TypeError` for malformed schemas and a `RangeError` for invalid language
 * tags, like the other Built-in AI APIs do for invalid options.
 */
function normalizeSchema(schema, method) {
  const fail = (message) => {
    throw new TypeError(
      `Failed to execute '${method}' on 'DecisionModel': ${message}`,
    );
  };
  if (!schema || typeof schema !== 'object') {
    fail('The schema must be an object.');
  }
  const { context, expectedInputs = [], questions } = schema;
  if (context !== undefined && typeof context !== 'string') {
    fail('The schema `context` must be a string.');
  }
  if (!Array.isArray(expectedInputs)) {
    fail('The schema `expectedInputs` must be an array.');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    fail('The schema needs at least one question.');
  }

  const ids = new Set();
  const normalizedQuestions = questions.map((question, i) => {
    const { id, type, prompt, options } = question ?? {};
    if (typeof id !== 'string' || id === '') {
      fail(`Question ${i} needs a non-empty string \`id\`.`);
    }
    if (ids.has(id)) {
      fail(`The question id '${id}' is used more than once.`);
    }
    ids.add(id);
    if (!QUESTION_TYPES.has(type)) {
      fail(
        `The provided value '${type}' for question '${id}' is not a valid enum value of type DecisionQuestionType.`,
      );
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      fail(`Question '${id}' needs a non-empty \`prompt\`.`);
    }
    if (type === 'binary') {
      return { id, type, prompt };
    }
    if (!Array.isArray(options) || options.length < 2) {
      fail(`The ${type} question '${id}' needs at least two options.`);
    }
    const labels = new Set();
    return {
      id,
      type,
      prompt,
      options: options.map((option) => {
        const { label, description } = option ?? {};
        if (typeof label !== 'string' || label.trim() === '') {
          fail(`Every option of question '${id}' needs a non-empty \`label\`.`);
        }
        if (labels.has(label)) {
          fail(`Question '${id}' has the option '${label}' more than once.`);
        }
        labels.add(label);
        if (description !== undefined && typeof description !== 'string') {
          fail(`The description of option '${label}' must be a string.`);
        }
        return description ? { label, description } : { label };
      }),
    };
  });

  const inputTypes = new Set();
  const languages = new Set();
  for (const input of expectedInputs) {
    inputTypes.add(input?.type);
    for (const tag of input?.languages ?? []) {
      languages.add(BaseTaskModel._validateLanguageTag(tag));
    }
  }

  return {
    context: context || '',
    questions: normalizedQuestions,
    inputTypes: [...inputTypes],
    languages: [...languages],
  };
}

/**
 * Reads `window.DECISION_MODEL_CONFIG` and resolves the model for the
 * requested languages. Returns `null` when the backend can't serve them.
 */
function resolveBackendConfig(languages, win) {
  const config = win?.[CONFIG_GLOBAL] ?? globalThis[CONFIG_GLOBAL] ?? {};
  const backend = config.backend ?? DEFAULT_BACKEND;
  const info = BACKENDS[backend];
  if (!info) {
    throw new TypeError(
      `Unknown ${CONFIG_GLOBAL}.backend '${backend}'. Expected one of: ${Object.keys(BACKENDS).join(', ')}.`,
    );
  }
  const onlyEnglish = languages.every((tag) => tag.split('-')[0] === 'en');

  if (backend === 'open-jev') {
    if (!onlyEnglish) {
      return null;
    }
    return {
      backend,
      model: config.model ?? info.defaultModel,
      dtype: config.dtype ?? 'auto',
      device: config.device ?? 'auto',
    };
  }

  // A custom Laya model is trusted to cover the languages it was asked for.
  // The default repo switches to its multilingual checkpoint when needed.
  let subfolder = config.subfolder ?? '';
  if (!config.model && config.subfolder === undefined && !onlyEnglish) {
    subfolder = info.multilingualSubfolder;
  }
  return {
    backend,
    model: config.model ?? info.defaultModel,
    subfolder,
    revision: config.revision ?? 'main',
    // Laya calls its runtime a "backend"; `device` keeps the two apart.
    device: config.device ?? 'auto',
    dtype: config.dtype ?? 'f16',
  };
}

function modelKey(config) {
  return [config.backend, config.model, config.subfolder ?? ''].join(':');
}

/**
 * Turns the probabilities of one question, in option order, into the result
 * shape from the explainer.
 */
function toResult(question, distribution) {
  const round = (x) => Math.round(x * PRECISION) / PRECISION;
  const labels =
    question.type === 'binary'
      ? BINARY_LABELS
      : question.options.map(({ label }) => label);
  let best = 0;
  for (let i = 1; i < distribution.length; i++) {
    if (distribution[i] > distribution[best]) {
      best = i;
    }
  }
  const [first, second = 0] = [...distribution].sort((a, b) => b - a);
  const result = {
    id: question.id,
    label: labels[best],
    probability: round(distribution[best]),
    // The margin between the two most likely options, which is high only
    // when the model clearly prefers one answer. This matches the
    // explainer's examples, where a p(true) of 0.98 has a confidence of 0.96.
    // It is also comparable across both backends, which compute their own
    // confidence values differently.
    confidence: round(first - second),
    probabilities: labels.map((label, i) => ({
      label,
      probability: round(distribution[i]),
    })),
  };
  if (question.type === 'ordinal') {
    // The expected 1-based position on the scale, so a four-level scale
    // labeled "1" to "4" yields a score between 1 and 4.
    result.expectedScore = round(
      distribution.reduce((sum, p, i) => sum + p * (i + 1), 0),
    );
  }
  return result;
}

const quotaError = (message) =>
  Object.assign(new Error(message), { name: 'QuotaExceededError' });

/**
 * Backend adapters. Each `load()` resolves to an engine whose `prepare()`
 * converts the schema once, and whose `decide()` returns one probability
 * array per question, in option order (`[p(true), p(false)]` for binary).
 */
const engines = {
  'open-jev': {
    // open-jev falls back to WebAssembly with 4-bit weights without WebGPU,
    // but onnxruntime-web's WebAssembly build has no kernel for their
    // quantized embedding lookup (`GatherBlockQuantized`), and the kev
    // models ship no other weights.
    async isSupported({ device, dtype }) {
      const webgpu =
        device === 'webgpu' ||
        (device === 'auto' && !!(await navigator.gpu?.requestAdapter()));
      return webgpu || !(dtype === 'auto' || dtype.startsWith('q4'));
    },

    async isCached({ model, dtype, device }) {
      await ensureTransformers();
      const { OpenJev } = await import('open-jev');
      const { isCached } = await OpenJev.info({ model, dtype, device });
      return isCached;
    },

    async load({ model, dtype, device }, onProgress) {
      await ensureTransformers();
      const { OpenJev } = await import('open-jev');
      const jev = await OpenJev.load({
        model,
        dtype,
        device,
        // Fail loudly instead of silently dropping the end of the input.
        truncation: 'error',
        onProgress: ({ progress }) => onProgress(progress),
      });

      let questions = null;
      let native = null;
      return {
        prepare(schema) {
          questions = schema.questions;
          native = questions.map((question) => {
            const instructions = instructionsFor(question, schema.context);
            if (question.type === 'binary') {
              return { type: 'noul', instructions };
            }
            if (question.type === 'categorical') {
              return {
                type: 'choice',
                instructions,
                options: question.options.map(({ label }) => label),
                descriptions: Object.fromEntries(
                  question.options
                    .filter(({ description }) => description)
                    .map(({ label, description }) => [label, description]),
                ),
              };
            }
            // Score questions take no descriptions, so they go into the
            // level text.
            return {
              type: 'score',
              instructions,
              options: question.options.map(optionText),
            };
          });
        },

        async decide(state) {
          let answers;
          try {
            answers = await jev.decide(state, native);
          } catch (err) {
            // open-jev's own message suggests its `truncation` option, which
            // the polyfill doesn't expose.
            const cut = /^State was cut to (\d+) tokens/.exec(err.message);
            if (cut) {
              throw quotaError(
                `The input is too long: the questions leave room for ${cut[1]} tokens.`,
              );
            }
            if (/token context/.test(err.message)) {
              throw quotaError(err.message);
            }
            throw err;
          }
          return answers.map((answer, i) => {
            const question = questions[i];
            if (question.type === 'binary') {
              return [answer.probability, 1 - answer.probability];
            }
            return native[i].options.map(
              (option) => answer.probabilities[option],
            );
          });
        },

        destroy: () => jev.dispose(),
      };
    },
  },

  laya: {
    // Laya's CPU backend runs wherever WebGPU doesn't.
    isSupported: async () => true,

    async isCached({ model, subfolder, revision }) {
      // Laya keeps Hub downloads in the Cache API, keyed by commit-pinned
      // resolve URLs, with the branch-to-commit mapping stored next to them.
      const { CHECKPOINT_FILES } = await import('@johnhenry/laya');
      const cache = await caches.open('hf-cache');
      const base = `https://huggingface.co/${model}`;
      let commit = revision;
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        const ref = await cache.match(
          `${base}/refs/${encodeURIComponent(revision)}`,
        );
        if (!ref) {
          return false;
        }
        commit = (await ref.text()).trim();
      }
      const prefix = subfolder ? `${subfolder}/` : '';
      for (const file of CHECKPOINT_FILES) {
        const path = `${prefix}${file}`
          .split('/')
          .map(encodeURIComponent)
          .join('/');
        if (!(await cache.match(`${base}/resolve/${commit}/${path}`))) {
          return false;
        }
      }
      return true;
    },

    async load({ model, subfolder, revision, device, dtype }, onProgress) {
      const { load } = await import('@johnhenry/laya');
      // Laya reports progress per file, so sum up the bytes of all files.
      const files = new Map();
      const agent = await load(model, {
        backend: device,
        dtype,
        revision,
        ...(subfolder ? { subfolder } : {}),
        onProgress: ({ file, loaded, total }) => {
          files.set(file, { loaded, total: total ?? loaded });
          let sumLoaded = 0;
          let sumTotal = 0;
          for (const entry of files.values()) {
            sumLoaded += entry.loaded;
            sumTotal += entry.total;
          }
          onProgress(sumTotal > 0 ? sumLoaded / sumTotal : 0);
        },
      });

      let questions = null;
      let native = null;
      let inputQuota = Infinity;
      return {
        prepare(schema) {
          questions = schema.questions;
          native = Object.fromEntries(
            questions.map((question) => {
              const instructions = instructionsFor(question, schema.context);
              if (question.type === 'binary') {
                return [question.id, { type: 'noul', instructions }];
              }
              if (question.type === 'categorical') {
                const hasDescriptions = question.options.some(
                  ({ description }) => description,
                );
                return [
                  question.id,
                  {
                    type: 'choice',
                    instructions,
                    // A list keeps the option order; an object adds the
                    // descriptions.
                    criteria: hasDescriptions
                      ? Object.fromEntries(
                          question.options.map(({ label, description }) => [
                            label,
                            description ?? null,
                          ]),
                        )
                      : question.options.map(({ label }) => label),
                  },
                ];
              }
              return [
                question.id,
                {
                  type: 'score',
                  instructions,
                  criteria: question.options.map(optionText),
                },
              ];
            }),
          );
          // Laya silently cuts the state to whatever room each question
          // leaves in the sequence. With an empty state, a sequence is the
          // question prefix plus one separator, so the room left is the
          // maximum length minus that.
          const maxLength = agent.config.max_len ?? 512;
          const { items } = agent.prepare('', native);
          inputQuota = Math.min(
            ...items.map(({ ids }) => maxLength - ids.length),
          );
        },

        async decide(state) {
          const { maskToken } = agent.tokenizer;
          const tokens = agent.tokenizer.encode(
            state.split(maskToken).join(' '),
          ).length;
          if (tokens > inputQuota) {
            throw quotaError(
              `The input needs ${tokens} tokens, but the questions leave room for ${inputQuota}.`,
            );
          }
          const { answers } = await agent.predict(state, native);
          return questions.map((question) => {
            const answer = answers[question.id];
            if (question.type === 'binary') {
              return [answer.noul, 1 - answer.noul];
            }
            if (question.type === 'categorical') {
              return question.options.map(
                ({ label }) => answer.probabilities[label],
              );
            }
            return question.options.map(
              (_, i) => answer.probabilities[String(i)],
            );
          });
        },

        destroy: () => agent.dispose(),
      };
    },
  },
};

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
  const done = () => {
    worker.terminate();
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  };
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const { type, result, error } = e.data;
      if (type === 'response') {
        resolve(result);
        done();
      } else if (type === 'error') {
        reject(new Error(error));
        done();
      }
    };
    worker.onerror = (err) => {
      reject(err);
      done();
    };
    worker.postMessage({ action, payload });
  });
}

if (isWorker) {
  const abortedRequests = new Set();
  let engine = null;

  const postError = (type, err, extra = {}) => {
    self.postMessage({
      type,
      ...extra,
      error: err.message,
      name: err.name || 'Error',
    });
  };

  self.onmessage = async (e) => {
    const msg = e.data;

    // Support static actions from temporary workers
    if (msg.action === 'availability') {
      try {
        const { config } = msg.payload;
        const engine = engines[config.backend];
        let status = 'unavailable';
        if (await engine.isSupported(config)) {
          status = 'downloadable';
          try {
            if (await engine.isCached(config)) {
              status = 'available';
            }
          } catch {
            // Not cached, or the Hub is unreachable. A download may still
            // work.
          }
        }
        self.postMessage({ type: 'response', result: status });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      }
      return;
    }

    // Instance-level actions
    if (msg.type === 'init') {
      try {
        const { config, schema, hasMonitor } = msg;
        const onProgress = (loaded) => {
          if (hasMonitor) {
            self.postMessage({ type: 'progress', loaded });
          }
        };
        if (!(await engines[config.backend].isSupported(config))) {
          throw createError(
            'NotSupportedError',
            `The ${config.backend} backend needs WebGPU for this model. Use the laya backend, which also runs on the CPU.`,
          );
        }
        engine = await engines[config.backend].load(config, onProgress);
        engine.prepare(schema);
        // Deciding on an empty input checks the questions against the
        // model's limits now, and warms up the GPU pipelines for the first
        // real call.
        await engine.decide('');
        self.postMessage({ type: 'ready' });
      } catch (err) {
        postError('init-error', err);
      }
    } else if (msg.type === 'decide') {
      const { requestId, input, questions } = msg;
      try {
        if (!engine) {
          throw new Error('Model is not initialized in the worker.');
        }
        const distributions = await engine.decide(input);
        if (abortedRequests.has(requestId)) {
          abortedRequests.delete(requestId);
          throw new DOMException('Aborted', 'AbortError');
        }
        const result = Object.fromEntries(
          questions.map((question, i) => [
            question.id,
            toResult(question, distributions[i]),
          ]),
        );
        self.postMessage({ type: 'decide-response', requestId, result });
      } catch (err) {
        abortedRequests.delete(requestId);
        postError('decide-error', err, { requestId });
      }
    } else if (msg.type === 'abort-decide') {
      abortedRequests.add(msg.requestId);
    }
  };
}

export class DecisionModel {
  #worker = null;
  #questions = null;
  #destroyed = false;
  #destructionReason = null;
  #pendingRequests = new Map();
  #nextRequestId = 0;

  constructor(worker, questions) {
    this.#worker = worker;
    this.#questions = questions;

    this.#worker.onmessage = (e) => {
      if (this.#destroyed) {
        return;
      }
      const msg = e.data;
      const req = this.#pendingRequests.get(msg.requestId);
      if (!req) {
        return;
      }
      this.#pendingRequests.delete(msg.requestId);
      if (msg.type === 'decide-response') {
        req.resolve(msg.result);
      } else if (msg.type === 'decide-error') {
        req.reject(createError(msg.name, msg.error));
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
    BaseTaskModel._checkContext.call(this);
  }

  _checkContext() {
    this.constructor._checkContext();
  }

  // Resolves the schema and configuration shared by `availability()` and
  // `create()`. `config` is `null` when the backend can't serve the schema.
  static _resolve(schema, method) {
    this._checkContext();
    // Only `availability()` may be asked without a schema.
    const normalized =
      method === 'availability' && schema === undefined
        ? null
        : normalizeSchema(schema, method);
    const config = resolveBackendConfig(
      normalized?.languages ?? [],
      this.__window,
    );
    const textOnly = (normalized?.inputTypes ?? []).every((t) => t === 'text');
    return {
      schema: normalized,
      config: textOnly && typeof WebAssembly !== 'undefined' ? config : null,
    };
  }

  static availability(schema) {
    const p = (async () => {
      const { config } = this._resolve(schema, 'availability');
      if (!config) {
        return 'unavailable';
      }
      if (downloadingModels.has(modelKey(config))) {
        return 'downloading';
      }
      return runInTemporaryWorker('availability', { config });
    })();
    p.catch(() => {});
    return p;
  }

  static create(schema) {
    const p = this._createInternal(schema);
    p.catch(() => {});
    return p;
  }

  static async _createInternal(options) {
    const { schema, config } = this._resolve(options, 'create');
    const { signal, monitor } = options;

    if (signal?.aborted) {
      throw abortError(signal);
    }
    if (!config) {
      throw new DOMException(
        'The model does not support the requested input types or languages.',
        'NotSupportedError',
      );
    }

    let fireProgressEvent = null;
    if (monitor) {
      const monitorTarget = new EventTarget();
      monitor(monitorTarget);
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

    const key = modelKey(config);
    downloadingModels.add(key);

    const url = getWorkerUrl();
    const worker = new Worker(url, { type: 'module' });
    const revokeUrl = () => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };

    let cleanup = null;

    const readyPromise = new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          // The final event fires once the model is ready.
          fireProgressEvent?.(Math.min(msg.loaded, 0.99));
        } else if (msg.type === 'ready') {
          revokeUrl();
          resolve();
        } else if (msg.type === 'init-error') {
          revokeUrl();
          reject(createError(msg.name, msg.error));
        }
      };

      const onError = (err) => {
        revokeUrl();
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
    const abortPromise = new Promise((_, reject) => {
      if (signal) {
        abortHandler = () => reject(abortError(signal));
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });

    try {
      worker.postMessage({
        type: 'init',
        config,
        schema,
        hasMonitor: !!monitor,
      });

      await Promise.race([readyPromise, abortPromise]);
    } catch (err) {
      worker.terminate();
      revokeUrl();
      throw err;
    } finally {
      cleanup?.();
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      downloadingModels.delete(key);
    }

    fireProgressEvent?.(1);

    const model = new this(worker, schema.questions);

    if (signal) {
      signal.addEventListener('abort', () => model.destroy(signal.reason), {
        once: true,
      });
    }

    return model;
  }

  decide(input, options = {}) {
    if (this.#destroyed) {
      const p = Promise.reject(
        this.#destructionReason ||
          new DOMException('The model has been destroyed.', 'AbortError'),
      );
      p.catch(() => {});
      return p;
    }
    const p = this.#decideInternal(input, options);
    p.catch(() => {});
    return p;
  }

  async #decideInternal(input, options = {}) {
    this._checkContext();

    const { signal } = options;
    if (signal?.aborted) {
      throw abortError(signal);
    }

    // Structured page state is serialized; anything else becomes a string,
    // as a WebIDL `DOMString` argument would.
    const state =
      input !== null && typeof input === 'object'
        ? JSON.stringify(input)
        : String(input);

    const requestId = ++this.#nextRequestId;

    return new Promise((resolve, reject) => {
      let onAbort = null;

      if (signal) {
        onAbort = () => {
          this.#pendingRequests.delete(requestId);
          this.#worker?.postMessage({ type: 'abort-decide', requestId });
          reject(abortError(signal));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const settle = (fn) => (value) => {
        if (onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        fn(value);
      };

      this.#pendingRequests.set(requestId, {
        resolve: settle(resolve),
        reject: settle(reject),
      });

      this.#worker?.postMessage({
        type: 'decide',
        requestId,
        input: state,
        questions: this.#questions,
      });
    });
  }

  destroy(reason) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#destructionReason =
      reason || new DOMException('The model has been destroyed.', 'AbortError');

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
BaseTaskModel.exposeAPIGlobally(
  'DecisionModel',
  DecisionModel,
  '__FORCE_DECISION_MODEL_POLYFILL__',
);

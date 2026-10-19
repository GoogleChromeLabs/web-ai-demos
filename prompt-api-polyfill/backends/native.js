/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import PolyfillBackend from './base.js';

/**
 * Native backend: hands every call to on-device models in the host app.
 *
 * This is what lets a browser without a Blink implementation of the built-in
 * AI APIs, such as Chrome for iOS on WebKit, back them with Apple Foundation
 * Models and Gemma 4. The host injects a transport into the page and sets:
 *
 *   window.NATIVE_CONFIG = { bridge: '__builtInAINativeBridge' };
 *
 * `bridge` names a global with two methods:
 *
 * - `send(message)` posts a plain object to the host.
 * - `listen(callback)` registers the one function the host calls with every
 *   event it sends back.
 *
 * Each message carries an `id` and a `cmd`. The host answers with events for
 * that `id`: any number of `chunk` and `progress` events, then exactly one
 * `result` or `error`.
 *
 * The host keeps the model sessions. The polyfill keeps the conversation and
 * sends all of it with each turn, so the host can rebuild a session from
 * scratch whenever it has to.
 */

const DEFAULT_BRIDGE = '__builtInAINativeBridge';

/** One client per transport, shared by every session of the page. */
const clients = new WeakMap();

class NativeClient {
  #transport;
  #pending = new Map();

  constructor(transport) {
    this.#transport = transport;
    transport.listen((event) => this.#dispatch(event));
  }

  static for(config = {}) {
    const name = config.bridge || DEFAULT_BRIDGE;
    const transport = globalThis[name];
    if (
      !transport ||
      typeof transport.send !== 'function' ||
      typeof transport.listen !== 'function'
    ) {
      throw new DOMException(
        `Prompt API Polyfill: The native bridge "${name}" is missing.`,
        'NotSupportedError'
      );
    }
    let client = clients.get(transport);
    if (!client) {
      client = new NativeClient(transport);
      clients.set(transport, client);
    }
    return client;
  }

  /**
   * Sends one command and resolves with its result.
   * @param {string} cmd - The command.
   * @param {Object} payload - The rest of the message.
   * @param {Object} [handlers] - `onChunk(text)` and `onProgress(loaded)`.
   * @returns {{id: string, promise: Promise<any>}}
   */
  call(cmd, payload = {}, handlers = {}) {
    const id = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, ...handlers });
    });
    this.#transport.send({ ...payload, id, cmd });
    return { id, promise };
  }

  /** Sends a command whose answer nobody waits for. */
  notify(cmd, payload = {}) {
    const { promise } = this.call(cmd, payload);
    promise.catch(() => {});
  }

  #dispatch(event) {
    const pending = this.#pending.get(event?.id);
    if (!pending) {
      return;
    }
    switch (event.type) {
      case 'chunk':
        pending.onChunk?.(event.text);
        break;
      case 'progress':
        pending.onProgress?.(event.loaded);
        break;
      case 'result':
        this.#pending.delete(event.id);
        pending.resolve(event.value);
        break;
      case 'error':
        this.#pending.delete(event.id);
        pending.reject(new DOMException(event.message, event.name));
        break;
    }
  }
}

/**
 * Drops what the host cannot use or must not see: callbacks, signals, and the
 * initial prompts, which reach it as part of every conversation anyway.
 * @param {Object} options - LanguageModel options.
 * @param {Object} config - `NATIVE_CONFIG`.
 * @returns {Object} Options the host understands.
 */
function hostOptions(options = {}, config = {}) {
  const result = {};
  for (const key of ['expectedInputs', 'expectedOutputs']) {
    if (Array.isArray(options[key])) {
      result[key] = options[key].map(({ type, languages }) => ({
        type,
        ...(languages ? { languages: [...languages] } : {}),
      }));
    }
  }
  for (const key of ['temperature', 'topK']) {
    if (typeof options[key] === 'number') {
      result[key] = options[key];
    }
  }
  if (config.backend) {
    result.backend = config.backend;
  }
  return result;
}

export default class NativeBackend extends PolyfillBackend {
  #config;
  #client;
  #sessionId = crypto.randomUUID();
  #created;
  #contextWindow;
  #schema;
  #omitSchemaInput = false;

  constructor(config = {}) {
    super(config.modelName || 'native');
    this.#config = config;
    this.#client = NativeClient.for(config);
  }

  /**
   * The host's answer, so the page sees whether the model is ready, still to
   * be downloaded, or missing for these options.
   * @param {Object} options - LanguageModel options.
   * @param {Object} [config] - `NATIVE_CONFIG`.
   * @returns {Promise<string>}
   */
  static async availability(options = {}, config = {}) {
    return NativeClient.for(config).call('availability', {
      options: hostOptions(options, config),
    }).promise;
  }

  /** The context window of the model the host picked for this session. */
  get contextWindow() {
    return this.#contextWindow;
  }

  /**
   * Creates the host session on the first call. The polyfill calls this
   * again, without awaiting it, whenever a prompt's `responseConstraint`
   * changes, so the schema is taken before anything is awaited.
   */
  createSession(options, sessionParams, monitorTarget) {
    this.#schema = sessionParams.generationConfig?.responseSchema;
    this.#omitSchemaInput = Boolean(sessionParams.omitResponseConstraintInput);
    this.#created ??= this.#create(options, sessionParams, monitorTarget);
    return this.#created;
  }

  async #create(options, sessionParams, monitorTarget) {
    const { promise } = this.#client.call(
      'create',
      {
        session: this.#sessionId,
        options: {
          ...hostOptions(options, this.#config),
          systemInstruction: sessionParams.systemInstruction,
        },
        // A download needs a user gesture, and only the page can tell.
        userActivated: Boolean(globalThis.navigator?.userActivation?.isActive),
      },
      {
        onProgress: (loaded) => {
          if (!monitorTarget || loaded <= monitorTarget.__lastProgressLoaded) {
            return;
          }
          // The polyfill dispatches 0 and 1 itself.
          if (loaded <= 0 || loaded >= 1) {
            return;
          }
          // Rounded down to 1/65536 and strictly increasing, as the spec
          // requires.
          const rounded = Math.floor(loaded * 65536) / 65536;
          if (rounded <= monitorTarget.__lastProgressLoaded) {
            return;
          }
          monitorTarget.dispatchEvent(
            new ProgressEvent('downloadprogress', {
              loaded: rounded,
              total: 1,
              lengthComputable: true,
            })
          );
          monitorTarget.__lastProgressLoaded = rounded;
        },
      }
    );
    try {
      const session = await promise;
      this.#contextWindow = session.contextWindow;
      this.backendName = session.backend;
      return session;
    } catch (error) {
      this.#created = undefined;
      throw error;
    }
  }

  dispose() {
    if (!this.#created) {
      return;
    }
    const created = this.#created;
    this.#created = undefined;
    // Destroy only once the host has the session, or it would outlive this.
    created.then(
      () => this.#client.notify('destroy', { session: this.#sessionId }),
      () => {}
    );
  }

  #generateMessage(contents, stream) {
    return {
      session: this.#sessionId,
      contents,
      stream,
      ...(this.#schema
        ? { schema: this.#schema, omitSchemaInput: this.#omitSchemaInput }
        : {}),
    };
  }

  async generateContent(contents) {
    await this.#created;
    const { text, usage } = await this.#client.call(
      'generate',
      this.#generateMessage(contents, false)
    ).promise;
    return { text, usage };
  }

  async generateContentStream(contents) {
    await this.#created;
    const queue = [];
    let wake;
    let done = false;
    let failure;
    let usage = 0;

    const { id, promise } = this.#client.call(
      'generate',
      this.#generateMessage(contents, true),
      {
        onChunk: (text) => {
          queue.push(text);
          wake?.();
        },
      }
    );
    promise.then(
      (result) => {
        usage = result.usage;
        done = true;
        wake?.();
      },
      (error) => {
        failure = error;
        done = true;
        wake?.();
      }
    );

    const client = this.#client;
    return (async function* () {
      try {
        while (true) {
          if (queue.length) {
            const text = queue.shift();
            yield { text: () => text, usageMetadata: { totalTokenCount: 0 } };
            continue;
          }
          if (done) {
            break;
          }
          await new Promise((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
        if (failure) {
          throw failure;
        }
        yield { text: () => '', usageMetadata: { totalTokenCount: usage } };
      } finally {
        // The reader went away early: stop the model instead of letting it
        // finish a response nobody reads.
        if (!done) {
          client.notify('abort', { target: id });
        }
      }
    })();
  }

  async countTokens(contents) {
    await this.#created;
    return this.#client.call('countTokens', {
      session: this.#sessionId,
      contents,
    }).promise;
  }
}

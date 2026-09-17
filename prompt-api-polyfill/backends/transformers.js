/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ModelRegistry,
  pipeline,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import { StructuredOutputProcessor } from '@huggingface/transformers-structured-output';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Pipelines currently loaded, shared by every session using the same model,
 * device, and dtype (each combination loads different weights).
 *
 * `LanguageModel#clone()` creates a new backend instance so that per-session
 * state stays separate. The pipeline is not per-session state, though: it is
 * the model weights on the device. Holding one per backend instance meant
 * every clone called `pipeline()` again and reloaded the whole model.
 *
 * @type {Map<string, {generator: Promise<Object>, ready: boolean, users: number}>}
 */
const generators = new Map();

const generatorKey = (modelName, device, dtype) =>
  `${modelName}|${device}|${dtype}`;

/**
 * Tokenizers that structured output constrains generation with, by pipeline.
 * Preparing a tokenizer for constraints is expensive and cached per tokenizer
 * object, so every session sharing a pipeline must share this one, too.
 * @type {WeakMap<Object, Object>}
 */
const constraintTokenizers = new WeakMap();

/**
 * Returns the tokenizer to constrain generation with. Some tokenizers know
 * more tokens than the model has logits for, for example Gemma 3's
 * `<image_soft_token>`, which the text-only model never produces. The
 * structured output processor rejects logits smaller than the vocabulary, so
 * those tokens are left out.
 * @param {Object} generator - The text generation pipeline.
 * @returns {Object} The tokenizer.
 */
const constraintTokenizer = (generator) => {
  let tokenizer = constraintTokenizers.get(generator);
  if (tokenizer) {
    return tokenizer;
  }
  tokenizer = generator.tokenizer;
  const { config } = generator.model;
  const vocabSize = config.vocab_size ?? config.text_config?.vocab_size;
  const json = tokenizer._tokenizerJSON;
  if (
    Number.isInteger(vocabSize) &&
    json?.added_tokens?.some((token) => token.id >= vocabSize)
  ) {
    tokenizer = Object.create(tokenizer, {
      _tokenizerJSON: {
        value: {
          ...json,
          added_tokens: json.added_tokens.filter(
            (token) => token.id < vocabSize
          ),
        },
      },
      all_special_ids: {
        value: tokenizer.all_special_ids?.filter((id) => id < vocabSize),
      },
      decode: { value: tokenizer.decode.bind(tokenizer) },
    });
  }
  constraintTokenizers.set(generator, tokenizer);
  return tokenizer;
};

/**
 * Transformers.js (ONNX Runtime) Backend
 */
export default class TransformersBackend extends PolyfillBackend {
  #generator;
  #generatorReady;
  #shared;
  #tokenizer;
  #device;
  #dtype;
  #systemInstruction;
  #responseFormat;
  #omitResponseConstraintInput;

  constructor(config = {}) {
    super(config.modelName || DEFAULT_MODELS.transformers.modelName);
    this.#device =
      config.device || DEFAULT_MODELS.transformers.device || 'webgpu';
    this.#dtype = config.dtype || DEFAULT_MODELS.transformers.dtype || 'q4f16';

    if (config.isDefault) {
      console.log(
        `Polyfill: No backend configuration found. Defaulting to Transformers.js with model: ${this.modelName}`
      );
    }

    // Use the Cross-Origin Storage API if it's supported.
    env.experimental_useCrossOriginStorage = true;

    if (config.env) {
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
      merge(env, config.env);
    }
  }

  /**
   * Loaded models can be large, so we initialize them lazily.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The generator.
   */
  #ensureGenerator(monitorTarget) {
    // One acquisition per backend instance, however many calls race to it.
    this.#generatorReady ??= this.#acquireGenerator(monitorTarget);
    return this.#generatorReady;
  }

  async #acquireGenerator(monitorTarget) {
    const dispatch = (loaded) => {
      if (!monitorTarget) {
        return;
      }
      // Round to nearest 1/0x10000 (65536) as required by WPT
      const precision = 1 / 65536;
      const roundedLoaded = Math.floor(loaded / precision) * precision;

      // Ensure strict monotonicity using the property set by the polyfill
      if (roundedLoaded <= monitorTarget.__lastProgressLoaded) {
        return;
      }

      monitorTarget.dispatchEvent(
        new ProgressEvent('downloadprogress', {
          loaded: roundedLoaded,
          total: 1,
          lengthComputable: true,
        })
      );
      monitorTarget.__lastProgressLoaded = roundedLoaded;
    };

    const progress_callback = (data) => {
      if (data.status === 'progress_total') {
        dispatch(data.progress / 100);
      } else if (data.status === 'ready') {
        dispatch(1);
      }
    };

    // Initial 0% progress
    dispatch(0);

    const key = generatorKey(this.modelName, this.#device, this.#dtype);
    let shared = generators.get(key);
    if (!shared) {
      // Progress goes to whichever session started the load. Sessions that
      // join a pipeline already loading still see 0 and then 1.
      shared = {
        ready: false,
        users: 0,
        generator: pipeline('text-generation', this.modelName, {
          device: this.#device,
          dtype: this.#dtype,
          progress_callback,
        }),
      };
      generators.set(key, shared);
    }
    shared.users += 1;
    this.#shared = shared;

    try {
      this.#generator = await shared.generator;
      shared.ready = true;
    } catch (error) {
      this.#release();
      // A failed load is not kept, so the next session can try again.
      if (generators.get(key) === shared) {
        generators.delete(key);
      }
      throw error;
    }
    this.#tokenizer = this.#generator.tokenizer;

    // Ensure 100% is dispatched once loading completes
    dispatch(1);
    return this.#generator;
  }

  /**
   * Gives up this session's share of the pipeline, disposing of it once no
   * session is using it any more.
   */
  #release() {
    const shared = this.#shared;
    if (!shared) {
      return;
    }
    this.#shared = undefined;
    this.#generator = undefined;
    this.#generatorReady = undefined;
    shared.users -= 1;
    if (shared.users > 0) {
      return;
    }
    const key = generatorKey(this.modelName, this.#device, this.#dtype);
    if (generators.get(key) === shared) {
      generators.delete(key);
    }
    shared.generator.then((generator) => generator.dispose()).catch(() => {});
  }

  /**
   * Called by the polyfill when the session is destroyed.
   */
  dispose() {
    this.#release();
  }

  /**
   * Checks if the backend is available given the options.
   * @param {Object} options - LanguageModel options.
   * @param {Object} [config] - The backend configuration (`TRANSFORMERS_CONFIG`).
   * @returns {Promise<string>} 'available', 'downloading', 'downloadable', or
   *     'unavailable'.
   */
  static async availability(options, config = {}) {
    if (options?.expectedInputs && Array.isArray(options.expectedInputs)) {
      for (const input of options.expectedInputs) {
        if (input.type === 'audio' || input.type === 'image') {
          return 'unavailable';
        }
      }
    }
    const defaults = DEFAULT_MODELS.transformers;
    const modelName = config.modelName || defaults.modelName;
    const device = config.device || defaults.device || 'webgpu';
    const dtype = config.dtype || defaults.dtype || 'q4f16';

    const shared = generators.get(generatorKey(modelName, device, dtype));
    if (shared) {
      return shared.ready ? 'available' : 'downloading';
    }
    // Look in the same storage a load would use, before any backend instance
    // has had the chance to switch it on.
    env.experimental_useCrossOriginStorage = true;
    // "available" means ready for immediate use. A model that still has to be
    // fetched is "downloadable", which is what lets callers ask the user first.
    // Only the files the text generation pipeline loads count: multimodal
    // models like Gemma 4 also ship audio and vision encoders it never fetches.
    try {
      return (await ModelRegistry.is_pipeline_cached(
        'text-generation',
        modelName,
        { device, dtype }
      ))
        ? 'available'
        : 'downloadable';
    } catch {
      return 'downloadable';
    }
  }

  /**
   * Creates a new session.
   * @param {Object} options - LanguageModel options.
   * @param {Object} sessionParams - Session parameters.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The generator.
   */
  async createSession(options, sessionParams, monitorTarget) {
    // Initializing the generator can be slow, so we do it lazily or here.
    // For now, let's trigger the loading.
    await this.#ensureGenerator(monitorTarget);

    // We don't really have "sessions" in the same way Gemini does,
    // but we can store the generation config.
    this.generationConfig = {
      max_new_tokens: 512, // Default limit
      do_sample: false,
      return_full_text: false,
    };
    this.#systemInstruction = sessionParams.systemInstruction;
    this.responseSchema = sessionParams.generationConfig?.responseSchema;
    this.#omitResponseConstraintInput = Boolean(
      sessionParams.omitResponseConstraintInput
    );
    this.#responseFormat = this.#toResponseFormat(this.responseSchema);

    return this.#generator;
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} contents - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);

    // messages already have schema appended via #contentsToMessages

    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    const output = await generator(prompt, {
      ...this.generationConfig,
      add_special_tokens: false,
      logits_processor: this.#createLogitsProcessor(),
    });
    const text = output[0].generated_text;

    // Approximate usage
    const usage = await this.countTokens(contents);

    return { text, usage };
  }

  /**
   * Generates content stream.
   * @param {Array} contents - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);

    // messages already have schema appended via #contentsToMessages

    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });

    // Counted before generating, like `generateContent()` does.
    const usage = await this.countTokens(contents);

    const queue = [];
    let resolveSignal;
    let promise = new Promise((r) => (resolveSignal = r));
    let isDone = false;
    let generationError;

    const on_token_callback = (text) => {
      queue.push(text);
      if (resolveSignal) {
        resolveSignal();
        resolveSignal = null;
      }
    };

    const streamer = new TextStreamer(this.#tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: on_token_callback,
    });

    const generationPromise = generator(prompt, {
      ...this.generationConfig,
      add_special_tokens: false,
      logits_processor: this.#createLogitsProcessor(),
      streamer,
    });

    generationPromise
      .then(() => {
        isDone = true;
        if (resolveSignal) {
          resolveSignal();
          resolveSignal = null;
        }
      })
      .catch((err) => {
        console.error('[Transformers.js] Generation error:', err);
        generationError = err;
        isDone = true;
        if (resolveSignal) {
          resolveSignal();
          resolveSignal = null;
        }
      });

    return (async function* () {
      while (true) {
        if (queue.length === 0 && !isDone) {
          if (!resolveSignal) {
            promise = new Promise((r) => (resolveSignal = r));
          }
          await promise;
        }

        while (queue.length > 0) {
          const newText = queue.shift();
          yield {
            text: () => newText,
            usageMetadata: { totalTokenCount: usage },
          };
        }

        if (isDone) {
          // For example, a response constraint that reached a dead end.
          if (generationError) {
            throw generationError;
          }
          break;
        }
      }
    })();
  }

  /**
   * Counts tokens.
   * @param {Array} contents - The content to count.
   * @param {Object} [constraint] - The response constraint to count instead
   *     of the current one, as `{responseSchema, omitResponseConstraintInput}`.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(contents, constraint) {
    await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents, constraint);
    const { input_ids } = this.#tokenizer.apply_chat_template(messages, {
      tokenize: true,
      add_generation_prompt: false,
      return_tensor: false,
      return_dict: true,
    });
    return input_ids.length;
  }

  #contentsToMessages(
    contents,
    {
      responseSchema = this.responseSchema,
      omitResponseConstraintInput = this.#omitResponseConstraintInput,
    } = {}
  ) {
    const messages = contents.map((c) => {
      let role =
        c.role === 'model'
          ? 'assistant'
          : c.role === 'system'
            ? 'system'
            : 'user';
      const content = c.parts.map((p) => p.text).join('');
      return { role, content };
    });

    if (this.#systemInstruction && !messages.some((m) => m.role === 'system')) {
      messages.unshift({ role: 'system', content: this.#systemInstruction });
    }

    // Append JSON Schema constraint if present
    if (!omitResponseConstraintInput) {
      this.#appendResponseSchema(messages, responseSchema);
    }

    if (this.modelName.toLowerCase().includes('gemma')) {
      const systemIndex = messages.findIndex((m) => m.role === 'system');
      if (systemIndex !== -1) {
        const systemMsg = messages[systemIndex];
        const nextUserIndex = messages.findIndex(
          (m, i) => m.role === 'user' && i > systemIndex
        );
        if (nextUserIndex !== -1) {
          messages[nextUserIndex].content =
            systemMsg.content + '\n\n' + messages[nextUserIndex].content;
          messages.splice(systemIndex, 1);
        } else {
          // If there's no user message after the system message,
          // just convert the system message to a user message.
          systemMsg.content += '\n\n';
          systemMsg.role = 'user';
        }
      }
    }

    return messages;
  }

  /**
   * Maps a `responseConstraint` to a Transformers.js structured output format.
   * Constraints the engine cannot enforce (for example, JSON Schema `pattern`
   * or `format`, or regular expressions with lookarounds) fall back to prompt
   * engineering alone.
   * @param {Object|RegExp} [constraint] - The response constraint.
   * @returns {Object|undefined} The response format, if it can be enforced.
   */
  #toResponseFormat(constraint) {
    if (!constraint) {
      return undefined;
    }
    const responseFormat =
      constraint instanceof RegExp
        ? { type: 'regex', regex: constraint.source }
        : { type: 'json_schema', json_schema: constraint };
    try {
      // Validates the constraint, and prepares the tokenizer once so that the
      // processors created for each generation are cheap.
      new StructuredOutputProcessor(
        constraintTokenizer(this.#generator),
        responseFormat
      );
      return responseFormat;
    } catch (error) {
      console.warn(
        this.#omitResponseConstraintInput
          ? `Polyfill: The Transformers.js backend cannot enforce this \`responseConstraint\` (${error.message}), and \`omitResponseConstraintInput\` keeps it out of the prompt, so the response only follows the guidance in your prompt.`
          : `Polyfill: The Transformers.js backend cannot enforce this \`responseConstraint\` (${error.message}) and falls back to prompt engineering, which may fail. For better results, consider adding few-shot examples to your prompt.`
      );
      return undefined;
    }
  }

  /**
   * Constrains generation to the response format, if there is one. The
   * processor tracks the tokens generated so far, so every generation needs a
   * fresh one.
   * @returns {Array|undefined} The logits processors.
   */
  #createLogitsProcessor() {
    if (!this.#responseFormat) {
      return undefined;
    }
    return [
      new StructuredOutputProcessor(
        constraintTokenizer(this.#generator),
        this.#responseFormat
      ),
    ];
  }

  #appendResponseSchema(messages, responseSchema) {
    // Even when generation is constrained, telling the model what shape to
    // produce keeps it from fighting the constraint.
    if (responseSchema instanceof RegExp) {
      const constraint = `Respond ONLY with text matching this regular expression: ${responseSchema}`;
      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content = constraint + '\n\n' + messages[0].content;
      } else {
        messages.unshift({ role: 'system', content: constraint });
      }
    } else if (responseSchema) {
      const constraint = `Respond ONLY with a raw JSON object matching this JSON Schema:

\`\`\`json
${JSON.stringify(responseSchema, null, 2)}
\`\`\`

DO NOT include Markdown code blocks, explanations, or any other text.`;

      if (messages.length > 0 && messages[0].role === 'system') {
        messages[0].content = constraint + '\n\n' + messages[0].content;
      } else {
        messages.unshift({ role: 'system', content: constraint });
      }
    }
  }
}

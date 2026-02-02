import {
  pipeline,
  TextStreamer,
} from 'https://esm.run/@huggingface/transformers';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Transformers.js (ONNX Runtime) Backend
 */
export default class TransformersBackend extends PolyfillBackend {
  #generator;
  #tokenizer;
  #device;
  #dtype;
  #systemInstruction;

  constructor(config = {}) {
    super(config.modelName || DEFAULT_MODELS.transformers.modelName);
    this.#device =
      config.device || DEFAULT_MODELS.transformers.device || 'webgpu';
    this.#dtype = config.dtype || DEFAULT_MODELS.transformers.dtype || 'q4f16';
  }

  /**
   * Loaded models can be large, so we initialize them lazily.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The generator.
   */
  async #ensureGenerator(monitorTarget) {
    if (!this.#generator) {
      const files = new Map();
      const modelFiles = await resolveModelFiles(this.modelName, {
        dtype: this.#dtype,
      });
      for (const { path, size } of modelFiles) {
        files.set(path, { loaded: 0, total: size });
      }

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
        if (data.status === 'initiate') {
          if (files.has(data.file)) {
            const fileData = files.get(data.file);
            // Update with actual size if available, otherwise keep pre-fetched
            if (data.total) {
              fileData.total = data.total;
            }
          } else {
            files.set(data.file, { loaded: 0, total: data.total || 0 });
          }
        } else if (data.status === 'progress') {
          if (files.has(data.file)) {
            files.get(data.file).loaded = data.loaded;
          }
        } else if (data.status === 'done') {
          if (files.has(data.file)) {
            const fileData = files.get(data.file);
            fileData.loaded = fileData.total;
          }
        } else if (data.status === 'ready') {
          dispatch(1);
          return;
        }

        if (data.status === 'progress' || data.status === 'done') {
          let totalLoaded = 0;
          let totalSize = 0;
          for (const { loaded, total } of files.values()) {
            totalLoaded += loaded;
            totalSize += total;
          }

          if (totalSize > 0) {
            const globalProgress = totalLoaded / totalSize;
            // Cap at slightly less than 1.0 until 'ready'
            dispatch(Math.min(globalProgress, 0.9999));
          }
        }
      };

      // Initial 0% progress
      dispatch(0);

      this.#generator = await pipeline('text-generation', this.modelName, {
        device: this.#device,
        dtype: this.#dtype,
        progress_callback,
      });
      this.#tokenizer = this.#generator.tokenizer;
    }
    return this.#generator;
  }

  /**
   * Checks if the backend is available given the options.
   * @param {Object} options - LanguageModel options.
   * @returns {string} 'available' or 'unavailable'.
   */
  static availability(options) {
    if (options?.expectedInputs && Array.isArray(options.expectedInputs)) {
      for (const input of options.expectedInputs) {
        if (input.type === 'audio' || input.type === 'image') {
          return 'unavailable';
        }
      }
    }
    return 'available';
  }

  /**
   * Creates a new session.
   * @param {Object} options - LanguageModel options.
   * @param {Object} sessionParams - Session parameters.
   * @param {EventTarget} [monitorTarget] - The event target to dispatch download progress events to.
   * @returns {Promise<Object>} The generator.
   */
  async createSession(options, sessionParams, monitorTarget) {
    if (options.responseConstraint) {
      console.warn(
        "The `responseConstraint` flag isn't supported by the Transformers.js backend and was ignored."
      );
    }
    // Initializing the generator can be slow, so we do it lazily or here.
    // For now, let's trigger the loading.
    await this.#ensureGenerator(monitorTarget);

    // We don't really have "sessions" in the same way Gemini does,
    // but we can store the generation config.
    this.generationConfig = {
      max_new_tokens: 512, // Default limit
      temperature: sessionParams.generationConfig?.temperature || 1.0,
      top_p: 1.0,
      do_sample: sessionParams.generationConfig?.temperature > 0,
      return_full_text: false,
    };
    this.#systemInstruction = sessionParams.systemInstruction;

    return this.#generator;
  }

  async generateContent(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    const output = await generator(prompt, {
      ...this.generationConfig,
      add_special_tokens: false,
    });
    const text = output[0].generated_text;

    // Approximate usage
    const usage = await this.countTokens(contents);

    return { text, usage };
  }

  async generateContentStream(contents) {
    const generator = await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const prompt = this.#tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });

    const queue = [];
    let resolveSignal;
    let promise = new Promise((r) => (resolveSignal = r));
    let isDone = false;

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
            usageMetadata: { totalTokenCount: 0 },
          };
        }

        if (isDone) {
          break;
        }
      }
    })();
  }

  async countTokens(contents) {
    await this.#ensureGenerator();
    const messages = this.#contentsToMessages(contents);
    const input_ids = this.#tokenizer.apply_chat_template(messages, {
      tokenize: true,
      add_generation_prompt: false,
      return_tensor: false,
    });
    return input_ids.length;
  }

  #contentsToMessages(contents) {
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
}

/**
 * Exact replication of Transformers.js file resolution logic using HF Tree API.
 * @param {string} modelId - The Hugging Face model ID.
 * @param {object} options - Configuration options.
 * @returns {Promise<Object[]>} Array of { path, size } objects.
 */
async function resolveModelFiles(modelId, options = {}) {
  const { dtype = 'q8', branch = 'main' } = options;

  let cachedData = null;
  const cacheKey = `transformers_model_files_${modelId}_${dtype}_${branch}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      cachedData = JSON.parse(cached);
      const { timestamp, files } = cachedData;
      const oneDay = 24 * 60 * 60 * 1000;
      if (Date.now() - timestamp < oneDay) {
        return files;
      }
    }
  } catch (e) {
    console.warn('Failed to read from localStorage cache:', e);
  }

  const manifestUrl = `https://huggingface.co/api/models/${modelId}/tree/${branch}?recursive=true`;

  let response;
  try {
    response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Manifest fetch failed: ${response.status}`);
    }
  } catch (e) {
    if (cachedData) {
      console.warn(
        `Failed to fetch manifest from network, falling back to cached data (expired):`,
        e
      );
      return cachedData.files;
    }
    throw e;
  }

  const fileTree = await response.json();
  const fileMap = new Map(fileTree.map((f) => [f.path, f.size]));
  const finalFiles = [];

  // Helper: check existence and return { path, size }
  const exists = (path) => fileMap.has(path);
  const add = (path) => {
    if (exists(path)) {
      finalFiles.push({ path, size: fileMap.get(path) });
      return true;
    }
    return false;
  };

  // --- 1. Configs (Always Required) ---
  add('config.json');
  add('generation_config.json');
  add('preprocessor_config.json');

  // --- 2. Tokenizer Resolution ---
  if (exists('tokenizer.json')) {
    add('tokenizer.json');
    add('tokenizer_config.json');
  } else {
    // Fallback: Legacy tokenizer files
    add('tokenizer_config.json');
    add('special_tokens_map.json');
    add('vocab.json');
    add('merges.txt');
    add('vocab.txt');
  }

  // --- 3. ONNX Model Resolution ---
  const onnxFolder = 'onnx';

  let suffixes = [];
  if (dtype === 'fp32') {
    suffixes = [''];
  } else if (dtype === 'quantized') {
    suffixes = ['_quantized'];
  } else {
    suffixes = [`_${dtype}`];
    if (dtype === 'q8') {
      suffixes.push('');
    }
  }

  let components = [
    'model',
    'encoder_model',
    'decoder_model',
    'decoder_model_merged',
  ];

  const foundComponents = [];
  for (const c of components) {
    for (const s of suffixes) {
      const filename = `${onnxFolder}/${c}${s}.onnx`;
      if (exists(filename)) {
        foundComponents.push(filename);
        break;
      }
    }
  }

  const hasMerged = foundComponents.some((f) =>
    f.includes('decoder_model_merged')
  );
  const filteredComponents = foundComponents.filter((f) => {
    if (hasMerged && f.includes('decoder_model') && !f.includes('merged')) {
      return false;
    }
    return true;
  });

  for (const file of filteredComponents) {
    add(file);
    const dataFile = `${file}_data`;
    if (add(dataFile)) {
      let i = 1;
      while (add(`${dataFile}_${i}`)) {
        i++;
      }
    }
  }

  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        files: finalFiles,
      })
    );
  } catch (e) {
    console.warn('Failed to write to localStorage cache:', e);
  }

  return finalFiles;
}

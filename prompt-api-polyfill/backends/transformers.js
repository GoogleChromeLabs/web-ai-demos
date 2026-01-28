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

  constructor(config) {
    super(config.modelName || DEFAULT_MODELS.transformers);
  }

  async #ensureGenerator(monitorTarget) {
    if (!this.#generator) {
      const files = new Map();
      const modelFiles = await resolveModelFiles(this.modelName, {
        quantized: true,
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
        device: 'webgpu',
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

  async createSession(options, inCloudParams, monitorTarget) {
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
      temperature: inCloudParams.generationConfig?.temperature || 1.0,
      top_p: 1.0,
      do_sample: inCloudParams.generationConfig?.temperature > 0,
    };

    return this.#generator;
  }

  async generateContent(contents) {
    const generator = await this.#ensureGenerator();
    const prompt = this.#convertContentsToPrompt(contents);

    const output = await generator(prompt, this.generationConfig);
    const text = output[0].generated_text.slice(prompt.length);

    // Approximate usage
    const usage = await this.countTokens(contents);

    return { text, usage };
  }

  async generateContentStream(contents) {
    const generator = await this.#ensureGenerator();
    const prompt = this.#convertContentsToPrompt(contents);

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
    const text = this.#convertContentsToPrompt(contents);
    const { input_ids } = await this.#tokenizer(text);
    return input_ids.size;
  }

  #convertContentsToPrompt(contents) {
    // Simple ChatML-like format for Qwen/Llama
    let prompt = '';
    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user';
      prompt += `<|im_start|>${role}\n`;
      for (const part of content.parts) {
        if (part.text) {
          prompt += part.text;
        }
      }
      prompt += '<|im_end|>\n';
    }
    prompt += '<|im_start|>assistant\n';
    return prompt;
  }
}

/**
 * Generates the full list of file paths and sizes that Transformers.js would attempt to download.
 * @param {string} modelId - The Hugging Face model ID (e.g., "onnx-community/Qwen3-4B-ONNX")
 * @param {object} options - Configuration options
 * @param {boolean} [options.quantized=true] - Whether to load the quantized version (default: true)
 * @param {string} [options.branch='main'] - The git branch/revision to fetch from
 * @param {boolean} [options.includeExternalData=true] - Whether to guess and include .onnx_data files (needed for models >2GB)
 * @returns {Promise<Object[]>} Array of { path, size } objects
 */
async function resolveModelFiles(modelId, options = {}) {
  const {
    quantized = true,
    branch = 'main',
    includeExternalData = true,
  } = options;

  const baseUrl = `https://huggingface.co/${modelId}/resolve/${branch}`;

  // 1. The "Always On" Configuration Files
  const configFiles = [
    'config.json',
    'tokenizer_config.json',
    'tokenizer.json',
    'generation_config.json',
  ];

  // 2. The Model Weights Logic
  const subfolder = 'onnx';
  const modelFileName = quantized ? 'model_quantized.onnx' : 'model.onnx';
  const modelPath = `${subfolder}/${modelFileName}`;

  const modelFiles = [modelPath];

  // 3. The "External Data" Logic
  if (includeExternalData) {
    modelFiles.push(`${modelPath}_data`);
  }

  const allPaths = [...configFiles, ...modelFiles];
  const results = await Promise.all(
    allPaths.map(async (path) => {
      const url = `${baseUrl}/${path}`;
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
          const size = parseInt(
            response.headers.get('Content-Length') || '0',
            10
          );
          return { path, size };
        }
      } catch (e) {
        // Ignore errors and filter out later
      }
      return null;
    })
  );

  return results.filter((r) => r !== null);
}

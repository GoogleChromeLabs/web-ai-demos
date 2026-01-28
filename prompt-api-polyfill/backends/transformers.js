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
      console.log(`[Transformers.js] Loading model: ${this.modelName}`);

      const progress_callback = (data) => {
        if (!monitorTarget) {
          return;
        }

        // Round to nearest 1/0x10000 (65536) as required by WPT in tests/wpt/resources/util.js
        const precision = 1 / 65536;

        if (data.status === 'progress') {
          const progress = data.total > 0 ? data.loaded / data.total : 0;
          const roundedProgress = Math.floor(progress / precision) * precision;

          // Ensure strict monotonicity
          if (roundedProgress <= monitorTarget.__lastProgressLoaded) {
            return;
          }

          monitorTarget.dispatchEvent(
            new ProgressEvent('downloadprogress', {
              loaded: roundedProgress,
              total: 1,
              lengthComputable: true,
            })
          );
          monitorTarget.__lastProgressLoaded = roundedProgress;
        } else if (data.status === 'done') {
          if (monitorTarget.__lastProgressLoaded >= 1) {
            return;
          }
          monitorTarget.dispatchEvent(
            new ProgressEvent('downloadprogress', {
              loaded: 1,
              total: 1,
              lengthComputable: true,
            })
          );
          monitorTarget.__lastProgressLoaded = 1;
        }
      };

      this.#generator = await pipeline('text-generation', this.modelName, {
        device: 'webgpu',
        progress_callback,
      });
      this.#tokenizer = this.#generator.tokenizer;
    }
    return this.#generator;
  }

  async createSession(options, inCloudParams, monitorTarget) {
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

    const streamer = new TextStreamer(this.#tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
    });

    // Run generation in the background (don't await)
    generator(prompt, {
      ...this.generationConfig,
      streamer,
    });

    // streamer is an AsyncIterable in Transformers.js v3
    return (async function* () {
      for await (const newText of streamer) {
        yield {
          text: () => newText,
          usageMetadata: { totalTokenCount: 0 },
        };
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

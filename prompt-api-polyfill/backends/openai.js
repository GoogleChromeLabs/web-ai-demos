import OpenAI from 'https://esm.run/openai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * OpenAI API Backend
 */
export default class OpenAIBackend extends PolyfillBackend {
  #model;

  constructor(config) {
    super(config.modelName || DEFAULT_MODELS.openai.modelName);
    this.config = config;
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true, // Required for client-side usage
    });
  }

  static availability(options = {}) {
    if (options.expectedInputs) {
      const hasAudio = options.expectedInputs.some(
        (input) => input.type === 'audio'
      );
      const hasImage = options.expectedInputs.some(
        (input) => input.type === 'image'
      );
      if (hasAudio && hasImage) {
        return 'unavailable';
      }
    }
    return 'available';
  }

  createSession(options, sessionParams) {
    // OpenAI doesn't have a "session" object like Gemini, so we return a context object
    // tailored for our generate methods.
    this.#model = {
      model: options.modelName || this.modelName,
      temperature: sessionParams.generationConfig?.temperature,
      top_p: 1.0, // Default to 1.0 as topK is not directly supported the same way
      systemInstruction: sessionParams.systemInstruction,
    };

    const config = sessionParams.generationConfig || {};
    if (config.responseSchema) {
      const { schema, wrapped } = this.#fixSchemaForOpenAI(
        config.responseSchema
      );
      this.#model.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: schema,
        },
      };
      this.#model.response_wrapped = wrapped;
    } else if (config.responseMimeType === 'application/json') {
      this.#model.response_format = { type: 'json_object' };
    }

    return this.#model;
  }

  /**
   * OpenAI Structured Outputs require:
   * 1. All fields in objects to be marked as 'required'.
   * 2. Objects to have 'additionalProperties: false'.
   * 3. The root must be an 'object'.
   */
  #fixSchemaForOpenAI(schema) {
    if (typeof schema !== 'object' || schema === null) {
      return { schema, wrapped: false };
    }

    const processNode = (node) => {
      if (node.type === 'object') {
        if (node.properties) {
          node.additionalProperties = false;
          node.required = Object.keys(node.properties);
          for (const key in node.properties) {
            processNode(node.properties[key]);
          }
        } else {
          node.additionalProperties = false;
          node.required = [];
        }
      } else if (node.type === 'array' && node.items) {
        processNode(node.items);
      }
      return node;
    };

    // Deep clone to avoid side effects
    const cloned = JSON.parse(JSON.stringify(schema));

    if (cloned.type !== 'object') {
      // Wrap in object as OpenAI requires object root
      return {
        wrapped: true,
        schema: {
          type: 'object',
          properties: { value: cloned },
          required: ['value'],
          additionalProperties: false,
        },
      };
    }

    return {
      wrapped: false,
      schema: processNode(cloned),
    };
  }

  #validateContent(messages) {
    let hasImage = false;
    let hasAudio = false;

    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url') {
            hasImage = true;
          }
          if (part.type === 'input_audio') {
            hasAudio = true;
          }
        }
      }
    }

    if (hasImage && hasAudio) {
      throw new Error(
        'OpenAI backend does not support mixing images and audio in the same session. Please start a new session.'
      );
    }

    return { hasImage, hasAudio };
  }

  #routeModel(hasAudio) {
    // If the user explicitly provided a model in the session options, respect it.
    // Otherwise, pick based on content.
    if (this.#model.model !== this.modelName) {
      return this.#model.model;
    }

    return hasAudio ? `${this.modelName}-audio-preview` : this.modelName;
  }

  async generateContent(contents) {
    const { messages } = this.#convertContentsToInput(
      contents,
      this.#model.systemInstruction
    );
    const { hasAudio } = this.#validateContent(messages);
    const model = this.#routeModel(hasAudio);

    if (
      model === `${this.modelName}-audio-preview` &&
      this.#model.response_format
    ) {
      throw new DOMException(
        `OpenAI audio model ('${model}') does not support structured outputs (responseConstraint).`,
        'NotSupportedError'
      );
    }

    const options = {
      model: model,
      messages: messages,
    };

    if (this.#model.temperature > 0) {
      options.temperature = this.#model.temperature;
    }

    if (this.#model.response_format) {
      options.response_format = this.#model.response_format;
    }

    try {
      const response = await this.openai.chat.completions.create(options);

      const choice = response.choices[0];
      let text = choice.message.content;

      if (this.#model.response_wrapped && text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && 'value' in parsed) {
            text = JSON.stringify(parsed.value);
          }
        } catch {
          // Ignore parsing error, return raw text
        }
      }

      const usage = response.usage?.prompt_tokens || 0;

      return { text, usage };
    } catch (error) {
      console.error('OpenAI Generate Content Error:', error);
      throw error;
    }
  }

  async generateContentStream(contents) {
    const { messages } = this.#convertContentsToInput(
      contents,
      this.#model.systemInstruction
    );
    const { hasAudio } = this.#validateContent(messages);
    const model = this.#routeModel(hasAudio);

    if (
      model === `${this.modelName}-audio-preview` &&
      this.#model.response_format
    ) {
      throw new DOMException(
        `OpenAI audio model ('${model}') does not support structured outputs (responseConstraint).`,
        'NotSupportedError'
      );
    }

    const options = {
      model: model,
      messages: messages,
      stream: true,
    };

    if (this.#model.temperature > 0) {
      options.temperature = this.#model.temperature;
    }

    if (this.#model.response_format) {
      options.response_format = this.#model.response_format;
    }

    try {
      const stream = await this.openai.chat.completions.create(options);

      // Convert OpenAI stream to an AsyncIterable that yields chunks
      return (async function* () {
        let firstChunk = true;
        for await (const chunk of stream) {
          let text = chunk.choices[0]?.delta?.content;
          if (text) {
            // Note: Unwrapping a wrapped object in a stream is complex.
            // For now, streaming wrapped results will yield the full JSON including the wrapper.
            yield {
              text: () => text,
              usageMetadata: { totalTokenCount: 0 },
            };
          }
        }
      })();
    } catch (error) {
      console.error('OpenAI Generate Content Stream Error:', error);
      throw error;
    }
  }

  async countTokens(contents) {
    // OpenAI does not provide a public API endpoint for counting tokens before generation.
    // Implementing countTokens strictly requires a tokenizer like `tiktoken`.
    // For this initial implementation, we use a character-based approximation (e.g., text.length / 4)
    // to avoid adding heavy WASM dependencies (`tiktoken`) to the polyfill.
    let totalText = '';

    if (Array.isArray(contents)) {
      for (const content of contents) {
        if (!content.parts) {
          continue;
        }
        for (const part of content.parts) {
          if (part.text) {
            totalText += part.text;
          } else if (part.inlineData) {
            // Approximate image token cost (e.g., ~1000 chars worth)
            totalText += ' '.repeat(1000);
          }
        }
      }
    }

    return Math.ceil(totalText.length / 4);
  }

  #convertContentsToInput(contents, systemInstruction) {
    const messages = [];

    // System instructions
    if (systemInstruction) {
      messages.push({
        role: 'system',
        content: systemInstruction,
      });
    }

    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user';
      const contentParts = [];

      for (const part of content.parts) {
        if (part.text) {
          contentParts.push({ type: 'text', text: part.text });
        } else if (part.inlineData) {
          const { data, mimeType } = part.inlineData;
          if (mimeType.startsWith('image/')) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${data}` },
            });
          } else if (mimeType.startsWith('audio/')) {
            contentParts.push({
              type: 'input_audio',
              input_audio: {
                data: data,
                format: mimeType.split('/')[1] === 'mpeg' ? 'mp3' : 'wav',
              },
            });
          }
        }
      }

      // Simplification: if only one text part, just send string content for better compatibility
      // but multimodal models usually prefer the array format.
      // We'll keep the array format for consistency with multimodal inputs.
      messages.push({ role, content: contentParts });
    }

    return { messages };
  }
}

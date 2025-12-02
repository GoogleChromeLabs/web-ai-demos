/**
 * Polyfill for the Web Neural Network "Prompt API" (LanguageModel)
 * Backend: Firebase AI Logic (Hybrid/Cloud Fallback)
 * Spec: https://github.com/webmachinelearning/prompt-api/blob/main/README.md
 * * Instructions:
 * 1. Include this script in your HTML type="module".
 * 2. Define window.FIREBASE_CONFIG with your Firebase configuration object BEFORE importing this.
 */

import { initializeApp } from 'https://esm.run/firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'https://esm.run/firebase/ai';

import './async-iterator-polyfill.js'; // Still needed for Safari 26.2.

(() => {
  if ('LanguageModel' in window) {
    return;
  }

  const firebaseConfig = window.FIREBASE_CONFIG || window.__firebase_config;
  if (!firebaseConfig) {
    console.error(
      'Firebase Prompt API Polyfill: Missing configuration. Please set window.FIREBASE_CONFIG.'
    );
    return;
  }

  // --- Initialize Firebase ---
  const app = initializeApp(firebaseConfig);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const MODEL_NAME = 'gemini-2.0-flash-lite';

  // --- Multimodal Helpers ---

  class MultimodalConverter {
    static async convert(type, value) {
      if (type === 'image') return this.processImage(value);
      if (type === 'audio') return this.processAudio(value);
      throw new DOMException(
        `Unsupported media type: ${type}`,
        'NotSupportedError'
      );
    }

    static async processImage(source) {
      // Blob
      if (source instanceof Blob) {
        return this.blobToInlineData(source);
      }

      // BufferSource (ArrayBuffer/View) -> Sniff or Default
      if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
        const buffer = source instanceof ArrayBuffer ? source : source.buffer;
        const base64 = this.arrayBufferToBase64(buffer);
        // Basic sniffing for PNG/JPEG magic bytes
        const u8 = new Uint8Array(buffer);
        let mimeType = 'image/png'; // Default
        if (u8[0] === 0xff && u8[1] === 0xd8) mimeType = 'image/jpeg';
        else if (u8[0] === 0x89 && u8[1] === 0x50) mimeType = 'image/png';

        return { inlineData: { data: base64, mimeType } };
      }

      // ImageBitmapSource (Canvas, Image, VideoFrame, etc.)
      // We draw to a canvas to standardize to PNG
      return this.canvasSourceToInlineData(source);
    }

    static async processAudio(source) {
      // Blob
      if (source instanceof Blob) {
        return this.blobToInlineData(source);
      }

      // AudioBuffer -> WAV
      if (source instanceof AudioBuffer) {
        const wavBuffer = this.audioBufferToWav(source);
        const base64 = this.arrayBufferToBase64(wavBuffer);
        return { inlineData: { data: base64, mimeType: 'audio/wav' } };
      }

      // BufferSource -> Assume it's already an audio file (mp3/wav)
      if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
        const buffer = source instanceof ArrayBuffer ? source : source.buffer;
        return {
          inlineData: {
            data: this.arrayBufferToBase64(buffer),
            mimeType: 'audio/wav', // Fallback assumption
          },
        };
      }

      throw new DOMException('Unsupported audio source', 'NotSupportedError');
    }

    // --- Low Level Converters ---

    static blobToInlineData(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.error) reject(reader.error);
          else
            resolve({
              inlineData: {
                data: reader.result.split(',')[1],
                mimeType: blob.type,
              },
            });
        };
        reader.readAsDataURL(blob);
      });
    }

    static canvasSourceToInlineData(source) {
      const canvas = document.createElement('canvas');
      const w = source.naturalWidth || source.videoWidth || source.width;
      const h = source.naturalHeight || source.videoHeight || source.height;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');
      return {
        inlineData: {
          data: dataUrl.split(',')[1],
          mimeType: 'image/png',
        },
      };
    }

    static arrayBufferToBase64(buffer) {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }

    // Simple WAV Encoder for AudioBuffer
    static audioBufferToWav(buffer) {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const format = 1; // PCM
      const bitDepth = 16;

      let result;
      if (numChannels === 2) {
        result = this.interleave(
          buffer.getChannelData(0),
          buffer.getChannelData(1)
        );
      } else {
        result = buffer.getChannelData(0);
      }

      return this.encodeWAV(result, format, sampleRate, numChannels, bitDepth);
    }

    static interleave(inputL, inputR) {
      const length = inputL.length + inputR.length;
      const result = new Float32Array(length);
      let index = 0;
      let inputIndex = 0;
      while (index < length) {
        result[index++] = inputL[inputIndex];
        result[index++] = inputR[inputIndex];
        inputIndex++;
      }
      return result;
    }

    static encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
      const bytesPerSample = bitDepth / 8;
      const blockAlign = numChannels * bytesPerSample;

      const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
      const view = new DataView(buffer);

      /* RIFF identifier */
      this.writeString(view, 0, 'RIFF');
      /* RIFF chunk length */
      view.setUint32(4, 36 + samples.length * bytesPerSample, true);
      /* RIFF type */
      this.writeString(view, 8, 'WAVE');
      /* format chunk identifier */
      this.writeString(view, 12, 'fmt ');
      /* format chunk length */
      view.setUint32(16, 16, true);
      /* sample format (raw) */
      view.setUint16(20, format, true);
      /* channel count */
      view.setUint16(22, numChannels, true);
      /* sample rate */
      view.setUint32(24, sampleRate, true);
      /* byte rate (sample rate * block align) */
      view.setUint32(28, sampleRate * blockAlign, true);
      /* block align (channel count * bytes per sample) */
      view.setUint16(32, blockAlign, true);
      /* bits per sample */
      view.setUint16(34, bitDepth, true);
      /* data chunk identifier */
      this.writeString(view, 36, 'data');
      /* data chunk length */
      view.setUint32(40, samples.length * bytesPerSample, true);

      this.floatTo16BitPCM(view, 44, samples);

      return buffer;
    }

    static floatTo16BitPCM(output, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
    }

    static writeString(view, offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
  }

  // --- Helper to convert initial History ---
  async function convertToFirebaseHistory(prompts) {
    const history = [];
    for (const p of prompts) {
      const role = p.role === 'assistant' ? 'model' : 'user';
      let parts = [];

      if (Array.isArray(p.content)) {
        // Mixed content
        for (const item of p.content) {
          if (item.type === 'text') {
            parts.push({ text: item.value || item.text || '' });
          } else {
            const part = await MultimodalConverter.convert(
              item.type,
              item.value
            );
            parts.push(part);
          }
        }
      } else {
        // Simple string
        parts.push({ text: p.content });
      }
      history.push({ role, parts });
    }
    return history;
  }

  /**
   * Main LanguageModel Class
   */
  class LanguageModel extends EventTarget {
    #model;
    #history;
    #options;
    #destroyed;
    #inputUsage;
    #topK;
    #temperature;
    #onquotaoverflow;

    constructor(model, initialHistory, options = {}) {
      super();
      this.#model = model;
      this.#history = initialHistory || [];
      this.#options = options;
      this.#destroyed = false;
      this.#inputUsage = 0;

      this.#topK = options.topK;
      this.#temperature = options.temperature;
    }

    get inputUsage() {
      return this.#inputUsage;
    }
    get inputQuota() {
      return 1000000;
    }
    get topK() {
      return this.#topK;
    }
    get temperature() {
      return this.#temperature;
    }

    get onquotaoverflow() {
      return this.#onquotaoverflow;
    }
    set onquotaoverflow(handler) {
      if (this.#onquotaoverflow)
        this.removeEventListener('quotaoverflow', this.#onquotaoverflow);
      this.#onquotaoverflow = handler;
      if (typeof handler === 'function')
        this.addEventListener('quotaoverflow', handler);
    }

    // --- Static Methods ---
    static async availability(options = {}) {
      return 'available';
    }

    static async params() {
      return {
        defaultTemperature: 1.0,
        defaultTopK: 3,
        maxTemperature: 2.0,
        maxTopK: 40,
      };
    }

    static async create(options = {}) {
      const defaults = {
        temperature: 1.0,
        topK: 3,
      };

      const resolvedOptions = { ...defaults, ...options };

      const inCloudParams = {
        model: MODEL_NAME,
        generationConfig: {
          temperature: resolvedOptions.temperature,
          topK: resolvedOptions.topK,
        },
      };

      if (options.responseConstraint) {
        inCloudParams.generationConfig.responseMimeType = 'application/json';
        inCloudParams.generationConfig.responseSchema =
          options.responseConstraint;
      }

      let initialHistory = [];
      let systemInstruction = undefined;

      if (options.initialPrompts && Array.isArray(options.initialPrompts)) {
        const systemPrompts = options.initialPrompts.filter(
          (p) => p.role === 'system'
        );
        const conversationPrompts = options.initialPrompts.filter(
          (p) => p.role !== 'system'
        );

        if (systemPrompts.length > 0) {
          systemInstruction = systemPrompts.map((p) => p.content).join('\n');
        }
        // Await the conversion of history items (in case of images in history)
        initialHistory = await convertToFirebaseHistory(conversationPrompts);
      } else if (options.systemPrompt) {
        systemInstruction = options.systemPrompt;
      }

      if (systemInstruction) {
        inCloudParams.systemInstruction = systemInstruction;
      }

      const model = getGenerativeModel(ai, {
        mode: InferenceMode.PREFER_IN_CLOUD,
        inCloudParams: inCloudParams,
      });

      return new LanguageModel(model, initialHistory, resolvedOptions);
    }

    // --- Instance Methods ---

    async clone(options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      // Clone private history
      const historyCopy = JSON.parse(JSON.stringify(this.#history));
      return new LanguageModel(this.#model, historyCopy, {
        ...this.#options,
        ...options,
      });
    }

    destroy() {
      this.#destroyed = true;
      this.#history = null;
    }

    async prompt(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      // 1. Process Input (Async conversion of Blob/Canvas/AudioBuffer)
      const parts = await this.#processInput(input);
      const userContent = { role: 'user', parts: parts };

      try {
        this.#updateUsage(parts);
        if (this.#inputUsage > this.inputQuota)
          this.dispatchEvent(new Event('quotaoverflow'));

        const requestContents = [...this.#history, userContent];

        const result = await this.#model.generateContent({
          contents: requestContents,
        });

        const responseText = result.response.text();

        this.#history.push(userContent);
        this.#history.push({ role: 'model', parts: [{ text: responseText }] });

        return responseText;
      } catch (error) {
        console.error('Firebase AI Logic Error:', error);
        throw error;
      }
    }

    promptStreaming(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');

      const _this = this; // Capture 'this' to access private fields in callback

      return new ReadableStream({
        async start(controller) {
          if (options.signal?.aborted) {
            controller.error(new DOMException('Aborted', 'AbortError'));
            return;
          }

          try {
            // Access private methods/fields via captured _this
            const parts = await _this.#processInput(input);
            const userContent = { role: 'user', parts: parts };

            _this.#updateUsage(parts);
            if (_this.#inputUsage > _this.inputQuota)
              _this.dispatchEvent(new Event('quotaoverflow'));

            const requestContents = [..._this.#history, userContent];

            const result = await _this.#model.generateContentStream({
              contents: requestContents,
            });

            let fullResponseText = '';

            for await (const chunk of result.stream) {
              const chunkText = chunk.text();
              fullResponseText += chunkText;
              controller.enqueue(chunkText);
            }

            _this.#history.push(userContent);
            _this.#history.push({
              role: 'model',
              parts: [{ text: fullResponseText }],
            });

            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    }

    async append(input, options = {}) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');
      if (options.signal?.aborted)
        throw new DOMException('Aborted', 'AbortError');

      const parts = await this.#processInput(input);
      const content = { role: 'user', parts: parts };

      this.#updateUsage(parts);
      this.#history.push(content);

      if (this.#inputUsage > this.inputQuota) {
        this.dispatchEvent(new Event('quotaoverflow'));
      }
    }

    async measureInputUsage(input) {
      if (this.#destroyed)
        throw new DOMException('Session is destroyed', 'InvalidStateError');

      try {
        const parts = await this.#processInput(input);
        const { totalTokens } = await this.#model.countTokens({
          contents: [{ role: 'user', parts }],
        });
        return totalTokens;
      } catch (e) {
        return 100;
      }
    }

    // --- Private Helper to process diverse input types ---
    async #processInput(input) {
      if (typeof input === 'string') {
        return [{ text: input }];
      }

      if (Array.isArray(input)) {
        if (input.length > 0 && input[0].role) {
          let combinedParts = [];
          for (const msg of input) {
            if (typeof msg.content === 'string') {
              combinedParts.push({ text: msg.content });
            } else if (Array.isArray(msg.content)) {
              for (const c of msg.content) {
                if (c.type === 'text') combinedParts.push({ text: c.value });
                else {
                  const part = await MultimodalConverter.convert(
                    c.type,
                    c.value
                  );
                  combinedParts.push(part);
                }
              }
            }
          }
          return combinedParts;
        }

        return input.map((s) => ({ text: String(s) }));
      }

      return [{ text: JSON.stringify(input) }];
    }

    #updateUsage(parts) {
      for (const p of parts) {
        if (p.text) this.#inputUsage += p.text.length / 4;
        if (p.inlineData) this.#inputUsage += 258;
      }
    }
  }

  // Attach to window
  window.LanguageModel = LanguageModel;
  console.log(
    'Polyfill: window.LanguageModel is now backed by Firebase AI Logic (Hybrid/Cloud).'
  );
})();

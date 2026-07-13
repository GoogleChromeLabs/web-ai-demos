/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default model versions for each backend.
 */
export const DEFAULT_MODELS = {
  // Firebase AI Logic docs say stable Gemini 2.5+ model names have no
  // auto-updated alias and recommend pinning an explicit stable name.
  firebase: { modelName: 'gemini-3.1-flash-lite' },
  // 'gemini-flash-lite-latest' is a Gemini Developer API alias that always
  // resolves to the newest stable Flash-Lite release (2-week notice before
  // any swap), so the default stays current without code changes.
  gemini: { modelName: 'gemini-flash-lite-latest' },
  openai: { modelName: 'gpt-4o' },
  transformers: {
    modelName: 'onnx-community/gemma-3-1b-it-ONNX-GQA',
    device: 'webgpu',
    dtype: 'q4f16',
  },
  webllm: {
    modelName: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  },
};

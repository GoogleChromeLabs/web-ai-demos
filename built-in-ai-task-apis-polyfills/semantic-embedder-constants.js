/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Values shared between the SemanticEmbedder main-thread class and the worker
 * that runs the model. They live apart from both so that importing them can
 * never drag the worker's Transformers.js import onto the main thread, or the
 * main thread's DOM code into the worker.
 */

export const DEFAULT_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
// EmbeddingGemma activations do not support fp16. q8 gives a good balance of
// model size and quality in the browser.
export const DEFAULT_DTYPE = 'q8';
// EmbeddingGemma's context window is 2048 tokens, but onnxruntime-web
// overflows when a sequence fills it exactly (`OrtRun()` ERROR_CODE 1), so the
// usable ceiling is one token below the window. Truncating to the window size
// itself would push every oversized input straight into that failure.
export const MODEL_CONTEXT_TOKENS = 2048;
export const MAX_INPUT_TOKENS = MODEL_CONTEXT_TOKENS - 1;

// The vector space the embeddings belong to. Vectors from different spaces are
// not comparable, so callers need this to version what they store.
export const EMBEDDING_SPACE = 'embeddinggemma-300m';

// EmbeddingGemma task-type prefixes (must match the model's training setup).
// See https://ai.google.dev/gemma/docs/embeddinggemma/model_card for the
// full prompt table.
export const TASK_PREFIXES = {
  'semantic-similarity': 'task: sentence similarity | query: ',
  'retrieval-query': 'task: search result | query: ',
  'retrieval-document': 'title: none | text: ',
  classification: 'task: classification | query: ',
  clustering: 'task: clustering | query: ',
};

export const VALID_TASK_TYPES = new Set(Object.keys(TASK_PREFIXES));

/**
 * Applies the task-specific prefix the model was trained with.
 * @param {string} text - The input text.
 * @param {string} [taskType] - The task type, or undefined to embed as-is.
 * @returns {string} The prefixed text.
 */
export function applyPrefix(text, taskType) {
  // No taskType means the raw input is embedded as-is, with no prefix.
  const prefix = taskType ? TASK_PREFIXES[taskType] : undefined;
  return prefix ? `${prefix}${text}` : text;
}

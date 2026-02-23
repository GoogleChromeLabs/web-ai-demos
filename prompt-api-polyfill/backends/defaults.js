/**
 * Default model versions for each backend.
 */
export const DEFAULT_MODELS = {
  firebase: { modelName: 'gemini-2.5-flash-lite' },
  gemini: { modelName: 'gemini-2.5-flash-lite' },
  openai: { modelName: 'gpt-4o' },
  transformers: {
    modelName: 'onnx-community/gemma-3-1b-it-ONNX-GQA',
    device: 'webgpu',
    dtype: 'q4f16',
  },
};

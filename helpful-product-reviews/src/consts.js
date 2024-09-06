export const MODEL_URL =
  'https://storage.googleapis.com/jmstore/kaggleweb/grader/g-2b-it-gpu-int4.bin';

export const MEDIAPIPE_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm';

export const MESSAGE_CODE = {
  PREPARING_MODEL: 'preparing-model',
  MODEL_READY: 'model-ready',
  GENERATING_RESPONSE: 'generating-response',
  RESPONSE_READY: 'response-ready',
  MODEL_ERROR: 'model-error',
};

export const MODEL_STATUS = {
  NOT_STARTED: 'not-started',
  PREPARING: 'preparing',
  READY: 'ready',
  GENERATING: 'generating-response',
  ERROR: 'error',
};

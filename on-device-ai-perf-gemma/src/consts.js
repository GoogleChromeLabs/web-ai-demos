export const MODEL_URL =
  'https://storage.googleapis.com/jmstore/kaggleweb/grader/g-2b-it-gpu-int4.bin';

export const MEDIAPIPE_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm';

export const MESSAGE_CODE = {
  PREPARING_MODEL: 'preparingModel',
  MODEL_READY: 'modelReady',
  GENERATING_RESPONSE: 'generatingResponse',
  RESPONSE_READY: 'responseReady',
  MODEL_ERROR: 'modelError',
};

export const MODEL_STATUS = {
  NOT_STARTED: 'not-started',
  PREPARING: 'preparing',
  READY: 'ready',
  GENERATING: 'generating-response',
  ERROR: 'error',
};

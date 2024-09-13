/* Copyright 2024 Google LLC
SPDX-License-Identifier: Apache-2.0 */

export const MESSAGE_CODE = {
  PREPARING_MODEL: 'preparing-model',
  MODEL_READY: 'model-ready',
  GENERATING_RESPONSE: 'generating-response',
  RESPONSE_READY: 'response-ready',
  MODEL_ERROR: 'model-error',
  INFERENCE_ERROR: 'inference-error',
};

export const MODEL_STATUS = {
  NOT_STARTED: 'not-started',
  PREPARING: 'preparing',
  READY: 'ready',
  GENERATING: 'generating-response',
  ERROR: 'error',
};

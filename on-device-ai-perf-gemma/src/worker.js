import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';
import { MODEL_URL, MEDIAPIPE_WASM, MESSAGE_CODE } from './consts.js';

let llmInference = null;

// Trigger model preparation *before* a message arrives
(async function () {
  console.info('[Worker] Preparing model...');
  self.postMessage({ code: MESSAGE_CODE.PREPARING_MODEL, payload: null });
  try {
    const genai = await FilesetResolver.forGenAiTasks(MEDIAPIPE_WASM);
    llmInference = await LlmInference.createFromModelPath(genai, MODEL_URL);
    self.postMessage({ code: MESSAGE_CODE.MODEL_READY, payload: null });
  } catch (error) {
    console.error('[Worker] Error preparing model:', error);
    self.postMessage({ code: MESSAGE_CODE.MODEL_ERROR, payload: null });
  }
})();

self.onmessage = function (message) {
  if (!llmInference) {
    // TODO post message?
    throw new Error("Can't run inference, the model is not ready yet");
  }
  console.info('[Worker] 📬 Message from main thread: ', message);
  console.info('[Worker] Generating response...');
  self.postMessage({ code: MESSAGE_CODE.GENERATING_RESPONSE, payload: null });

  // TODO if llmInference is not ready, wait for it to be ready
  (async function () {
    const response = await llmInference.generateResponse(message.data);
    console.info('[Worker] Response generated');
    self.postMessage({ code: MESSAGE_CODE.RESPONSE_READY, payload: response });
  })();
};

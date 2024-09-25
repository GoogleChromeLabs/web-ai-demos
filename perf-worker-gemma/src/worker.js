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
    // Just in case. This condition shouldn't normally be hit because the inference UI button is disabled until the model is ready
    throw new Error("Can't run inference, the model is not ready yet");
  }
  console.info('[Worker] 📬 Message from main thread: ', message);
  console.info('[Worker] Generating response...');
  self.postMessage({ code: MESSAGE_CODE.GENERATING_RESPONSE, payload: null });

  (async function () {
    // TODO handle errors (e.g. an inference error can happen when the input is too long). A simple try/catch isn't sufficient, we also need to terminate the previous/failing inference which I didn't figure out how to do
    const response = await llmInference.generateResponse(message.data);
    console.info('[Worker] Response generated');
    self.postMessage({ code: MESSAGE_CODE.RESPONSE_READY, payload: response });
  })();
};

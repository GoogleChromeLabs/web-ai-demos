import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';

const inputText = 'Tell me how to bake a cake';
const MODEL_URL =
  'https://storage.googleapis.com/jmstore/kaggleweb/grader/g-2b-it-gpu-int4.bin';

(async function () {
  const genai = await FilesetResolver.forGenAiTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm'
  );
  const llmInference = await LlmInference.createFromModelPath(genai, MODEL_URL);
  const response = await llmInference.generateResponse(inputText);
  console.log(response);
})();

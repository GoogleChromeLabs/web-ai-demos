import { env, pipeline } from '@xenova/transformers';
import { MODEL_STATUS } from './consts.js';

const MODEL_NAME = 'Xenova/toxic-bert';
const TOXICITY_THRESHOLD = 0.9;

displayModelStatus(MODEL_STATUS.NOT_STARTED);

// Hack for bug https://github.com/xenova/transformers.js/issues/366
env.allowLocalModels = false;
env.useBrowserCache = false;
let classifier = null;

(async function () {
  displayModelStatus(MODEL_STATUS.PREPARING);
  document.getElementById('inferenceButton').disabled = true;
  try {
    classifier = await pipeline('text-classification', MODEL_NAME);
    displayModelStatus(MODEL_STATUS.READY);
    document.getElementById('inferenceButton').disabled = false;
  } catch (error) {
    console.error('[Worker] Error preparing model:', error);
    displayModelStatus(MODEL_STATUS.ERROR);
    document.getElementById('inferenceButton').disabled = true;
  }
})();

function displayModelStatus(status) {
  document.getElementById('modelStatus').className = status;
}

// Define an asynchronous function to classify text
async function classify(text) {
  if (!classifier) {
    throw new Error("Can't run inference, the model is not ready yet");
  }
  let results = await classifier(text, { topk: null });
  console.log('Results:', results);
  return results;
}

function getToxicityTypes(results) {
  const toxicityAssessment = [];
  for (let element of results) {
    if (element.score > TOXICITY_THRESHOLD) {
      toxicityAssessment.push(element.label);
    }
  }
  return toxicityAssessment;
}

function runLLMInference() {
  const userInput = document.getElementById('userPrompt').value;
  if (!classifier) {
    throw new Error("Can't run inference, the model is not ready yet");
  }
  displayModelStatus(MODEL_STATUS.GENERATING);
  document.getElementById('inferenceButton').disabled = true;

  (async function () {
    let results = await classify(userInput);
    displayModelStatus(MODEL_STATUS.READY);
    document.getElementById('inferenceButton').disabled = false;
    document.getElementById('llmOutput').innerText =
      getToxicityTypes(results).length === 0 ? 'Not toxic' : 'Toxic';
  })();
}

window.runLLMInference = runLLMInference;

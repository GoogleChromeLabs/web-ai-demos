/* Copyright 2024 Google LLC
SPDX-License-Identifier: Apache-2.0 */

import { env, pipeline } from '@xenova/transformers';
import { MESSAGE_CODE } from './consts.js';
import { TOXICITY_THRESHOLD, MODEL_NAME } from './config.js';

// Hack for bug https://github.com/xenova/transformers.js/issues/366
env.allowLocalModels = false;
env.useBrowserCache = false;

let classifier = null;

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

// Trigger model preparation *before* a message arrives
(async function () {
  console.info('[Worker] Preparing model...');
  self.postMessage({ code: MESSAGE_CODE.PREPARING_MODEL, payload: null });
  try {
    classifier = await pipeline('text-classification', MODEL_NAME);
    self.postMessage({ code: MESSAGE_CODE.MODEL_READY, payload: null });
  } catch (error) {
    console.error('[Worker] Error preparing model:', error);
    self.postMessage({ code: MESSAGE_CODE.MODEL_ERROR, payload: null });
  }
})();

self.onmessage = function (message) {
  const textToClassify = message.data;
  if (!classifier) {
    // Just in case. This condition shouldn't normally be hit because inference won't be triggered in script.js unless modelStatus is READY
    throw new Error("Can't run inference, the model is not ready yet");
  }
  console.info('[Worker] 📬 Message from main thread: ', textToClassify);
  console.info('[Worker] Assessing toxicity...');
  self.postMessage({ code: MESSAGE_CODE.GENERATING_RESPONSE, payload: null });

  // Run the classifier
  (async function () {
    try {
      const classificationResults = await classify(textToClassify);
      const toxicityTypes = getToxicityTypes(classificationResults);
      const toxicityAssessement = {
        isToxic: toxicityTypes.length > 0,
        toxicityTypeList:
          toxicityTypes.length > 0 ? toxicityTypes.join(', ') : '',
      };
      console.info('[Worker] Toxicity assessed: ', toxicityAssessement);
      self.postMessage({
        code: MESSAGE_CODE.RESPONSE_READY,
        payload: toxicityAssessement,
      });
    } catch (error) {
      console.log('ERROr');
      self.postMessage({
        code: MESSAGE_CODE.INFERENCE_ERROR,
      });
    }
  })();
};

import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';
import { MODEL_URL, MEDIAPIPE_WASM, MESSAGE_CODE } from './consts.js';

let llmInference = null;

// function generatePrompt(userInput) {
//   return `Based on a product review for socks, analyze if the review is helpful to other buyers. A review is only helpful if it's specific and provides details or adjectives about the product itself (example: "These are warm"). A review is NOT helpful if it doesn't explain itself (example: "I don't like these socks", "This is too expensive"), or if it's not about the product itself, the socks. DO mark a review as NOT helpful when needed. If the review is not helpful, make a suggestion to improve the review text to make it more informative to other buyers. Do NOT make suggestions about the product itself. Follow the following structure and do not output anything other than that:
// Helpful: <yes or no>
// Suggestion: <suggestion to improve the product review. "none" if the product review is helpful>

function generatePrompt(userInput) {
  return `I will give you a product review for socks. Check if the review is specific, provides details or adjectives about the product itself (example: "These are warm"), and justifies itself. If so, mark the review as specific. If not, mark the review as not specific (example: "I don't like these socks", "This is too expensive"). Do mark a review as NOT specific if needed. If the review is not specific, make a suggestion to improve the review text to make it more informative to other buyers. Do NOT make suggestions about the product itself. Follow the following structure and do not output anything other than that:
Specific: <yes or no>
Suggestion: <suggestion to improve the product review. "none" if the product review is specific> 


Examples:

Review:  "I received the wrong product."
Specific: no
Suggestion: Provide more context. For example, "I ordered the [product name], but I received [wrong product name] instead."

Review: "These socks are not as warm as I expected. I've worn them on several cold winter days, and my feet still get cold."
Specific: yes
Suggestion: none

Review: "I don't like the color."
Specific: no
Suggestion: Be more specific. For example, "The color is darker than on the picture."

Review: "I love the blend of wool and synthetic fibers in these socks. They provide excellent insulation without feeling too heavy. The cushioning is perfect for long hikes, and they've held up well to repeated washes."
Specific: yes
Suggestion: none

Review: "This is way too expensive."
Specific: no
Suggestion: Provide more context. For example, "The price is higher than similar products I've tried in the past, with no difference in quality."

Review: "Not as warm as expected."
Specific: yes
Suggestion: none

Review: "I don't like these."
Specific: no
Suggestion: Explain what you don't like. For example, "Not as warm as expected."

Review: "Perfect fit, no blisters."
Specific: yes
Suggestion: none


Review to analyze:

Review: "${userInput}"          
`;
}

function isLlmResponseUseful(response) {
  const { isHelpful, suggestion } = response;
  if (isHelpful === null || suggestion === null) {
    // Llm response isn't formatted correctly
    return false;
  }
  if (!isHelpful && suggestion === 'none') {
    // Llm doesn't have any suggestion despite marking the review as not helpful
    return false;
  }
  return true;
}

function generateReviewHelperOutput(response) {
  const parsedResponse = parseLlmResponse(response);
  if (!isLlmResponseUseful(parsedResponse)) {
    console.info('Llm response is not useful');
    return;
  }
  const { isHelpful, suggestion } = parsedResponse;
  const output =
    suggestion === 'none'
      ? '👍 Your review is helpful!'
      : `${isHelpful} 💡 Wanna make your review even more helpful? ${suggestion}`;
  return output;
}

function parseLlmResponse(response) {
  const result = {
    isHelpful: null,
    suggestion: null,
  };

  const helpfulStringIndex = response.indexOf('Specific:');
  const suggestionStringIndex = response.indexOf('Suggestion:');
  if (helpfulStringIndex === -1 || suggestionStringIndex === -1) {
    return result;
  }

  const startIndex = response.indexOf('Specific:') + 'Specific:'.length;
  const endIndex = response.indexOf('Suggestion:', startIndex);

  const isHelpfulString = response.substring(startIndex, endIndex).trim();
  console.log('isHelpfulString', isHelpfulString);

  if (isHelpfulString === 'yes') {
    result.isHelpful = true;
  } else if (isHelpfulString === 'no') {
    result.isHelpful = false;
  }

  const suggestionString = response
    .substring(endIndex + 'Suggestion:'.length)
    .trim();
  result.suggestion = suggestionString;
  return result;
}

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
    const response = await llmInference.generateResponse(
      generatePrompt(message.data)
    );
    const reviewHelperOutput = generateReviewHelperOutput(response);
    console.info('[Worker] Response generated', reviewHelperOutput);
    self.postMessage({
      code: MESSAGE_CODE.RESPONSE_READY,
      payload: reviewHelperOutput,
    });
  })();
};

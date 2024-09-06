const url = new URL('./worker.js', import.meta.url);
import { MESSAGE_CODE, MODEL_STATUS } from './consts.js';
import { TYPING_DELAY } from './config.js';

// Initialization

let modelStatus = MODEL_STATUS.NOT_STARTED;
displayModelStatus(modelStatus);
displayReviewHelperOutput('No tip yet to improve your review.');
const worker = new Worker(url);
let typingTimeout = 0;

// DOM manipulation, display and events

function handleUserInputChange(event) {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  typingTimeout = setTimeout(() => {
    console.info('Input: User has stopped typing');
    if (modelStatus === MODEL_STATUS.READY) {
      console.info('Trigger inference');
      runLLMInference();
    }
    setTimeout(() => {}, 1000);
  }, TYPING_DELAY); // 800ms delay
}

function updateUiByModelStatus(status) {
  displayModelStatus(status);
  displayReviewHelperStatus(status);
  displayAiEffectStatus(status);
}

function displayAiEffectStatus(status) {
  document.getElementById('aiEffect').className = status;
}

function displayModelStatus(status) {
  document.getElementById('modelStatusWrapper').className = status;
  document.getElementById('modelStatus').className = status;
}

function displayReviewHelperStatus(status) {
  document.getElementById('reviewHelperStatusWrapper').className = status;
  document.getElementById('reviewHelperStatus').className = status;
}

function displayReviewHelperOutput(output) {
  resetScrollReviewHelperBubble();
  document.getElementById('reviewHelperOutput').innerText = output;
}

function simulatePostReview() {
  document.getElementById('reviewInputEl').value = '';
  window.alert('Review posted!');
}

function resetScrollReviewHelperBubble() {
  const reviewHelperOutputEl = document.getElementById('reviewHelperOutput');
  reviewHelperOutputEl.scrollTop = 0;
}

function toggleReviewHelperBubble() {
  resetScrollReviewHelperBubble();
  document.getElementById('reviewHelperBubble').classList.toggle('hidden');
}

// Gen AI / inference + worker message handling

function runLLMInference() {
  // TODO manage empty input
  const userPrompt = document.getElementById('reviewInputEl').value.trim();
  worker.postMessage(userPrompt);
}

worker.onmessage = function (message) {
  console.info('[Main thread] 📬 Message from worker: ', message);

  if (!message.data || !message.data.code) {
    throw new Error(
      `Message from worker is empty or doesn't contain a code field: ${message}`
    );
  }
  const messageCode = message.data.code;
  switch (messageCode) {
    case MESSAGE_CODE.PREPARING_MODEL:
      modelStatus = MODEL_STATUS.PREPARING;
      updateUiByModelStatus(modelStatus);
      break;

    case MESSAGE_CODE.MODEL_READY:
      modelStatus = MODEL_STATUS.READY;
      updateUiByModelStatus(modelStatus);
      runLLMInference();
      break;

    case MESSAGE_CODE.GENERATING_RESPONSE:
      modelStatus = MODEL_STATUS.GENERATING;
      updateUiByModelStatus(modelStatus);
      displayReviewHelperOutput('Thinking...');
      break;

    case MESSAGE_CODE.RESPONSE_READY:
      // TODO change to "ready again" to diff from first-time READY state?
      modelStatus = MODEL_STATUS.READY;
      updateUiByModelStatus(modelStatus);
      displayReviewHelperOutput(message.data.payload);
      break;

    case MESSAGE_CODE.MODEL_ERROR:
      modelStatus = MODEL_STATUS.ERROR;
      updateUiByModelStatus(modelStatus);
      break;

    default:
      throw new Error(
        `Message from worker contains an unknown message code: ${messageCode}`
      );
  }
};

window.runLLMInference = runLLMInference;
window.simulatePostReview = simulatePostReview;
window.handleUserInputChange = handleUserInputChange;
window.toggleReviewHelperBubble = toggleReviewHelperBubble;

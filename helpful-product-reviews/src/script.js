const url = new URL('./worker.js', import.meta.url);
import { MESSAGE_CODE, MODEL_STATUS } from './consts.js';

// Initialization

displayModelStatus(MODEL_STATUS.NOT_STARTED);
const worker = new Worker(url);
let typingTimeout = 0;

// DOM manipulation and events

const handleUserInputChange = (event) => {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  typingTimeout = setTimeout(() => {
    console.log('Input: User has stopped typing - Run inference');
    setTimeout(() => {}, 1000);
  }, 800); // 800ms delay
};

function displayModelStatus(status) {
  document.getElementById('modelStatusWrapper').className = status;
  document.getElementById('modelStatus').className = status;
}

function displayReviewHelperOutput(output) {
  document.getElementById('reviewHelperOutput').innerText = output;
}

function simulatePostReview() {
  document.getElementById('reviewInputEl').value = '';
  window.alert('Review posted!');
}

// Gen AI / inference + worker message handling

function runLLMInference() {
  const userPrompt = document.getElementById('reviewInputEl').value;
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
      displayModelStatus(MODEL_STATUS.PREPARING);
      document.getElementById('reviewHelperStatus').className =
        MODEL_STATUS.PREPARING;
      break;

    case MESSAGE_CODE.MODEL_READY:
      displayModelStatus(MODEL_STATUS.READY);
      document.getElementById('reviewHelperStatus').className =
        MODEL_STATUS.READY;
      break;

    case MESSAGE_CODE.GENERATING_RESPONSE:
      displayModelStatus(MODEL_STATUS.GENERATING);
      document.getElementById('reviewHelperStatus').className =
        MODEL_STATUS.GENERATING;
      break;

    case MESSAGE_CODE.RESPONSE_READY:
      displayModelStatus(MODEL_STATUS.READY);
      document.getElementById('reviewHelperStatus').className =
        MODEL_STATUS.READY;
      displayReviewHelperOutput(message.data.payload);
      // document.getElementById('llmOutput').innerText = message.data.payload;
      break;

    case MESSAGE_CODE.MODEL_ERROR:
      displayModelStatus(MODEL_STATUS.ERROR);
      document.getElementById('reviewHelperStatus').className = 'error';
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

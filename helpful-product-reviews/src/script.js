const url = new URL('./worker.js', import.meta.url);
import { MESSAGE_CODE, MODEL_STATUS } from './consts.js';

displayModelStatus(MODEL_STATUS.NOT_STARTED);
const worker = new Worker(url);
let typingTimeout = 0;

const handleUserInputChange = (event) => {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  typingTimeout = setTimeout(() => {
    console.log('Input: User has stopped typing - Run inference');
    setTimeout(() => {}, 1000);
  }, 800); // 800ms delay
};

// onchange="alert('the textarea has change')"
// handleInput(
//   'Review: "Love the natural ingredients!" Helpful: yes Suggestion: none'
// );

// handleInput(
//   'Review: "I don\'t like the color." Helpful: no Suggestion: Be more specific. For example, "The color is too dark for my hair."'
// );

// handleInput(
//   'Review: "Love the natural ingredients!" Helpful: yes Suggestion: none'
// );

function displayModelStatus(status) {
  document.getElementById('modelStatusWrapper').className = status;
  document.getElementById('modelStatus').className = status;
}

function displayReviewHelperOutput(output) {
  document.getElementById('reviewHelperOutput').innerText = output;
}

function runLLMInference() {
  const userPrompt = document.getElementById('reviewInputEl').value;
  worker.postMessage(userPrompt);
}

function simulatePostReview() {
  document.getElementById('reviewInputEl').value = '';
  window.alert('Review posted!');
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
      document.getElementById('reviewHelperStatus').className = 'not-ready';
      break;

    case MESSAGE_CODE.MODEL_READY:
      document.getElementById('reviewHelperStatus').className = 'ready';
      displayModelStatus(MODEL_STATUS.READY);
      break;

    case MESSAGE_CODE.GENERATING_RESPONSE:
      displayModelStatus(MODEL_STATUS.GENERATING);
      break;

    case MESSAGE_CODE.RESPONSE_READY:
      displayModelStatus(MODEL_STATUS.READY);
      displayReviewHelperOutput(message.data.payload);
      // document.getElementById('llmOutput').innerText = message.data.payload;
      break;

    case MESSAGE_CODE.MODEL_ERROR:
      document.getElementById('reviewHelperStatus').className = 'error';
      displayModelStatus(MODEL_STATUS.ERROR);
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

/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';

// TODO: Head to Kaggle, accept terms, and download the Gemma model here: https://www.kaggle.com/models/google/gemma/tfLite/gemma-2b-it-gpu-int4
// Host on your CDN or server and update URL below to be that path. Ensure CORS headers are set so it can be used by your web app if different domain.
const MODEL_FILE_NAME = 'https://';

const MENU = document.getElementById('menu');
const MENU_ITEMS = document.querySelectorAll('.item');
const SIDE_PANEL = document.getElementById('sidePanel');
const PRELOADER = document.getElementById('preloader');

let promptText = '';
let llmInference;
let genText = '';
let lastSelectedText = '';

for (let i = 0; i < MENU_ITEMS.length; i++) {
  MENU_ITEMS[i].addEventListener('click', handleMenuClick);
}

document.body.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  MENU.setAttribute('style', 'left: ' + e.clientX + 'px; top: ' + e.clientY + 'px;');
  MENU.classList.add('enabled');
  lastSelectedText = getSelectionText();
});


function resetMenu() {
  MENU.classList.remove('enabled');
}


function handleMenuClick(e) { 
  switch (this.innerText) {
    case 'Define word':
      promptText = 'What does jasonholder mean? Explain with some examples.';
      break;
    case 'Explain phrase like I\'m a child':
      promptText = 'Explain "jasonholder" as if I were a child.';
      break;
    case 'Executive summary':
      promptText = 'Create an executive summary for the following text, be sure to list the top 3 items to consider: "jasonholder"';
      break;
    case 'Turn into Tweet':
      promptText = 'Imagine you are a social media influencer. First create 3 key bullet points that summarize the text below, and then turn those bullets into a short concise Tweet: "jasonholder"';
      break;
    case 'Translate to German':
      promptText = 'Translate the following sentence to German: "jasonholder"';
      break;
    default:
      promptText = '';
  }
  
  if(llmInference !== undefined) {
    const PROMPT_FINAL = promptText.replace('jasonholder', lastSelectedText).split('\n').join(' ');
    llmInference.generateResponse(PROMPT_FINAL, displayPartialResults);
  } else {
    sidePanel.innerText  = 'Please wait for model to finish loading before trying the demo!';
    resetMenu();
  }
}

function getSelectionText() {
    var text = '';
    if (window.getSelection) {
        text = window.getSelection().toString();
    } else if (document.selection && document.selection.type != "Control") {
        text = document.selection.createRange().text;
    }
    return text;
}


function displayPartialResults(partialResults, complete) {
  genText += partialResults;
  SIDE_PANEL.innerText = genText;
  
  if (complete) {
    if (!genText) {
      console.error('Result is empty');
    }
    resetMenu(); 
    genText = '';
  }
}


async function initLLM() {
  const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

  LlmInference
      .createFromOptions(genaiFileset, {
        baseOptions: {
            modelAssetPath: MODEL_FILE_NAME
        },
        maxTokens: 1000,
        topK: 30,
        temperature: 0.75,
        randomSeed: 64
      })
      .then(llm => {
        llmInference = llm;
        PRELOADER.classList.remove('animate__fadeIn');
        PRELOADER.classList.add('animate__fadeOut');
        setTimeout(function() {
          PRELOADER.setAttribute('class', 'removed');
        }, 1000);
      }).catch(() =>{
        console.error('Failed to initialize the task.');
      });
}

initLLM();

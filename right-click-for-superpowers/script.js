import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';

const MODEL_FILE_NAME = 'https://storage.googleapis.com/jmstore/kaggleweb/grader/g-2b-it-gpu-int4.bin';

let promptText = '';
let llmInference = undefined;
let genText = '';
let lastSelectedText = '';
let menu = document.getElementById('menu');
let menuItems = document.querySelectorAll('.item');
let sidePanel = document.getElementById('sidePanel');
let preloader = document.getElementById('preloader');

for (let i = 0; i < menuItems.length; i++) {
  menuItems[i].addEventListener('click', handleMenuClick);
}

document.body.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  menu.setAttribute('style', 'left: ' + e.clientX + 'px; top: ' + e.clientY + 'px;');
  menu.classList.add('enabled');
  lastSelectedText = getSelectionText();
  console.log(lastSelectedText);
});


function resetMenu() {
  menu.classList.remove('enabled');
}


function handleMenuClick(e) {
  console.log(this.innerText);
  
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
    let promptFinal = promptText.replace('jasonholder', lastSelectedText).split('\n').join(' ');
    console.log(promptFinal);
    llmInference.generateResponse(promptFinal, displayPartialResults);
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
  sidePanel.innerText = genText;
  
  if (complete) {
    if (!genText) {
      console.error('Result is empty');
    }
    console.log(genText);
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
        preloader.classList.remove('animate__fadeIn');
        preloader.classList.add('animate__fadeOut');
        setTimeout(function() {
          preloader.setAttribute('class', 'removed');
        }, 1000);
      }).catch(() =>{
        console.error('Failed to initialize the task.');
      });
}

initLLM();

/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './pdf.min.mjs';

const {pdfjsLib} = globalThis;
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

const [openButton, exampleButton, languageButton, translateButton] = Array.from(document.querySelectorAll('button'));
const output = document.querySelector('output');
const detectedLanguageParagraph = document.querySelector('.detected-language');
const translationParagraph = document.querySelector('.translation');
const img = document.querySelector('img');
const downloadStatus = document.querySelector('.download-status');
const downloadMessage = document.querySelector('.download-message');
const downloadProgress = document.querySelector('.download-progress');

// The extracted text is in whatever language the document is in, so every
// output language the Prompt API supports is declared.
const PROMPT_OPTIONS = {
  expectedInputs: [
    { type: 'image' },
    { type: 'text', languages: ['de', 'en', 'es', 'fr', 'ja'] },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['de', 'en', 'es', 'fr', 'ja'] },
  ],
};

// Resolves once the user has interacted with the page. Chrome only starts a
// model download with user activation, which a tap, click, or key press grants.
const waitForUserActivation = () =>
  new Promise((resolve) => {
    const controller = new AbortController();
    const onInteraction = () => {
      if (navigator.userActivation.isActive) {
        controller.abort();
        resolve();
      }
    };
    for (const type of ['keydown', 'mousedown', 'pointerup', 'touchend']) {
      document.addEventListener(type, onInteraction, {
        capture: true,
        signal: controller.signal,
      });
    }
  });

// Creates an instance of one of the built-in AI APIs. `availability()` is
// asked with exactly the options `create()` gets, a download that is still
// needed waits for user activation, and its progress is shown on the page.
const createWithDownload = async (api, options, name) => {
  const availability = await api.availability(options);
  if (availability === 'unavailable') {
    throw new Error(`The ${name} is unavailable.`);
  }
  const downloadNeeded = availability !== 'available';
  if (downloadNeeded && !navigator.userActivation.isActive) {
    downloadMessage.textContent = `Click anywhere or press a key to download the ${name} model.`;
    downloadProgress.hidden = true;
    downloadStatus.hidden = false;
    await waitForUserActivation();
  }
  try {
    return await api.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (!downloadNeeded) {
            return;
          }
          downloadMessage.textContent = `Downloading the ${name} model: ${Math.round(
            e.loaded * 100,
          )}%`;
          downloadProgress.value = e.loaded;
          downloadProgress.hidden = false;
          downloadStatus.hidden = false;
        });
      },
    });
  } finally {
    downloadStatus.hidden = true;
  }
};

let useExample = false;
let detectedLanguage = undefined;

openButton.addEventListener('click', async () => {
  output.innerHTML = '';
  translationParagraph.innerHTML = '';
  detectedLanguageParagraph.innerHTML = '';
  detectedLanguage = false;
  img.src = '';

  let file;
  if (!useExample) {
    try {
      const [handle] = await showOpenFilePicker({
        types: [
          {
            description: 'Image or PDF files',
            accept: {
              'image/*': ['.png', '.gif', '.jpeg', '.jpg', '.webp', '.avif'],
              'application/pdf': ['.pdf'],
            },
          },
        ],
      });
      file = await handle.getFile();
      if (file.type === 'application/pdf') {
        const pdfBytes = new Uint8Array(await file.arrayBuffer());
        file = await convertFirstPageToPngBlob(pdfBytes);
      }
    } catch (err) {
      console.error(err.name, err.message);
    }
  } else {
    useExample = false;
    file = await fetch('specimen.png').then(response => response.blob());
  }
  const blobURL = URL.createObjectURL(file);
  img.src = blobURL;
  setTimeout(() => {
    URL.revokeObjectURL(blobURL);
  }, 0);

  try {
    const session = await createWithDownload(
      LanguageModel,
      PROMPT_OPTIONS,
      'Prompt API',
    );
    const stream = session.promptStreaming([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            value: 'Extract all text from the provided image.',
          },
          { type: 'image', value: file },
        ],
      },
    ]);
    for await (const chunk of stream) {
      output.append(chunk);
    }
  } catch (err) {
    console.error(err.name, err.message);
  }
});

languageButton.addEventListener('click', async () => {
  if (!output.innerText.length) {
    return;
  }

  detectedLanguage = false;
  detectedLanguageParagraph.innerHTML = '';

  try {
    const languageDetector = await createWithDownload(
      LanguageDetector,
      {},
      'Language Detector API',
    );
    ({ detectedLanguage } = (
      await languageDetector.detect(output.innerText)
    )[0]);
    const displayLanguage = new Intl.DisplayNames(['en'], {
      type: 'language',
    }).of(detectedLanguage);
    detectedLanguageParagraph.textContent = displayLanguage;
  } catch (err) {
    console.error(err.name, err.message);
  }
});

translateButton.addEventListener('click', async () => {
  if (!detectedLanguage || detectedLanguage === 'en') {
    return;
  }

  translationParagraph.innerHTML = '';

  try {
    const translator = await createWithDownload(
      Translator,
      { sourceLanguage: detectedLanguage, targetLanguage: 'en' },
      'Translator API',
    );
    const paragraphs = output.innerText.split('\n');
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        translationParagraph.append('\n');
        continue;
      }
      const translateStream = translator.translateStreaming(paragraph);
      for await (const chunk of translateStream) {
        translationParagraph.append(chunk);
      }
      translationParagraph.append('\n');
    }
  } catch (err) {
    console.error(err.name, err.message);
  }
});

exampleButton.addEventListener('click', () => {
  useExample = true;
  openButton.click();
});

const convertFirstPageToPngBlob = async (pdfData) => {
  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
};

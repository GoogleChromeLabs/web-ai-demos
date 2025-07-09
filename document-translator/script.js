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

let useExample = false;
let detectedLanguage = false;

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
    const session = await LanguageModel.create({
      expectedInputs: [{ type: 'image' }, { type: 'text' }],
    });
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
    const languageDetector = await LanguageDetector.create();
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
    const translator = await Translator.create({
      sourceLanguage: detectedLanguage,
      targetLanguage: 'en',
    });
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

exampleButton.addEventListener('click', async () => {
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

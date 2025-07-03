/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './pdf.min.mjs';

const {pdfjsLib} = globalThis;
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

const [button1, button2] = Array.from(document.querySelectorAll('button'));
const output = document.querySelector('output');
const strong = document.querySelector('strong');
const p = document.querySelector('p');
const img = document.querySelector('img');

let useExample = false;

button1.addEventListener('click', async () => {
  output.innerHTML = '';
  p.innerHTML = '';
  strong.innerHTML = '';

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
    file = await fetch('specimen.png').then(response => response.blob());
  }

  img.src = URL.createObjectURL(file);
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

  let detectedLanguage;
  try {
    const languageDetector = await LanguageDetector.create();
    ({ detectedLanguage } = (
      await languageDetector.detect(output.innerText)
    )[0]);
    const displayLanguage = new Intl.DisplayNames(['en'], {
      type: 'language',
    }).of(detectedLanguage);
    strong.textContent = displayLanguage;
  } catch (err) {
    console.error(err.name, err.message);
  }

  try {
    const translator = await Translator.create({
      sourceLanguage: detectedLanguage,
      targetLanguage: 'en',
    });
    const paragraphs = output.innerText.split('\n');
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        p.append('\n');
        continue;
      }
      const translateStream = translator.translateStreaming(paragraph);
      for await (const chunk of translateStream) {
        p.append(chunk);
      }
      p.append('\n');
    }
  } catch (err) {
    console.error(err.name, err.message);
  }
});

button2.addEventListener('click', async () => {
  useExample = true;
  await button1.click();
  useExample = false;
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

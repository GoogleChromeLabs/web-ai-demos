/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const form = document.querySelector('form');
const input = document.querySelector('input');
const output = document.querySelector('output');
const pre = document.querySelector('pre');
const downloadStatus = document.querySelector('.download-status');
const downloadMessage = document.querySelector('.download-message');
const downloadProgress = document.querySelector('.download-progress');

const getPrompt = (word) =>
  `Suggest a list of unique synonyms for the word "${word}".`;

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

const createLanguageModel = async (createOptions) => {
  // Asked again with the same options right before `create()`, since the
  // model may have been downloaded or evicted since the page loaded.
  const availability = await LanguageModel.availability(createOptions);
  if (availability === 'unavailable') {
    throw new Error('The Prompt API is unavailable on this device.');
  }
  const downloadNeeded = availability !== 'available';
  if (downloadNeeded && !navigator.userActivation.isActive) {
    downloadMessage.textContent =
      'Click anywhere or press a key to download the model.';
    downloadProgress.hidden = true;
    downloadStatus.hidden = false;
    await waitForUserActivation();
  }
  try {
    return await LanguageModel.create({
      ...createOptions,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (!downloadNeeded) {
            return;
          }
          downloadMessage.textContent = `Downloading the model: ${Math.round(
            e.loaded * 100
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

(async () => {
  let isAvailable = false;

  const createOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [
      {
        role: 'system',
        content: `You act as a thesaurus assistant that responds with synonyms of an input word.
Only respond with the list of synonyms.
Do not respond with further additional text before or after the list.
Each synonym may only occur once in the list.`,
      },
      {
        role: 'user',
        content: 'Suggest a list of unique synonyms for the word "funny".',
      },
      {
        role: 'assistant',
        content: `- amusing
- humorous
- comic
- comical
- droll
- laughable
- chucklesome
- hilarious
- hysterical
- riotous
- uproarious
- witty
- quick-witted
- waggish
- facetious
- jolly
- jocular
- lighthearted
- entertaining
- diverting
`,
      },
    ],
  };

  if ('LanguageModel' in self) {
    const availability = await LanguageModel.availability(createOptions);
    console.log(availability);
    if (availability !== 'unavailable') {
      isAvailable = true;
    }
  }
  console.log(isAvailable)

  if (!isAvailable) {
    document.querySelector('div').hidden = false;
    return;
  }

  document.querySelector('main').hidden = false;

  // Created on the first submit, which is a user interaction, so a model
  // download that is still needed can start right away.
  let languageModel;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = input.value.trim().split(/\s+/)[0].replace(/[^a-zA-Z\n]/g, '');
    if (!word) {
      return;
    }
    const prompt = getPrompt(word);
    try {
      languageModel ??= await createLanguageModel(createOptions);
      const assistantClone = await languageModel.clone();
      const stream = assistantClone.promptStreaming(prompt);
      output.innerHTML = '';
      pre.innerHTML = '';
      const doc = document.implementation.createHTMLDocument();
      doc.write(
        `<div>Here's a list of synonyms for the word <span>${word}</span>:<ul><li>`
      );
      output.append(doc.body.firstChild);

      for await (const chunk of stream) {
        pre.insertAdjacentText('beforeEnd', chunk);
        const newContent = chunk
          .replace(/^\s*[\-\*]\s*/, '')
          .replace(/[^a-zA-Z\n]/g, '')
          .replace('\n', '<li>');
        doc.write(newContent);
      }
      doc.write('</ul></div>');
    } catch (error) {
      console.log(error.name, error.message);
      output.innerHTML = `<pre>${error.name}: ${error.message}</pre>`;
    }
  });
})();

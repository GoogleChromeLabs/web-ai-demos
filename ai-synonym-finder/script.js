/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const form = document.querySelector('form');
const input = document.querySelector('input');
const output = document.querySelector('output');
const pre = document.querySelector('pre');

const getPrompt = (word) =>
  `Suggest a list of unique synonyms for the word "${word}".`;

(async () => {
  const isAvailable = (await self.ai?.languageModel?.capabilities?.())?.available;
  if (!isAvailable || isAvailable === 'no') {
    document.querySelector('div').hidden = false;
    return;
  }
  document.querySelector('main').hidden = false;

  const languageModel = await self.ai.languageModel.create({
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
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = input.value.trim().split(/\s+/)[0].replace(/[^a-zA-Z\n]/g, '');
    if (!word) {
      return;
    }
    const prompt = getPrompt(word);
    try {
      const assistantClone = await languageModel.clone();
      const stream = assistantClone.promptStreaming(prompt);
      output.innerHTML = '';
      pre.innerHTML = '';
      const doc = document.implementation.createHTMLDocument();
      doc.write(
        `<div>Here's a list of synonyms for the word <span>${word}</span>:<ul><li>`
      );
      output.append(doc.body.firstChild);
      let previousLength = 0;
      for await (const chunk of stream) {
        pre.insertAdjacentText('beforeEnd', chunk.slice(previousLength));
        const newContent = chunk
          .slice(previousLength)
          .replace(/^\s*[\-\*]\s*/, '')
          .replace(/[^a-zA-Z\n]/g, '')
          .replace('\n', '<li>');
        previousLength = chunk.length;
        doc.write(newContent);
      }
      doc.write('</ul></div>');
    } catch (error) {
      console.log(error.name, error.message);
      output.innerHTML = `<pre>${error.name}: ${error.message}</pre>`;
    }
  });
})();

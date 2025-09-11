/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';
// import { marked } from 'https://cdn.jsdelivr.net/npm/marked@13.0.3/lib/marked.esm.js';

(async () => {
  const showNotSupportedMessage = () => {
    document.querySelector('.not-supported-message').hidden = false;
  };

  if (!('Writer' in self && 'Rewriter' in self)) { // Test for Stable
    return showNotSupportedMessage();
  }

  const writeForm = document.querySelector('.write-form');
  const rewriteForm = document.querySelector('.rewrite-form');
  const contextInput = document.querySelector('input');
  const copyButton = document.querySelector('.copy-button');
  const output = document.querySelector('output');
  const textarea = document.querySelector('textarea');
  const formatSelect = document.querySelector('.format');
  const toneSelect = document.querySelector('.tone');
  const lengthSelect = document.querySelector('.length');
  const rewriteFormatSelect = document.querySelector('.rewrite-format');
  const rewriteToneSelect = document.querySelector('.rewrite-tone');
  const rewriteLengthSelect = document.querySelector('.rewrite-length');

  writeForm.hidden = false;

  let writer;
  let rewriter;

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      writeForm.dispatchEvent(new Event('submit'));
    }
  });

  [contextInput, textarea].forEach((input) =>
    input.addEventListener('focus', () => {
      input.select();
    })
  );

  const write = async () => {
    output.style.display = 'block';
    rewriteForm.hidden = true;
    copyButton.hidden = true;
    output.textContent = 'Writing…';
    const prompt = textarea.value.trim();
    if (!prompt) {
      return;
    }
    const stream = writer.writeStreaming(prompt);
    output.textContent = '';
    let fullResponse = '';
    for await (const chunk of stream) {
      // In Chrome stable, the writer always returns the entire text, so the full response is
      // the same as the chunk. In Canary, only the newly generated content is returned, so
      // the new chunk is joined with the existing full response.
      fullResponse = 'Writer' in self ? fullResponse + chunk : chunk;
      output.innerHTML = DOMPurify.sanitize(
        fullResponse /*marked.parse(fullResponse)*/
      );
    }
    copyButton.hidden = false;
    rewriteForm.hidden = false;
  };

  const createWriter = async () => {
    const options = {
      tone: toneSelect.value,
      length: lengthSelect.value,
      format: formatSelect.value,
      sharedContext: context.value.trim(),
    };

    writer = await Writer.create(options);
    console.log(writer);
  };

  const createRewriter = async () => {
    const options = {
      tone: rewriteToneSelect.value,
      length: rewriteLengthSelect.value,
      format: rewriteFormatSelect.value,
      sharedContext: context.value.trim(),
    };

    rewriter = await Rewriter.create(options);
    console.log(rewriter);
  };

  writeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createWriter();
    await write();
  });

  const rewrite = async () => {
    rewriteForm.hidden = true;
    copyButton.hidden = true;
    const prompt = output.innerHTML.trim();
    if (!prompt) {
      return;
    }
    output.textContent = 'Rewriting…';
    const stream = await rewriter.rewriteStreaming(prompt);
    output.textContent = '';
    let fullResponse = '';
    for await (const chunk of stream) {
      // In Chrome stable, the rewriter always returns the entire text, so the full response is
      // the same as the chunk. In Canary, only the newly generated content is returned, so
      // the new chunk is joined with the existing full response.
      fullResponse = 'Rewriter' in self ? fullResponse + chunk : chunk;
      output.innerHTML = DOMPurify.sanitize(
        fullResponse /*marked.parse(fullResponse)*/
      );
    }
    rewriteForm.hidden = false;
    copyButton.hidden = false;
    [rewriteToneSelect, rewriteLengthSelect, rewriteFormatSelect].forEach(
      (select) => (select.value = 'as-is')
    );
  };

  rewriteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createRewriter();
    await rewrite();
  });

  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(output.innerText);
  });

  // Remove once multiple rewrite options are supported.
  const whatTone = document.querySelector('[name=what][value=tone]');
  const whatLength = document.querySelector('[name=what][value=length]');

  [whatTone, whatLength].forEach((what) => {
    what.addEventListener('change', () => {
      rewriteToneSelect.labels[0].hidden = !whatTone.checked;
      rewriteLengthSelect.labels[0].hidden = !whatLength.checked;
      rewriteFormatSelect.labels[0].hidden = true;
    });
  });
  rewriteToneSelect.labels[0].hidden = !whatTone.checked;
  rewriteLengthSelect.labels[0].hidden = !whatLength.checked;
})();

/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as smd from 'https://cdn.jsdelivr.net/npm/streaming-markdown@0.0.17/smd.min.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.2.0/dist/purify.es.mjs';

if (!('LanguageModel' in self)) {
  document.querySelector('.not-supported').style.display = 'block';
  document.querySelector('main').style.display = 'none';
}

const form = document.querySelector('form');
const pre = document.querySelector('pre');
const input = document.querySelector('input');
const output = document.querySelector('output');

const assistant = await LanguageModel.create();

const renderer = smd.default_renderer(output);
const parser = smd.parser(renderer);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = input.value.trim();
  if (!prompt) {
    return;
  }
  output.innerHTML = '';
  pre.innerHTML = '';
  const doc = document.implementation.createHTMLDocument();
  doc.write('<div>');
  output.append(doc.body.firstChild);
  const assistantClone = await assistant.clone();
  const stream = assistantClone.promptStreaming(prompt);

  let chunks = '';

  for await (const chunk of stream) {
    chunks += chunk;
    DOMPurify.sanitize(chunks);
    if (DOMPurify.removed.length) {
      // Immediately stop what you were doing.
      smd.parser_end(parser);
      const { from } = DOMPurify.removed[0];
      alert(
        'Insecure model output removed from <' +
          from.nodeName.toLowerCase() +
          '>.'
      );
      return;
    }
    smd.parser_write(parser, chunk);
    // For the unformatted raw output.
    pre.append(chunk);
  }
  smd.parser_end(parser);
});

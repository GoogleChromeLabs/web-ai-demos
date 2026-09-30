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
const downloadStatus = document.querySelector('.download-status');
const downloadMessage = document.querySelector('.download-message');
const downloadProgress = document.querySelector('.download-progress');

// Shared by `availability()` and `create()`, so both ask about the same
// session.
const SESSION_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
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

const createAssistant = async () => {
  const availability = await LanguageModel.availability(SESSION_OPTIONS);
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
      ...SESSION_OPTIONS,
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

// Created on the first submit, which is a user interaction, so a model
// download that is still needed can start right away.
let assistant;

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
  assistant ??= await createAssistant();
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

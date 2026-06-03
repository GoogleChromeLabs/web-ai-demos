/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Engine } from '@litert-lm/core';
import { fetchBlob } from 'cos-resource-fetcher';

const MODELS = {
  e2b: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
  e4b: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm',
};

const out = document.getElementById('out');
const input = document.getElementById('in');
const status = document.getElementById('status');
const modelSelect = document.getElementById('model');

function setStatus(msg) {
  status.textContent = msg;
}

let engine = null;
let chat = null;

async function loadModel(key) {
  input.disabled = true;
  modelSelect.disabled = true;
  out.textContent = '';

  if (engine) {
    await engine.delete();
    engine = null;
    chat = null;
  }

  setStatus('Fetching model…');
  const modelBlob = await fetchBlob(MODELS[key], {
    onProgress({ loaded, total }) {
      const loadedGB = (loaded / 1e9).toFixed(2);
      if (total) {
        const percent = ((loaded / total) * 100).toFixed(1);
        const totalGB = (total / 1e9).toFixed(2);
        setStatus(`Downloading… ${percent}% (${loadedGB} / ${totalGB} GB)`);
      } else {
        setStatus(`Downloading… ${loadedGB} GB`);
      }
    },
  });

  setStatus('Loading engine…');
  engine = await Engine.create({ model: modelBlob.stream() });
  chat = await engine.createConversation();

  setStatus('Ready. Type a message and press Enter.');
  input.disabled = false;
  modelSelect.disabled = false;
  input.focus();
}

await loadModel('e2b');

modelSelect.addEventListener('change', () => loadModel(modelSelect.value));

input.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  out.append(`\n>>> ${text}\nAI: `);
  input.disabled = true;
  modelSelect.disabled = true;

  const stream = chat.sendMessageStreaming(text);
  for await (const chunk of stream) {
    out.append(chunk.content[0].text);
  }

  input.disabled = false;
  modelSelect.disabled = false;
  input.focus();
});

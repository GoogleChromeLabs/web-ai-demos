import { Engine } from '@litert-lm/core';
import { fetchBlob } from 'cos-resource-fetcher';

// To use the E4B model, swap this URL (and only this URL):
// const MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm';
const MODEL_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm';

const out = document.getElementById('out');
const input = document.getElementById('in');
const status = document.getElementById('status');

function setStatus(msg) {
  status.textContent = msg;
}

setStatus('Fetching model…');

const modelBlob = await fetchBlob(MODEL_URL, {
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

const engine = await Engine.create({ model: modelBlob.stream() });
const chat = await engine.createConversation();

setStatus('Ready. Type a message and press Enter.');
input.disabled = false;
input.focus();

input.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  const text = input.value.trim();
  input.value = '';
  out.append(`\n>>> ${text}\nAI: `);
  input.disabled = true;

  const stream = chat.sendMessageStreaming(text);
  for await (const chunk of stream) {
    out.append(chunk.content[0].text);
  }

  input.disabled = false;
  input.focus();
});

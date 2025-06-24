/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './style.css';
import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';

console.log(import.meta.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize FirebaseApp
const firebaseApp = initializeApp(firebaseConfig);

// Initialize the Google AI service
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Create a `GenerativeModel` instance with a model that supports your use case
const model = getGenerativeModel(ai, {
  mode: 'prefer_on_device',
  model: 'gemini-2.5-flash',
  onDeviceParams: {
    temperature: 0.8,
    topK: 10,
  },
});

const [pre1, pre2] = Array.from(document.querySelectorAll('pre'));
const [span1, span2] = Array.from(document.querySelectorAll('span'));
const getSource = async () =>
  'LanguageModel' in self &&
  (await LanguageModel.availability()) === 'available'
    ? 'Built-in AI'
    : 'Cloud AI';

(async () => {
  document.querySelector('button').addEventListener('click', async () => {
    pre1.innerHTML = '';
    span1.innerHTML = await getSource();

    // Send a text only prompt to the model [Documentation]
    const prompt = 'Tell me a short joke';
    // To stream generated text output, call generateContentStream with the text input
    try {
      const result = await model.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        pre1.append(chunkText);
      }

      console.log('Aggregated response: ', await result.response);
    } catch (err) {
      console.error(err.name, err.message);
    }
  });

  // Converts a File object to a Part object.
  async function fileToGenerativePart(file) {
    const base64EncodedDataPromise = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  }

  const fileInputEl = document.querySelector('input[type=file]');

  fileInputEl.addEventListener('change', async () => {
    pre2.innerHTML = '';
    span2.innerHTML = await getSource();

    // Provide a text prompt to include with the image
    const prompt = 'Write a poem on this picture';

    const imagePart = await fileToGenerativePart(fileInputEl.files[0]);

    try {
      // To generate text output, call generateContent with the text and image
      const result = await model.generateContentStream([prompt, imagePart]);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        pre2.append(chunkText);
      }
      console.log('Aggregated response: ', await result.response);
    } catch (err) {
      console.error(err.name, err.message);
    }
  });
})();

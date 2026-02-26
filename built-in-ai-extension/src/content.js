/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// src/content.js

(async () => {
  // Read config from storage
  const config = await chrome.storage.local.get([
    'backend',
    'forceInjection',
    // Gemini
    'geminiApiKey',
    'geminiModelName',
    // OpenAI
    'openaiApiKey',
    'openaiModelName',
    // Firebase
    'firebaseApiKey',
    'firebaseProjectId',
    'firebaseAppId',
    'firebaseApiProvider',
    'firebaseModelName',
    'firebaseUseAppCheck',
    'firebaseReCaptchaSiteKey',
    'firebaseUseLimitedUseAppCheckTokens',
    // Transformers
    'transformersModelName',
    'transformersDevice',
    'transformersDtype',
  ]);

  // Default values
  const backend = config.backend || 'gemini';
  const forceInjection = config.forceInjection || false;

  // Inject the entry script as a module to support ESM imports
  const script = document.createElement('script');
  script.id = 'built-in-ai-extension-script';
  script.type = 'module';
  script.src = chrome.runtime.getURL('/src/main-world-entry.js');

  // Pass necessary data via data-attribute
  script.dataset.config = JSON.stringify({
    config,
    backend,
    forceInjection,
    extensionId: chrome.runtime.id,
  });

  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();

  let bridgePort = null;

  // Listen for the bridge initialization from the MAIN world
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'AI_EXTENSION_INIT_BRIDGE' && event.ports[0]) {
      bridgePort = event.ports[0];
      bridgePort.onmessage = (e) => {
        const { id, message } = e.data;
        chrome.runtime.sendMessage(message, (response) => {
          bridgePort.postMessage({ id, response });
        });
      };
    }
  });

  // Listen for messages from background/offscreen and relay to MAIN world
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== 'content') return;

    // Relay over the bridge port if available (supports binary)
    if (bridgePort) {
      bridgePort.postMessage({ type: 'EVENT', message });
      return;
    }

    // Fallback/Legacy event dispatching (only if bridge is not ready)
    const eventType =
      message.type === 'download-progress'
        ? 'extension-download-progress'
        : message.type === 'stream-chunk'
          ? 'extension-stream-chunk'
          : message.type === 'stream-error'
            ? 'extension-stream-error'
            : message.type === 'context-overflow'
              ? 'extension-context-overflow'
              : 'extension-stream-done';

    const event = new CustomEvent(eventType, {
      detail: message,
    });
    window.dispatchEvent(event);
  });


})();

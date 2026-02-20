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

  // Listen for messages from background/offscreen and dispatch to MAIN world
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== 'content') return;

    const eventType =
      message.type === 'download-progress'
        ? 'extension-download-progress'
        : message.type === 'stream-chunk'
          ? 'extension-stream-chunk'
          : message.type === 'quota-overflow'
            ? 'extension-quota-overflow'
            : 'extension-stream-done';

    console.log(`Content script receiving ${message.type} from extension:`, {
      requestId: message.requestId,
      eventType,
    });

    const event = new CustomEvent(eventType, {
      detail: message,
    });
    window.dispatchEvent(event);
  });

  // Listen for requests from the MAIN world and relay to extension
  window.addEventListener('extension-request', (event) => {
    const { detail } = event;
    if (!detail) return;
    const { bridgeId } = detail;

    chrome.runtime.sendMessage(detail, (response) => {
      // Send the response back to the MAIN world
      window.dispatchEvent(
        new CustomEvent('extension-response', {
          detail: {
            bridgeId,
            response,
          },
        })
      );
    });
  });
})();

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// offscreen/offscreen.js

const sessions = new Map(); // requestId -> session instance
const controllers = new Map(); // callId -> AbortController

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  (async () => {
    let processedMessage;
    try {
      // Recursively find and process blobURLs into Blobs
      const processBlobURLs = async (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        // More robust identification for the specific bridge descriptor
        if (obj.__extension_blob_url__) {
          const url = obj.__extension_blob_url__;
          try {
            const response = await fetch(url);
            const blob = await response.blob();
            URL.revokeObjectURL(url);
            return blob;
          } catch (e) {
            console.error(`[Offscreen] Failed to fetch blobURL (${url}):`, e);
            URL.revokeObjectURL(url);
            throw e;
          }
        }

        // Avoid recursing into Blobs, ArrayBuffers, or other special objects
        const constructorName = obj.constructor?.name;
        if (
          constructorName === 'Blob' ||
          constructorName === 'File' ||
          constructorName === 'ArrayBuffer' ||
          ArrayBuffer.isView(obj)
        ) {
          return obj;
        }

        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            obj[i] = await processBlobURLs(obj[i]);
          }
        } else {
          for (const key of Object.keys(obj)) {
            obj[key] = await processBlobURLs(obj[key]);
          }
        }
        return obj;
      };

      processedMessage = await processBlobURLs(message);
      const { type } = processedMessage;

      if (type === 'create-session') {
        const {
          config,
          options,
          requestId,
          callId,
          apiType,
          backend,
          senderTabId,
          senderFrameId,
        } = processedMessage;

        // Apply external configuration to globals for the polyfills to find.
        setupConfigs(backend, config);

        const promptApiModule = await import('prompt-api-polyfill');

        const ApiClass = getApiClass(promptApiModule, apiType, config, backend);

        if (!ApiClass) {
          throw new Error(
            `AI API "${apiType || 'LanguageModel'}" is undefined in offscreen context.`
          );
        }

        const monitor = (target) => {
          let lastProgressTimestamp = 0;
          target.addEventListener('downloadprogress', (e) => {
            const now = Date.now();
            // Always send progress when started or finished (required for WPT),
            // otherwise throttle intermediate progress updates to at most once per 200ms
            // to avoid drowning the message bus.
            if (
              e.loaded > 0 &&
              e.loaded < e.total &&
              now - lastProgressTimestamp < 200
            ) {
              return;
            }
            lastProgressTimestamp = now;

            const progressMessage = {
              target: senderTabId ? 'content' : 'options',
              type: 'download-progress',
              loaded: e.loaded,
              total: e.total,
              requestId: requestId,
              senderTabId: senderTabId,
              senderFrameId: senderFrameId,
            };

            chrome.runtime.sendMessage(progressMessage);
          });
        };

        const controller = new AbortController();
        if (callId) controllers.set(callId, controller);
        try {
          const session = await ApiClass.create({
            ...options,
            monitor,
            signal: controller.signal,
          });

          // Relay contextoverflow events
          session.addEventListener?.('contextoverflow', () => {
            chrome.runtime.sendMessage({
              target: senderTabId ? 'content' : 'options',
              type: 'context-overflow',
              requestId,
              senderTabId,
              senderFrameId,
            });
          });

          sessions.set(requestId, session);
          sendResponse({
            success: true,
            attributes: {
              contextUsage: session.contextUsage,
              contextWindow: session.contextWindow,
            },
          });
        } finally {
          if (callId) controllers.delete(callId);
        }
      } else if (processedMessage.type === 'availability') {
        const { config, backend, apiType, options } = processedMessage;

        setupConfigs(backend, config);

        const promptApiModule = await import('prompt-api-polyfill');

        const ApiClass = getApiClass(promptApiModule, apiType, config, backend);

        const result = await ApiClass.availability(options);
        sendResponse({ success: true, result });
      } else if (processedMessage.type === 'clone-session') {
        const {
          sourceRequestId,
          requestId,
          callId,
          options,
          senderTabId,
          senderFrameId,
        } = processedMessage;
        const sourceSession = sessions.get(sourceRequestId);
        if (!sourceSession) {
          throw new Error(
            'No source session found for requestId: ' + sourceRequestId
          );
        }

        const monitor = (target) => {
          let lastProgressTimestamp = 0;
          target.addEventListener('downloadprogress', (e) => {
            const now = Date.now();
            if (
              e.loaded > 0 &&
              e.loaded < e.total &&
              now - lastProgressTimestamp < 200
            ) {
              return;
            }
            lastProgressTimestamp = now;

            chrome.runtime.sendMessage({
              target: senderTabId ? 'content' : 'options',
              type: 'download-progress',
              loaded: e.loaded,
              total: e.total,
              requestId: requestId,
              senderTabId: senderTabId,
              senderFrameId: senderFrameId,
            });
          });
        };

        const controller = new AbortController();
        if (callId) controllers.set(callId, controller);
        try {
          const session = await sourceSession.clone({
            ...options,
            monitor,
            signal: controller.signal,
          });
          sessions.set(requestId, session);
          sendResponse({
            success: true,
            attributes: {
              contextUsage: session.contextUsage,
              contextWindow: session.contextWindow,
            },
          });
        } finally {
          if (callId) controllers.delete(callId);
        }
      } else if (processedMessage.type === 'list-models') {
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        const models = new Set();
        for (const key of keys) {
          const url = new URL(key.url);
          const match = url.pathname.match(/\/([^/]+\/[^/]+)\/resolve\//);
          if (match) models.add(match[1]);
        }
        sendResponse({ success: true, models: Array.from(models) });
      } else if (processedMessage.type === 'delete-model') {
        const { modelName } = processedMessage;
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        let deletedCount = 0;
        for (const key of keys) {
          if (key.url.includes(modelName)) {
            await cache.delete(key);
            deletedCount++;
          }
        }
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k.startsWith('transformers_model_files_') &&
            k.includes(modelName)
          ) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
        sendResponse({ success: true, deletedCount });
      } else if (
        processedMessage.type === 'prompt' ||
        processedMessage.type === 'execute' ||
        processedMessage.type === 'append'
      ) {
        const { requestId, callId, text, method, options } = processedMessage;

        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        const controller = new AbortController();
        if (callId) controllers.set(callId, controller);
        try {
          const result = await session[method || processedMessage.type](text, {
            ...options,
            signal: controller.signal,
          });
          sendResponse({
            success: true,
            result,
            attributes: {
              contextUsage: session.contextUsage,
              contextWindow: session.contextWindow,
            },
          });
        } finally {
          if (callId) controllers.delete(callId);
        }
      } else if (
        processedMessage.type === 'prompt-streaming' ||
        processedMessage.type === 'execute-streaming'
      ) {
        const {
          requestId,
          callId,
          text,
          method,
          options,
          senderTabId,
          senderFrameId,
        } = processedMessage;
        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        const controller = new AbortController();
        if (callId) controllers.set(callId, controller);

        // session[method](text, options) preserves "this"
        const stream = session[method || 'promptStreaming'](text, {
          ...options,
          signal: controller.signal,
        });
        const reader = stream.getReader();

        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                chrome.runtime.sendMessage({
                  target: senderTabId ? 'content' : 'options',
                  type: 'stream-done',
                  requestId,
                  callId,
                  senderTabId,
                  senderFrameId,
                  // Also include final usage meta if available
                  attributes: {
                    contextUsage: session.contextUsage,
                    contextWindow: session.contextWindow,
                  },
                });
                break;
              }
              chrome.runtime.sendMessage({
                target: senderTabId ? 'content' : 'options',
                type: 'stream-chunk',
                requestId,
                callId,
                text: String(value), // Ensure it's a string
                senderTabId,
                senderFrameId,
              });
            }
          } catch (err) {
            console.error('Streaming error in offscreen:', err);
            chrome.runtime.sendMessage({
              target: senderTabId ? 'content' : 'options',
              type: 'stream-error',
              requestId,
              callId,
              error: err.message,
              name: err.name,
              senderTabId,
              senderFrameId,
            });
          } finally {
            if (callId) controllers.delete(callId);
          }
        })();
        sendResponse({
          success: true,
          attributes: {
            contextUsage: session.contextUsage,
            contextWindow: session.contextWindow,
          },
        });
      } else if (processedMessage.type === 'destroy-session') {
        const { requestId } = processedMessage;
        const session = sessions.get(requestId);
        if (session && session.destroy) session.destroy();
        sessions.delete(requestId);
        sendResponse({ success: true });
      } else if (processedMessage.type === 'abort-request') {
        const { callId } = processedMessage;
        const controller = controllers.get(callId);
        if (controller) {
          controller.abort();
          controllers.delete(callId);
        }
        sendResponse({ success: true });
      }
    } catch (err) {
      console.error('Offscreen execution error:', err);
      // Use message instead of processedMessage here because processedMessage
      // might be undefined if processBlobURLs failed
      const apiType = processedMessage?.apiType ?? message.apiType;
      const errorMsg =
        apiType && !err.message.includes(apiType)
          ? `[${apiType}] ${err.message}`
          : err.message;
      sendResponse({ success: false, error: errorMsg, name: err.name });
    }
  })();

  return true; // Keep channel open for async response
});

function setupConfigs(backend, config) {
  // Apply external configuration to globals for the polyfills to find.
  // First, clear any previous configurations to avoid stale settings.
  window.GEMINI_CONFIG = undefined;
  window.OPENAI_CONFIG = undefined;
  window.FIREBASE_CONFIG = undefined;
  window.TRANSFORMERS_CONFIG = undefined;

  // Set the configuration based on the selected backend.
  if (backend === 'gemini') {
    window.GEMINI_CONFIG = {
      apiKey: config.geminiApiKey,
      modelName: config.geminiModelName,
    };
  } else if (backend === 'openai') {
    window.OPENAI_CONFIG = {
      apiKey: config.openaiApiKey,
      modelName: config.openaiModelName,
    };
  } else if (backend === 'firebase') {
    window.FIREBASE_CONFIG = {
      apiKey: config.firebaseApiKey,
      projectId: config.firebaseProjectId,
      appId: config.firebaseAppId,
      geminiApiProvider: config.firebaseApiProvider,
      modelName: config.firebaseModelName,
      useAppCheck: config.firebaseUseAppCheck,
      reCaptchaSiteKey: config.firebaseReCaptchaSiteKey,
      useLimitedUseAppCheckTokens: config.firebaseUseLimitedUseAppCheckTokens,
    };
  } else if (backend === 'transformers') {
    window.TRANSFORMERS_CONFIG = {
      apiKey: 'transformers',
      modelName: config.transformersModelName,
      device: config.transformersDevice,
      dtype: config.transformersDtype,
      env: {
        allowRemoteModels: true,
        backends: {
          onnx: {
            wasm: {
              wasmPaths: chrome.runtime.getURL('/src/transformers-assets/'),
            },
          },
        },
      },
    };
  }
}

function getApiClass(promptApiModule, apiType, config, backend) {
  const nativeClass = window[apiType || 'LanguageModel'];

  const ApiClass =
    promptApiModule.LanguageModel ||
    promptApiModule.default?.LanguageModel ||
    promptApiModule.default ||
    nativeClass;

  // If forceInjection is false and we have a native class, prefer it,
  // BUT only if the requested backend is 'native'.
  if (
    !config.forceInjection &&
    backend === 'native' &&
    nativeClass &&
    typeof nativeClass.create === 'function'
  ) {
    return nativeClass;
  }

  return ApiClass;
}

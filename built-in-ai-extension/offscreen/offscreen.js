// offscreen/offscreen.js

let sessions = new Map(); // requestId -> session instance

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  (async () => {
    try {
      if (message.type === 'create-session') {
        const {
          config,
          options,
          requestId,
          apiType,
          backend,
          senderTabId,
          senderFrameId,
        } = message;
        console.log('Offscreen create-session:', {
          backend,
          apiType,
          hasConfig: !!config,
          geminiKey: !!config?.geminiApiKey,
          transformersModel: !!config?.transformersModelName,
        });

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
            useLimitedUseAppCheckTokens:
              config.firebaseUseLimitedUseAppCheckTokens,
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
                    wasmPaths: chrome.runtime.getURL(
                      '/src/transformers-assets/'
                    ),
                  },
                },
              },
            },
          };
        }

        console.log('Globals set:', {
          GEMINI: !!window.GEMINI_CONFIG,
          FIREBASE: !!window.FIREBASE_CONFIG,
          TRANSFORMERS: !!window.TRANSFORMERS_CONFIG,
        });

        const lowerApiName = apiType
          ? apiType.charAt(0).toLowerCase() + apiType.slice(1)
          : 'languageModel';
        const nativeClass = window[apiType || 'LanguageModel'];

        // Load Prompt API polyfill as the provider via standard package imports.
        // Vite will handle the bundling and resolution.
        const [promptApiModule] = await Promise.all([
          import('prompt-api-polyfill'),
        ]);

        const ApiClass =
          promptApiModule.LanguageModel ||
          promptApiModule.default?.LanguageModel ||
          promptApiModule.default ||
          nativeClass;

        console.log('Offscreen AI context:', {
          apiType,
          hasNativeClass: !!nativeClass,
          hasApiClass: !!ApiClass,
          promptApiModuleKeys: Object.keys(promptApiModule),
        });

        if (!ApiClass) {
          throw new Error(
            `AI API "LanguageModel" is undefined in offscreen context.`
          );
        }

        // If forceInjection is false and we have a native class, prefer it
        let sessionProvider = ApiClass;
        if (
          !config.forceInjection &&
          nativeClass &&
          typeof nativeClass.create === 'function'
        ) {
          console.log(
            `Offscreen: Using native implementation for ${apiType || 'LanguageModel'}`
          );
          sessionProvider = nativeClass;
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

        const session = await sessionProvider.create({ ...options, monitor });

        // Relay quotaoverflow events
        session.addEventListener?.('quotaoverflow', () => {
          chrome.runtime.sendMessage({
            target: senderTabId ? 'content' : 'options',
            type: 'quota-overflow',
            requestId,
            senderTabId,
            senderFrameId,
          });
        });

        sessions.set(requestId, session);
        sendResponse({
          success: true,
          attributes: {
            inputUsage: session.inputUsage,
            inputQuota: session.inputQuota,
          },
        });
      } else if (message.type === 'clone-session') {
        const {
          sourceRequestId,
          requestId,
          options,
          senderTabId,
          senderFrameId,
        } = message;
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

        const session = await sourceSession.clone({ ...options, monitor });
        sessions.set(requestId, session);
        sendResponse({
          success: true,
          attributes: {
            inputUsage: session.inputUsage,
            inputQuota: session.inputQuota,
          },
        });
      } else if (message.type === 'list-models') {
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        const models = new Set();
        for (const key of keys) {
          const url = new URL(key.url);
          const match = url.pathname.match(/\/([^/]+\/[^/]+)\/resolve\//);
          if (match) models.add(match[1]);
        }
        sendResponse({ success: true, models: Array.from(models) });
      } else if (message.type === 'delete-model') {
        const { modelName } = message;
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
        message.type === 'prompt' ||
        message.type === 'execute' ||
        message.type === 'append'
      ) {
        const { requestId, text, method, options, senderTabId, senderFrameId } =
          message;
        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        console.log(`Offscreen executing ${method || message.type}:`, {
          requestId,
          textLength: text?.length,
        });
        const result = await session[method || message.type](text, options);
        sendResponse({
          success: true,
          result,
          attributes: {
            inputUsage: session.inputUsage,
            inputQuota: session.inputQuota,
          },
        });
      } else if (
        message.type === 'prompt-streaming' ||
        message.type === 'execute-streaming'
      ) {
        const { requestId, text, method, options, senderTabId, senderFrameId } =
          message;
        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        console.log(
          `Offscreen executing streaming ${method || 'promptStreaming'}:`,
          { requestId, textLength: text?.length }
        );
        // session[method](text, options) preserves "this"
        const stream = session[method || 'promptStreaming'](text, options);
        const reader = stream.getReader();

        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`Offscreen streaming done for ${requestId}`);
                chrome.runtime.sendMessage({
                  target: senderTabId ? 'content' : 'options',
                  type: 'stream-done',
                  requestId,
                  senderTabId,
                  senderFrameId,
                  // Also include final usage meta if available
                  attributes: {
                    inputUsage: session.inputUsage,
                    inputQuota: session.inputQuota,
                  },
                });
                break;
              }
              console.log(`Offscreen sending chunk for ${requestId}:`, {
                textLength: value?.length,
              });
              chrome.runtime.sendMessage({
                target: senderTabId ? 'content' : 'options',
                type: 'stream-chunk',
                requestId,
                text: String(value), // Ensure it's a string
                senderTabId,
                senderFrameId,
              });
            }
          } catch (err) {
            console.error('Streaming error in offscreen:', err);
          }
        })();
        sendResponse({
          success: true,
          attributes: {
            inputUsage: session.inputUsage,
            inputQuota: session.inputQuota,
          },
        });
      } else if (message.type === 'destroy-session') {
        const { requestId } = message;
        const session = sessions.get(requestId);
        if (session && session.destroy) session.destroy();
        sessions.delete(requestId);
        sendResponse({ success: true });
      }
    } catch (err) {
      console.error('Offscreen execution error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});

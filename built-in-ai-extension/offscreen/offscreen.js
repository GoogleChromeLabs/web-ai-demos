// offscreen/offscreen.js

let sessions = new Map(); // requestId -> session instance

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  (async () => {
    try {
      if (message.type === 'create-session') {
        const { config, options, requestId, apiType, backend, senderTabId } = message;
        console.log('Offscreen create-session:', {
          backend,
          apiType,
          hasConfig: !!config,
          geminiKey: !!config?.geminiApiKey,
          transformersModel: !!config?.transformersModelName
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
                    wasmPaths: chrome.runtime.getURL('/src/transformers-assets/'),
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
        const nativeClass =
          window[apiType || 'LanguageModel'] ||
          (window.ai &&
            (window.ai[apiType || 'LanguageModel'] || window.ai[lowerApiName]));

        // Load polyfills as potential providers via standard package imports.
        // Vite will handle the bundling and resolution.
        const [promptApiModule, taskApisModule] = await Promise.all([
          import('prompt-api-polyfill'),
          import('built-in-ai-task-apis-polyfills'),
        ]);

        let ApiClass;
        if (apiType === 'LanguageModel' || !apiType) {
          ApiClass =
            promptApiModule.LanguageModel ||
            promptApiModule.default?.LanguageModel ||
            promptApiModule.default ||
            nativeClass;
        } else {
          ApiClass = taskApisModule[apiType] || nativeClass;
        }

        console.log('Offscreen AI context:', {
          apiType,
          hasNativeClass: !!nativeClass,
          hasApiClass: !!ApiClass,
          promptApiModuleKeys: Object.keys(promptApiModule),
          taskApisModuleKeys: Object.keys(taskApisModule),
        });

        if (!ApiClass) {
          throw new Error(
            `AI API "${apiType || 'LanguageModel'}" is undefined in offscreen context.`
          );
        }

        // If forceInjection is false and we have a native class, prefer it
        let sessionProvider = ApiClass;
        if (!config.forceInjection && nativeClass && typeof nativeClass.create === 'function') {
          console.log(`Offscreen: Using native implementation for ${apiType || 'LanguageModel'}`);
          sessionProvider = nativeClass;
        }

        const monitor = (target) => {
          target.addEventListener('downloadprogress', (e) => {
            const progressMessage = {
              target: senderTabId ? 'content' : 'options',
              type: 'download-progress',
              loaded: e.loaded,
              total: e.total,
              requestId: requestId,
              senderTabId: senderTabId,
            };

            chrome.runtime.sendMessage(progressMessage);
          });
        };

        const session = await sessionProvider.create({ ...options, monitor });

        sessions.set(requestId, session);
        sendResponse({ success: true });
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
      } else if (message.type === 'prompt' || message.type === 'execute') {
        const { requestId, text, method, options, senderTabId } = message;
        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        // session[method](text, options) preserves "this"
        const result = await session[method || 'prompt'](text, options);
        sendResponse({ success: true, result });
      } else if (
        message.type === 'prompt-streaming' ||
        message.type === 'execute-streaming'
      ) {
        const { requestId, text, method, options, senderTabId } = message;
        const session = sessions.get(requestId);
        if (!session)
          throw new Error('No active session for requestId: ' + requestId);

        // session[method](text, options) preserves "this"
        const stream = session[method || 'promptStreaming'](text, options);
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
                  senderTabId,
                });
                break;
              }
              chrome.runtime.sendMessage({
                target: senderTabId ? 'content' : 'options',
                type: 'stream-chunk',
                requestId,
                text: value,
                senderTabId,
              });
            }
          } catch (err) {
            console.error('Streaming error:', err);
          }
        })();
        sendResponse({ success: true });
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

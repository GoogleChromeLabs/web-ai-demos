// src/main-world-entry.js

(async () => {
  const scriptTag = document.currentScript;
  if (!scriptTag) return;

  const data = JSON.parse(scriptTag.dataset.config || '{}');
  const { config, backend, forceInjection } = data;

  // Helper to send messages to the extension via the content script bridge
  const sendMessage = (message) => {
    const bridgeId = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const listener = (event) => {
        if (event.detail.bridgeId === bridgeId) {
          window.removeEventListener('extension-response', listener);
          const response = event.detail.response;
          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error));
          }
        }
      };
      window.addEventListener('extension-response', listener);
      window.dispatchEvent(
        new CustomEvent('extension-request', {
          detail: { ...message, bridgeId },
        })
      );
    });
  };

  console.log('Built-in AI Extension: Injecting defensive AI proxies...');
  const sessions = new WeakMap();

  class LanguageModel extends EventTarget {
    // ... (rest of the class remains same)
    constructor(apiType, options, requestId) {
      super();
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async prompt(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'prompt',
        requestId,
        text,
        options,
      });
      return response.result;
    }

    promptStreaming(text, options = {}) {
      const { requestId } = sessions.get(this);
      return new ReadableStream({
        start(controller) {
          const chunkListener = (e) => {
            if (e.detail.requestId === requestId)
              controller.enqueue(e.detail.text);
          };
          const doneListener = (e) => {
            if (e.detail.requestId === requestId) {
              controller.close();
              window.removeEventListener('extension-stream-chunk', chunkListener);
              window.removeEventListener('extension-stream-done', doneListener);
            }
          };
          window.addEventListener('extension-stream-chunk', chunkListener);
          window.addEventListener('extension-stream-done', doneListener);

          sendMessage({
            target: 'offscreen',
            type: 'prompt-streaming',
            requestId,
            text,
            options,
          }).catch((err) => controller.error(err));
        },
      });
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }

    async clone(options = {}) {
      const { apiType, requestId } = sessions.get(this);
      const newRequestId = Math.random().toString(36).slice(2);

      // Proxy monitor events back for the cloned session
      if (options.monitor) {
        const target = new EventTarget();
        progressTargets.set(newRequestId, target);
        options.monitor(target);
      }

      // Strip non-serializable properties (like 'monitor' function) before sending
      const serializableOptions = { ...options };
      for (const key in serializableOptions) {
        if (typeof serializableOptions[key] === 'function') {
          delete serializableOptions[key];
        }
      }

      await sendMessage({
        target: 'offscreen',
        type: 'create-session', // Or a 'clone-session' if supported
        apiType,
        backend,
        requestId: newRequestId,
        config,
        options: serializableOptions,
      });
      return new LanguageModel(apiType, options, newRequestId);
    }
  }

  class Summarizer {
    constructor(apiType, options, requestId) {
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async summarize(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'summarize',
        options,
      });
      return response.result;
    }

    summarizeStreaming(text, options = {}) {
      const { requestId } = sessions.get(this);
      return new ReadableStream({
        start(controller) {
          const chunkListener = (e) => {
            if (e.detail.requestId === requestId)
              controller.enqueue(e.detail.text);
          };
          const doneListener = (e) => {
            if (e.detail.requestId === requestId) {
              controller.close();
              window.removeEventListener('extension-stream-chunk', chunkListener);
              window.removeEventListener('extension-stream-done', doneListener);
            }
          };
          window.addEventListener('extension-stream-chunk', chunkListener);
          window.addEventListener('extension-stream-done', doneListener);

          sendMessage({
            target: 'offscreen',
            type: 'execute-streaming',
            requestId,
            text,
            method: 'summarizeStreaming',
            options,
          }).catch((err) => controller.error(err));
        },
      });
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }
  }

  class Writer {
    constructor(apiType, options, requestId) {
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async write(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'write',
        options,
      });
      return response.result;
    }

    writeStreaming(text, options = {}) {
      const { requestId } = sessions.get(this);
      return new ReadableStream({
        start(controller) {
          const chunkListener = (e) => {
            if (e.detail.requestId === requestId)
              controller.enqueue(e.detail.text);
          };
          const doneListener = (e) => {
            if (e.detail.requestId === requestId) {
              controller.close();
              window.removeEventListener('extension-stream-chunk', chunkListener);
              window.removeEventListener('extension-stream-done', doneListener);
            }
          };
          window.addEventListener('extension-stream-chunk', chunkListener);
          window.addEventListener('extension-stream-done', doneListener);

          sendMessage({
            target: 'offscreen',
            type: 'execute-streaming',
            requestId,
            text,
            method: 'writeStreaming',
            options,
          }).catch((err) => controller.error(err));
        },
      });
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }
  }

  class Rewriter {
    constructor(apiType, options, requestId) {
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async rewrite(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'rewrite',
        options,
      });
      return response.result;
    }

    rewriteStreaming(text, options = {}) {
      const { requestId } = sessions.get(this);
      return new ReadableStream({
        start(controller) {
          const chunkListener = (e) => {
            if (e.detail.requestId === requestId)
              controller.enqueue(e.detail.text);
          };
          const doneListener = (e) => {
            if (e.detail.requestId === requestId) {
              controller.close();
              window.removeEventListener('extension-stream-chunk', chunkListener);
              window.removeEventListener('extension-stream-done', doneListener);
            }
          };
          window.addEventListener('extension-stream-chunk', chunkListener);
          window.addEventListener('extension-stream-done', doneListener);

          sendMessage({
            target: 'offscreen',
            type: 'execute-streaming',
            requestId,
            text,
            method: 'rewriteStreaming',
            options,
          }).catch((err) => controller.error(err));
        },
      });
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }
  }

  class LanguageDetector {
    constructor(apiType, options, requestId) {
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async detect(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'detect',
        options,
      });
      return response.result;
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }
  }

  class Translator {
    constructor(apiType, options, requestId) {
      sessions.set(this, { apiType, options, requestId });
    }

    destroy() {
      const { requestId } = sessions.get(this);
      sendMessage({
        target: 'offscreen',
        type: 'destroy-session',
        requestId,
      });
    }

    async translate(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'translate',
        options,
      });
      return response.result;
    }

    translateStreaming(text, options = {}) {
      const { requestId } = sessions.get(this);
      return new ReadableStream({
        start(controller) {
          const chunkListener = (e) => {
            if (e.detail.requestId === requestId)
              controller.enqueue(e.detail.text);
          };
          const doneListener = (e) => {
            if (e.detail.requestId === requestId) {
              controller.close();
              window.removeEventListener('extension-stream-chunk', chunkListener);
              window.removeEventListener('extension-stream-done', doneListener);
            }
          };
          window.addEventListener('extension-stream-chunk', chunkListener);
          window.addEventListener('extension-stream-done', doneListener);

          sendMessage({
            target: 'offscreen',
            type: 'execute-streaming',
            requestId,
            text,
            method: 'translateStreaming',
            options,
          }).catch((err) => controller.error(err));
        },
      });
    }

    async measureInputUsage(text, options = {}) {
      const { requestId } = sessions.get(this);
      const response = await sendMessage({
        target: 'offscreen',
        type: 'execute',
        requestId,
        text,
        method: 'measureInputUsage',
        options,
      });
      return response.result;
    }
  }

  const progressTargets = new Map(); // requestId -> EventTarget

  window.addEventListener('extension-download-progress', (e) => {
    const { requestId } = e.detail;
    const target = progressTargets.get(requestId);
    if (target) {
      target.dispatchEvent(new ProgressEvent('downloadprogress', e.detail));
      // If download is complete, we could potentially remove it, 
      // but 'loaded === total' might happen multiple times for different files.
      // We'll leave it for now or rely on session destruction.
    }
  });

  const createApiClass = (apiName, ProxyClass) => {
    // Capture the existing native implementation if it exists, checking both top-level and window.ai
    const lowerName = apiName.charAt(0).toLowerCase() + apiName.slice(1);
    const nativeApi =
      window[apiName] ||
      (window.ai && (window.ai[apiName] || window.ai[lowerName]));

    return class {
      static async create(options = {}) {
        // If forceInjection is false and a native implementation exists, use it
        if (!forceInjection && nativeApi && typeof nativeApi.create === 'function') {
          return nativeApi.create(options);
        }

        const requestId = Math.random().toString(36).slice(2);

        // Proxy monitor events back
        if (options.monitor) {
          const target = new EventTarget();
          progressTargets.set(requestId, target);
          options.monitor(target);
        }

        // Strip non-serializable properties (like 'monitor' function) before sending
        const serializableOptions = { ...options };
        for (const key in serializableOptions) {
          if (typeof serializableOptions[key] === 'function') {
            delete serializableOptions[key];
          }
        }

        await sendMessage({
          target: 'offscreen',
          type: 'create-session',
          apiType: apiName,
          backend,
          requestId,
          config,
          options: serializableOptions,
        });

        return new ProxyClass(apiName, options, requestId);
      }

      static async capabilities(options = {}) {
        if (!forceInjection && nativeApi && typeof nativeApi.capabilities === 'function') {
          return nativeApi.capabilities(options);
        }
        return { available: 'readily' };
      }

      // Handle legacy availability for older versions of the API
      static async availability(options = {}) {
        if (!forceInjection && nativeApi && typeof nativeApi.availability === 'function') {
          return nativeApi.availability(options);
        }
        return 'readily';
      }
    };
  };

  const LanguageModelProxy = createApiClass('LanguageModel', LanguageModel);
  const SummarizerProxy = createApiClass('Summarizer', Summarizer);
  const WriterProxy = createApiClass('Writer', Writer);
  const RewriterProxy = createApiClass('Rewriter', Rewriter);
  const LanguageDetectorProxy = createApiClass('LanguageDetector', LanguageDetector);
  const TranslatorProxy = createApiClass('Translator', Translator);

  window.LanguageModel = LanguageModelProxy;
  window.Summarizer = SummarizerProxy;
  window.Writer = WriterProxy;
  window.Rewriter = RewriterProxy;
  window.LanguageDetector = LanguageDetectorProxy;
  window.Translator = TranslatorProxy;

  console.log('Built-in AI Extension: Proxies injected successfully.');

})();

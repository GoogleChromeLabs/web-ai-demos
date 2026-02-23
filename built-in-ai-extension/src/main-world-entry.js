/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// src/main-world-entry.js

(async () => {
  const scriptTag = document.getElementById('built-in-ai-extension-script');
  if (!scriptTag) return;

  const data = JSON.parse(scriptTag.dataset.config || '{}');
  const { config, backend, forceInjection } = data;

  // Capture native state BEFORE importing polyfills to avoid side-effect interference
  const nativeAPIs = {
    LanguageModel: window.LanguageModel,
    Summarizer: window.Summarizer,
    Writer: window.Writer,
    Rewriter: window.Rewriter,
    LanguageDetector: window.LanguageDetector,
    Translator: window.Translator,
  };

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
            const error =
              response.name === 'AbortError'
                ? new DOMException(response.error || 'Aborted', 'AbortError')
                : new Error(response.error);
            reject(error);
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

  const sessions = new WeakMap();
  const sessionData = new WeakMap(); // Instance -> { requestId, attributes }
  const progressTargets = new Map(); // requestId -> EventTarget
  const sessionTargets = new Map(); // requestId -> Instance (for events)

  const apiStatuses = [];
  const sanitizeOptions = (options) => {
    const { monitor, signal, ...rest } = options;
    return rest;
  };

  const handleSignal = (signal, requestId, callId) => {
    if (!signal) return;
    if (signal.aborted) {
      throw signal.reason || new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener(
      'abort',
      () => {
        sendMessage({
          target: 'offscreen',
          type: 'abort-request',
          requestId,
          callId,
        }).catch(() => {});
      },
      { once: true }
    );
  };

  const setClassName = (cls, name) => {
    Object.defineProperty(cls, 'name', { value: name, configurable: true });
    if (cls.prototype) {
      Object.defineProperty(cls.prototype, Symbol.toStringTag, {
        value: name,
        configurable: true,
      });
    }
    return cls;
  };

  // The LanguageModel session class that delegates calls to the offscreen page
  const LanguageModelSession = setClassName(
    {
      LanguageModel: class extends EventTarget {
        constructor(apiType, options, requestId, initialAttributes = {}) {
          super();
          sessions.set(this, { apiType, options, requestId });
          sessionData.set(this, { requestId, attributes: initialAttributes });
          sessionTargets.set(requestId, this);
        }

        get inputUsage() {
          return sessionData.get(this).attributes.inputUsage || 0;
        }
        get inputQuota() {
          return sessionData.get(this).attributes.inputQuota || 0;
        }

        get onquotaoverflow() {
          return sessionData.get(this).onquotaoverflow || null;
        }

        set onquotaoverflow(handler) {
          const data = sessionData.get(this);
          if (data.onquotaoverflow) {
            this.removeEventListener('quotaoverflow', data.onquotaoverflow);
          }
          data.onquotaoverflow = handler;
          if (typeof handler === 'function') {
            this.addEventListener('quotaoverflow', handler);
          }
        }

        destroy() {
          const { requestId } = sessions.get(this);
          sessionTargets.delete(requestId);
          sendMessage({
            target: 'offscreen',
            type: 'destroy-session',
            requestId,
          });
        }

        async prompt(text, options = {}) {
          const { requestId } = sessions.get(this);
          const callId = Math.random().toString(36).slice(2);
          handleSignal(options.signal, requestId, callId);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'prompt',
            requestId,
            callId,
            text,
            options: sanitizeOptions(options),
          });
          if (response.attributes) {
            sessionData.get(this).attributes = response.attributes;
          }
          return response.result;
        }

        promptStreaming(text, options = {}) {
          const { requestId } = sessions.get(this);
          const callId = Math.random().toString(36).slice(2);
          const self = this;

          handleSignal(options.signal, requestId, callId);

          return new ReadableStream({
            start(controller) {
              const chunkListener = (e) => {
                if (
                  e.detail.requestId === requestId &&
                  e.detail.callId === callId
                ) {
                  controller.enqueue(e.detail.text);
                }
              };
              const doneListener = (e) => {
                if (
                  e.detail.requestId === requestId &&
                  e.detail.callId === callId
                ) {
                  if (e.detail.attributes) {
                    sessionData.get(self).attributes = e.detail.attributes;
                  }
                  controller.close();
                  window.removeEventListener(
                    'extension-stream-chunk',
                    chunkListener
                  );
                  window.removeEventListener(
                    'extension-stream-done',
                    doneListener
                  );
                  window.removeEventListener(
                    'extension-stream-error',
                    errorListener
                  );
                }
              };
              const errorListener = (e) => {
                if (
                  e.detail.requestId === requestId &&
                  e.detail.callId === callId
                ) {
                  const error = new DOMException(
                    e.detail.error || 'Aborted',
                    e.detail.name || 'AbortError'
                  );
                  controller.error(error);
                  window.removeEventListener(
                    'extension-stream-chunk',
                    chunkListener
                  );
                  window.removeEventListener(
                    'extension-stream-done',
                    doneListener
                  );
                  window.removeEventListener(
                    'extension-stream-error',
                    errorListener
                  );
                }
              };
              window.addEventListener('extension-stream-chunk', chunkListener);
              window.addEventListener('extension-stream-done', doneListener);
              window.addEventListener('extension-stream-error', errorListener);

              sendMessage({
                target: 'offscreen',
                type: 'prompt-streaming',
                requestId,
                callId,
                text,
                options: sanitizeOptions(options),
              })
                .then((response) => {
                  if (response.attributes) {
                    sessionData.get(self).attributes = response.attributes;
                  }
                })
                .catch((err) => {
                  controller.error(err);
                  window.removeEventListener(
                    'extension-stream-chunk',
                    chunkListener
                  );
                  window.removeEventListener(
                    'extension-stream-done',
                    doneListener
                  );
                  window.removeEventListener(
                    'extension-stream-error',
                    errorListener
                  );
                });
            },
          });
        }

        async append(text, options = {}) {
          const { requestId } = sessions.get(this);
          const callId = Math.random().toString(36).slice(2);
          handleSignal(options.signal, requestId, callId);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'append',
            requestId,
            callId,
            text,
            options: sanitizeOptions(options),
          });
          if (response.attributes) {
            sessionData.get(this).attributes = response.attributes;
          }
        }

        async measureInputUsage(text, options = {}) {
          const { requestId } = sessions.get(this);
          const callId = Math.random().toString(36).slice(2);
          handleSignal(options.signal, requestId, callId);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'execute',
            requestId,
            callId,
            text,
            method: 'measureInputUsage',
            options: sanitizeOptions(options),
          });
          if (response.attributes) {
            sessionData.get(this).attributes = response.attributes;
          }
          return response.result;
        }

        async clone(options = {}) {
          const { apiType, requestId } = sessions.get(this);
          const newRequestId = Math.random().toString(36).slice(2);
          const callId = Math.random().toString(36).slice(2);

          handleSignal(options.signal, requestId, callId);

          if (options.monitor) {
            const target = new EventTarget();
            progressTargets.set(newRequestId, target);
            options.monitor(target);
          }

          const response = await sendMessage({
            target: 'offscreen',
            type: 'clone-session',
            sourceRequestId: requestId,
            apiType,
            backend,
            requestId: newRequestId,
            callId,
            config,
            options: sanitizeOptions(options),
          });
          return new LanguageModelSession(
            apiType,
            options,
            newRequestId,
            response.attributes
          );
        }
      },
    }.LanguageModel,
    'LanguageModel'
  );

  // Static proxy for LanguageModel.create and availability
  const LanguageModelProxy = class {
    static async create(options = {}) {
      const native = nativeAPIs.LanguageModel;
      const isNative =
        !forceInjection && native && typeof native.create === 'function';
      if (isNative) {
        return native.create(options);
      }

      const requestId = Math.random().toString(36).slice(2);
      const callId = Math.random().toString(36).slice(2);

      handleSignal(options.signal, requestId, callId);

      if (options.monitor) {
        const target = new EventTarget();
        progressTargets.set(requestId, target);
        options.monitor(target);
      }

      const response = await sendMessage({
        target: 'offscreen',
        type: 'create-session',
        apiType: 'LanguageModel',
        backend,
        requestId,
        callId,
        config,
        options: sanitizeOptions(options),
      });

      return new LanguageModelSession(
        'LanguageModel',
        options,
        requestId,
        response.attributes
      );
    }

    static async availability(options = {}) {
      const native = nativeAPIs.LanguageModel;
      const isNative =
        !forceInjection && native && typeof native.availability === 'function';
      if (isNative) {
        return native.availability(options);
      }

      const response = await sendMessage({
        target: 'offscreen',
        type: 'availability',
        apiType: 'LanguageModel',
        backend,
        config,
        options: sanitizeOptions(options),
      });
      return response.result;
    }
  };

  const isLMNative =
    !forceInjection &&
    nativeAPIs.LanguageModel &&
    typeof nativeAPIs.LanguageModel.create === 'function';
  apiStatuses.push({
    API: 'LanguageModel',
    Source: isLMNative ? 'Native' : 'Extension Proxy (Offscreen)',
    Backend: isLMNative ? 'chrome' : backend,
  });

  // Set the proxy globally. This must happen BEFORE task APIs are used.
  // Use a named class to ensure it shows up correctly in the console
  window.LanguageModel = setClassName(
    { LanguageModel: class extends LanguageModelProxy {} }.LanguageModel,
    'LanguageModel'
  );

  // Dynamically import polyfills to ensure we captured native state first
  const { Summarizer, Writer, Rewriter, LanguageDetector, Translator } =
    await import('built-in-ai-task-apis-polyfills');

  // Expose task APIs, preferring native if available and not forced
  const exposeAPI = (name, polyfillClass) => {
    const native = nativeAPIs[name];
    const usePolyfill =
      forceInjection || !native || typeof native.create !== 'function';

    apiStatuses.push({
      API: name,
      Source: usePolyfill ? 'Extension Polyfill (Local)' : 'Native',
      Backend: usePolyfill ? backend : 'chrome',
    });

    if (usePolyfill) {
      // Use a dynamic object shorthand trick to ensure the class is born with the correct name.
      // This is more robust against minifiers that might otherwise rename class expressions.
      window[name] = setClassName(
        { [name]: class extends polyfillClass {} }[name],
        name
      );
    }
  };

  exposeAPI('Summarizer', Summarizer);
  exposeAPI('Writer', Writer);
  exposeAPI('Rewriter', Rewriter);
  exposeAPI('LanguageDetector', LanguageDetector);
  exposeAPI('Translator', Translator);

  window.addEventListener('extension-download-progress', (e) => {
    const { requestId } = e.detail;
    const target = progressTargets.get(requestId);
    if (target) {
      target.dispatchEvent(new ProgressEvent('downloadprogress', e.detail));
    }
  });

  window.addEventListener('extension-quota-overflow', (e) => {
    const { requestId } = e.detail;
    const target = sessionTargets.get(requestId);
    if (target) {
      target.dispatchEvent(new Event('quotaoverflow'));
    }
  });

  console.table(apiStatuses);
})();

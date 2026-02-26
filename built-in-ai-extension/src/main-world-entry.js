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
    Classifier: window.Classifier,
  };

  // Binary Bridge setup for efficient communication with content script
  const channel = new MessageChannel();
  const bridgePort = channel.port1;
  const pendingRequests = new Map();

  // Listen for responses and events back from the content script bridge
  bridgePort.onmessage = (event) => {
    if (event.data.type === 'EVENT') {
      const { message } = event.data;
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

      window.dispatchEvent(new CustomEvent(eventType, { detail: message }));
      return;
    }

    const { id, response } = event.data;
    const request = pendingRequests.get(id);
    if (request) {
      pendingRequests.delete(id);
      if (response.success) {
        request.resolve(response);
      } else {
        const error =
          response.name === 'AbortError'
            ? new DOMException(response.error || 'Aborted', 'AbortError')
            : new Error(response.error);
        request.reject(error);
      }
    }
  };

  // Initialize the bridge by sending the second port to the content script
  window.postMessage({ type: 'AI_EXTENSION_INIT_BRIDGE' }, '*', [
    channel.port2,
  ]);

  // Helper to send messages to the extension via the MessagePort bridge
  const sendMessage = async (message) => {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      pendingRequests.set(id, { resolve, reject });
      bridgePort.postMessage({ id, message });
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

  const preprocessInput = async (input) => {
    if (!input || typeof input === 'string') return input;
    if (!Array.isArray(input)) return input;

    return Promise.all(
      input.map(async (item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          if (
            (item.type === 'image' || item.type === 'video') &&
            item.value &&
            typeof item.value === 'object'
          ) {
            const val = item.value;
            // Check if it's a DOM element that's not cloneable
            const isDOMElement =
              (typeof HTMLElement !== 'undefined' &&
                val instanceof HTMLElement) ||
              (typeof SVGElement !== 'undefined' && val instanceof SVGElement);

            if (isDOMElement) {
              try {
                // Blob is more reliably cloneable across the MessageChannel bridge
                // and chrome.runtime.sendMessage than ImageBitmap in some contexts.
                if (val instanceof HTMLCanvasElement) {
                  item.value = await new Promise((resolve) =>
                    val.toBlob(resolve, 'image/png')
                  );
                } else if (val instanceof HTMLImageElement) {
                  const canvas = document.createElement('canvas');
                  canvas.width = val.naturalWidth || val.width;
                  canvas.height = val.naturalHeight || val.height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(val, 0, 0);
                  item.value = await new Promise((resolve) =>
                    canvas.toBlob(resolve, 'image/png')
                  );
                } else {
                  // Fallback for other elements (video, svg)
                  item.value = await createImageBitmap(val);
                }
              } catch (e) {
                // If it fails (e.g., source not loaded), the offscreen page
                // might still try to handle it or throw a better error.
                console.warn(
                  `Failed to pre-process ${item.type} element for bridge:`,
                  e
                );
              }
            }
          }
        }
        return item;
      })
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

        get contextUsage() {
          return sessionData.get(this).attributes.contextUsage || 0;
        }
        get contextWindow() {
          return sessionData.get(this).attributes.contextWindow || 0;
        }

        get oncontextoverflow() {
          return sessionData.get(this).oncontextoverflow || null;
        }

        set oncontextoverflow(handler) {
          const data = sessionData.get(this);
          if (data.oncontextoverflow) {
            this.removeEventListener('contextoverflow', data.oncontextoverflow);
          }
          data.oncontextoverflow = handler;
          if (typeof handler === 'function') {
            this.addEventListener('contextoverflow', handler);
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

          const processedText = await preprocessInput(text);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'prompt',
            requestId,
            callId,
            text: processedText,
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
            async start(controller) {
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

              const processedText = await preprocessInput(text);

              sendMessage({
                target: 'offscreen',
                type: 'prompt-streaming',
                requestId,
                callId,
                text: processedText,
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

          const processedText = await preprocessInput(text);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'append',
            requestId,
            callId,
            text: processedText,
            options: sanitizeOptions(options),
          });
          if (response.attributes) {
            sessionData.get(this).attributes = response.attributes;
          }
        }

        async measureContextUsage(text, options = {}) {
          const { requestId } = sessions.get(this);
          const callId = Math.random().toString(36).slice(2);
          handleSignal(options.signal, requestId, callId);

          const processedText = await preprocessInput(text);

          const response = await sendMessage({
            target: 'offscreen',
            type: 'execute',
            requestId,
            callId,
            text: processedText,
            method: 'measureContextUsage',
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
  const {
    Summarizer,
    Writer,
    Rewriter,
    LanguageDetector,
    Translator,
    Classifier,
  } = await import('built-in-ai-task-apis-polyfills');

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
  exposeAPI('Classifier', Classifier);

  window.addEventListener('extension-download-progress', (e) => {
    const { requestId } = e.detail;
    const target = progressTargets.get(requestId);
    if (target) {
      target.dispatchEvent(new ProgressEvent('downloadprogress', e.detail));
    }
  });

  window.addEventListener('extension-context-overflow', (e) => {
    const { requestId } = e.detail;
    const target = sessionTargets.get(requestId);
    if (target) {
      target.dispatchEvent(new Event('contextoverflow'));
    }
  });

  console.table(apiStatuses);
})();

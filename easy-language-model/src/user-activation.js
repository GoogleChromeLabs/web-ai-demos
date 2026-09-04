/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Events that grant transient user activation.
const ACTIVATION_EVENTS = ['pointerdown', 'keydown', 'click', 'touchend'];

/** Whether the page currently has transient user activation. */
export function hasUserActivation() {
  return navigator.userActivation?.isActive ?? true;
}

/**
 * Resolves once the user interacts with the page.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {EventTarget} [options.target] Defaults to the document.
 */
export function waitForUserActivation({ signal, target = document } = {}) {
  if (hasUserActivation()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const settle = (fn, value) => {
      controller.abort();
      fn(value);
    };
    if (signal) {
      if (signal.aborted) {
        return settle(reject, signal.reason);
      }
      signal.addEventListener('abort', () => settle(reject, signal.reason), {
        signal: controller.signal,
      });
    }
    for (const type of ACTIVATION_EVENTS) {
      target.addEventListener(
        type,
        (event) => {
          // Only a real interaction grants activation; a synthetic event would
          // resolve here and then fail in create().
          if (event.isTrusted) {
            settle(resolve);
          }
        },
        { signal: controller.signal, capture: true }
      );
    }
  });
}

/**
 * Makes sure the page has user activation before a model download is started.
 *
 * Chrome only requires a gesture when the model isn't downloaded yet, so this
 * is a no-op for an `"available"` model.
 *
 * @param {object} options
 * @param {'wait'|'ignore'} options.mode
 * @param {() => void} [options.onUserActivationRequired]
 * @param {AbortSignal} [options.signal]
 */
export async function ensureUserActivation({
  mode,
  onUserActivationRequired,
  signal,
}) {
  // 'ignore' hands the requirement back to the caller: `create()` is called
  // without a gesture and rejects with the browser's own error, which is the
  // mode to use when driving it from a click handler of your own.
  if (mode === 'ignore' || hasUserActivation()) {
    return false;
  }
  onUserActivationRequired?.();
  await waitForUserActivation({ signal });
  return true;
}

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Whether the page currently has transient user activation. */
export function hasUserActivation() {
  return navigator.userActivation?.isActive ?? true;
}

/**
 * Resolves when `button` is clicked.
 *
 * Only that button counts. Listening to the whole document would resolve on a
 * click the user meant for something else, and the gesture it granted may be
 * spent by the time `create()` runs.
 *
 * @param {EventTarget} button
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 */
function waitForClick(button, { signal } = {}) {
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
    button.addEventListener(
      'click',
      (event) => {
        // Only a real click grants activation. A dispatched one would resolve
        // here and then fail in create().
        if (event.isTrusted) {
          settle(resolve);
        }
      },
      { signal: controller.signal }
    );
  });
}

/**
 * Makes sure the page has user activation before a model download is started.
 *
 * Chrome only requires a gesture when the model isn't downloaded yet, so this
 * is a no-op for an `"available"` model.
 *
 * With no `activationButton` there is nothing to wait on, so `create()` is
 * called as it stands and rejects the way the Prompt API rejects. Handing over
 * a button is what opts into waiting.
 *
 * @param {object} options
 * @param {HTMLElement} [options.activationButton] Revealed while waiting,
 *   hidden again afterwards, and the only thing whose click counts.
 * @param {HTMLElement} [options.hint] Revealed and hidden alongside it, for the
 *   line of text saying why the button appeared.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<boolean>} Whether it waited.
 */
export async function ensureUserActivation({ activationButton, hint, signal }) {
  if (!activationButton || hasUserActivation()) {
    return false;
  }

  const shown = [activationButton, hint].filter(Boolean);
  for (const element of shown) {
    element.hidden = false;
  }
  try {
    await waitForClick(activationButton, { signal });
  } finally {
    // Also on abort: an affordance that outlives the wait is worse than one
    // that never appeared.
    for (const element of shown) {
      element.hidden = true;
    }
  }
  return true;
}

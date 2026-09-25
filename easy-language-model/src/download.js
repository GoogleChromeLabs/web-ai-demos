/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes a `downloadprogress` event into the shape callers are handed.
 *
 * A `total` of 1 means the browser is reporting a fraction rather than a byte
 * count, and it can be absent entirely, which would make `loaded / total` NaN.
 * Both are settled here, and `percent` is worked out from them: a whole number
 * from 0 to 100, ready to put on the page. Every download callback in the
 * library goes through this, so they all carry the same fields.
 *
 * @param {{loaded: number, total?: number}} event
 * @param {string} resource What is being downloaded.
 * @returns {{resource: string, loaded: number, total: number, percent: number}}
 */
export function normalizeDownloadProgress(event, resource) {
  const total = event.total > 0 ? event.total : 1;
  const loaded = Math.min(
    Number.isFinite(event.loaded) ? event.loaded : 0,
    total
  );
  return {
    resource,
    loaded,
    total,
    percent: Math.round((loaded / total) * 100),
  };
}

/**
 * How long to wait for the first `downloadprogress` event before saying so.
 *
 * Timed from the moment the monitor is installed, which is inside `create()`,
 * so the wait for a user gesture is already over and bytes should be moving.
 */
const FIRST_PROGRESS_TIMEOUT_MS = 30_000;

/**
 * Wires up download reporting for one `create()` call.
 *
 * Unlike the raw Prompt API, where `monitor` is opt-in, the wrapper always
 * installs one. A caller's own `monitor` still runs, and a `<progress>` element
 * passed as `downloadProgress` is driven automatically, including going indeterminate
 * once the bytes are all in and the browser is unpacking the model.
 *
 * The element stays hidden until the first `downloadprogress` event arrives.
 * `availability()` saying `downloadable` means a download would be needed, and
 * a gesture may still be waited on before one starts, so revealing the bar any
 * earlier leaves an empty bar on the page for as long as that takes.
 *
 * @param {object} options
 * @param {(progress: {resource: string, loaded: number, total: number, percent: number}) => void} [options.onDownloadProgress]
 * @param {HTMLProgressElement} [options.downloadProgress]
 * @param {(monitor: EventTarget) => void} [options.monitor] The caller's own monitor.
 */
export function createDownloadReporter({
  onDownloadProgress,
  downloadProgress,
  monitor,
} = {}) {
  // The model was missing when we started, so a download really is happening.
  let downloadExpected = false;
  // Cleared by the first event, and when the `create()` call settles either way.
  let firstProgressTimer;

  const resetProgressElement = () => {
    if (downloadProgress) {
      downloadProgress.hidden = true;
      downloadProgress.value = 0;
      downloadProgress.max = 1;
    }
  };

  const stopWaitingForProgress = () => {
    clearTimeout(firstProgressTimer);
    firstProgressTimer = undefined;
  };

  return {
    /** Called with the result of `availability()`. */
    reportAvailability(availability) {
      downloadExpected = availability !== 'available';
      // Reset, and left hidden: the first `downloadprogress` event is what
      // reveals it, so the bar appears when there is progress to show.
      resetProgressElement();
    },

    /** The `monitor` callback to hand to `LanguageModel.create()`. */
    monitor(m) {
      // A download was expected and the monitor is now installed, so the first
      // event should follow shortly. Staying quiet past this leaves a caller
      // with a page that reports nothing, so say it on the console.
      if (downloadExpected) {
        firstProgressTimer = setTimeout(() => {
          console.warn(
            `[EasyLanguageModel] No downloadprogress event after ` +
              `${FIRST_PROGRESS_TIMEOUT_MS / 1000} seconds. The model ` +
              `download may not have started.`
          );
        }, FIRST_PROGRESS_TIMEOUT_MS);
      }

      m.addEventListener('downloadprogress', (event) => {
        stopWaitingForProgress();
        const reported = normalizeDownloadProgress(event, 'language-model');
        const { total, loaded } = reported;

        if (downloadProgress) {
          if (loaded < total) {
            downloadProgress.hidden = false;
            downloadProgress.max = total;
            downloadProgress.value = loaded;
          } else if (downloadExpected) {
            // All bytes are in, but the model still has to be unpacked and
            // loaded into memory. Nobody can say how long that takes, so the
            // bar goes indeterminate.
            downloadProgress.hidden = false;
            downloadProgress.removeAttribute('value');
          }
        }

        onDownloadProgress?.(reported);
      });
      monitor?.(m);
    },

    /** Called once the `create()` call has settled, successfully or not. */
    reportReady() {
      stopWaitingForProgress();
      resetProgressElement();
    },
  };
}

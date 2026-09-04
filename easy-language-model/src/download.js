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
 * Wires up download reporting for one `create()` call.
 *
 * Unlike the raw Prompt API, where `monitor` is opt-in, the wrapper always
 * installs one. A caller's own `monitor` still runs, and a `<progress>` element
 * passed as `downloadProgress` is driven automatically, including going indeterminate
 * once the bytes are all in and the browser is unpacking the model.
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

  return {
    /** Called with the result of `availability()`. */
    reportAvailability(availability) {
      downloadExpected = availability !== 'available';
      if (downloadProgress) {
        downloadProgress.hidden = !downloadExpected;
        downloadProgress.value = 0;
        downloadProgress.max = 1;
      }
    },

    /** The `monitor` callback to hand to `LanguageModel.create()`. */
    monitor(m) {
      m.addEventListener('downloadprogress', (event) => {
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

    /** Called once the session exists. */
    reportReady() {
      if (downloadProgress) {
        downloadProgress.hidden = true;
        downloadProgress.value = 0;
        downloadProgress.max = 1;
      }
    },
  };
}

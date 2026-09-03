/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes a `downloadprogress` event into the shape callers are handed.
 *
 * A `total` of 1 means the browser is reporting a fraction rather than a byte
 * count, and it can be absent entirely, so `percent` is worked out here rather
 * than by every caller. Every download callback in the library goes through this, so
 * they all carry the same fields.
 *
 * @param {{loaded: number, total?: number}} event
 * @param {string} resource What is being downloaded.
 * @returns {{resource: string, loaded: number, total: number, percent: number}}
 */
export function normalizeDownloadProgress(event, resource) {
  const total = event.total > 0 ? event.total : 1;
  const loaded = Number.isFinite(event.loaded) ? event.loaded : 0;
  return { resource, loaded, total, percent: Math.min(1, loaded / total) };
}

/**
 * Wires up download reporting for one `create()` call.
 *
 * Unlike the raw Prompt API, where `monitor` is opt-in, the wrapper always
 * installs one. A caller's own `monitor` still runs, and a `<progress>` element
 * passed as `progress` is driven automatically, including going indeterminate
 * once the bytes are all in and the browser is unpacking the model.
 *
 * @param {object} options
 * @param {(progress: {resource: string, loaded: number, total: number, percent: number}) => void} [options.onDownloadProgress]
 * @param {HTMLProgressElement} [options.progress]
 * @param {(monitor: EventTarget) => void} [options.monitor] The caller's own monitor.
 */
export function createDownloadReporter({
  onDownloadProgress,
  progress,
  monitor,
} = {}) {
  // The model was missing when we started, so a download really is happening.
  let downloadExpected = false;

  return {
    /** Called with the result of `availability()`. */
    reportAvailability(availability) {
      downloadExpected = availability !== 'available';
      if (progress) {
        progress.hidden = !downloadExpected;
        progress.value = 0;
        progress.max = 1;
      }
    },

    /** The `monitor` callback to hand to `LanguageModel.create()`. */
    monitor(m) {
      m.addEventListener('downloadprogress', (event) => {
        const reported = normalizeDownloadProgress(event, 'language-model');
        const { total, loaded, percent } = reported;

        if (progress) {
          if (percent < 1) {
            progress.hidden = false;
            progress.max = total;
            progress.value = loaded;
          } else if (downloadExpected) {
            // All bytes are in, but the model still has to be unpacked and
            // loaded into memory. Nobody can say how long that takes, so the
            // bar goes indeterminate.
            progress.hidden = false;
            progress.removeAttribute('value');
          }
        }

        onDownloadProgress?.(reported);
      });
      monitor?.(m);
    },

    /** Called once the session exists. */
    reportReady() {
      if (progress) {
        progress.hidden = true;
        progress.value = 0;
        progress.max = 1;
      }
    },
  };
}

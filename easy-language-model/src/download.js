/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every state a session creation can pass through, in order:
 *
 * - `checking`      — `availability()` is in flight.
 * - `unavailable`   — the model can't run on this device with these options.
 * - `downloadable`  — a download is needed and hasn't started.
 * - `downloading`   — bytes are coming in; progress events are firing.
 * - `extracting`    — the download finished; the browser is unpacking and
 *                     loading the model into memory. Duration is unknown, so
 *                     this is the point to show an indeterminate indicator.
 * - `available`     — the model was already there, no download needed.
 * - `ready`         — the session exists and can be prompted.
 */
export const DOWNLOAD_STATES = [
  'checking',
  'unavailable',
  'downloadable',
  'downloading',
  'extracting',
  'available',
  'ready',
];

/**
 * Normalizes a `downloadprogress` event into the shape callers are handed.
 *
 * `total` is 1 when the browser reports a fraction rather than a byte count,
 * and can be absent entirely, so `percent` is computed here rather than by
 * every caller. Every download callback in the library goes through this, so
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
 * installs one. A user's own `monitor` callback still runs, and a
 * `<progress>` element passed as `progress` is driven automatically, including
 * the indeterminate "extracting" phase once the bytes are all in.
 *
 * @param {object} options
 * @param {(state: string, detail: object) => void} [options.onDownloadStateChange]
 * @param {(progress: {resource: string, loaded: number, total: number, percent: number}) => void} [options.onDownloadProgress]
 * @param {HTMLProgressElement} [options.progress]
 * @param {(monitor: EventTarget) => void} [options.monitor] The caller's own monitor.
 */
export function createDownloadReporter({
  onDownloadStateChange,
  onDownloadProgress,
  progress,
  monitor,
} = {}) {
  let state = null;
  // The model was missing when we started, so a download really is happening.
  let downloadExpected = false;

  const setState = (next, detail = {}) => {
    if (state === next) {
      return;
    }
    state = next;
    if (progress) {
      progress.hidden = !(next === 'downloading' || next === 'extracting');
    }
    onDownloadStateChange?.(next, { ...detail, state: next });
  };

  return {
    get state() {
      return state;
    },

    /** Called with the result of `availability()`. */
    reportAvailability(availability) {
      downloadExpected = availability !== 'available';
      if (progress) {
        progress.value = 0;
        progress.max = 1;
      }
      setState(availability, { availability });
    },

    setState,

    /** The `monitor` callback to hand to `LanguageModel.create()`. */
    monitor(m) {
      m.addEventListener('downloadprogress', (event) => {
        const reported = normalizeDownloadProgress(event, 'language-model');
        const { total, loaded, percent } = reported;

        if (percent < 1) {
          setState('downloading');
          if (progress) {
            progress.max = total;
            progress.value = loaded;
          }
        } else if (downloadExpected) {
          // All bytes are in, but the model still has to be extracted and
          // loaded into memory. Nobody can say how long that takes, so switch
          // the bar to its indeterminate state.
          setState('extracting');
          progress?.removeAttribute('value');
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
      setState('ready');
    },
  };
}

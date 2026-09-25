/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createDownloadReporter } from './download.js';
import { ensureUserActivation } from './user-activation.js';

/** Whether the Prompt API exists in this context. */
export function isPromptApiSupported() {
  return 'LanguageModel' in globalThis;
}

/**
 * Creates a raw `LanguageModel` session with download reporting always on and
 * the user activation requirement taken care of.
 *
 * @param {object} createOptions Passed through to `LanguageModel.create()`.
 * @param {object} easy The wrapper's own options.
 * @returns {Promise<{session: LanguageModel, finishDownloadUi: () => void}>}
 *   `finishDownloadUi` takes down a progress element that is still up waiting
 *   for the model to say something. Call it on the session's first output.
 */
export async function createRawSession(createOptions, easy) {
  const reporter = createDownloadReporter(easy);

  // The elements handed over are the wrapper's to drive, so they start hidden
  // whether or not the markup said so, and are revealed only if it turns out a
  // gesture is needed.
  for (const element of [easy.activationButton, easy.activationHint]) {
    if (element) {
      element.hidden = true;
    }
  }

  // Forwarded as given. A dictionary ignores members it doesn't declare, so
  // whatever the Prompt API adds next reaches both calls without a change here,
  // and the two can never disagree about the same session.
  //
  // Asked here for the download reporter and the gesture check below, not to
  // decide whether to proceed: call `availability()` before `create()` and act
  // on what it says. An unavailable model is `LanguageModel.create()`'s own
  // error to throw, and it throws a better one than a wrapper could invent.
  const availability = await LanguageModel.availability(createOptions);
  reporter.reportAvailability(availability);

  // A gesture is only required when something has to be downloaded.
  if (availability !== 'available') {
    await ensureUserActivation({
      activationButton: easy.activationButton,
      activationHint: easy.activationHint,
      signal: createOptions.signal,
    });
  }

  let session;
  try {
    session = await LanguageModel.create({
      ...createOptions,
      monitor: reporter.monitor,
    });
  } catch (error) {
    // Nothing is coming, so the progress element goes away and the wait for a
    // first `downloadprogress` event stops.
    reporter.finish();
    throw error;
  }

  reporter.reportReady();
  return { session, finishDownloadUi: reporter.finish };
}

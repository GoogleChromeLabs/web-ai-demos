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
 * @returns {Promise<LanguageModel>}
 */
export async function createRawSession(createOptions, easy) {
  const reporter = createDownloadReporter(easy);

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
      mode: easy.userActivation ?? 'wait',
      onUserActivationRequired: easy.onUserActivationRequired,
      signal: createOptions.signal,
    });
  }

  const session = await LanguageModel.create({
    ...createOptions,
    monitor: reporter.monitor,
  });

  reporter.reportReady();
  return session;
}

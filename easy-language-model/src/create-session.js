/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LanguageModelUnavailableError } from './errors.js';
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
  if (!isPromptApiSupported()) {
    throw new LanguageModelUnavailableError(
      "This browser doesn't support the Prompt API (`LanguageModel`)."
    );
  }

  const reporter = createDownloadReporter(easy);

  // Forwarded as given. A dictionary ignores members it doesn't declare, so
  // whatever the Prompt API adds next reaches both calls without a change here,
  // and the two can never disagree about the same session.
  const availability = await LanguageModel.availability(createOptions);

  if (availability === 'unavailable') {
    reporter.reportAvailability(availability);
    throw new LanguageModelUnavailableError(
      'The Prompt API is unavailable on this device for the requested ' +
        'configuration.',
      { availability }
    );
  }

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

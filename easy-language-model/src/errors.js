/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thrown when the model produced output that the Sanitizer API stripped, which
 * means the output contained markup that isn't safe to insert into the DOM.
 *
 * Treat this the way you'd treat any tainted user-generated content: stop
 * rendering. The partial output that was already emitted is available on
 * `partialOutput`, the sanitized version of the offending text on `sanitized`.
 */
export class UnsafeModelOutputError extends Error {
  constructor(message, { output, sanitized, partialOutput } = {}) {
    super(message);
    this.name = 'UnsafeModelOutputError';
    this.output = output;
    this.sanitized = sanitized;
    this.partialOutput = partialOutput;
  }
}

/**
 * Thrown when the model needs to be downloaded but the page hasn't been
 * interacted with, and `userActivation: 'throw'` was requested.
 */
export class UserActivationRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserActivationRequiredError';
  }
}

/**
 * Thrown when the Prompt API isn't implemented, or when `availability()`
 * reports `"unavailable"` for the requested configuration.
 */
export class LanguageModelUnavailableError extends Error {
  constructor(message, { availability } = {}) {
    super(message);
    this.name = 'LanguageModelUnavailableError';
    this.availability = availability;
  }
}

/**
 * Thrown when output sanitization was requested (the default) but the browser
 * doesn't implement the HTML Sanitizer API.
 */
export class SanitizerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SanitizerUnavailableError';
  }
}

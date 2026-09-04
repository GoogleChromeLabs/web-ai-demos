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
  /**
   * @param {string} message
   * @param {{output?: string, sanitized?: string, partialOutput?: string}} [detail]
   */
  constructor(message, { output, sanitized, partialOutput } = {}) {
    super(message);
    this.name = 'UnsafeModelOutputError';
    this.output = output;
    this.sanitized = sanitized;
    this.partialOutput = partialOutput;
  }
}

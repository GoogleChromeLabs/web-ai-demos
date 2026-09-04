/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the error thrown when the model's output didn't survive sanitization.
 *
 * This is the Prompt API's own `OperationError`, which it defines as a prompt
 * failing "for any other reason not listed in the other exception types". That
 * is what happened: the prompt ran, and its output can't be handed over. Using
 * the platform's error rather than a class of our own means a caller already
 * catching `DOMException` from `prompt()` catches this too.
 *
 * The detail rides along as own properties, and `sanitized` is what tells this
 * apart from an `OperationError` the model itself raised:
 *
 * ```js
 * catch (error) {
 *   if (error.name === 'OperationError' && 'sanitized' in error) {
 *     // The response was rejected, not the request.
 *   }
 * }
 * ```
 *
 * @param {string} message
 * @param {{output?: string, sanitized?: string, partialOutput?: string}} [detail]
 * @returns {DOMException}
 */
export function unsafeOutputError(
  message,
  { output, sanitized, partialOutput } = {}
) {
  const error = new DOMException(message, 'OperationError');
  // DOMException's own fields are read-only accessors on the prototype, so the
  // detail goes on as plain own properties.
  Object.assign(error, { output, sanitized, partialOutput });
  return error;
}

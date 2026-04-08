/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replaces the first match of `pattern` in `str` with `replacement`.
 * Throws if `pattern` is not found, preventing silent prompt misconfigurations.
 * @param {string} str
 * @param {string|RegExp} pattern
 * @param {string} replacement
 * @param {string} label - Human-readable name used in the error message.
 * @returns {string}
 */
export function replaceOrThrow(str, pattern, replacement, label) {
  const found =
    typeof pattern === 'string' ? str.includes(pattern) : str.search(pattern) !== -1;
  if (!found) {
    throw new Error(`Prompt template substitution failed for "${label}"`);
  }
  return str.replace(pattern, replacement);
}

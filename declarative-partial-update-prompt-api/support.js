/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Records what the browser ships, then loads the polyfill only if something is
// missing. The check runs before the polyfill can fill the gaps.
export const nativeSupport = {
  // Every streaming method the page calls. `streamHTML()` is also the one the
  // polyfill can only add where `setHTML()` exists.
  streamingInsertion: ['streamHTMLUnsafe', 'streamHTML'].every(
    (method) => method in Element.prototype
  ),
};

// A dynamic import, so Vite splits the polyfill into a chunk of its own that a
// supporting browser never downloads. `html-setters-polyfill` also wraps
// `setHTMLUnsafe()` unconditionally, which is one more reason to leave it out
// where it isn't needed.
if (!nativeSupport.streamingInsertion) {
  await import('html-setters-polyfill');
}

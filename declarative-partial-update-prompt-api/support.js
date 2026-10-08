/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Records what the browser ships, then loads a polyfill only for what is
// missing. The checks run before either polyfill can fill the gaps.
export const nativeSupport = {
  // The same check `template-for-polyfill` makes before it installs itself.
  templateFor: 'htmlFor' in HTMLTemplateElement.prototype,
  // Every streaming method the page calls. `streamHTML()` is also the one the
  // polyfill can only add where `setHTML()` exists.
  streamingInsertion: [
    'streamAppendHTMLUnsafe',
    'streamHTMLUnsafe',
    'streamHTML',
  ].every((method) => method in Element.prototype),
};

/**
 * Loads `template-for-polyfill`, even where `<template for>` is native.
 *
 * A native `<template for>` patches only while the document parser or a
 * streaming insertion method parses it in place. `html-setters-polyfill`
 * parses each stream in a detached document and appends the result, and a
 * `<template for>` that arrives that way stays an inert element after the
 * cards. So wherever the streaming methods are polyfilled, the patching has to
 * be polyfilled as well. The polyfill installs itself only where `htmlFor` is
 * missing, so the native accessor is hidden while it loads.
 */
async function loadTemplateForPolyfill() {
  const proto = HTMLTemplateElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'htmlFor');
  delete proto.htmlFor;
  try {
    await import('template-for-polyfill');
  } finally {
    if (descriptor) {
      Object.defineProperty(proto, 'htmlFor', descriptor);
    }
  }
}

// Dynamic imports, so Vite splits each polyfill into a chunk of its own that a
// supporting browser never downloads. `html-setters-polyfill` also wraps
// `setHTMLUnsafe()` unconditionally, which is one more reason to leave it out
// where it isn't needed.
await Promise.all([
  nativeSupport.streamingInsertion || import('html-setters-polyfill'),
  (nativeSupport.templateFor && nativeSupport.streamingInsertion) ||
    loadTemplateForPolyfill(),
]);

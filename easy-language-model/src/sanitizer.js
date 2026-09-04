/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UnsafeModelOutputError } from './errors.js';
import { isSafeUrl } from 'streaming-markdown-html';

/** Whether the browser implements the HTML Sanitizer API. */
export function isSanitizerSupported() {
  return (
    typeof globalThis.Sanitizer === 'function' &&
    typeof Element.prototype.setHTML === 'function' &&
    typeof Element.prototype.setHTMLUnsafe === 'function'
  );
}

// A document created by `createHTMLDocument()` has no browsing context, so
// parsing into it never runs script and never fetches subresources. That's what
// makes it safe to parse untrusted markup *unsanitized* for comparison.
let inertDocument;
function getInertDocument() {
  inertDocument ??= document.implementation.createHTMLDocument('');
  return inertDocument;
}

function assertSanitizerSupport() {
  if (!isSanitizerSupported()) {
    throw new TypeError(
      "This browser doesn't support the HTML Sanitizer API. Pass " +
        '`sanitizer: false` to opt out of output sanitization, or load a ' +
        'Sanitizer API polyfill.'
    );
  }
}

function setHtml(element, html, sanitizer) {
  if (sanitizer === undefined || sanitizer === 'default') {
    element.setHTML(html);
  } else {
    element.setHTML(html, { sanitizer });
  }
}

/** Removes `href`/`src` attributes with an unsafe scheme. Returns how many. */
function stripUnsafeUrls(root) {
  let removed = 0;
  for (const element of root.querySelectorAll('[href], [src]')) {
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute);
      if (value !== null && !isSafeUrl(value)) {
        element.removeAttribute(attribute);
        removed++;
      }
    }
  }
  return removed;
}

/**
 * Sanitizes a string of HTML and reports whether anything was taken out.
 *
 * The Sanitizer API doesn't tell you what it removed (unlike DOMPurify's
 * `removed` array), so this parses the input twice in an inert document — once
 * sanitized, once not — and compares the two serializations. Since both go
 * through the same parser and serializer, any difference is a removal.
 *
 * @param {string} html
 * @param {object} [options]
 * @param {Sanitizer|object|'default'} [options.sanitizer]
 * @returns {{sanitized: string, removed: boolean}}
 */
export function sanitizeHtml(html, { sanitizer } = {}) {
  assertSanitizerSupport();
  const doc = getInertDocument();

  const safe = doc.createElement('div');
  setHtml(safe, html, sanitizer);
  stripUnsafeUrls(safe);

  const unsafe = doc.createElement('div');
  unsafe.setHTMLUnsafe(html);

  return {
    sanitized: safe.innerHTML,
    removed: safe.innerHTML !== unsafe.innerHTML,
  };
}

const blankOut = (match) => match.replace(/[^\n]/g, ' ');

/**
 * Replaces the contents of fenced code blocks and inline code spans with
 * spaces, keeping every other offset intact.
 *
 * A Markdown renderer emits code as *text*, so `<iframe>` inside a fence is
 * displayed, not executed. Without this, asking the model for an HTML snippet
 * would trip the injection check on every answer.
 */
export function maskCode(text) {
  return (
    text
      // Closed fences.
      .replace(
        /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm,
        blankOut
      )
      // A fence that hasn't been closed yet swallows everything after it.
      .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, blankOut)
      // Inline code spans, closed and unclosed.
      .replace(/(`+)[^\n]*?\1/g, blankOut)
      .replace(/`[^\n]*$/gm, blankOut)
  );
}

/**
 * Builds the guard used to vet raw model output before it reaches the DOM.
 *
 * @param {object} [options]
 * @param {Sanitizer|object|'default'|false} [options.sanitizer] `false` disables the check.
 * @param {boolean} [options.ignoreFencedCode] Skip fenced/inline code. Default `true`.
 */
export function createOutputGuard({
  sanitizer = 'default',
  ignoreFencedCode = true,
} = {}) {
  const enabled = sanitizer !== false;
  if (enabled) {
    assertSanitizerSupport();
  }

  /** @returns {{removed: boolean, sanitized: string}} */
  const check = (text) => {
    if (!enabled || text === '') {
      return { removed: false, sanitized: text };
    }
    const candidate = ignoreFencedCode ? maskCode(text) : text;
    return sanitizeHtml(candidate, { sanitizer });
  };

  return {
    enabled,
    sanitizer,
    check,
    /**
     * Throws `UnsafeModelOutputError` if `text` contains unsafe markup.
     *
     * @param {string} text
     * @param {{partialOutput?: string}} [detail]
     */
    assertSafe(text, { partialOutput } = {}) {
      const { removed, sanitized } = check(text);
      if (removed) {
        throw new UnsafeModelOutputError(
          'The model produced output containing markup that the Sanitizer ' +
            'API removed. Rendering was stopped.',
          { output: text, sanitized, partialOutput }
        );
      }
      return text;
    },
  };
}

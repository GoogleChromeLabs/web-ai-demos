/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Elements the HTML parser never gives children, so they never open a scope. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

// Chunks are single tokens, so an opening tag is matched rather than parsed.
// Attributes may be valueless: serializers differ on whether a boolean one
// comes out as `checked` or `checked=""`.
const OPEN_TAG = /^<([a-z0-9-]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>$/i;
const ATTRIBUTE = /([a-z-]+)(?:="([^"]*)")?/gi;

function unescapeText(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * A `WritableStream` that renders `promptStreamingHTML()` chunks into an
 * element as they arrive.
 *
 * ```js
 * await session.promptStreamingHTML(prompt).pipeTo(renderStreamingHTML(output));
 * ```
 *
 * `pipeTo()` drains the stream, so unlike passing an element to a method that
 * returns one, there is no way to wire this up and have nothing happen. It also
 * gives you the rest of the streams machinery for free: put a `TransformStream`
 * in the middle, or feed it HTML chunks from somewhere other than a model.
 *
 * Nodes are built with `createElement` and `append`, never from a string, so
 * this works on pages that enforce Trusted Types. That is why every chunk is a
 * single token: a balanced fragment would need `insertAdjacentHTML`, which such
 * pages refuse.
 *
 * @param {HTMLElement} element Where to render.
 * @returns {WritableStream<string>}
 */
export function renderStreamingHTML(element) {
  if (!element) {
    throw new TypeError('renderStreamingHTML() requires an element.');
  }
  // The open elements, innermost last, exactly as the parser would track them.
  const open = [element];

  return new WritableStream({
    write(chunk) {
      const cursor = open.at(-1);

      if (chunk.startsWith('</')) {
        if (open.length > 1) {
          open.pop();
        }
        return;
      }

      if (chunk.startsWith('<')) {
        const tag = OPEN_TAG.exec(chunk);
        if (!tag) {
          throw new TypeError(`Not a single HTML token: ${chunk}`);
        }
        const child = document.createElement(tag[1]);
        for (const [, name, value] of tag[2].matchAll(ATTRIBUTE)) {
          child.setAttribute(
            name,
            value === undefined ? '' : unescapeText(value)
          );
        }
        cursor.append(child);
        if (!VOID_ELEMENTS.has(child.localName)) {
          open.push(child);
        }
        return;
      }

      cursor.append(unescapeText(chunk));
    },
  });
}

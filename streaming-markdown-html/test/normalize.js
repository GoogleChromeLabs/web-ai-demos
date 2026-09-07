/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes HTML for comparison. Attribute order, insignificant whitespace
 * between tags, and how an entity happens to be spelled (`&copy;` versus ©)
 * carry no meaning, so none of them should count as a difference. Parsing and
 * re-serializing settles the entity spelling.
 */
export function normalizeHtml(html) {
  const probe = globalThis.document.createElement('div');
  probe.innerHTML = html;
  return probe.innerHTML
    .replace(
      /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g,
      (_match, tag, attrs) => {
        const list = [...attrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)]
          // `checked` and `checked=""` are the same attribute; serializers
          // differ on which they write.
          .map(([, name, value]) =>
            value === undefined || value === '' ? name : `${name}="${value}"`
          )
          .sort();
        return `<${tag}${list.length > 0 ? ` ${list.join(' ')}` : ''}>`;
      }
    )
    .replace(/\n/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

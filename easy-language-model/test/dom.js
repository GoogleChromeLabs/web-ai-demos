/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// A DOM for Node, so the real renderer can be tested rather than a stand-in.
import { parseHTML } from 'linkedom';

const { document, Element, Node } = parseHTML(
  '<!doctype html><html><body></body></html>'
);

globalThis.document = document;
globalThis.Element = Element;
globalThis.Node = Node;

// linkedom has no `document.implementation`; the renderer builds into an inert
// document when it isn't given a target element.
if (!document.implementation) {
  Object.defineProperty(document, 'implementation', {
    value: {
      createHTMLDocument: () =>
        parseHTML('<!doctype html><html><body></body></html>').document,
    },
    configurable: true,
  });
}

// `isSafeUrl()` resolves relative URLs against the document base.
if (!document.baseURI) {
  Object.defineProperty(document, 'baseURI', {
    value: 'https://example.test/',
    configurable: true,
  });
}

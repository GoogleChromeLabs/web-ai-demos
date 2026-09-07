/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHtmlTokenStreamer } from './renderer.js';

/**
 * A `TransformStream` that takes Markdown chunks and emits HTML chunks.
 *
 * This is `createHtmlTokenStreamer()` with a stream on either side, which is
 * what lets a Markdown source reach the page in one expression:
 *
 * ```js
 * await markdownStream
 *   .pipeThrough(markdownToHtml())
 *   .pipeTo(renderStreamingHTML(output));
 * ```
 *
 * Chunk boundaries on the way in don't have to line up with anything: a
 * construct split across two writes is held until it is complete.
 *
 * @param {object} [options]
 * @param {(detail: {attribute: string, value: string}) => void} [options.onUnsafe]
 *   Called when an `href` or `src` is dropped for having an unsafe scheme.
 * @returns {TransformStream<string, string>}
 */
export function markdownToHtml({ onUnsafe } = {}) {
  /** @type {ReturnType<typeof createHtmlTokenStreamer>} */
  let streamer;

  return new TransformStream({
    start(controller) {
      streamer = createHtmlTokenStreamer({
        onHtml: (html) => controller.enqueue(html),
        onUnsafe,
      });
    },
    transform(markdown) {
      streamer.write(markdown);
    },
    flush() {
      // Closes whatever tags the Markdown left open. The controller still
      // accepts chunks here, so those closing tags make it out.
      streamer.end();
    },
  });
}

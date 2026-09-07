/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './dom.js';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHtmlTokenStreamer } from '../renderer.js';
import { markdownToHtml } from '../markdown-to-html.js';
import { renderStreamingHTML } from '../render-stream.js';
import { normalizeHtml } from './normalize.js';

/** Feeds `chunks` through a stream and collects what comes out. */
async function through(chunks, options) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const out = [];
  await source
    .pipeThrough(markdownToHtml(options))
    .pipeTo(new WritableStream({ write: (html) => void out.push(html) }));
  return out;
}

const SAMPLE = [
  '# Title\n\nAT&a',
  'mp;T wrote `x & y`.\n\n',
  '| a ',
  '| b |\n| - | - |\n|  c  |  d  |\n\n',
  '~~gone~~ and [t](https://x.test "Ti")\n',
];

describe('markdownToHtml', () => {
  it('emits the same chunks as the callback API', async () => {
    const expected = [];
    const streamer = createHtmlTokenStreamer({
      onHtml: (html) => expected.push(html),
    });
    for (const chunk of SAMPLE) {
      streamer.write(chunk);
    }
    streamer.end();

    assert.deepEqual(await through(SAMPLE), expected);
  });

  it('closes tags the Markdown left open, on flush', async () => {
    // No trailing newline, so the paragraph is still open when input ends.
    const out = await through(['*hi*']);
    assert.equal(out.join(''), '<p><em>hi</em></p>');
  });

  it('pipes into renderStreamingHTML', async () => {
    const root = document.createElement('div');
    const source = new ReadableStream({
      start(controller) {
        for (const chunk of SAMPLE) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    await source
      .pipeThrough(markdownToHtml())
      .pipeTo(renderStreamingHTML(root));

    // Attribute order differs between the two, and means nothing in HTML.
    assert.equal(
      normalizeHtml(root.innerHTML),
      normalizeHtml((await through(SAMPLE)).join(''))
    );
    assert.match(root.innerHTML, /<h1>Title<\/h1>/);
    // The entity was split across two chunks and still resolved.
    assert.match(root.innerHTML, /AT&amp;T/);
  });

  it('reports an unsafe URL rather than emitting it', async () => {
    const unsafe = [];
    const out = await through(['[x](javascript:void0)\n'], {
      onUnsafe: (detail) => unsafe.push(detail),
    });
    assert.deepEqual(unsafe, [
      { attribute: 'href', value: 'javascript:void0' },
    ]);
    assert.ok(!out.join('').includes('javascript:'));
  });
});

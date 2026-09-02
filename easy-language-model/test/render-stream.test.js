/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './dom.js';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { createHtmlTokenStreamer } from '../src/markdown-html.js';
import { renderStreamingHTML } from '../src/render-stream.js';
import { normalizeHtml } from './normalize.js';

/** Renders Markdown both ways and returns the two results. */
async function bothWays(markdown, { chunkSize } = {}) {
  const chunks = [];
  const emitter = createHtmlTokenStreamer({ onHtml: (h) => chunks.push(h) });
  const direct = document.createElement('div');
  const renderer = createHtmlTokenStreamer({ into: direct, onHtml: () => {} });

  const pieces = chunkSize
    ? (markdown.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [])
    : [markdown];
  for (const piece of pieces) {
    emitter.write(piece);
    renderer.write(piece);
  }
  emitter.end();
  renderer.end();

  const piped = document.createElement('div');
  const writer = renderStreamingHTML(piped).getWriter();
  for (const chunk of chunks) {
    await writer.write(chunk);
  }
  await writer.close();

  // Attribute order carries no meaning and serializers disagree on it.
  return {
    chunks,
    direct: normalizeHtml(direct.innerHTML),
    piped: normalizeHtml(piped.innerHTML),
  };
}

const CASES = {
  'heading and paragraph': '# Title\n\nA **bold** para.\n',
  'inline code': 'use `code` here\n',
  link: 'See [docs](https://e.com/a?b=1&c=2 "T") now.\n',
  image: '![alt text](https://e.com/i.png)\n',
  lists: '- one\n- two\n\n1. a\n2. b\n',
  'nested list': '- outer\n  - inner\n',
  'task list': '- [x] done\n- [ ] todo\n',
  'fenced code': '```js\nlet x = 1 < 2 && 3 > 2;\n```\n',
  blockquote: '> quoted **text**\n',
  table: '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n',
  entities: 'AT&amp;T &copy; 5 < 6\n',
  'link with markup inside': '[**bold** link](https://e.com/)\n',
  'thematic break': 'a\n\n---\n\nb\n',
};

describe('renderStreamingHTML', () => {
  for (const [name, markdown] of Object.entries(CASES)) {
    it(`builds the same DOM as rendering directly: ${name}`, async () => {
      const { direct, piped } = await bothWays(markdown);
      assert.equal(piped, direct);
    });
  }

  it('is unaffected by how the Markdown was chunked', async () => {
    const markdown = Object.values(CASES).join('\n');
    const whole = await bothWays(markdown);
    for (const chunkSize of [1, 3, 7]) {
      const split = await bothWays(markdown, { chunkSize });
      assert.equal(split.piped, whole.piped, `chunk size ${chunkSize}`);
    }
  });

  it('receives only single tokens, never a balanced fragment', async () => {
    const { chunks } = await bothWays(Object.values(CASES).join('\n'));
    for (const chunk of chunks) {
      if (chunk.startsWith('<')) {
        assert.equal(
          chunk.indexOf('<', 1),
          -1,
          `fragment would need insertAdjacentHTML: ${chunk}`
        );
      }
    }
  });

  // A page enforcing Trusted Types refuses every string-to-DOM sink, so the
  // renderer must not reach for one.
  it('never uses a string-to-DOM sink', () => {
    const source = readFileSync(
      new URL('../src/render-stream.js', import.meta.url),
      'utf8'
    );
    for (const sink of [
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'document.write',
    ]) {
      assert.ok(!source.includes(`.${sink}`), `render-stream.js uses ${sink}`);
    }
  });

  it('rejects an element-less call', () => {
    assert.throws(() => renderStreamingHTML(), { name: 'TypeError' });
  });
});

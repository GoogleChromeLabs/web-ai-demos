/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './dom.js';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marked } from 'marked';

import { createHtmlTokenStreamer } from '../src/markdown-html.js';
import { renderStreamingHTML } from '../src/render-stream.js';
import { normalizeHtml } from './normalize.js';

marked.setOptions({ gfm: true, breaks: false });

/** Runs Markdown through the streamer and returns the concatenated HTML. */
function render(markdown, { chunkSize } = {}) {
  const out = [];
  const streamer = createHtmlTokenStreamer({
    onHtml: (html) => out.push(html),
  });
  const chunks = chunkSize
    ? (markdown.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [])
    : [markdown];
  for (const chunk of chunks) {
    streamer.write(chunk);
  }
  streamer.end();
  return out.join('');
}

/**
 * Asserts our output matches what a CommonMark + GFM parser produces, and that
 * it does so however the input is chopped up. Chunk boundaries land in the
 * middle of constructs when a model streams, so every case is also fed in
 * small pieces.
 */
function matchesReference(markdown) {
  const expected = normalizeHtml(marked.parse(markdown));
  assert.equal(normalizeHtml(render(markdown)), expected, 'whole input');
  for (const chunkSize of [1, 2, 3, 4, 7]) {
    assert.equal(
      normalizeHtml(render(markdown, { chunkSize })),
      expected,
      `chunk size ${chunkSize}`
    );
  }
}

// Constructs an LLM routinely emits. Each must match the reference parser.
const CASES = {
  'ATX heading': '# Title\n',
  'bold and italic': 'a **b** and *c*\n',
  'nested emphasis': '**bold with *italic* inside**\n',
  'escaped asterisk': 'literal \\*not emphasis\\*\n',
  'inline code': 'use `code` here\n',
  'fenced code with language': '```js\nlet x = 1;\n```\n',
  'tilde fence': '~~~js\nlet x = 1;\n~~~\n',
  'fence containing backticks': '````\n```\n````\n',
  'indented code': '    indented code\n',
  'unordered list': '- a\n- b\n',
  'ordered list': '1. a\n2. b\n',
  'ordered list with start': '3. a\n4. b\n',
  'nested list': '- a\n  - b\n',
  'task list': '- [x] done\n- [ ] todo\n',
  blockquote: '> quoted\n',
  'nested blockquote': '> a\n> > b\n',
  'blockquote with list': '> - a\n> - b\n',
  'inline link': '[t](https://e.com/)\n',
  'link with title': '[t](https://e.com/ "Title")\n',
  'bare url': 'see https://e.com/ ok\n',
  image: '![alt](https://e.com/i.png)\n',
  'hard break with backslash': 'line one\\\nline two\n',
  'thematic break': 'a\n\n---\n\nb\n',
  table: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
  strikethrough: '~~gone~~\n',
  'html entity': 'AT&amp;T &copy; &#65;\n',
  'consecutive emphasis': '*a* *b* *c*\n',
  'intraword underscore': 'snake_case_word\n',
  'dunder identifier': 'call __init__ here\n',
  'constant with underscores': 'set MAX_BUFFER_SIZE now\n',
  'underscore emphasis': 'an _emphasised_ word\n',
  'underscore strong': 'an __important__ word\n',
};

describe('markdown to HTML', () => {
  for (const [name, markdown] of Object.entries(CASES)) {
    it(name, () => matchesReference(markdown));
  }
});

// Two CommonMark constructs are deliberately not supported. These tests pin the
// current behaviour so that a future fix shows up as a failure here rather than
// as a silent change.
describe('known deviations from CommonMark', () => {
  it('does not support setext headings', () => {
    // `Title` is emitted as a paragraph before the `=====` line is seen, and
    // the parser never revises what it already emitted. Supporting this would
    // mean holding every paragraph back by one line, which is the cost the
    // append-only design exists to avoid. LLMs use ATX headings essentially
    // always.
    assert.equal(render('Title\n=====\n'), '<p>Title<br>=====</p>');
  });

  it('does not support angle-bracket autolinks', () => {
    // `<https://e.com/>` stays literal. Making `<` open a link risks swallowing
    // the `<placeholder>` style text that LLM prose is full of, and bare URLs
    // and [text](url) links — which are what models actually emit — both work.
    assert.equal(render('<https://e.com/>\n'), '<p>&lt;https://e.com/&gt;</p>');
    assert.match(
      render('see https://e.com/ ok\n'),
      /<a href="https:\/\/e\.com\/">/
    );
  });

  it('does not resolve reference links', () => {
    // `[t][r]` needs the `[r]: url` definition, which may appear anywhere later
    // in the document. Resolving it means a second pass over text already
    // emitted, which an append-only parser cannot do. The anchors come out
    // without an href, so they render as plain text rather than dead links.
    assert.equal(
      render('[t][r]\n\n[r]: https://e.com/\n'),
      '<p><a>t</a><a>r</a></p>' +
        '<p><a>r</a>: <a href="https://e.com/">https://e.com/</a></p>'
    );
  });

  it('does not wrap loose list items in paragraphs', () => {
    // Whether a list is loose is only known once the blank line after it is
    // seen, by which point <li> and its text are already out. Affects spacing
    // only.
    assert.equal(render('- a\n\n- b\n'), '<ul><li>a</li><li>b</li></ul>');
  });

  it("does not keep a list item's second paragraph inside the item", () => {
    assert.equal(
      render('- para one\n\n  para two\n'),
      '<ul><li>para one</li></ul><p>para two</p>'
    );
  });

  it('does not parse block constructs inside list items', () => {
    assert.equal(render('- # h\n'), '<ul><li># h</li></ul>');
  });

  it('ignores table column alignment', () => {
    // The reference parser emits the deprecated `align` attribute, which
    // sanitizers strip anyway.
    assert.match(
      render('| a | b |\n| :-- | --: |\n| 1 | 2 |\n'),
      /<th>a<\/th><th>b<\/th>/
    );
  });

  it('keeps the space before a two-space hard break', () => {
    // Renders identically; the difference is only in the markup.
    assert.equal(
      render('line one  \nline two\n'),
      '<p>line one <br>line two</p>'
    );
  });

  it('leaves <placeholder> prose alone', () => {
    assert.equal(
      render('replace <your-key> with it\n'),
      '<p>replace &lt;your-key&gt; with it</p>'
    );
  });
});

describe('streaming', () => {
  const sample =
    '# Title\n\nA **bold** para with `code` and a [link](https://e.com/).\n\n' +
    '- one\n- two\n\n```js\nlet x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';

  it('output is independent of chunk size', () => {
    const whole = render(sample);
    for (const chunkSize of [1, 2, 3, 5, 7, 13, 64]) {
      assert.equal(
        render(sample, { chunkSize }),
        whole,
        `chunkSize ${chunkSize}`
      );
    }
  });

  it('emits far more chunks than blocks', () => {
    const out = [];
    const streamer = createHtmlTokenStreamer({ onHtml: (h) => out.push(h) });
    streamer.write(sample);
    streamer.end();
    assert.ok(
      out.length > 20,
      `expected a token-level stream, got ${out.length}`
    );
  });

  it('opens with a tag rather than a whole block', () => {
    const out = [];
    const streamer = createHtmlTokenStreamer({ onHtml: (h) => out.push(h) });
    streamer.write('Hello world');
    assert.equal(out[0], '<p>');
  });

  it('describes a DOM that can be rebuilt from the chunks alone', async () => {
    const out = [];
    const streamer = createHtmlTokenStreamer({ onHtml: (h) => out.push(h) });
    streamer.write(sample);
    streamer.end();

    const rebuilt = document.createElement('div');
    const writer = renderStreamingHTML(rebuilt).getWriter();
    for (const html of out) {
      await writer.write(html);
    }
    await writer.close();

    assert.equal(normalizeHtml(rebuilt.innerHTML), normalizeHtml(out.join('')));
  });
});

describe('untrusted content', () => {
  it('escapes raw HTML into text', () => {
    assert.equal(
      render('<img src=x onerror=alert(1)>'),
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
    );
  });

  it('reports a javascript: link and drops the href', () => {
    const unsafe = [];
    const out = [];
    const streamer = createHtmlTokenStreamer({
      onHtml: (h) => out.push(h),
      onUnsafe: (d) => unsafe.push(d),
    });
    streamer.write('[click](javascript:alert(1))');
    streamer.end();
    assert.deepEqual(
      unsafe.map((u) => u.attribute),
      ['href']
    );
    assert.ok(!out.join('').includes('javascript:'));
  });

  it('keeps safe and relative urls', () => {
    assert.equal(render('[x](/docs)'), '<p><a href="/docs">x</a></p>');
    assert.equal(
      render('[x](https://e.com/)'),
      '<p><a href="https://e.com/">x</a></p>'
    );
  });
});

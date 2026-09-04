<!--
  Copyright 2026 Google LLC
  SPDX-License-Identifier: Apache-2.0
-->

# streaming-markdown-html

A streaming Markdown-to-HTML parser for browsers. It's append-only: as Markdown
arrives it emits new HTML and never revises what it already emitted, so the page
can grow a token at a time instead of being re-rendered on every chunk. That is
what makes it a fit for a language model's output, which arrives a few
characters at a time.

Two things make it browser-specific on purpose:

- **Output granularity is one token**, not one block. A paragraph appears word
  by word rather than all at once when it ends.
- **Nothing needs an HTML string sink.** `renderStreamingHTML()` builds the DOM
  with `createElement`, `setAttribute`, and `append` alone, so it works on pages
  that enforce Trusted Types, where `innerHTML` and `insertAdjacentHTML` throw.

```sh
npm install streaming-markdown-html
```

## Markdown in, HTML chunks out

`createHtmlTokenStreamer()` takes Markdown a piece at a time and calls you back
with HTML:

```js
import { createHtmlTokenStreamer } from 'streaming-markdown-html';

const streamer = createHtmlTokenStreamer({
  onHtml: (html) => console.log(html), // '<p>', 'Hello ', 'world', '</p>'
  // A `javascript:` href, or any other scheme outside http(s), mailto, tel,
  // sms, ftp and image `data:` URLs. The attribute is dropped either way;
  // this is the notification.
  onUnsafe: ({ attribute, value }) => console.warn(attribute, value),
});
streamer.write('Hello ');
streamer.write('world');
streamer.end(); // Closes whatever tags the Markdown left open.
```

A chunk is one opening tag, one run of text, or one closing tag, never a
balanced fragment: `<p>` arrives before its text and `</p>` long after.
Concatenating them all gives the complete, well-formed HTML.

## Putting those chunks on the page

`renderStreamingHTML(element)` is a `WritableStream` that takes those chunks and
builds the DOM as they arrive, appending nodes rather than re-parsing anything:

```js
import {
  createHtmlTokenStreamer,
  renderStreamingHTML,
} from 'streaming-markdown-html';

const writer = renderStreamingHTML(document.querySelector('#out')).getWriter();
const streamer = createHtmlTokenStreamer({
  onHtml: (html) => writer.write(html),
});

for await (const markdown of source) {
  streamer.write(markdown);
}
streamer.end();
await writer.close();
```

Keeping each chunk to a single token is what makes this possible without an HTML
string sink: a balanced fragment would need `insertAdjacentHTML`.

`isSafeUrl(value)` is exported too, for callers that want the same check
elsewhere.

## What was fixed

The parser started as a copy of
[streaming-markdown](https://github.com/thetarnav/streaming-markdown) 0.2.15
(MIT, Damian Tarnawski). Upstream is unmaintained — the last substantive commit
was May 2025, and it describes itself as an experiment — but its append-only
design is exactly what token-level streaming needs. Every fix below lives in
[`parser.js`](parser.js), marked with a `FIX:` comment, and is measured against
a CommonMark + GFM reference:

|                                      | Before                                             | After                        |
| ------------------------------------ | -------------------------------------------------- | ---------------------------- |
| `snake_case_word`, `MAX_BUFFER_SIZE` | `snake<em>case</em>word`                           | kept literal, per CommonMark |
| `~~~` code fences                    | mangled into strikethrough                         | parsed as a fence            |
| `&amp;`, `&copy;`, `&#65;`           | double-escaped, shown literally                    | resolved                     |
| `[t](url "Title")`                   | title swallowed into the `href`, breaking the link | `title` attribute            |
| `![alt](src)`                        | alt text silently dropped                          | `alt` attribute              |
| Fenced code language                 | `class="js"`                                       | `class="language-js"`        |
| Table cells                          | padded with the spaces from `\| a \|`              | trimmed                      |
| `~~text~~`                           | `<s>`                                              | `<del>`, as GFM specifies    |

Every construct is tested at several chunk sizes, because a model's chunk
boundaries land mid-construct and several of these bugs only appear there.

## Known deviations

These are deliberately not supported, and each is pinned by a test in
[`test/markdown.test.js`](test/markdown.test.js) so a future fix shows up as a
failure rather than a silent change:

- **Setext headings** (`Title` over `=====`), and anything about a list that is
  only knowable after the fact: whether it is loose, and whether a second
  paragraph belongs to the item above it. Each is recognizable only once the
  content it affects has been emitted, and an append-only parser cannot revise
  what it emitted. Supporting them means holding every paragraph back by a line,
  which is the cost this design exists to avoid. Models use `#` headings
  essentially always.
- **Block constructs inside a list item.** `- # h` keeps the `#` as text.
- **Reference links** (`[t][r]` with a `[r]: url` definition). The definition
  can appear anywhere later in the document, so resolving it needs a second
  pass. The anchors come out without an `href`, so they render as plain text
  rather than as dead links.
- **Angle-bracket autolinks** (`<https://example.com/>`). Making `<` open a link
  risks swallowing the `<placeholder>` text that model prose is full of. Bare
  URLs and `[text](url)` links both work.
- **Table column alignment**. The reference parser emits the deprecated `align`
  attribute, which sanitizers strip anyway.
- **The space before a two-space hard break**, which is kept rather than
  trimmed. It renders identically.

## Note on entity references

Resolving `&copy;` needs the full HTML entity table, so the browser's own parser
does it, through `setHTML()` rather than `innerHTML`: pages enforcing Trusted
Types refuse `innerHTML`, and refusing it here would break every response
containing an entity rather than only an unsafe one. Where `setHTML()` is
missing, references are left literal rather than throwing.

## Licence

[`parser.js`](parser.js) is MIT, © 2024 Damian Tarnawski, with modifications ©
2026 Google LLC. The full notice is at the top of the file. Everything else is
Apache-2.0, © 2026 Google LLC.

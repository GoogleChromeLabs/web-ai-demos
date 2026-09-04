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

## Install

```sh
npm install streaming-markdown-html
```

It needs a DOM, so it runs in a browser rather than in Node: both entry points
reach for `document`. It has no runtime dependencies, and ships TypeScript
declarations.

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

If the Markdown already arrives as a stream, the whole thing is one expression.
`markdownToHtml()` is the streamer above as a `TransformStream`, and
`renderStreamingHTML(element)` is a `WritableStream` that builds the DOM as the
chunks arrive, appending nodes rather than re-parsing anything:

```js
import {
  markdownToHtml,
  renderStreamingHTML,
} from 'streaming-markdown-html';

await markdownStream
  .pipeThrough(markdownToHtml())
  .pipeTo(renderStreamingHTML(document.querySelector('#out')));
```

Keeping each chunk to a single token is what makes that last step possible
without an HTML string sink: a balanced fragment would need
`insertAdjacentHTML`. Because it's an ordinary pipeline, a `TransformStream` in
the middle sees the HTML on its way past, and backpressure works the way it
does anywhere else.

`isSafeUrl(value)` is exported too, for callers that want the same check
elsewhere.

## With the Prompt API

`LanguageModel` streams Markdown, which is exactly what the pipeline above
takes. `promptStreaming()` returns a `ReadableStream`, so rendering a response
as it is generated is those same three lines:

```js
import {
  markdownToHtml,
  renderStreamingHTML,
} from 'streaming-markdown-html';

const session = await LanguageModel.create();
const output = document.querySelector('#out');

await session
  .promptStreaming('Explain streams, with a short table.')
  .pipeThrough(markdownToHtml())
  .pipeTo(renderStreamingHTML(output));
```

A model's chunks split wherever the tokenizer happened to split them, mid-word
and mid-construct, which is the case this parser is built for: a `**bold**` or a
table row spread over three chunks is held until it is complete, and nothing
already on the page is touched again.

Two things this does not do, both of which matter if the prompt is anything a
user can influence. It does not vet the Markdown: a model told to emit
`<img src=x onerror=…>` will emit it, and while this parser escapes it into text
rather than markup, you want to know it happened. And it does not stop the
response. For both, see
[`easy-language-model`](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/easy-language-model),
a Prompt API wrapper that runs the response through the
[Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API)
and uses this package underneath.

## Prior art

This is not a parser written from scratch. It is a fork of
[streaming-markdown](https://github.com/thetarnav/streaming-markdown) 0.2.15 by
Damian Tarnawski (MIT), which is where the append-only design and the whole
tokenizer come from. That design is the hard part and the reason for building on
it: emitting only new tokens is what lets a caller append to the DOM instead of
re-rendering.

It is a fork rather than a dependency because upstream is unmaintained. The last
substantive commit was May 2025 and it describes itself as an experiment, so
there was nowhere to send these fixes. Each one lives in
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

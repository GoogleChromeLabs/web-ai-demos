<!--
  Copyright 2026 Google LLC
  SPDX-License-Identifier: Apache-2.0
-->

# The Markdown parser

[`streaming-markdown.js`](streaming-markdown.js) is a vendored copy of
[streaming-markdown](https://github.com/thetarnav/streaming-markdown) 0.2.15
(MIT, Damian Tarnawski). It's here rather than in `dependencies` because
upstream is unmaintained — the last substantive commit was May 2025 and it
describes itself as an experiment — while its append-only design is exactly
what token-level streaming needs: the parser only ever emits new tokens, so a
caller can append to the DOM and never re-parse.

Two things turn Markdown into HTML: this parser, and the renderer in
[`src/markdown-html.js`](../src/markdown-html.js) that consumes its tokens. The
first two rows below were fixed here, in the parser; the rest are the
renderer's. Measured against a CommonMark + GFM reference:

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
[`test/markdown.test.js`](../test/markdown.test.js) so a future fix shows up as
a failure rather than a silent change:

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

## Licence

`streaming-markdown.js` is MIT, © 2024 Damian Tarnawski, with modifications ©
2026 Google LLC. The full notice is at the top of the file.

# Declarative Partial Updates with the Prompt API

A city guide whose five cards are written by five concurrent Prompt API
sessions and patched into the page in whatever order they finish, using
[declarative partial updates](https://developer.chrome.com/docs/web-platform/declarative-partial-updates):

- **Out-of-order streaming.** Each card, stamped from one `<template>` in
  `index.html`, holds a named range,
  `<?start name="food">…skeleton…<?end>`. The page script never looks a card up
  to fill it. It opens one `streamAppendHTMLUnsafe()` stream per section on the
  shared parent, `#guide`, and writes `<template for="food">`, the model's HTML
  chunks, and `</template>`. The `for` attribute routes the content into the
  matching range, exactly the way a server streaming a page out of order would.
- **Streaming HTML insertion.** The follow-up answer is piped straight from
  `promptStreamingHTML()` into `answer.streamHTML()`, which sanitizes it with
  the Sanitizer API as it goes. This is the platform's version of
  EasyLanguageModel's own `renderStreamingHTML()`.

The model is driven through
[`easy-language-model`](../easy-language-model/), whose `promptStreamingHTML()`
turns the model's Markdown into HTML chunks with all model-written text escaped.
That is why the guide may use the unsafe variant: the sanitizer has no place for
`<template for>`, and every tag in the stream is one this page or the Markdown
parser wrote.

## Polyfills

Both APIs sit behind `chrome://flags/#enable-experimental-web-platform-features`.
Elsewhere, the demo loads:

- [`template-for-polyfill`](https://github.com/GoogleChromeLabs/template-for-polyfill)
  for `<template for>` and the processing instructions, which non-supporting
  browsers parse as comments. It patches with a `MutationObserver`.
- [`html-setters-polyfill`](https://github.com/GoogleChromeLabs/html-setters-polyfill)
  for `streamAppendHTMLUnsafe()`, `streamHTML()`, and the rest. It buffers a
  stream and inserts it on close, so with the polyfill each card appears in one
  go when its section is complete, and natively it fills in chunk by chunk.

A native `<template for>` patches only while the document parser or a streaming
insertion method parses it in place. `html-setters-polyfill` parses each stream
in a detached document and appends the result, which leaves the template inert.
So wherever the streaming methods are polyfilled, as in Chrome versions that
ship `<template for>` without them, the page loads `template-for-polyfill` as
well, and hides the native `htmlFor` from it while it loads so it installs.

The on-device model answers one prompt at a time, so the sections finish in the
order they start. The page starts them in a random order on every run, which
shows that the cards don't depend on it: the layout comes from the markup, and
each answer lands wherever its `<template for>` points. A native patch clears its
range as soon as the opening `<template for>` tag is parsed, so the page holds
that tag back until the first chunk arrives, and a queued card keeps its
skeleton.

The header of the page says which of the two you are getting. The "HTML written
to `#guide`" panel shows every chunk in the order it was written, colored by
the stream it went to.

## Running it

```sh
npm install
npm run dev
```

Open the printed `http://localhost` URL in Chrome with the Prompt API available.
`npm run build` writes a static site to `dist/`.

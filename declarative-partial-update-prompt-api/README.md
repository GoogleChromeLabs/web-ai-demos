# Declarative Partial Updates with the Prompt API

A city guide whose five cards are written by five concurrent Prompt API
sessions and streamed into the page in whatever order they finish, using the
streaming HTML insertion methods from
[declarative partial updates](https://developer.chrome.com/docs/web-platform/declarative-partial-updates):

- **Streaming into each card.** The page stamps one card per section from a
  `<template>` in `index.html`. Each section pipes the HTML chunks from
  `promptStreamingHTML()` into its card's `streamHTML()`, which replaces the
  skeleton and runs every chunk through the Sanitizer API as it goes. The
  sanitizer also allows `class`, which the default config drops and the page
  uses to style the arrival and error lines.
- **Streaming the follow-up.** The follow-up answer is piped into
  `answer.streamHTML()` the same way. This is the platform's version of
  EasyLanguageModel's own `renderStreamingHTML()`.

The model is driven through
[`easy-language-model`](../easy-language-model/), whose `promptStreamingHTML()`
turns the model's Markdown into HTML chunks with all model-written text escaped.

The on-device model answers one prompt at a time, so the sections finish in the
order they start. The page starts them in a random order on every run, which
shows that the cards don't depend on it: the layout comes from the markup, and
each answer streams into its own card. `streamHTML()` replaces the skeleton, so
the page opens each card's stream with its first chunk, and a queued card keeps
its skeleton.

The "HTML streamed into the cards" panel shows every chunk in the order it was
written, colored by the card it went to.

## Polyfill

In browsers without the streaming methods, the demo loads
[`html-setters-polyfill`](https://github.com/GoogleChromeLabs/html-setters-polyfill).
It buffers a stream and inserts it on close, so with the polyfill each card
appears in one go when its section is complete, and natively it fills in chunk
by chunk. The polyfill can add `streamHTML()` only where `setHTML()` exists, so
in browsers without it the page falls back to `streamHTMLUnsafe()`, which is
safe here because every tag comes from the Markdown parser. The header of the
page says which of the two you are getting.

## Running it

```sh
npm install
npm run dev
```

Open the printed `http://localhost` URL in Chrome with the Prompt API available.
`npm run build` writes a static site to `dist/`.

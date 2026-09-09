# Writer and Rewriter API Polyfills

Chrome is proposing to deprecate and remove the experimental
[Writer](https://developer.chrome.com/docs/ai/writer-api) and
[Rewriter](https://developer.chrome.com/docs/ai/rewriter-api) APIs. This package
keeps `window.Writer` and `window.Rewriter` working by reimplementing them on
top of `window.LanguageModel`, using the same system prompt templates Chrome
used. Your calling code does not change.

The polyfills are backed **exclusively** by the LanguageModel implementation the
browser itself provides, with no fallback behind them and no way to opt into
one:

- `Writer.availability()` and `Rewriter.availability()` resolve with
  `'unavailable'` when `window.LanguageModel` is missing.
- `Writer.create()` and `Rewriter.create()` reject with a `NotSupportedError`.

## Why the APIs are going away

Both APIs were explored as task-specific abstractions and reached an origin
trial, but the signal from that trial was consistent: developers preferred to
implement writing and rewriting directly with the Prompt API
(`window.LanguageModel`).

That preference is a reasonable one, because the two APIs were never more than
templatized system prompts over the same on-device model the Prompt API exposes.
Custom prompting reached the same results, or better ones, and base models have
improved to the point where adjusting tone, length, and format needs no
dedicated API. Retiring these thin abstractions frees up effort for task APIs
where a dedicated model does earn its place, such as Summarizer and Translator,
and for primitives that unlock things the platform cannot do yet, such as
embeddings and tool calling.

## Installation

```bash
npm install writer-rewriter-polyfills
```

There are no runtime dependencies.

## Usage

Load a polyfill only where the native API is missing, so browsers that still
ship it keep using it:

```js
const polyfills = [];
if (!('Writer' in self)) {
  polyfills.push(import('writer-rewriter-polyfills/writer'));
}
if (!('Rewriter' in self)) {
  polyfills.push(import('writer-rewriter-polyfills/rewriter'));
}
await Promise.all(polyfills);
```

Importing the package root loads both at once:

```js
import 'writer-rewriter-polyfills';
```

Then check availability before you offer the feature. Because there is no
fallback behind it, `'unavailable'` is the answer you should design for first:

```js
const options = { tone: 'neutral', format: 'plain-text', outputLanguage: 'en' };

switch (await Writer.availability(options)) {
  case 'unavailable':
    // Either there is no window.LanguageModel, or it has no usable model for
    // these options. Fall back to whatever your app did before.
    showPlainEditor();
    break;
  case 'downloadable':
  case 'downloading':
    // The model still has to arrive. Ask first, then report progress below.
    showDownloadPrompt();
    break;
  case 'available':
    showWriterUi();
    break;
}
```

Creating a writer is unchanged, including the download monitor:

```js
try {
  const writer = await Writer.create({
    ...options,
    sharedContext: 'An email to a colleague.',
    monitor: (m) => {
      m.addEventListener('downloadprogress', (e) => {
        progress.value = e.loaded;
        progress.max = e.total;
      });
    },
  });

  const draft = await writer.write('Tell her I will be late.');
  writer.destroy();
} catch (error) {
  if (error.name === 'NotSupportedError') {
    showPlainEditor();
  } else {
    throw error;
  }
}
```

`Rewriter` works the same way, with `rewrite()` in place of `write()`:

```js
const rewriter = await Rewriter.create({ tone: 'more-casual' });
const result = await rewriter.rewrite(
  'I am writing to inform you that I will be late.',
);
rewriter.destroy();
```

Both also stream, through `writeStreaming()` and `rewriteStreaming()`:

```js
const stream = writer.writeStreaming('Tell her I will be late.');
for await (const chunk of stream) {
  output.append(chunk);
}
```

## API surface

The polyfills follow the documented APIs:

- [Writer API](https://developer.chrome.com/docs/ai/writer-api)
- [Rewriter API](https://developer.chrome.com/docs/ai/rewriter-api)

For complete examples, see [`demo-writer.html`](demo-writer.html) and
[`demo-rewriter.html`](demo-rewriter.html).

## Running the demos locally

```bash
npm install
npm start
```

By default the demos force the polyfill even where the browser ships a native
Writer or Rewriter, so the polyfill code path is the one being exercised. Add
`?native` to the URL to prefer native support where it exists.

To build the demos as a static site:

```bash
npm run build:demos
```

## If you would rather not use the polyfill

Prompt the model yourself. The system prompt templates behind these APIs are in
[`writer-prompt-builder.js`](writer-prompt-builder.js) and
[`rewriter-prompt-builder.js`](rewriter-prompt-builder.js). They are meant to be
read, taken apart, and adapted: start from the template for the tone, format,
and length you need, and drop the rest.

Those two files are generated from Chrome's own prompt dumps by
[`scripts/writer-prompt-extractor.js`](scripts/writer-prompt-extractor.js) and
[`scripts/rewriter-prompt-extractor.js`](scripts/rewriter-prompt-extractor.js),
so do not edit them by hand.

## Tell us if this does not work for you

The proposal is not final, and the point of announcing it early is to find the
use cases it would break. If you have been testing these APIs and the Prompt API
or this polyfill falls short on quality, performance, or ergonomics, describe
the case in the
[Writer and Rewriter APIs consultation form](https://docs.google.com/forms/d/e/1FAIpQLSeyCU1PmpB6t5JtNN0qR1xDVB2iPOKxZ9Tjh4bQwOKz5JsBJw/viewform).
Concrete examples carry the most weight, and we will follow up with a short
technical conversation where one would help.

## License

Apache 2.0

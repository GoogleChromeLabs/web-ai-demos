# Deprecation of the Writer and Rewriter APIs

Chrome is proposing to deprecate and remove the experimental Writer and Rewriter
APIs. This document explains why, and how to keep the feature working in your
app with the polyfill in this package.

## Why

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

## What the polyfill can and cannot do for you

The polyfill keeps `window.Writer` and `window.Rewriter` working by
reimplementing them on top of `window.LanguageModel`, using the same system
prompt templates Chrome used. Your calling code does not change.

In a browser without `window.LanguageModel`, `Writer.availability()` and
`Rewriter.availability()` resolve with `'unavailable'`, and `Writer.create()`
and `Rewriter.create()` reject with a `NotSupportedError`.

## Using it

Install the package:

```bash
npm install built-in-ai-task-apis-polyfills
```

Load a polyfill only where the native API is missing, so browsers that still
ship it keep using it:

```js
const polyfills = [];
if (!('Writer' in self)) {
  polyfills.push(import('built-in-ai-task-apis-polyfills/writer'));
}
if (!('Rewriter' in self)) {
  polyfills.push(import('built-in-ai-task-apis-polyfills/rewriter'));
}
await Promise.all(polyfills);
```

Then check availability before you offer the feature. Because there is no
fallback behind it, `'unavailable'` is the answer you should design for first:

```js
const options = { tone: 'neutral', format: 'plain-text', outputLanguage: 'en' };

switch (await Writer.availability(options)) {
  case 'unavailable':
    // No Prompt API in this browser, so the Writer API can't work.
    // Fall back to whatever your app did before.
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

`Rewriter` works the same way, with `rewrite()` in place of `write()`.

## If you would rather not use the polyfill

Prompt the model yourself. The system prompt templates behind these APIs are in
[`writer-prompt-builder.js`](./writer-prompt-builder.js) and
[`rewriter-prompt-builder.js`](./rewriter-prompt-builder.js). They are meant to
be read, taken apart, and adapted: start from the template for the tone, format,
and length you need, and drop the rest.

## Tell us if this does not work for you

The proposal is not final, and the point of announcing it early is to find the
use cases it would break. If you have been testing these APIs and the Prompt API
or this polyfill falls short on quality, performance, or ergonomics, describe
the case in the
[Writer and Rewriter APIs consultation form](https://docs.google.com/forms/d/e/1FAIpQLSeyCU1PmpB6t5JtNN0qR1xDVB2iPOKxZ9Tjh4bQwOKz5JsBJw/viewform).
Concrete examples carry the most weight, and we will follow up with a short
technical conversation where one would help.

# Easy Language Model

A near drop-in wrapper for the Prompt API's
[`LanguageModel`](https://developer.chrome.com/docs/ai/prompt-api). Same shape,
same options, same return values, with the boilerplate that every production
built-in AI app ends up writing folded in:

|                        | Prompt API                                                        | `EasyLanguageModel`                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Sanitizing output**  | Sanitize and diff every response yourself to see what was removed | [Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API) on `prompt()` and `promptStreaming()`, on by default |
| **Rendering Markdown** | Bring your own streaming parser                                   | `promptStreamingHTML()` emits HTML chunks; `renderStreaming()` renders them                                                               |
| **Long conversations** | Manage `contextUsage` and rebuild the session yourself            | `session.compact()`                                                                                                                       |
| **Model downloads**    | `monitor` is opt-in and easy to forget                            | Always on, with a `<progress>` element you can hand over                                                                                  |
| **User activation**    | `create()` fails if the page has no gesture                       | Waits for one, or tells you to ask                                                                                                        |

Everything else — `append()`, `clone()`, `measureContextUsage()`,
`contextUsage`, `contextWindow`, `contextoverflow`, `responseConstraint`,
`initialPrompts`, `signal`, `tools`, multimodal input — is passed through
untouched, and `session.session` gets you the raw `LanguageModel` for anything
else.

## Install

```sh
npm install easy-language-model
```

```js
import { EasyLanguageModel } from 'easy-language-model';
```

Requires Chrome with the Prompt API and the HTML Sanitizer API. Pass
`sanitizer: false` to run without the latter.

## Side by side

### Creating a session

Three separate concerns have to line up before a session exists: the
availability check has to use the _same_ options as `create()`, a download
needs a progress indicator, and starting that download needs a user gesture.

Both sides check availability, so what's left over is the real difference:
wiring the monitor, handling the extracting state, and waiting for a gesture.
Keeping the Prompt API's own options in one object is what makes the two calls
agree by construction; the wrapper's options are spread in at `create()` time
and never have to be repeated.

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const options = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['en'] },
  ],
};

const availability =
  await LanguageModel.availability(options);

if (availability === 'unavailable') {
  return;
}

let downloading = false;
if (availability !== 'available') {
  downloading = true;
  progress.hidden = false;
  if (!navigator.userActivation.isActive) {
    await waitForClick();
  }
}

const session = await LanguageModel.create({
  ...options,
  monitor(m) {
    m.addEventListener(
      'downloadprogress',
      (e) => {
        progress.value = e.loaded;
        if (downloading && e.loaded === 1) {
          progress.removeAttribute('value');
        }
      },
    );
  },
});
progress.hidden = true;
```

</td><td>

```js
const options = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['en'] },
  ],
};

const availability =
  await EasyLanguageModel.availability(options);

if (availability === 'unavailable') {
  return;
}

const session = await EasyLanguageModel.create({
  ...options,
  progress,
  onUserActivationRequired() {
    enableButton.hidden = false;
    hint.hidden = false;
  },
});
```

</td></tr>
</table>

On the left, `e.loaded === 1` is the moment the bytes are all in and the
browser starts unpacking the model. That takes an unknown amount of time, so
the indicator has to go indeterminate; the wrapper does that for you and
reports it as an `extracting` state. Checking availability is optional on the
right — `create()` checks anyway and throws `LanguageModelUnavailableError` —
but it is worth asking first if you would rather not offer the feature at all.

The button needs no click handler: any trusted click, tap, or key press
anywhere on the page releases the wait and `create()` resolves. It's there to
give the user something to aim at, and the hint to explain what it's for. Use
`userActivation: 'throw'` instead if you'd rather drive `create()` from your own
button's handler and treat a missing gesture as an error.

### Prompting

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const doc =
  document.implementation.createHTMLDocument();

const wasSanitized = (html) => {
  const safe = doc.createElement('div');
  safe.setHTML(html);
  const unsafe = doc.createElement('div');
  unsafe.setHTMLUnsafe(html);
  return safe.innerHTML !== unsafe.innerHTML;
};

const answer = await session.prompt(prompt);
if (wasSanitized(answer)) {
  throw new Error('Unsafe output.');
}
```

</td><td>

```js
const answer = await session.prompt(prompt);
```

</td></tr>
</table>

The left has to build that helper because the Sanitizer API doesn't report what
it removed, so the only way to find out is to parse twice and compare — see
[How the sanitization works](#how-the-sanitization-works). On the right the
response is already vetted, and `prompt()` throws `UnsafeModelOutputError` when
it isn't.

### Streaming Markdown

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const stream = session.promptStreaming(prompt);
let chunks = '';
for await (const chunk of stream) {
  chunks += chunk;
  if (wasSanitized(chunks)) {
    smd.parser_end(parser);
    return;
  }
  smd.parser_write(parser, chunk);
}
smd.parser_end(parser);
```

</td><td>

```js
const stream = session.promptStreaming(prompt);
for await (const chunk of stream) {
  output.append(chunk);
}
```

</td></tr>
</table>

The check on the left runs against everything received so far, not each chunk
alone, because a tag can straddle a chunk boundary. On the right the stream
errors instead of handing you an unsafe chunk.

### Streaming HTML

`promptStreamingHTML()` runs the Markdown through a streaming parser and gives
you HTML instead. Chunks arrive at the granularity the parser works at — an
opening tag, a run of text, a closing tag — so text appears as fast as the model
produces it. A chunk is therefore _not_ a balanced fragment: `<p>` arrives
before its text and `</p>` long after. Concatenating every chunk yields the
complete, well-formed HTML.

To put it on screen, pass `into` and the DOM is built by appending nodes, so
nothing is ever re-parsed:

<!-- prettier-ignore-start -->
<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
let chunks = '';
for await (const chunk of stream) {
  chunks += chunk;
  output.innerHTML = marked.parse(chunks);
}
```

</td><td>

```js
const stream = session.promptStreamingHTML(
  prompt,
  { into: output },
);
for await (const html of stream) {
  // `html` is already in `output`.
}
```

</td></tr>
</table>
<!-- prettier-ignore-end -->

`renderStreaming()` is the same pipeline with the loop written for you, and
hands back the raw Markdown as well:

```js
const markdown = await session.renderStreaming(prompt, {
  into: output,
  onHtml: (html) => htmlView.append(html), // the chunks above
  onMarkdown: (chunk) => rawView.append(chunk), // what the model actually said
});
```

One response can drive every view this way, so showing the rendered output
beside the raw Markdown costs one inference, not two.

### Stopping a response

`signal` reaches the Prompt API unchanged on every prompting method, so an
abort cancels the inference rather than just ignoring the rest of it. Whatever
was already emitted stays valid; the stream ends with an `AbortError`, which is
worth telling apart from a real failure:

```js
const controller = new AbortController();
stopButton.onclick = () => controller.abort();

try {
  await session.renderStreaming(prompt, {
    into: output,
    signal: controller.signal,
  });
} catch (error) {
  if (error.name !== 'AbortError') throw error;
}
```

An aborted turn is not written to `history`, so what the wrapper thinks was said
does not drift from the session, which matters because `compact()` reads it.

To start over instead, destroy the session and make a new one, the same thing
the [Prompt API playground](../prompt-api-playground/) does:

```js
session.destroy();
session = await EasyLanguageModel.create(options);
```

### Compacting a long conversation

When the context window fills, the browser evicts the oldest message pairs.
Compacting is the proactive alternative: summarize the history with the
[Summarizer API](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer)
and restart the session with those summaries as `initialPrompts`, which the
browser never evicts.

By hand that means tracking every message, detecting each one's language,
summarizing it, destroying the session, building a new one, and re-registering
every listener — while keeping an untouched copy of the history in case any of
that fails. `compact()` returns
`{ before, after, saved, reduction, messages, languages }`.

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const compacted = [];
for (const message of history) {
  const lang = (await detectLanguage(message.content))
    ?? navigator.language;
  const format = looksLikeMarkdown(message.content)
    ? 'markdown'
    : 'plain-text';
  const summarizer =
    await getSummarizer(format, lang);
  compacted.push({
    role: message.role,
    content: await summarizer.summarize(
      message.content,
      { context: '…' },
    ),
  });
}
session.destroy();
session = await LanguageModel.create({
  initialPrompts: compacted,
});
session.addEventListener('contextoverflow', …);
```

</td><td>

```js
const stats = await session.compact();
```

</td></tr>
</table>

`compact()` swaps the underlying session in place: the `EasySession` object
stays valid, and listeners registered through it are re-attached. `system`
messages and non-text content pass through verbatim — a system prompt is an
instruction, not a transcript. Fenced code is kept verbatim too, so summarizing
doesn't mangle code samples. If anything fails after the old session is gone,
the untouched history is used to rebuild a working session before the error is
re-thrown.

## API

### `EasyLanguageModel`

- **`EasyLanguageModel.supported`** — whether the Prompt API exists.
- **`EasyLanguageModel.availability(options)`** — same as
  `LanguageModel.availability()`; returns `'unavailable'` when the API is
  missing rather than throwing.
- **`EasyLanguageModel.create(options)`** — returns an `EasySession`. Every
  `LanguageModel.create()` option is forwarded. In addition:

| Option                                                   | Default               | What it does                                                                                                 |
| -------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sanitizer`                                              | Sanitizer API default | `Sanitizer`, `SanitizerConfig`, `'default'`, or `false` to turn the output check off.                        |
| `ignoreFencedCode`                                       | `true`                | Exempt fenced and inline code from the check, so asking for an HTML snippet isn't flagged.                   |
| `unsafeOutput`                                           | `'throw'`             | `'throw'` or `'stop'` (end the stream quietly).                                                              |
| `onUnsafeOutput(detail)`                                 | —                     | Called on detection either way. `detail` has `output`, `sanitized`, `partialOutput`.                         |
| `onDownloadProgress({resource, loaded, total, percent})` | —                     | Download progress. `resource` is `language-model`, or `summarizer` / `language-detector` during `compact()`. |
| `onDownloadStateChange(state)`                           | —                     | `checking` → `downloadable` → `downloading` → `extracting` → `ready`.                                        |
| `progress`                                               | —                     | An `HTMLProgressElement` to drive automatically.                                                             |
| `monitor`                                                | —                     | Your own `create()` monitor. Still called; the wrapper adds its own rather than replacing yours.             |
| `userActivation`                                         | `'wait'`              | `'wait'`, `'throw'`, or `'ignore'`.                                                                          |
| `onUserActivationRequired()`                             | —                     | Your cue to reveal a button or other affordance.                                                             |
| `compact`                                                | —                     | Defaults for `session.compact()`.                                                                            |

### `EasySession`

| Member                                                                                                                                                               | Notes                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `prompt(input, options)`                                                                                                                                             | Sanitized.                                                                                                                  |
| `promptStreaming(input, options)`                                                                                                                                    | `ReadableStream` of vetted Markdown chunks.                                                                                 |
| `promptStreamingHTML(input, {into, onMarkdown, …})`                                                                                                                  | `ReadableStream` of HTML chunks at parser granularity; concatenate for the full HTML. Pass `into` to render as you consume. |
| `renderStreaming(input, {into, onHtml, onMarkdown, …})`                                                                                                              | Renders into an element token by token; resolves with the Markdown.                                                         |
| `compact(options)`                                                                                                                                                   | Returns `{before, after, saved, reduction, messages, languages}`.                                                           |
| `history`                                                                                                                                                            | The conversation as the current session sees it.                                                                            |
| `contextUsageRatio`                                                                                                                                                  | `contextUsage / contextWindow`.                                                                                             |
| `session`                                                                                                                                                            | The raw `LanguageModel`.                                                                                                    |
| `append`, `clone`, `destroy`, `measureContextUsage`, `contextUsage`, `contextWindow`, `samplingMode`, `addEventListener`, `removeEventListener`, `oncontextoverflow` | Pass-throughs.                                                                                                              |

### Errors

`UnsafeModelOutputError`, `UserActivationRequiredError`,
`LanguageModelUnavailableError`, `SanitizerUnavailableError`.

## How the sanitization works

The model's raw Markdown is what gets vetted, because that's the only part the
model authored. The Sanitizer API doesn't report what it removed, so the wrapper
parses that output twice inside a document with no browsing context — once with
`setHTML()`, once with `setHTMLUnsafe()` — and compares the two serializations.
Both go through the same parser and serializer, so any difference is something
the sanitizer took out. Because the document is inert, neither parse runs script
or fetches anything.

The HTML from `promptStreamingHTML()` needs no scrub of its own: every tag is
one the Markdown parser picked from a fixed set, all text is escaped by the DOM
serializer, and the only model-supplied values that reach an attribute are
`href` and `src`, which are scheme-checked before they're set. With no `into`
element the DOM is built in that same inert document, so an image URL the model
invented is never requested.

Four details worth knowing:

- **The check runs on the accumulated response, not on each chunk.** Dangerous
  markup can straddle a chunk boundary. A tag that's still being written is
  also held back rather than emitted, so a half-finished
  `<img src=x onerror=…` never reaches you.
- **Fenced and inline code are exempt by default.** A Markdown renderer emits
  code as text, so `<iframe>` inside a fence is displayed, not executed.
  Without this, asking the model for an HTML snippet would be flagged every
  time. Set `ignoreFencedCode: false` if you render code some other way.
- **URL schemes are checked separately.** The Sanitizer API's default
  configuration removes unsafe elements and attributes but deliberately doesn't
  filter URLs, so `[click](javascript:alert(1))` would otherwise survive.
  `href` and `src` are restricted to `http`, `https`, `mailto`, `tel`, `sms`,
  `ftp`, relative URLs, and `data:` URLs for real image types.
- **A link's URL arrives after its text.** Markdown writes `[docs](url)`, so the
  parser only knows the `href` once the token closes. Links, images, and
  task-list checkboxes are therefore emitted as one finished element rather than
  as an opening tag followed by text. They're small, so nothing visibly stalls.

## Demo

```sh
npm install
npm run dev
```

One prompt is one inference, shown three ways: the live DOM, the raw Markdown
the model produced, and the HTML chunks that built the DOM. Around that are the
download states as they happen, the user-gesture prompt, a context bar with
compact and reset, stop for a response in flight, and a button that fills in an
injection prompt so you can watch rendering stop mid-response.

## The Markdown parser

The parser in [`src/markdown-parser.js`](src/markdown-parser.js) is a vendored
copy of [streaming-markdown](https://github.com/thetarnav/streaming-markdown)
0.2.15 (MIT, Damian Tarnawski). It's here rather than in `dependencies` because
upstream is unmaintained — the last substantive commit was May 2025 and it
describes itself as an experiment — while its append-only design is exactly
what token-level streaming needs: the parser only ever emits new tokens, so a
caller can append to the DOM and never re-parse.

Measured against a CommonMark + GFM reference, the vendored copy and the
renderer fix:

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

### Known deviations

Four things are deliberately not supported, and are pinned by tests in
[`test/markdown.test.js`](test/markdown.test.js) so a future fix shows up as a
failure rather than a silent change:

- **Setext headings** (`Title` over `=====`) and **loose lists**. Both are only
  recognizable after the content they affect has already been emitted, and an
  append-only parser cannot revise what it emitted. Supporting them means
  holding every paragraph back by a line, which is the cost this design exists
  to avoid. Models use `#` headings essentially always.
- **Reference links** (`[t][r]` with a `[r]: url` definition). The definition
  can appear anywhere later in the document, so resolving it needs a second
  pass. The anchors come out without an `href`, so they render as plain text
  rather than as dead links.
- **Angle-bracket autolinks** (`<https://example.com/>`). Making `<` open a link
  risks swallowing the `<placeholder>` text that model prose is full of. Bare
  URLs and `[text](url)` links both work.
- **Table column alignment**. The reference parser emits the deprecated `align`
  attribute, which sanitizers strip anyway.

## Test

```sh
npm test
```

Runs in Node against a DOM shim, covering the Markdown pipeline (every
construct checked against a CommonMark reference at several chunk sizes),
session plumbing (user activation, download states, `compact()`, listener
re-attachment, error recovery), and download progress payloads.

Sanitization is the one thing Node can't cover, since it has no HTML Sanitizer
API. Those cases live in a page instead:

```sh
npm run dev   # then open /test/sanitizer.browser.html
```

## Build

```sh
npm run build       # library → dist/
npm run build:demo  # demo → dist-demo/
```

## Further reading

- [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- [Best practices to render streamed LLM responses](https://developer.chrome.com/docs/ai/render-llm-responses)
- [Session compacting](https://developer.chrome.com/docs/ai/session-compacting)
- [Inform users of model download](https://developer.chrome.com/docs/ai/inform-users-of-model-download)
- [User activation](https://developer.chrome.com/docs/ai/get-started#user-activation)
- [HTML Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API)

## License

Apache 2.0

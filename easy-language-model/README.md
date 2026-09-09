# Easy Language Model

A near drop-in wrapper for the Prompt API's
[`LanguageModel`](https://developer.chrome.com/docs/ai/prompt-api): same shape,
same options, same return values, with the following added.

|                                  | `LanguageModel`                                                                    | `EasyLanguageModel`                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Sanitizing output**            | Sanitize and diff every response yourself to see what was removed                  | [Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API) on `prompt()` and `promptStreaming()`, on by default |
| **Rendering HTML from Markdown** | Bring your own streaming parser                                                    | `promptStreamingHTML()` emits HTML chunks; pipe them into `renderStreamingHTML()`                                                         |
| **Markdown to HTML**             | Bring your own parser                                                              | `markdownToHtml()`, a `TransformStream` to pipe a Markdown stream through                                                                 |
| **Tool calling**                 | Run the loop yourself: read the calls, run them, feed results back, cap the rounds | `tools` with an `execute` each, and every prompting method runs the loop for you                                                          |
| **Session history**              | Bring your own transcript                                                          | `session.history`, recorded as you go, `append()` included                                                                                |
| **Long conversations**           | Manage `contextUsage` and rebuild the session yourself                             | `session.compact()`                                                                                                                       |
| **Model downloads**              | `monitor` is opt-in and easy to forget                                             | Always on, with a `<progress>` element you can hand over                                                                                  |
| **User activation**              | `create()` fails if the page has no gesture                                        | Hand over a button and it waits for a click on it, showing and hiding it for you                                                          |

Everything else is passed through untouched.

## Install

```sh
npm install easy-language-model
```

```js
import {
  EasyLanguageModel,
  renderStreamingHTML,
} from 'easy-language-model';
```

Nothing else is required: `EasyLanguageModel`'s `expectedInputs` and
`expectedOutputs` default to `[{ type: 'text', languages: ['en'] }]`.

```js
if ((await EasyLanguageModel.availability()) === 'unavailable') return;

const session = await EasyLanguageModel.create();

await session
  .promptStreamingHTML('Explain streams in one sentence.')
  .pipeTo(renderStreamingHTML(output));
```

The model writes Markdown. The `promptStreamingHTML()` method parses it into
HTML as it arrives, and `renderStreamingHTML()` appends that to the page without
re-parsing what is already there. The one-shot `promptHTML()` returns the same
HTML in one piece.

[Side by side](#side-by-side) shows each addition against the `LanguageModel`
code it replaces.

## API

### `EasyLanguageModel`

#### Statics

| `LanguageModel`         | `EasyLanguageModel`     | Difference                                                                                                                                  |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(options)`       | `create(options)`       | Installs the download monitor, and waits for a click on `activationButton` if the model has to be fetched.                                  |
| `availability(options)` | `availability(options)` | Returns `'unavailable'` when the underlying `LanguageModel` is missing, instead of throwing, so no separate feature detection is necessary. |

Calling `create()` forwards every `LanguageModel.create()` option and adds
these, in four groups:

##### Sanitizing output

| Option             | Default               | What it does                                                                                      |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------- |
| `sanitizer`        | Sanitizer API default | `Sanitizer`, `SanitizerConfig`, `'default'`, or `false` to turn the output check off.             |
| `ignoreFencedCode` | `true`                | Exempt fenced and inline code from the sanitization, so asking for an HTML snippet isn't flagged. |

##### Model downloads

| Option                                                   | Default | What it does                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `downloadProgress`                                       | —       | An `HTMLProgressElement` to drive automatically, including going indeterminate while the model is unpacked.                                                                                                                                         |
| `onDownloadProgress({resource, loaded, total, percent})` | —       | The same events as a callback, independent of `downloadProgress`: pass either, both, or neither. The `percent` field is a whole number from 0 to 100, and `resource` is `language-model`, or `summarizer` / `language-detector` during `compact()`. |

##### Tool calling

| Option                                                                | Default | What it does                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`                                                               | —       | Tools the model may call, each `{name, description, inputSchema, execute}`. Passing this adds `tool-call` and `tool-response` to the expected content types, which a tool-calling session needs and declaring `tools` does not imply. Whatever you expected yourself is kept. |
| `maxToolRounds`                                                       | `8`     | How many rounds of tool calls to allow before giving up. A round can carry several calls.                                                                                                                                                                                     |
| `onToolCall({callID, name, arguments})`                               | —       | Fires as each call is about to run.                                                                                                                                                                                                                                           |
| `onToolResponse({callID, name, arguments, ok, result, errorMessage})` | —       | Fires as each call resolves, refused ones included.                                                                                                                                                                                                                           |

##### User activation

| Option             | Default | What it does                                                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `activationButton` | —       | Hidden by default, shown when a download needs a gesture, hidden once clicked. Without one, no waiting. |
| `activationHint`   | —       | Shown and hidden with `activationButton`, for the line saying why it appeared.                          |

### Instance members

Added by the wrapper:

| Member                                | What it is                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promptHTML(input, options)`          | The whole response as HTML rather than Markdown, ready for `setHTML()`.                                                                                                                                                    |
| `promptStreamingHTML(input, options)` | That HTML as a `ReadableStream` of chunks at parser granularity. Pipe it into `renderStreamingHTML()`.                                                                                                                     |
| `compact({onStatus})`                 | Summarizes the conversation and restarts the session. The `onStatus` callback fires once per message, since each is a separate Summarizer call. Returns `{before, after, saved, reduction, percent, messages, languages}`. |
| `history`                             | The conversation as the current session sees it, which is what `compact()` summarizes.                                                                                                                                     |

Everything else is `LanguageModel`'s, and behaves the same.

### Exports

| Export                         | What it is                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EasyLanguageModel`            | The wrapper class, with `create()` and `availability()` as statics.                                                                                                                                               |
| `renderStreamingHTML(element)` | A `WritableStream` that appends HTML chunks to `element` as they arrive, building nodes with `createElement` and `append` rather than from a string, so it works where Trusted Types forbid `insertAdjacentHTML`. |
| `markdownToHtml()`             | A `TransformStream` from Markdown chunks to HTML chunks, the parser `promptStreamingHTML()` uses.                                                                                                                 |

TypeScript declarations ship with the package and resolve on import; there is
nothing to install or import separately. They pull in
[`@types/dom-chromium-ai`](https://www.npmjs.com/package/@types/dom-chromium-ai),
so `LanguageModel` and the other Prompt API globals are typed as well.

### Errors

None of its own. Everything rejects the way `LanguageModel` rejects: a missing
gesture, an unavailable model, and an aborted call all come through untouched.

Output the Sanitizer stripped throws an `OperationError`, the Prompt API's name
for a prompt that failed "for any other reason". The offending text is attached
to it, and `sanitized` distinguishes it from an `OperationError` the model
raised:

```js
try {
  output.setHTML(await session.prompt(prompt));
} catch (error) {
  if (error.name === 'OperationError' && 'sanitized' in error) {
    // The response was rejected, not the request. `output` is what the model
    // wrote, `sanitized` what survived, and on the streaming methods
    // `partialOutput` is what was handed over before the stop.
  }
}
```

## Side by side

### Creating a session

Both columns use the same three page elements: `downloadProgress`, a button to
start the download, and a line of text saying why it appeared. On the right all
three are passed by name. On the left, `waitForClick()` is a helper the caller
supplies.

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const options = {
  expectedInputs: [
    { type: 'text', languages: ['es'] },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['es'] },
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
  downloadProgress.hidden = false;
  if (!navigator.userActivation.isActive) {
    activationButton.hidden = false;
    activationHint.hidden = false;
    await waitForClick(activationButton);
    activationButton.hidden = true;
    activationHint.hidden = true;
  }
}

const session = await LanguageModel.create({
  ...options,
  monitor(m) {
    m.addEventListener(
      'downloadprogress',
      (e) => {
        downloadProgress.value = e.loaded;
        if (downloading && e.loaded === 1) {
          downloadProgress.removeAttribute('value');
        }
      },
    );
  },
});
downloadProgress.hidden = true;
```

</td><td>

```js
const options = {
  expectedInputs: [
    { type: 'text', languages: ['es'] },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['es'] },
  ],
};

const availability =
  await EasyLanguageModel.availability(options);

if (availability === 'unavailable') {
  return;
}

const session = await EasyLanguageModel.create({
  ...options,
  downloadProgress,
  activationButton,
  activationHint,
});
```

</td></tr>
</table>

On the left, `e.loaded === 1` marks the point where the bytes are in and the
browser starts unpacking the model, which takes an unknown amount of time; the
wrapper switches the indicator to indeterminate there.

The `activationButton` and `activationHint` elements are hidden from the moment
`create()` is called, shown if a gesture turns out to be needed, and hidden
again afterwards. Either both or just the button. Omit `activationButton` to
drive `create()` from a click handler of your own.

### Prompting

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

Taking the model at its word:

```js
// Dangerous: `answer` is untrusted.
const answer = await session.prompt(prompt);
output.innerHTML = answer;
```

Checking it first:

```js
const doc =
  document.implementation.createHTMLDocument();

const isUnsafe = (html) => {
  const safe = doc.createElement('div');
  safe.setHTML(html);
  const unsafe = doc.createElement('div');
  unsafe.setHTMLUnsafe(html);
  return safe.innerHTML !== unsafe.innerHTML;
};

try {
  const answer = await session.prompt(prompt);
  if (isUnsafe(answer)) {
    throw new Error('Unsafe output.');
  }
  output.setHTML(answer);
} catch (error) {
  showError(error);
}
```

</td><td>

```js
// Safe: `answer` is Sanitizer-checked
// automatically, and prompt() throws
// rather than hand back unsafe markup.
try {
  const answer = await session.prompt(prompt);
  output.setHTML(answer);
} catch (error) {
  showError(error);
}
```

</td></tr>
</table>

The left column needs a helper because the Sanitizer API does not report what
it removed: the only way to find out is to parse twice and compare. On the
right, `prompt()` throws an `OperationError` when the response would have been
stripped, carrying what the model wrote and what survived.

Both sides use `setHTML()` rather than `innerHTML`, because the check exempts
fenced code by default, so a response that passes can still carry an `<iframe>`
inside a fence. Set `ignoreFencedCode: false` to cover fences as well. See
[How the sanitization works](#how-the-sanitization-works).

### Streaming the response

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
// Check the whole response so far, not the
// chunk: a tag can straddle a boundary.
const stream = session.promptStreaming(prompt);
let chunks = '';
try {
  for await (const chunk of stream) {
    chunks += chunk;
    if (isUnsafe(chunks)) {
      throw new Error('Unsafe output.');
    }
    output.append(chunk);
  }
} catch (error) {
  showError(error);
}
```

</td><td>

```js
// Chunks are sanitized on the way past, and
// the stream errors rather than hand over
// one that isn't safe.
const stream = session.promptStreaming(prompt);
try {
  for await (const chunk of stream) {
    output.append(chunk);
  }
} catch (error) {
  showError(error);
}
```

</td></tr>
</table>

Both append the chunks as text. Turning them into HTML is the next section.

### HTML instead of Markdown

Both `promptHTML()` and `promptStreamingHTML()` are `prompt()` and
`promptStreaming()` with the Markdown run through a streaming parser, so what
you get back is HTML. The one-shot form hands over the whole response at once:

```js
// Safe as the parser escapes the model's text.
output.setHTML(await session.promptHTML(prompt));
```

The streaming form yields the same HTML as it arrives, a chunk at a time: an
opening tag, a run of text, or a closing tag. A chunk is therefore not a
balanced fragment, and `<p>` arrives before its text. Concatenated, the chunks
are the complete document.

Consuming the stream has no side effects. The `renderStreamingHTML()` sink is a
`WritableStream` that appends the chunks to an element as they arrive. The
other column uses [`marked`](https://marked.js.org/), which has to re-parse the
whole response on every chunk:

<!-- prettier-ignore-start -->
<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
// Check first, then re-parse and re-render
// the whole response on every chunk.
let chunks = '';
try {
  for await (const chunk of stream) {
    chunks += chunk;
    if (isUnsafe(chunks)) {
      throw new Error('Unsafe output.');
    }
    output.innerHTML = marked.parse(chunks);
  }
} catch (error) {
  showError(error);
}
```

</td><td>

```js
// Safe as the parser escapes the model's text.
try {
  await session
    .promptStreamingHTML(prompt)
    .pipeTo(renderStreamingHTML(output));
} catch (error) {
  showError(error);
}
```

</td></tr>
</table>
<!-- prettier-ignore-end -->

The response is a stream, so a `TransformStream` in the middle sees each HTML
chunk on its way to the page:

```js
await session
  .promptStreamingHTML(prompt)
  .pipeThrough(
    new TransformStream({
      transform(html, sink) {
        htmlView.append(html);
        sink.enqueue(html);
      },
    })
  )
  .pipeTo(renderStreamingHTML(output));
```

To show the rendered output beside the raw Markdown, `tee()` the response and
run one branch through `markdownToHtml()`, the transform
`promptStreamingHTML()` uses internally. Both views then come from one
inference:

```js
import {
  EasyLanguageModel,
  markdownToHtml,
  renderStreamingHTML,
} from 'easy-language-model';

const [rawBranch, htmlBranch] = session.promptStreaming(prompt).tee();

await Promise.all([
  (async () => {
    for await (const chunk of rawBranch) {
      rawView.append(chunk);
    }
  })(),
  htmlBranch.pipeThrough(markdownToHtml()).pipeTo(renderStreamingHTML(output)),
]);
```

### Calling tools

Hand over each tool with its `execute` attached; the wrapper strips that before
the declaration reaches the Prompt API. Every prompting method then runs the
loop and hands you the answer.

The content types a tool-calling session needs are added too, since declaring
`tools` implies none of them: `tool-response` so results are accepted at all,
and `tool-call` as an input so a conversation carrying one can be replayed,
which is what `compact()` does. Your own expectations are kept, and
`availability()` gets the same additions, so it can't ask about a different
session from the one `create()` builds.

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
const options = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },
    { type: 'tool-response' },
    { type: 'tool-call' },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['en'] },
    { type: 'tool-call' },
  ],
  tools: [declarationOf(getWeather)],
};
if ((await LanguageModel.availability(options))
    === 'unavailable') return;
const session = await LanguageModel.create(options);

let result = await session.prompt(question);
let rounds = 0;

while (Array.isArray(result)) {
  const calls = result
    .filter((part) => part.type === 'tool-call')
    .map((part) => part.value);
  if (!calls.length) break;
  if (++rounds > MAX_ROUNDS) {
    throw new Error('No answer.');
  }

  const content = [];
  for (const call of calls) {
    status.textContent = `Calling ${call.name}…`;
    // Dispatch, check the arguments, catch the
    // throw, strip the nulls, wrap the result in
    // a LanguageModelToolSuccess or ToolError…
    const part = await runTool(call);
    log(part.value.errorMessage ?? part.value.result);
    content.push(part);
  }
  result = await session.prompt([
    { role: 'user', content },
  ]);
}

const answer =
  typeof result === 'string'
    ? result
    : result
        .filter((p) => p.type === 'text')
        .map((p) => p.value)
        .join('');
```

</td><td>

```js
const options = { tools: [getWeather] };
if ((await EasyLanguageModel.availability(options))
    === 'unavailable') return;
const session = await EasyLanguageModel.create({
  ...options,
  onToolCall: ({ name }) =>
    (status.textContent = `Calling ${name}…`),
  onToolResponse: ({ result, errorMessage }) =>
    log(errorMessage ?? result),
});

const answer = await session.prompt(question);
```

</td></tr>
</table>

A round's calls run at once, so a round costs the slowest tool rather than the
sum, and `onToolResponse` fires in completion order. What the model receives
stays in the order it asked: Chrome sends an empty `callID` today, so position
is all it has to match a result to a request. Pair on name and arguments in
your own UI for the same reason.

An invented tool, a missing required argument, and a repeat of a call already
answered are each refused before `execute` runs. The `onToolResponse` callback
is the only place those are visible.

The streaming methods yield only text; tool calls are consumed on the way past.
One Markdown parser spans every round, so a tool call part-way through a
sentence does not start a second document.

```js
await session
  .promptStreamingHTML('What is the weather in Hamburg?')
  .pipeTo(renderStreamingHTML(output));
```

The `maxToolRounds` option caps the loop at eight rounds by default, counted in
rounds rather than calls, since one round can carry several. On the last
permitted round the results go back with a note that no more tools are coming.
If the model asks again after that, the prompt throws an `OperationError`
carrying `toolRounds` and the `toolCalls` it was still asking for.

### Stopping a response

A `signal` reaches the Prompt API unchanged on every prompting method, so an
abort cancels the inference rather than ignoring the rest of it. What was
already emitted stays valid, and the stream ends with an `AbortError`:

```js
const controller = new AbortController();
stopButton.onclick = () => controller.abort();

try {
  await session
    .promptStreamingHTML(prompt, { signal: controller.signal })
    .pipeTo(renderStreamingHTML(output));
} catch (error) {
  if (error.name !== 'AbortError') throw error;
}
```

An aborted turn is not written to `history`, which `compact()` reads.

To start over instead, destroy the session and make a new one:

```js
session.destroy();
session = await EasyLanguageModel.create(options);
```

### Compacting a long conversation

The `compact()` method summarizes the history with the
[Summarizer API](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer)
and restarts the session with the summaries as `initialPrompts`, which the
browser does not evict. The `contextoverflow` event is the cue to call it.

It returns `{ before, after, saved, reduction, percent, messages, languages }`,
where `before` and `after` each hold a `contextUsage` and a `contextWindow`.
The existing `session` stays usable.

<table>
<tr><th>Prompt API</th><th>EasyLanguageModel</th></tr>
<tr valign="top"><td>

```js
session.addEventListener(
  'contextoverflow',
  onOverflow,
);

async function onOverflow() {
  const compacted = [];
  for (const message of history) {
    const lang =
      (await detectLanguage(message.content))
      ?? navigator.language;
    const format =
      looksLikeMarkdown(message.content)
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
  // The replacement has no listeners.
  session.addEventListener(
    'contextoverflow',
    onOverflow,
  );
}
```

</td><td>

```js
session.oncontextoverflow = async () => {
  const stats = await session.compact();
  console.log(
    `Compacted ${stats.messages} messages, ` +
      `${stats.before.contextUsage} → ${stats.after.contextUsage} tokens ` +
      `(${stats.percent}% smaller), ` +
      `languages: ${stats.languages.join(', ')}`,
  );
};
```

</td></tr>
</table>

Each message is summarized in the language it was written in, which brings in
the
[Language Detector API](https://developer.mozilla.org/en-US/docs/Web/API/LanguageDetector).
Both it and the Summarizer are separate models, so the first `compact()` on a
device may have two downloads to wait for. The `onDownloadProgress` passed to
`create()` reports them, with `resource` naming which is arriving:

```js
const session = await EasyLanguageModel.create({
  ...options,
  onDownloadProgress({ resource, percent }) {
    // 'language-model' while create() runs, then 'summarizer' and
    // 'language-detector' the first time compact() does.
    status.textContent = `Downloading ${resource}: ${percent}%`;
  },
});
```

Both are fetched once and reused, so later calls download nothing.

Compaction swaps the underlying session in place: the `EasyLanguageModel` stays
valid and listeners registered through it are re-attached. Messages with the
`system` role, non-text content, and fenced code pass through verbatim. If
anything fails after the old session is gone, the untouched history rebuilds a
working session before the error is re-thrown.

## How the sanitization works

All four prompting methods return output that is safe to put on a page. Only
two of them use the Sanitizer API to get there.

The `prompt()` and `promptStreaming()` methods return a string whose destination
is unknown: escaping the markup would be correct for `setHTML()` and wrong for
`textContent` or JSON. They return the response unaltered, run it through the
Sanitizer API to determine whether anything would have been stripped, and throw
if so.

The `promptHTML()` and `promptStreamingHTML()` methods do not call the
Sanitizer. Their output is HTML the parser built: text is escaped, tags come
from the parser's own set, and an `href` or `src` with an unsafe scheme is
dropped. Model markup arrives as visible text rather than elements.

<details>
<summary>How the check works, and four details</summary>

The model's raw Markdown is what gets checked. The Sanitizer API does not report
what it removed, so the wrapper parses the output twice inside a document with
no browsing context, once with `setHTML()` and once with `setHTMLUnsafe()`, and
compares the serializations; any difference is what the sanitizer took out. The
document is inert, so neither parse runs script or fetches anything, and the
HTML methods build their DOM there too.

- **The check runs on the accumulated response, not on each chunk**, because
  dangerous markup can straddle a boundary. A tag still being written is held
  back too, so a half-finished `<img src=x onerror=…` never reaches you.
- **Fenced and inline code are exempt by default**, since a Markdown renderer
  shows code as text rather than running it. Without this, asking for an HTML
  snippet would be flagged every time. Set `ignoreFencedCode: false` if you
  render code some other way.
- **URL schemes are checked separately.** The Sanitizer API's default
  configuration removes unsafe elements and attributes but deliberately doesn't
  filter URLs, so `href` and `src` are restricted to `http`, `https`, `mailto`,
  `tel`, `sms`, `ftp`, relative URLs, and `data:` URLs for real image types.
- **A link's URL arrives after its text.** Markdown writes `[docs](url)`, so the
  `href` is only known once the element closes. Links, images, and task-list
  checkboxes are held back until then, and still arrive as separate tag and
  text chunks rather than as one balanced fragment.

</details>

## Demo

```sh
npm install
npm run dev
```

Three tools are wired up, on APIs that need no key: geocoding and weather from
[Open-Meteo](https://open-meteo.com/) and currency rates from
[Frankfurter](https://frankfurter.dev/). Looking a city up and reading the
weather are separate tools on purpose, so the model has to chain them and the
rounds are visible; a real app would rather have the one tool that takes a
place name. Asking about two cities and a conversion runs several calls over a
couple of rounds, and the page contains no loop: `onToolCall` is the only
tool-related line in it.

One prompt is one inference, shown three ways: the raw Markdown, the HTML
chunks parsed from it, and the rendered result. Around that are the
availability check and download progress as they happen, the user-gesture
prompt, a context bar with
compact and reset, stop for a response in flight, and a button that fills in an
injection prompt so you can watch the markup arrive as text rather than as
elements.

## Test

```sh
npm test
```

Runs in Node against a DOM shim, covering session plumbing (user activation,
the progress element, `compact()`, listener re-attachment, error recovery),
download progress payloads, and the tool-calling loop. The Markdown pipeline
has its own suite, in
[`streaming-markdown-html`](../streaming-markdown-html/), where every construct
checked against a CommonMark reference at several chunk sizes.

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

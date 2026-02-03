# Built-in AI Task APIs Polyfills

This package provides browser polyfills for the
[Built-in AI Task APIs](https://github.com/webmachinelearning/built-in-ai-task-apis),
specifically:

- **Summarizer API**
- **Writer API**
- **Rewriter API**

These polyfills are backed by the
[`prompt-api-polyfill`](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/built-in-ai-task-apis-polyfills),
meaning they support the same dynamic backends:

- **Firebase AI Logic** (cloud)
- **Google Gemini API** (cloud)
- **OpenAI API** (cloud)
- **Transformers.js** (local after initial model download)

When loaded in the browser, they define globals:

```js
window.Summarizer;
window.Writer;
window.Rewriter;
```

so you can use these Task APIs even in environments where they are not yet
natively available.

---

## Supported Backends

The polyfills use `prompt-api-polyfill` under the hood. You can configure the
backend by setting specific global variables on `window`.

### Firebase AI Logic (cloud)

- **Select by setting**: `window.FIREBASE_CONFIG`.

### Google Gemini API (cloud)

- **Select by setting**: `window.GEMINI_CONFIG`.

### OpenAI API (cloud)

- **Select by setting**: `window.OPENAI_CONFIG`.

### Transformers.js (local after initial model download)

- **Select by setting**: `window.TRANSFORMERS_CONFIG`.

---

## Installation

Install from npm:

```bash
npm install built-in-ai-task-apis-polyfills
```

## Quick start

### Recommended Loading Strategy

To ensure your app uses the native implementation when available, use a
defensive dynamic import strategy:

```html
<script type="module">
  import config from './.env.json' with { type: 'json' };

  // Example: Use Gemini backend
  window.GEMINI_CONFIG = config;

  // Load polyfills only if not natively supported
  const polyfills = [];
  if (!('Summarizer' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/summarizer'));
  }
  if (!('Writer' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/writer'));
  }
  if (!('Rewriter' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/rewriter'));
  }
  await Promise.all(polyfills);

  // Now you can use the APIs
  if ((await Summarizer.availability()) === 'available') {
    const summarizer = await Summarizer.create();
    const summary = await summarizer.summarize('Long text to summarize...');
    console.log(summary);
  }
</script>
```

### API Usage Examples

#### Summarizer API

```js
const summarizer = await Summarizer.create({
  type: 'key-points',
  format: 'markdown',
  length: 'short',
});

const result = await summarizer.summarize(text);
// or streaming
const stream = summarizer.summarizeStreaming(text);
for await (const chunk of stream) {
  console.log(chunk);
}
```

#### Writer API

```js
const writer = await Writer.create({
  tone: 'professional',
  format: 'plain-text',
});

const result = await writer.write('Draft of an email to my boss');
```

#### Rewriter API

```js
const rewriter = await Rewriter.create({
  tone: 'casual',
});

const result = await rewriter.rewrite('I am writing to inform you that...');
```

---

## Configuration

### Configuring `.env.json`

This repo ships with a `dot_env.json` template. Copy it to `.env.json` and fill
in your credentials:

```bash
cp dot_env.json .env.json
```

The polyfill will look for these configurations on the `window` object. Adjust
your loading logic to pass the JSON content to the appropriate global (e.g.,
`window.GEMINI_CONFIG`).

---

## API surface

Once the polyfills are loaded, you can use them as described in the official
documentation:

- [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api)
- [Writer and Rewriter APIs](https://developer.chrome.com/docs/ai/writer-rewriter-api)

For complete examples, see:

- [`demo_summarizer.html`](demo_summarizer.html)
- [`demo_writer.html`](demo_writer.html)
- [`demo_rewriter.html`](demo_rewriter.html)

---

## Running the demos locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy and fill in your config:
   ```bash
   cp dot_env.json .env.json
   ```
3. Start the server:
   ```bash
   npm start
   ```

---

## Testing

The project includes a comprehensive test suite based on Web Platform Tests
(WPT).

### Running Browser Tests

```bash
npm run test:browser
```

### Running WPT

```bash
npm run test:wpt
```

---

## License

Apache 2.0

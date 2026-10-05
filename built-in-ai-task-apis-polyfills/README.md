# Built-in AI Task APIs Polyfills

This package provides browser polyfills for the
[Built-in AI Task APIs](https://developer.chrome.com/docs/ai/built-in-apis),
specifically:

- **Summarizer API**
- **Writer API**
- **Rewriter API**
- **Language Detector API**
- **Translator API**
- **SemanticEmbedder API**
- **DecisionModel API**

> [!WARNING]
>
> The Writer and Rewriter APIs are deprecated. Their polyfills remain for
> existing code, but don't build new features on them.

The Summarizer, Writer, Rewriter, Language Detector, and Translator polyfills
are backed by the
[`prompt-api-polyfill`](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/prompt-api-polyfill),
which is automatically loaded if `window.LanguageModel` is not detected. This
means they support the same
[dynamic backends](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/prompt-api-polyfill#supported-backends).

The SemanticEmbedder polyfill is backed by
[EmbeddingGemma 300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)
— the same model Chrome's built-in SemanticEmbedder API uses on-device — running
in-browser via
[`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) (a
peer dependency you must install separately).

The DecisionModel polyfill implements the proposed
[Decisions API](https://github.com/explainers-by-googlers/decisions-api) with
one of two in-browser decision model runtimes, which you pick through
`window.DECISION_MODEL_CONFIG`:
[Laya](https://github.com/johnhenry/laya-js/blob/main/packages/laya/README.md)
(the default) or [open-jev](https://github.com/nico-martin/open-jev). Both are
regular dependencies of this package, and neither ships model weights: models
download from the Hugging Face Hub on first use.

When loaded in the browser, they define globals:

```js
window.Summarizer;
window.Writer;
window.Rewriter;
window.LanguageDetector;
window.Translator;
window.SemanticEmbedder;
window.DecisionModel;
```

so you can use these Task APIs even in environments where they are not yet
natively available.

## Installation

Install from npm:

```bash
npm install built-in-ai-task-apis-polyfills
```

If you use the **SemanticEmbedder** polyfill, also install the peer dependency:

```bash
npm install @huggingface/transformers
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
  if (!('LanguageDetector' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/language-detector'));
  }
  if (!('Translator' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/translator'));
  }
  if (!('SemanticEmbedder' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/semantic-embedder'));
  }
  if (!('DecisionModel' in window)) {
    polyfills.push(import('built-in-ai-task-apis-polyfills/decision-model'));
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
  tone: 'formal',
  format: 'plain-text',
});

const result = await writer.write(
  'Draft of an email to my boss telling her I will be late.',
);
```

#### Rewriter API

```js
const rewriter = await Rewriter.create({
  tone: 'more-casual',
});

const result = await rewriter.rewrite(
  'I am writing to inform you that I will be late.',
);
```

#### Language Detector API

```js
const detector = await LanguageDetector.create();
const results = await detector.detect("C'est la vie");

for (const { detectedLanguage, confidence } of results) {
  console.log(`${detectedLanguage} (${(confidence * 100).toFixed(1)}%)`);
}
```

#### Translator API

```js
const translator = await Translator.create({
  sourceLanguage: 'en',
  targetLanguage: 'fr',
});

const result = await translator.translate('Hello world');
```

#### SemanticEmbedder API

Backed by
[EmbeddingGemma 300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)
via `@huggingface/transformers`. The model (~420 MB) is downloaded and cached in
the browser on first use.

```js
const embedder = await SemanticEmbedder.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Download progress: ${Math.round(e.loaded * 100)}%`);
    });
  },
});

// Embed a single text
const { embeddings, metadata } = await embedder.embed('Hello world');
console.log(embeddings[0].values); // Float32Array of 768 values

// Every embedding reports what the model actually saw, and the result carries
// the space the vectors live in plus the input ceiling. Inputs longer than
// `metadata.maxInputTokens` are truncated rather than rejected, so check
// `truncated` if you need to chunk instead of losing the tail.
console.log(embeddings[0].statistics); // { tokenCount: 4, truncated: false }
console.log(metadata); // { embeddingSpace: 'embeddinggemma-300m', maxInputTokens: 2047 }

// Semantic search: embed query and corpus with appropriate task prefixes.
// Supported taskType values: 'semantic-similarity', 'retrieval-query',
// 'retrieval-document', 'classification', 'clustering'. If omitted, the raw
// string is embedded as-is with no prefix.
const [queryResult, docsResult] = await Promise.all([
  embedder.embed('What is machine learning?', { taskType: 'retrieval-query' }),
  embedder.embed(['AI transforms software.', 'Paris is in France.'], {
    taskType: 'retrieval-document',
  }),
]);

const queryVec = queryResult.embeddings[0].values;

// cosineSimilarity() isn't part of the API, so compute it yourself.
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const scores = docsResult.embeddings.map((e) =>
  cosineSimilarity(queryVec, e.values),
);
```

#### DecisionModel API

Define a schema of `boolean`, `choice`, and `score` questions, then ask the
model to decide all of them for an input in a single forward pass. Every answer
is one of the options you defined.

```js
const schema = {
  context: 'Document editor command palette',
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  questions: [
    {
      id: 'command',
      type: 'choice',
      prompt: "Which command best fulfills the user's goal?",
      options: [
        { label: 'export_pdf', description: 'Download or save as a PDF' },
        { label: 'share_link', description: 'Invite collaborators' },
        { label: 'archive_doc', description: 'Move to trash or archive' },
      ],
    },
    {
      id: 'urgent',
      type: 'boolean',
      prompt: 'Does the user need this done right away?',
    },
  ],
};

if ((await DecisionModel.availability(schema)) !== 'unavailable') {
  const model = await DecisionModel.create({
    ...schema,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        console.log(`Download progress: ${Math.round(e.loaded * 100)}%`);
      });
    },
  });

  const { command } = await model.decide('let my coworkers view this file');
  // command: { id: 'command', label: 'share_link', confidence,
  //            probabilities: [{ label, probability }, …] }
  if (command.confidence > 0.6) {
    runCommand(command.label);
  }
  model.destroy();
}
```

Each result reports the winning `label`, its probability as `confidence`, and
the `probabilities` of all options in schema order. `boolean` questions use the
labels `'true'` and `'false'`, and their results add `probability`, which is
always P(`'true'`). `score` questions default to the options `'1'` to `'5'` when
they define none, and their results add `expectedScore`. When all labels of a
`score` question are numbers, `expectedScore` is weighted by those numbers.
Otherwise it's weighted by each option's 1-based position. The polyfill rounds
all values to four decimals.

`decide()` throws a `QuotaExceededError` when the input doesn't fit into the
model's context window next to the questions, and doesn't truncate the input. It
accepts a `signal` to abort the call.

---

## Configuration

### Configuring the DecisionModel backend

Set `window.DECISION_MODEL_CONFIG` before calling `DecisionModel.create()`. All
fields are optional.

```js
window.DECISION_MODEL_CONFIG = {
  backend: 'open-jev', // 'laya' (default) or 'open-jev'
};
```

| Field       | `open-jev`                                                               | `laya`                                                                  |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `model`     | `'kev-0.6b'` (default, ~0.4 GB), `'kev-4b'`, `'open-jev'`, or a Hub repo | A Hub repo id or base URL, default `'convaiinnovations/laya'` (~0.8 GB) |
| `dtype`     | `'auto'` (default), `'fp32'`, `'fp16'`, `'q4'`, `'q4f16'`                | `'f16'` (default) or `'f32'`                                            |
| `device`    | `'auto'` (default), `'webgpu'`, or `'wasm'`                              | `'auto'` (default), `'webgpu'`, or `'cpu'`                              |
| `subfolder` | n/a                                                                      | Checkpoint folder inside the repo                                       |
| `revision`  | n/a                                                                      | Branch, tag, or commit, default `'main'`                                |

The open-jev models are English-only, so `availability()` reports
`'unavailable'` for schemas that expect other languages. It does the same
without WebGPU for the default models, because their 4-bit weights don't run on
onnxruntime-web's WebAssembly backend. With Laya's default repo, schemas that
expect languages other than English use its multilingual checkpoint
(`subfolder: 'multilingual'`, ~0.6 GB). Without WebGPU, Laya falls back to its
CPU backend. That backend runs everywhere and takes several seconds per
decision.

open-jev caches models through Transformers.js and shares them across origins
when the Cross-Origin Storage extension is installed. Laya caches models in the
Cache API of the page's origin.

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
- [Writer API](https://developer.chrome.com/docs/ai/writer-api)
- [Rewriter API](https://developer.chrome.com/docs/ai/rewriter-api)
- [Language Detector API](https://developer.chrome.com/docs/ai/language-detection-api)
- [Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [SemanticEmbedder API](https://github.com/explainers-by-googlers/embedding-api)
- [DecisionModel API](https://github.com/explainers-by-googlers/decisions-api)

For complete examples, see:

- [`demo-summarizer.html`](demo-summarizer.html)
- [`demo-writer.html`](demo-writer.html)
- [`demo-rewriter.html`](demo-rewriter.html)
- [`demo-language-detector.html`](demo-language-detector.html)
- [`demo-translator.html`](demo-translator.html)
- [`demo-semantic-embedder.html`](demo-semantic-embedder.html)
- [`demo-decision-model.html`](demo-decision-model.html)

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

```bash
npm run test:wpt
```

---

## License

Apache 2.0

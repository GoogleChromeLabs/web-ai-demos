# Prompt API Polyfill (Firebase AI Logic backend)

This package provides a browser polyfill for the
[Prompt API `LanguageModel`](https://github.com/webmachinelearning/prompt-api)
backed by **Firebase AI Logic**.

When loaded in the browser, it defines a global:

```js
window.LanguageModel;
```

so you can use the Prompt API shape even in environments where it is not yet
natively available.

- Back end: Firebase AI Logic
- Default model: `gemini-2.5-flash-lite` (configurable via `modelName`)

---

## Installation

Install from npm:

```bash
npm install prompt-api-polyfill
```

## Quick start

1. **Create a Firebase project with Generative AI enabled** (see Configuration
   below).
2. **Provide your Firebase config** on `window.FIREBASE_CONFIG`.
3. **Import the polyfill** so it can attach `window.LanguageModel`.

### Example (using a JSON config file)

Create a `.env.json` file (see
[Configuring `dot_env.json` / `.env.json`](#configuring-dot_envjson--envjson))
and then use it from a browser entry point:

```html
<script type="module">
  import firebaseConfig from './.env.json' with { type: 'json' };

  // Make the config available to the polyfill
  window.FIREBASE_CONFIG = firebaseConfig;

  // Only load the polyfill if LanguageModel is not available natively
  if (!('LanguageModel' in window)) {
    await import('prompt-api-polyfill');
  }

  const session = await LanguageModel.create();
  const text = await session.prompt('Say hello from the polyfill!');
  console.log(text);
</script>
```

> **Note**: The polyfill attaches `LanguageModel` to `window` as a side effect.
> There are no named exports.

### Example based on `index.html` in this repo

The included `index.html` demonstrates the full surface area of the polyfill,
including:

- `LanguageModel.create()` with options
- `prompt()` and `promptStreaming()`
- Multimodal inputs (text, image, audio)
- `append()` and `measureInputUsage()`
- Quota handling via `onquotaoverflow`
- `clone()` and `destroy()`

A simplified version of how it is wired up:

```html
<script type="module">
  import firebaseConfig from './.env.json' with { type: 'json' };
  window.FIREBASE_CONFIG = firebaseConfig;

  // Load the polyfill only when necessary
  if (!('LanguageModel' in window)) {
    await import('prompt-api-polyfill');
  }

  const controller = new AbortController();
  const session = await LanguageModel.create();

  try {
    const stream = session.promptStreaming('Write me a very long poem', {
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      console.log(chunk);
    }
  } catch (error) {
    console.error(error);
  }
</script>
```

---

## Configuring `dot_env.json` / `.env.json`

This repo ships with a template file:

```jsonc
// dot_env.json
{
  "apiKey": "",
  "projectId": "",
  "appId": "",
  "modelName": "",
}
```

You should treat `dot_env.json` as a **template** and create a real `.env.json`
that is **not committed** with your secrets.

### 1. Create `.env.json`

Copy the template:

```bash
cp dot_env.json .env.json
```

Then open `.env.json` and fill in the values from your Firebase project:

```json
{
  "apiKey": "YOUR_FIREBASE_WEB_API_KEY",
  "projectId": "your-gcp-project-id",
  "appId": "YOUR_FIREBASE_APP_ID",
  "modelName": "gemini-2.5-flash-lite"
}
```

### 2. Field-by-field explanation

- `apiKey` Your **Firebase Web API key**. You can find this in the Firebase
  Console under: _Project settings → General → Your apps → Web app_.

- `projectId` The **GCP / Firebase project ID**, e.g. `my-ai-project`.

- `appId` The **Firebase Web app ID**, e.g. `1:1234567890:web:abcdef123456`.

- `modelName` (optional) The Gemini model ID to use. If omitted, the polyfill
  defaults to:

  ```json
  "modelName": "gemini-2.5-flash-lite"
  ```

  You can substitute another supported Gemini model here if desired.

These fields are passed directly to:

- `initializeApp(firebaseConfig)` from Firebase
- `getAI(app, { backend: new GoogleAIBackend() })` from the Firebase AI SDK

and `modelName` is used to select which Gemini model to call.

> **Important:** Do **not** commit a real `.env.json` with production
> credentials to source control. Use `dot_env.json` as the committed template
> and keep `.env.json` local.

### 3. Wiring the config into the polyfill

Once `.env.json` is filled out, you can import it and expose it to the polyfill
exactly like in `index.html`:

```js
import firebaseConfig from './.env.json' with { type: 'json' };

window.FIREBASE_CONFIG = firebaseConfig;

if (!('LanguageModel' in window)) {
  await import('prompt-api-polyfill');
}
```

From this point on, `LanguageModel.create()` will use your Firebase
configuration.

---

## API surface

Once the polyfill is loaded and `window.LanguageModel` is available, you can use
it as described in the
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api).

For a complete, end-to-end example, see the `index.html` file in this directory.

---

## Running the demo locally

1. Install dependencies and this package (if using the npm-installed version in
   another project):

   ```bash
   npm install
   ```

2. Copy and fill in your config:

   ```bash
   cp dot_env.json .env.json
   # then edit .env.json with your Firebase and model settings
   ```

3. Serve `index.html`:

   ```bash
   npm start
   ```

You should see network requests to the Vertex AI / Firebase AI backend and
streaming responses logged in the console.

## License

Apache 2.0

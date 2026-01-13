# Prompt API Polyfill

This package provides a browser polyfill for the
[Prompt API `LanguageModel`](https://github.com/webmachinelearning/prompt-api),
supporting dynamic backends:

- **Firebase AI Logic**
- **Google Gemini API**

When loaded in the browser, it defines a global:

```js
window.LanguageModel;
```

so you can use the Prompt API shape even in environments where it is not yet
natively available.

## Supported Backends

### 1. Firebase AI Logic (Default)
- **Uses**: `firebase/ai` SDK.
- **Config**: Requires `window.FIREBASE_CONFIG`.
- **Default Model**: `gemini-2.5-flash-lite`.

### 2. Google Gemini API
- **Uses**: `@google/generative-ai` SDK.
- **Config**: Requires `window.GEMINI_CONFIG`.
- **Default Model**: `gemini-2.0-flash-lite-preview-02-05`.

---

## Installation

Install from npm:

```bash
npm install prompt-api-polyfill
```

## Quick start

### Backed by Firebase

1. **Create a Firebase project with Generative AI enabled**.
2. **Provide your Firebase config** on `window.FIREBASE_CONFIG`.
3. **Import the polyfill**.

```html
<script type="module">
  import firebaseConfig from './.env.json' with { type: 'json' };
  window.FIREBASE_CONFIG = firebaseConfig;

  if (!('LanguageModel' in window)) {
    await import('prompt-api-polyfill');
  }

  const session = await LanguageModel.create();
</script>
```

### Backed by Gemini API

1. **Get a Gemini API Key** from [Google AI Studio](https://aistudio.google.com/).
2. **Provide your API Key** on `window.GEMINI_CONFIG`.
3. **Import the polyfill**.

```html
<script type="module">
  // NOTE: Do not expose real keys in production source code!
  window.GEMINI_CONFIG = "YOUR_GEMINI_CONFIG";

  if (!('LanguageModel' in window)) {
    await import('prompt-api-polyfill');
  }

  // Uses Gemini backend because GEMINI_CONFIG is present
  const session = await LanguageModel.create();
</script>
```

Alternatively, pass the key via options:

```js
const session = await LanguageModel.create({
  apiKey: "YOUR_GEMINI_CONFIG"
});
```

---

## Configuration

### Example (using a JSON config file)

Create a `.env.json` file (see
[Configuring `dot_env.json` / `.env.json`](#configuring-dot_envjson--envjson))
and then use it from a browser entry point.

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
  import config from './.env.json' with { type: 'json' };
  
  // Decide backend based on config content
  if (config.apiKey && !config.projectId) {
     window.GEMINI_CONFIG = config.apiKey;
  } else {
     window.FIREBASE_CONFIG = config;
  }

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
  // For Firebase:
  "projectId": "",
  "appId": "",
  "modelName": "",
  
  // For Firebase OR Gemini:
  "apiKey": "" 
}
```

You should treat `dot_env.json` as a **template** and create a real `.env.json`
that is **not committed** with your secrets.

### 1. Create `.env.json`

Copy the template:

```bash
cp dot_env.json .env.json
```

Then open `.env.json` and fill in the values.

**For Firebase:**
```json
{
  "apiKey": "YOUR_FIREBASE_WEB_API_KEY",
  "projectId": "your-gcp-project-id",
  "appId": "YOUR_FIREBASE_APP_ID",
  "modelName": "gemini-2.5-flash-lite"
}
```

**For Gemini:**
```json
{
  "apiKey": "YOUR_GEMINI_CONFIG",
  "modelName": "gemini-2.0-flash-lite-preview-02-05" 
}
```

### 2. Field-by-field explanation

- `apiKey`: 
  - **Firebase**: Your Firebase Web API key.
  - **Gemini**: Your Gemini API Key.
  
- `projectId` / `appId`: **Firebase only**.

- `modelName` (optional): The model ID to use. 
  - Default Firebase: `gemini-2.5-flash-lite`
  - Default Gemini: `gemini-2.0-flash-lite-preview-02-05`

> **Important:** Do **not** commit a real `.env.json` with production
> credentials to source control. Use `dot_env.json` as the committed template
> and keep `.env.json` local.

### 3. Wiring the config into the polyfill

Once `.env.json` is filled out, you can import it and expose it to the polyfill.
See the [Quick start](#quick-start) examples above.

---

## API surface

Once the polyfill is loaded and `window.LanguageModel` is available, you can use
it as described in the
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api).

For a complete, end-to-end example, see the `index.html` file in this directory.

---

## Running the demo locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy and fill in your config:
   ```bash
   cp dot_env.json .env.json
   ```

3. Serve `index.html`:
   ```bash
   npm start
   ```

You should see network requests to the backends logs.

## License

Apache 2.0

# Built-in AI Extension

A Chrome extension that injects polyfills for the built-in AI APIs, namely
`LanguageModel`, `Summarizer`, `Writer`, etc.

## Features

- **Early Injection**: Polyfills are injected at `document_start` in the `MAIN`
  world.
- **Configurable Backends**: Choose between Gemini, OpenAI, Firebase, and
  Transformers.js.
- **Force Injection**: Option to overwrite native APIs even if they are present.
- **Developer Friendly**: Easily enter your API keys and configuration in the
  Options page.

## Privacy

The privacy of your data is a top priority. Depending on your chosen backend, AI
processing can happen entirely locally or via cloud providers. See our
[Privacy Policy](PRIVACY.md) for full details on data handling and required
permissions.

## Installation

1. Clone this repository.
2. Run `npm install`.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable "Developer mode".
5. Click "Load unpacked" and select the extension directory.

## Configuration

Right-click the extension icon and select **Options** to configure your
preferred backend and API keys.

## Development

- `npm run format`: Format the code using Prettier.
- `npm run lint`: Check the code formatting.
- `./zip-extension.sh`: Package the extension into a zip file for distribution.

## Publishing

`publish-extension.mjs` builds the extension and submits it to the Chrome Web
Store through the
[Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api),
authenticating as a
[service account](https://developer.chrome.com/docs/webstore/service-accounts)
linked to the publisher. Copy `.env.example` to `.env` and fill in the
credentials, then bump the version in both `public/manifest.json` and
`package.json`.

```sh
npm run release -- --status   # check credentials and what the store has
npm run release -- --dry-run  # build and check the version, upload nothing
npm run release               # upload and submit for review
```

Pass `--staged` to hold the release after approval and publish it later from the
Developer Dashboard.

## Credits

Uses the following polyfills:

- [prompt-api-polyfill](https://www.npmjs.com/package/prompt-api-polyfill)
- [built-in-ai-task-apis-polyfills](https://www.npmjs.com/package/built-in-ai-task-apis-polyfills)

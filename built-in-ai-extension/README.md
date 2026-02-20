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

## Credits

Uses the following polyfills:

- [prompt-api-polyfill](https://www.npmjs.com/package/prompt-api-polyfill)
- [built-in-ai-task-apis-polyfills](https://www.npmjs.com/package/built-in-ai-task-apis-polyfills)

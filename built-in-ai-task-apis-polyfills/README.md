# Built-in AI Task APIs Polyfills

Polyfills for the [Built-in AI Task APIs](https://github.com/webmachinelearning/writing-assistance-apis).

Current APIs supported:
- [Summarizer API](https://github.com/webmachinelearning/writing-assistance-apis/blob/main/summarizer-api.md)

Planned APIs:
- [Writer API](https://github.com/webmachinelearning/writing-assistance-apis/blob/main/writer-api.md)
- [Rewriter API](https://github.com/webmachinelearning/writing-assistance-apis/blob/main/rewriter-api.md)

## Installation

```bash
npm install built-in-ai-task-apis-polyfills
```

## Usage

### As a side-effect polyfill (Global Scope)

Import this at the top of your entry file to automatically polyfill `window.Summarizer`.

```javascript
import 'built-in-ai-task-apis-polyfills';

// Now window.Summarizer is available
const summarizer = await Summarizer.create();
```

### As a Module

You can also import the classes directly.

```javascript
import { Summarizer } from 'built-in-ai-task-apis-polyfills';

const summarizer = await Summarizer.create();
```

### Specific Polyfills

If you only want to import a specific polyfill:

```javascript
import 'built-in-ai-task-apis-polyfills/summarizer';
```

## Dependencies

This polyfill depends on [`prompt-api-polyfill`](https://www.npmjs.com/package/prompt-api-polyfill). It will attempt to load it from `esm.sh` if it's not present in the global scope.

## License

Apache-2.0

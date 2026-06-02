# cos-resource-fetcher

Fetches large resource blobs (model weights, Wasm files,…) using the
[Cross-Origin Storage (COS) API](https://github.com/WICG/cross-origin-storage)
when available, with the
[Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) as an
automatic fallback.

**Why COS?** The Cache API stores a separate copy per origin. COS stores a
single copy keyed by content hash that every origin on the device can reuse.
This means a 2 GB model downloaded by one site is instantly available to any
other site that asks for the same hash. See the
[COS explainer](https://github.com/WICG/cross-origin-storage) for the full
proposal and the
[Chrome extension](https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih)
to enable it while the API is not yet shipped.

## Installation

```bash
npm install cos-resource-fetcher
```

## Usage

### Default: Hugging Face URL

Pass a Hugging Face `/resolve/` URL — the library resolves the required SHA-256
automatically via the Git LFS pointer endpoint.

```js
import { fetchBlob } from 'cos-resource-fetcher';

const blob = await fetchBlob(
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
  {
    onProgress({ loaded, total }) {
      const percent = total
        ? ((loaded / total) * 100).toFixed(1) + '%'
        : `${loaded} bytes`;
      console.log(`Downloading… ${percent}`);
    },
  }
);
```

The `fetchBlob()` function returns a `Blob`. On first call it downloads the file
and stores it in COS (or the Cache API). Subsequent calls from the **same
origin** skip both the hash lookup and the download. Subsequent calls from a
**different origin** still need one small network request to resolve the SHA-256
(the hash cache is per-origin), but the file itself is served from COS without
re-downloading.

### Custom SHA-256 resolver

If you already know the hash, pass it directly via `sha256`:

```js
import { fetchBlob } from 'cos-resource-fetcher';

const blob = await fetchBlob(
  'https://example.com/models/gemma-4-E2B-it-web.litertlm',
  {
    sha256: 'abcdef0123456789…', // replace with the real hash
    onProgress({ loaded, total }) {
      const loadedGB = (loaded / 1e9).toFixed(2);
      if (total) {
        const percent = ((loaded / total) * 100).toFixed(1);
        console.log(
          `${percent}% — ${loadedGB} / ${(total / 1e9).toFixed(2)} GB`
        );
      }
    },
  }
);
```

If your URL is not on Hugging Face and you need to derive the hash at runtime,
pass a `getSHA256` function:

```js
const blob = await fetchBlob(modelUrl, {
  getSHA256: async (url) => {
    const res = await fetch(
      '/api/resource-hash?url=' + encodeURIComponent(url)
    );
    const { sha256 } = await res.json();
    return sha256;
  },
});
```

### npm packages

For any resource hosted on npm, SHA-256 hashes are available because npm
packages are mirrored on jsDelivr, which exposes a per-file hash for every
package version. The
[npm-sha256-hash-fetcher](https://github.com/tomayac/npm-sha256-hash-fetcher)
library wraps the jsDelivr API and converts the base64 hash it returns into hex:

```js
import { fetchBlob } from 'cos-resource-fetcher';
import { NPMSHA256HashFetcher } from 'npm-sha256-hash-fetcher';

const fetcher = new NPMSHA256HashFetcher();

const blob = await fetchBlob(cdnUrl, {
  getSHA256: async () => {
    const [result] = await fetcher.getHexHashForResource(
      'your-package@x.y.z/path/to/resource.bin'
    );
    if (result.status !== 'fulfilled') throw result.reason;
    return result.value;
  },
});
```

### Options

| Option       | Type                                                  | Default                                | Description                                                                 |
| ------------ | ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `sha256`     | `string`                                              | —                                      | Lowercase hex SHA-256, if already known. Takes precedence over `getSHA256`. |
| `getSHA256`  | `(url: string) => Promise<string>`                    | [`getHuggingFaceSHA256`](src/index.js) | Derives the SHA-256 at runtime. Only called when `sha256` is not provided.  |
| `onProgress` | `({ loaded: number, total: number \| null }) => void` | —                                      | Called with byte counts during a network download.                          |
| `cacheName`  | `string`                                              | `'cos-resource-fetcher'`               | Cache API bucket used by the fallback path.                                 |

### Resolving a Hugging Face SHA-256 manually

The named export `getHuggingFaceSHA256` is also available if you need the hash
independently:

```js
import { getHuggingFaceSHA256 } from 'cos-resource-fetcher';

const sha256 = await getHuggingFaceSHA256(
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm'
);
console.log(sha256); // e.g. "3f4a…"
```

## Demo

[`demo/`](demo/) contains a working chat UI powered by LiteRT-LM JS. It uses
`fetchBlob()` to load the Gemma 4 E2B model weight and streams responses
token-by-token.

```bash
cd demo
npm install
npm run dev
```

## How the fallback works

```
navigator.crossOriginStorage available?
  ├─ yes → look up hash in COS
  │         ├─ found → return cached blob (zero download)
  │         └─ not found → download → write to COS → return blob
  └─ no  → look up URL in Cache API
            ├─ found → return cached response blob
            └─ not found → download → write to cache → return blob
```

## License

Apache-2.0

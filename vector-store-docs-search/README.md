# Vector store docs search

A viewer for the DevDocs HTML documentation database with on-device semantic
search, built on the proposed
[Vector Store API](https://github.com/explainers-by-googlers/vector-store-api).
It downloads [`db.json`](https://documents.devdocs.io/html/db.json) (about
5.3 MB) plus the companion `index.json`, keeps both in the Cache Storage API,
and lets you browse the 252 documents locally — then hands them to a vector
store so you can search by meaning instead of by name.

It is the same demo as [`semantic-docs-search`](../semantic-docs-search), built
on the other end of the same problem. That one uses the
[Semantic Embedder API](https://github.com/explainers-by-googlers/semantic-embedder-api),
which returns raw vectors and leaves the rest to the page. This one uses the
Vector Store API, which keeps chunking, embedding, storage and search inside the
browser.

## What differs

|             | Semantic Embedder                                                                     | Vector Store                                              |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Chunking    | the page cuts documents into sections and splits again whatever comes back truncated  | `insert()` takes whole documents                          |
| Input limit | the page reads `metadata.maxInputTokens` and `statistics.truncated` and works to them | the store's business                                      |
| Storage     | the page keeps vectors in IndexedDB, keyed by embedding space                         | the store persists itself                                 |
| Search      | the page computes cosine similarity across every stored vector                        | `findNearest()`                                           |
| Returned    | a `Float32Array` the page has to interpret                                            | a passage and the id it came from, with no position in it |
| Page keeps  | vectors, chunk metadata, build stats                                                  | nothing                                                   |

In code that is `documentSections()`, a truncate-and-retry loop, an IndexedDB
layer and a `cosineSimilarity()` implementation on one side, against
`create()`, `insert()` and `findNearest()` on the other.

## What the abstraction costs

**Where a hit sits.** The store returns the matching chunk and the id of the
document it came from, but not where in that document the chunk is — it did the
chunking, so only it knows, and the API does not say. So a result here quotes
the passage and links to the document, and stops there.

A chunk arrives as one whitespace-collapsed run, beginning and ending wherever
the chunker landed and typically crossing paragraph and heading boundaries, so
there is no section it belongs to. The other demo names sections because it
indexes sections.

**What progress means.** This page can report documents per second, because it
counts its own `insert()` calls. Passages and tokens per second are not
available: how many chunks a document became, and how many tokens were read,
stay inside the store.

**Which knobs exist.** Chunk size and overlap are set once at `create()` and
reported by `VectorStore.params()`; how the text is actually cut is not
described. The other demo sets every boundary itself, at whole sections.

## Requirements

The Vector Store polyfill in [`vendor/`](vendor/) is
[KenjiBaheux/Vector-Store-Polyfill](https://github.com/KenjiBaheux/Vector-Store-Polyfill),
which the explainer links as its "try it out" implementation. It is Apache-2.0
and is not published to npm, so it is vendored here unmodified.

That polyfill is written against `window.SemanticEmbedder`, so this demo loads
[`built-in-ai-task-apis-polyfills`](https://www.npmjs.com/package/built-in-ai-task-apis-polyfills)
underneath it when the browser has none — which is what the badge in the header
reports. In Chrome Canary with `chrome://flags/#semantic-embedder-api` enabled,
the native embedder answers instead and nothing else changes.

## Run locally

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`, and `npm run preview` serves
it. [`vite.config.js`](vite.config.js) carries the same constraints as the other
demo, where they are explained in full.

## Notes

- Both caches are per origin: Cache Storage holds the documents, the vector
  store holds the index. Serving this site from another port starts with the
  documents cached and no store.
- The store is created with the default chunking `VectorStore.params()` reports,
  400 tokens with 50 overlapping.
- **Rebuild vector store** deletes the store and inserts everything again, which
  is how the API clears vectors; the cached documents are untouched.
- Results link to the document, not to a place inside it.
- The stats panel is read back from the store's own metadata. Even the build
  duration comes from there, as the gap between the store's creation and its
  last write.

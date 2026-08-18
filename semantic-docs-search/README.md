# Semantic docs search

A viewer for the DevDocs HTML documentation database with on-device semantic
search. It downloads
[`db.json`](https://documents.devdocs.io/html/db.json) (about 5.3 MB) plus the
companion `index.json`, keeps both in the Cache Storage API, and lets you browse
the 252 documents locally — then embeds them so you can search by meaning
instead of by name.

## Semantic search

Search uses the proposed
[SemanticEmbedder API](https://github.com/explainers-by-googlers/semantic-embedder-api).
Chrome does not ship it yet, so the page loads the
[`built-in-ai-task-apis-polyfills`](https://www.npmjs.com/package/built-in-ai-task-apis-polyfills)
implementation when `SemanticEmbedder` is missing from `window`, and uses the
native API as soon as one exists. The polyfill runs EmbeddingGemma 300M through
`@huggingface/transformers`, which is the model the proposal names.

**Build semantic index** embeds the passages with the `retrieval-document`
task type and stores the vectors in IndexedDB, keyed by the embedding space the
API reports so a different model invalidates them. A query is embedded with
`retrieval-query`, and the page ranks by cosine similarity — the API returns raw
vectors and deliberately leaves comparison and storage to the page.

### Passages, not documents

Documents are indexed one section at a time. A whole-document vector can rank a
document but cannot say which part of it matched, and most of these pages are
long enough that "somewhere in `<input>`" is not an answer. Sections carry their
heading trail, so a passage keeps the context it was written in and a result can
say where it came from.

Sections are also cheaper to embed than whole documents: cost grows with
sequence length, so 2,000 short passages take less work in total than 252
full-length pages.

### Fitting a passage to the input limit

The API does not chunk, and the model's window is finite, so the page has to
decide what to send. Rather than guessing a character budget, it asks and
retries: a section goes in as written, and any embedding that comes back with
`statistics.truncated` set is split and tried again, until every piece fits.

How far it splits comes from the rejection itself. The result reports
`statistics.tokenCount` and `metadata.maxInputTokens`, so a piece that came back
truncated is cut into `ceil(tokenCount / maxInputTokens)` parts and usually fits
on the next attempt, instead of being halved repeatedly. For the largest
document here, `<input>` at 8,899 tokens, that is 6 embed calls over 2 rounds
rather than 15 over 4.

Cuts land on the coarsest seam the text still has — between blocks, then
between sentences, then between words — so pieces stay as large and as whole as
they can, and a piece with no seam left is kept as is.

### Grounding a result

A document name and a score are not enough to judge a hit, so each result names
the section its matching passage came from, quotes the passage, links to that
section's anchor, and highlights the passage once the document opens. Grounding
is recorded while indexing, where the exact text that was embedded is known,
rather than reconstructed at query time.

Building the index shows its work: the passage currently being embedded, the
document and heading trail it came from, and throughput measured from the token
counts the API reports. Those figures are kept with the index and shown under
**Index stats** at the foot of the sidebar, and each search reports what
retrieval itself cost — the query embedding and the comparison pass separately.

### When statistics are missing

`statistics` and `metadata` are optional in the result, and an implementation is
free to return neither. The header says which one is answering: `native API`
when the browser provides `SemanticEmbedder`, `polyfill` otherwise, decided
before the polyfill is imported since it defines the same global.

Where token counts are missing, throughput is reported in passages per second
instead, so the readout never sits at zero. The retry loop is the real loss:
without `statistics.truncated` there is no signal that a passage did not fit, so
oversized passages are truncated silently rather than being split.

Nothing in the page knows the token limit. That number lives in the
implementation and reaches the page only through the reported metadata, which is
what makes the loop survive a model with a different window.

Because a batch is padded to its longest member, pieces are grouped by length
before being sent, which keeps the model from chewing through padding.

The first build downloads the model, roughly 420 MB, cached by the browser
afterwards. Indexing this corpus produces about 2,000 passages and runs at
roughly 70 tokens per second on an M-series laptop. Afterwards the index is read
back from IndexedDB and a query takes well under a second.

### Polyfill version

This demo needs `built-in-ai-task-apis-polyfills` **1.17.0 or newer**. Earlier
versions truncated oversized inputs to exactly the model's 2048-token window,
which onnxruntime-web cannot run — every long document failed with an opaque
`OrtRun()` integer overflow — and reported neither token counts nor truncation,
so the retry loop above had nothing to react to.

## Browsing

- Downloads the database once and reports progress while it streams.
- Caches both files under the `devdocs-html-v1` cache, so later visits load
  offline with no network request.
- Lists every entry in a sidebar, grouped by DevDocs type (Elements,
  Attributes, Guides, …), with a substring filter.
- Renders the stored HTML of the selected entry, with the current entry in the
  URL hash so entries are linkable and the back button works.
- Rewrites relative links: targets inside the database become in-app hash
  routes, everything else opens on devdocs.io or MDN in a new tab.
- Routes read `#path` or `#path#fragment`, so a document's own in-page anchors
  (`#browser_compatibility`) scroll within the entry instead of replacing it.
- **Redownload documents** clears the cache and fetches both files again.

## Run locally

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`, and `npm run preview` serves
it.

Vite is not decoration here: the polyfill re-loads itself as a module worker and
imports `@huggingface/transformers` by bare specifier, and import maps do not
reach workers, so the specifier has to be resolved at build time. For the same
reason [`vite.config.js`](vite.config.js) disables `modulePreload` and keeps the
polyfill in a chunk of its own — bundled into the app chunk, the worker would
re-run this whole page in a context with no DOM.

## Notes

- `index.json` lists 251 entries; the database also holds an `index` overview
  page, which the sidebar adds back as **HTML overview**.
- Passages are embedded under their document name, type, and heading trail, with
  Baseline banners, code samples, and tables stripped first, so boilerplate that
  repeats across pages does not dominate a vector.
- Quoted text is cut at a word boundary, never mid-word.
- Search ranks chunks individually but reports each document once, through its
  best-scoring chunk, so a long document cannot crowd out the results.
- Stored vectors carry the embedding space they were produced in, and a search
  ignores any that do not match the space the current model reports.
- MDN live-sample `<iframe>`s are removed, since only MDN's own scripts can
  fill them. The sample source above each one is still shown.

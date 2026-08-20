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

## Chunking

Indexing turns each document into passages: one vector per section, with every
passage small enough for the model to read in full.

### What constrains it

- **The API does not chunk.** The explainer is explicit that large inputs are
  the developer's problem, so the page decides what a unit of text is.
- **The limit is counted in tokens, not characters.** A token is a subword
  piece, so its size depends on the text: across this corpus a token averages
  4.8 characters, ranging from 4.1 to 5.3. Any character budget is therefore a
  guess, and the page never sets one.
- **The limit is not the page's to know.** It arrives with the result as
  `metadata.maxInputTokens`, 2,047 for EmbeddingGemma here, and the code reads
  it from there so a model with a different window needs no edit.
- **Overflowing is silent.** An oversized input still returns a vector, just one
  built from a prefix of the text. Only `statistics.truncated` distinguishes
  that from a complete reading.
- **Cost grows with sequence length**, and a batch is padded out to its longest
  member, so a single long passage makes its whole batch expensive.
- **A ranking has to point somewhere.** One vector per document can say which
  document matched but not where, which is no answer on a page the size of
  `<input>`.

### Step by step

1. **Strip the furniture.** Survey elements, Baseline banners, code samples,
   tables, and iframes come out, because they repeat across pages and would
   otherwise dominate the vectors.
2. **Collect the leaf blocks** — `h1`–`h4`, `p`, `li`, `dt`, `dd`, `figcaption`
   — keeping only the innermost when they nest, so no text is counted twice.
   Whitespace is collapsed, and blocks stay separated by blank lines, which is
   what later gives the splitter its seams.
3. **Cut at every heading.** The blocks between two headings become one section.
   Each carries the trail of headings above it, such as
   `Description › Closing dialogs`, and the anchor id of the deepest one. The
   page's own title heads the document rather than a section of it.
4. **Compose the input** as the document name and type, then the heading trail,
   then the prose. A passage keeps the context it was written in, and a hit can
   name where it came from. This corpus yields 1,993 pieces, the median one 91
   tokens.
5. **Sort by length and batch by eight**, so a batch is padded to something near
   its own members rather than to an outlier.
6. **Embed** with the `retrieval-document` task type.
7. **Split whatever did not fit.** A result marked `statistics.truncated` is cut
   into `ceil(tokenCount / maxInputTokens)` parts — both numbers reported by the
   implementation — and the parts rejoin the queue under the same section, to be
   embedded and checked again. Cuts land on the coarsest seam near each division:
   between blocks, else between sentences, else between words. A run with no seam
   left is stored as it is, truncated, since nothing better exists.
8. **Store** the vector with its document, heading trail, anchor, the passage
   text for quoting, and the embedding space it was produced in.

Here 6 of the 1,993 sections exceed the limit and become 13 parts, ending at
2,000 passages. The largest, `input › Attributes › Individual attributes` at
4,942 tokens, becomes three.

At query time each passage competes on its own, and a document is then
represented by its best one, so a long document cannot fill the results with
itself.

The first build downloads the model, roughly 420 MB, cached by the browser
afterwards. Indexing this corpus runs at roughly 70 tokens per second on an
M-series laptop. Afterwards the index is read back from IndexedDB and a query
takes well under a second.

## Grounding a result

A document name and a score are not enough to judge a hit, so each result names
the section its matching passage came from, quotes the passage, links to that
section's anchor, and highlights the passage once the document opens. Grounding
is recorded while indexing, where the exact text that was embedded is known,
rather than reconstructed at query time.

Building the index shows its work: the passage currently being embedded, the
document and heading trail it came from, and how fast it is going. Throughput
leads with passages per second, which the page measures itself and can therefore
report whatever implementation is answering — so a polyfill build and a native
one can be compared. Tokens per second and the running token total follow when
the implementation reports token counts.

Those figures are kept with the index and shown under **Index stats** at the
foot of the sidebar, alongside which implementation built it. Each search
reports what retrieval itself cost — the query embedding and the comparison pass
separately.

## When statistics are missing

`statistics` and `metadata` are optional in the result, and an implementation is
free to return neither. The header says which one is answering: `native API`
when the browser provides `SemanticEmbedder`, `polyfill` otherwise, decided
before the polyfill is imported since it defines the same global.

Where token counts are missing, only the token figures drop out; passages per
second is measured by the page and stays. The retry loop is the real loss:
without `statistics.truncated` there is no signal that a passage did not fit, so
oversized passages are truncated silently rather than being split.

## Polyfill version

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
reach workers, so the specifier has to be resolved at build time.

That worker also shapes [`vite.config.js`](vite.config.js). It re-runs whichever
chunk holds the polyfill, so that chunk must contain the polyfill alone and must
not touch `document`. Importing the polyfill dynamically already earns it a
chunk, but the dynamic-import helper is shared with the entry, and unless that
helper is given a chunk of its own the polyfill chunk imports the entry to reach
it — and the worker then executes this whole page with no DOM. `modulePreload`
is off for the same reason.

## Deploying to GitHub Pages

`npm run build` produces output that Pages can serve as it stands.

- `base` is `"./"`, so every asset resolves relative to the page and the site
  works from a repository subpath as well as from a domain root. The wasm binary
  is located through `import.meta.url`, so it follows.
- The build emits `.nojekyll`, without which Pages runs the output through
  Jekyll, which drops files whose names begin with an underscore.
- Everything is fetched from the page's own origin or over CORS, and the
  documentation database, the model, and the index are all cached in the
  browser, so no server-side anything is required.

Threads are the one thing Pages cannot give: `SharedArrayBuffer` needs
cross-origin isolation, which needs COOP and COEP headers that Pages does not
send, so onnxruntime runs single-threaded there and indexing is slower than it
is locally.

## Two caches, both per origin

The documents and the embeddings are stored separately, and the page says so:
the header reports the cached documents, the sidebar reports the stored
passages. **Redownload documents** refetches the documentation and keeps the
embeddings; **Rebuild semantic index** embeds the passages again and keeps the
documents.

Both live in origin-scoped storage — Cache Storage for the documents, IndexedDB
for the vectors — so the same site served from another origin, `localhost:5173`
instead of `localhost:5199`, starts with neither. That is why search can sit
disabled on a page that reports its documents as cached, and the sidebar says
which of the two is missing rather than leaving the controls greyed out without
explanation.

## Notes

- `index.json` lists 251 entries; the database also holds an `index` overview
  page, which the sidebar adds back as **HTML overview**.
- Quoted text is cut at a word boundary, never mid-word.
- Stored vectors carry the embedding space they were produced in, and a search
  ignores any that do not match the space the current model reports.
- MDN live-sample `<iframe>`s are removed, since only MDN's own scripts can
  fill them. The sample source above each one is still shown.

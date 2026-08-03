# Multilingual semantic search

This demo uses Chrome's experimental built-in `SemanticEmbedder` API to search
a Spanish travel guide with queries written in English, German, Japanese, or
any other language. It compares meaning directly and does not translate the
text.

## Requirements

- A recent desktop Chrome Canary.
- `chrome://flags/#semantic-embedder-api` set to **Enabled**.
- A secure context such as `http://localhost`.

## Run locally

From the repository root:

```sh
npx http-server semantic-embedder-multilingual-search -p 8000
```

Open <http://localhost:8000> in Chrome Canary.

The document passages are embedded with `retrieval-document`. The query is
embedded with `retrieval-query`. A small cosine-similarity function selects the
closest passage.

# SemanticEmbedder API Prototypes

This directory contains a suite of prototypes demonstrating the capabilities of
the Chrome built-in AI `SemanticEmbedder API`.

## Requirements

You must be using Chrome Canary (version >= 152.0.7943.0) and you MUST enable
the following flag to test these features:

1. Navigate to: `chrome://flags/#semantic-embedder-api` and Enable it.
2. Relaunch the browser.

*Note: For developers exploring the code, the core embedding logic, API calls, and cosine similarity computations are implemented directly inside each app's respective script (e.g., `note_search.js`, `comment_moderator.js`, `docs_rag.js`) without external wrappers, letting you directly read the raw logic of each app.*

## How to Run the Demo Locally

Because the prototypes use ES6 modules, they must be served over HTTP rather
than opened as raw `file://` URIs. The easiest way to do this is using Python's
built-in HTTP server.

1. Open your terminal and navigate to this directory.
2. Run the following command:

```bash
python3 -m http.server 8000
```

3. Open your browser and navigate to: [http://localhost:8000](http://localhost:8000)

## Prototypes

1. **Semantic Note Search (`note_search.html`)**: Demonstrates simple on-device
   vectorization and cosine similarity search over small sensitive texts without
   sending data server-side.
2. **Toxic Comment Moderator (`comment_moderator.html`)**: Nudges users away
   from toxic behavior using zero-latency checking against pre-computed toxic
   embedding anchors.
3. **Documentation RAG (`docs_rag.html`)**: Demonstrates how you can use both
   the Semantic Embedder API for context retrieval, and the Prompt API for
   synthesis to provide a RAG chatbot exclusively on the client side, requiring
   zero server-side databases or AI models.
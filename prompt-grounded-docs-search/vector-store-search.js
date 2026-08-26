/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Semantic search over the DevDocs entries, built on the proposed Vector Store
// API. Where the Semantic Embedder API hands back raw vectors and leaves
// chunking, storage and comparison to the page, this one keeps all of that
// inside the store: documents go in as text, queries come back as passages.
//
// Chrome ships neither API yet. The Vector Store polyfill in vendor/ stands in
// for this one, and it is itself written against SemanticEmbedder, so the
// embedder polyfill is loaded underneath it when the browser has no native
// implementation.

const STORE_ID = "devdocs-html";

// The store chunks what it is given. These are the browser's own defaults, as
// reported by VectorStore.params(), stated here so the demo shows the knob.
const CHUNKING = {
  maxChunkSizeTokens: 400,
  chunkOverlapTokens: 50,
};

const BLOCKS = "h1, h2, h3, h4, p, li, dt, dd, figcaption";
const STRIPPED =
  "mdn-survey, .baseline-indicator, .code-example, pre, table, iframe";

export { BLOCKS, STRIPPED };

let store;
let native;

const loadSemanticEmbedder = async () => {
  // Settled before the import, because the polyfill defines the global itself:
  // afterwards there is no telling the two apart from the outside.
  native ??= "SemanticEmbedder" in self;
  if (!native) {
    await import("built-in-ai-task-apis-polyfills/semantic-embedder");
  }
  return self.SemanticEmbedder;
};

// Which embedder is answering underneath the store: the browser's own, or the
// polyfill.
export const implementation = async () => {
  await loadSemanticEmbedder();
  return native ? "native" : "polyfill";
};

const loadVectorStore = async () => {
  // The Vector Store polyfill reads SemanticEmbedder off the global, so that
  // has to exist first.
  await loadSemanticEmbedder();
  if (!("VectorStore" in self)) {
    await import("./vendor/vector-store.js");
  }
  return self.VectorStore;
};

export const availability = async () =>
  (await loadVectorStore()).availability();

export const params = async () => (await loadVectorStore()).params();

// The store is the index, so asking whether one exists replaces keeping any
// state of our own.
export const describeStore = async () => {
  const api = await loadVectorStore();
  return (await api.list()).find((entry) => entry.id === STORE_ID);
};

const openStore = async () => {
  if (store) {
    return store;
  }
  const api = await loadVectorStore();
  store = await api.retrieve(STORE_ID);
  return store;
};

export const closeStore = () => {
  store?.close();
  store = undefined;
};

export const trimTo = (text, length) => {
  if (text.length <= length) {
    return text;
  }
  const cut = text.slice(0, length);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > length / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

// DevDocs stores MDN pages, so drop the parts that say nothing about the
// subject before handing the document over. Where it is cut after that is the
// store's business, not ours.
export const documentText = (entry, html) => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const node of parsed.querySelectorAll(STRIPPED)) {
    node.remove();
  }

  const blocks = [...parsed.body.querySelectorAll(BLOCKS)]
    .filter((node) => !node.querySelector(BLOCKS))
    .map((node) => node.textContent.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return [`${entry.name} (${entry.type})`, ...blocks].join("\n\n");
};

export const buildIndex = async ({ entries, db, onProgress, signal }) => {
  const api = await loadVectorStore();

  // A rebuild starts from nothing: the store owns the vectors, so dropping it
  // is how they are cleared.
  closeStore();
  await api.delete(STORE_ID);

  store = await api.create({
    id: STORE_ID,
    taskType: "retrieval",
    chunkingStrategy: CHUNKING,
    distance_type: "Cosine",
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onProgress?.({ phase: "download", loaded: event.loaded });
      });
    },
  });

  const startedAt = performance.now();
  let inserted = 0;
  let rate = 0;

  for (const entry of entries) {
    signal?.throwIfAborted();

    const content = documentText(entry, db[entry.path]);
    const insertStarted = performance.now();
    await store.insert([{ id: entry.path, content }]);
    const insertSeconds = (performance.now() - insertStarted) / 1000;

    inserted += 1;
    // Documents per second is all this API affords: the chunks it made and the
    // tokens it read stay inside the store.
    const sample = insertSeconds ? 1 / insertSeconds : 0;
    rate = rate ? rate * 0.7 + sample * 0.3 : sample;

    onProgress?.({
      phase: "insert",
      loaded: inserted,
      total: entries.length,
      rate,
      seconds: (performance.now() - startedAt) / 1000,
      current: { name: entry.name, passage: trimTo(content, 180) },
    });
  }

  return describeStore();
};

export const search = async (query, limit = 10) => {
  const active = await openStore();

  const started = performance.now();
  // Ask for more than we show, because several chunks of one document can rank
  // before the next document does.
  const found = await active.findNearest(query, {
    max_num_results: limit * 4,
    score_threshold: 0,
  });
  const milliseconds = performance.now() - started;

  // The store scores chunks; a document is represented by its best one.
  const best = new Map();
  for (const result of found) {
    if (result.score > (best.get(result.id)?.score ?? -Infinity)) {
      best.set(result.id, {
        path: result.id,
        score: result.score,
        passage: trimTo(result.content, 200),
        chunkIndex: result.chunkIndex,
      });
    }
  }

  return {
    matches: [...best.values()].slice(0, limit),
    stats: { milliseconds, chunksConsidered: found.length },
  };
};

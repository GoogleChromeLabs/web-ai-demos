/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Semantic search over the DevDocs entries, built on the proposed
// SemanticEmbedder API. Chrome does not ship the API yet, so the polyfill
// stands in: it runs EmbeddingGemma 300M locally through
// @huggingface/transformers, which is the same model the proposal names.

const BATCH_SIZE = 8;

// Vectors only mean something within the embedding space that produced them,
// so the store is keyed by the space the API reports rather than by a schema
// version. This is the fallback for an implementation that reports none.
const UNKNOWN_SPACE = "unknown";
const IDB_NAME = "semantic-docs-search";
const IDB_STORE = "chunks";
const META_STORE = "meta";
const BUILD_KEY = "build";

let embedder;
let native;

export const loadSemanticEmbedder = async () => {
  // Settled before the import, because the polyfill defines the global itself:
  // afterwards there is no telling the two apart from the outside.
  native ??= "SemanticEmbedder" in self;
  if (!native) {
    await import("built-in-ai-task-apis-polyfills/semantic-embedder");
  }
  return self.SemanticEmbedder;
};

// Which implementation is answering: the browser's own, or the polyfill.
export const implementation = async () => {
  await loadSemanticEmbedder();
  return native ? "native" : "polyfill";
};

export const availability = async () => {
  const api = await loadSemanticEmbedder();
  return api.availability();
};

const getEmbedder = async (onDownloadProgress) => {
  if (embedder) {
    return embedder;
  }

  const api = await loadSemanticEmbedder();
  embedder = await api.create({
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownloadProgress?.(event.loaded);
      });
    },
  });
  return embedder;
};

export const destroyEmbedder = () => {
  embedder?.destroy();
  embedder = undefined;
};

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      // Version 1 held one vector per document; the chunked layout replaced it.
      if (database.objectStoreNames.contains("vectors")) {
        database.deleteObjectStore("vectors");
      }
      if (!database.objectStoreNames.contains(IDB_STORE)) {
        database.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const readIndex = async () => {
  const database = await openDatabase();
  const records = await new Promise((resolve, reject) => {
    const request = database
      .transaction(IDB_STORE, "readonly")
      .objectStore(IDB_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return records;
};

const writeIndex = async (records, stats) => {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [IDB_STORE, META_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(IDB_STORE);
    store.clear();
    for (const record of records) {
      store.put(record);
    }
    transaction.objectStore(META_STORE).put(stats, BUILD_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

// What the last build cost, kept so it can be shown long after it finished.
export const readBuildStats = async () => {
  const database = await openDatabase();
  const stats = await new Promise((resolve, reject) => {
    const request = database
      .transaction(META_STORE, "readonly")
      .objectStore(META_STORE)
      .get(BUILD_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return stats;
};

// The blocks a document's text is built from, and the furniture that is not
// part of it. Exported because the page finds a matched passage back in the
// document with the same definitions.
export const BLOCKS = "h1, h2, h3, h4, p, li, dt, dd, figcaption";
export const STRIPPED =
  "mdn-survey, .baseline-indicator, .code-example, pre, table, iframe";
const HEADINGS = "h1, h2, h3, h4";

// Cutting a display string mid-word reads as a bug, so back up to the last
// space and mark the cut.
export const trimTo = (text, length) => {
  if (text.length <= length) {
    return text;
  }
  const cut = text.slice(0, length);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > length / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

// DevDocs stores MDN pages, so drop the parts that say nothing about the
// subject: the survey element, the Baseline banner, and the code samples that
// would otherwise crowd out the prose.
//
// A document is cut into its sections, because a section is the smallest piece
// that still answers a question on its own — and because a hit can then say
// which part of the page it came from instead of quoting the opening line.
export const documentSections = (entry, html) => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const node of parsed.querySelectorAll(STRIPPED)) {
    node.remove();
  }

  const blocks = [...parsed.body.querySelectorAll(BLOCKS)]
    // A list item inside a definition holds its own text, so only the
    // innermost block is taken and the text is not counted twice.
    .filter((node) => !node.querySelector(BLOCKS));

  const sections = [];
  // Headings by level, so a subsection carries the section it sits in: MDN
  // reuses names like "Result" and "HTML" under every example, and on their own
  // they say nothing about where a passage came from.
  const open = new Map();
  let prose = [];

  const flush = () => {
    if (!prose.length) {
      return;
    }

    // The page's own title heads the document rather than a section of it.
    const trail = [...open.values()].filter((node) => node !== blocks[0]);
    sections.push({
      path: entry.path,
      section: trail.map((node) => clean(node.textContent)).join(" › "),
      fragment: trail.at(-1)?.id ?? "",
      prose: prose.join("\n\n"),
    });
    prose = [];
  };

  for (const block of blocks) {
    if (block.matches(HEADINGS)) {
      flush();
      const level = Number(block.tagName.slice(1));
      for (const depth of [...open.keys()]) {
        if (depth >= level) {
          open.delete(depth);
        }
      }
      open.set(level, block);
      continue;
    }

    const text = clean(block.textContent);
    if (text) {
      prose.push(text);
    }
  }
  flush();

  return sections;
};

const clean = (text) => text.replace(/\s+/g, " ").trim();

// What actually gets embedded: the passage, under the name of the document and
// section it came from, so a passage keeps the context it was written in.
const pieceText = (piece, entry) =>
  [
    piece.section
      ? `${entry.name} (${entry.type}) — ${piece.section}`
      : `${entry.name} (${entry.type})`,
    piece.prose,
  ].join("\n\n");

// Cut a piece into roughly equal parts along the coarsest seam it still has:
// between blocks first, then between sentences, then between words. Nothing
// here knows anything about token limits — the caller decides how many parts to
// ask for, and splits again if a part still does not fit.
export const split = (text, parts) => {
  const seams = [/\n\n+/g, /(?<=[.!?])\s+/g, /\s+/g];
  const wanted = Math.max(2, parts);

  for (const seam of seams) {
    const matches = [...text.matchAll(seam)];
    if (matches.length < wanted - 1) {
      continue;
    }

    const cuts = [];
    for (let part = 1; part < wanted; part += 1) {
      const target = (text.length * part) / wanted;
      const nearest = matches.reduce((best, match) =>
        Math.abs(match.index - target) < Math.abs(best.index - target)
          ? match
          : best,
      );
      if (!cuts.some((cut) => cut.index === nearest.index)) {
        cuts.push(nearest);
      }
    }
    cuts.sort((first, second) => first.index - second.index);

    const pieces = [];
    let start = 0;
    for (const cut of cuts) {
      pieces.push(text.slice(start, cut.index).trim());
      start = cut.index + cut[0].length;
    }
    pieces.push(text.slice(start).trim());

    const kept = pieces.filter(Boolean);
    if (kept.length > 1) {
      return kept;
    }
  }

  // A single unbreakable run of characters: nothing left to split on.
  return [text];
};

export const buildIndex = async ({ entries, db, onProgress, signal }) => {
  const active = await getEmbedder((loaded) =>
    onProgress?.({ phase: "download", loaded }),
  );

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  // Sections go in as written. A section the model could not read in full
  // comes back marked truncated and is split and retried, so a piece is only
  // ever cut when the section itself does not fit.
  const pending = entries.flatMap((entry) =>
    documentSections(entry, db[entry.path]),
  );

  const records = [];
  let space = UNKNOWN_SPACE;
  let embedded = 0;
  let tokens = 0;
  let passageRate = 0;
  let tokenRate = 0;
  // Token counts and truncation flags are optional in the result, so the run
  // has to cope with an implementation that reports neither.
  let reportsTokens = false;
  const startedAt = performance.now();

  while (pending.length) {
    signal?.throwIfAborted();

    // A batch is padded out to its longest member, so mixing a one-line
    // section with a full-length one makes the model chew through padding for
    // all eight. Grouping similar lengths together keeps that waste down.
    pending.sort((first, second) => first.prose.length - second.prose.length);
    const batch = pending.splice(0, BATCH_SIZE);
    const batchStarted = performance.now();
    const result = await active.embed(
      batch.map((piece) => pieceText(piece, byPath.get(piece.path))),
      { taskType: "retrieval-document" },
    );
    space = result.metadata?.embeddingSpace ?? space;

    // The per-embedding token counts are what the model actually read, so the
    // throughput reported here is measured rather than estimated. The rate is
    // smoothed, because a batch of one-liners and a batch of long sections
    // differ wildly.
    reportsTokens ||= result.embeddings.some(
      (embedding) => embedding.statistics?.tokenCount !== undefined,
    );
    const batchTokens = result.embeddings.reduce(
      (total, embedding) => total + (embedding.statistics?.tokenCount ?? 0),
      0,
    );
    const batchSeconds = (performance.now() - batchStarted) / 1000;
    tokens += batchTokens;

    // Passages per second is measured here and so exists whatever the
    // implementation reports, which is what makes two runs comparable. Tokens
    // per second is the finer measure, and only an implementation that reports
    // token counts can offer it. Both are smoothed, because a batch of
    // one-liners and a batch of long sections differ wildly.
    const smooth = (previous, sample) =>
      previous ? previous * 0.7 + sample * 0.3 : sample;
    if (batchSeconds) {
      passageRate = smooth(
        passageRate,
        result.embeddings.length / batchSeconds,
      );
      tokenRate = smooth(tokenRate, batchTokens / batchSeconds);
    }

    batch.forEach((piece, position) => {
      const embedding = result.embeddings[position];
      let parts = [];

      if (embedding.statistics?.truncated) {
        // The rejection carries how far over the limit the piece was, so ask
        // for that many parts and converge in one round instead of halving
        // repeatedly. Both numbers come from the implementation; the page
        // still holds no limit of its own.
        const limit = result.metadata?.maxInputTokens;
        const wanted = limit
          ? Math.ceil(embedding.statistics.tokenCount / limit)
          : 2;
        parts = split(piece.prose, wanted);
      }

      if (parts.length > 1) {
        pending.push(...parts.map((prose) => ({ ...piece, prose })));
        return;
      }

      // Either it fit, or it is a single unsplittable run and the truncated
      // vector is the best available answer for it.
      records.push({
        id: `${piece.path}#${records.length}`,
        path: piece.path,
        section: piece.section,
        fragment: piece.fragment,
        passage: trimTo(piece.prose, 200),
        values: embedding.values,
        space,
      });
      embedded += 1;
    });

    const last = batch.at(-1);
    onProgress?.({
      phase: "embed",
      loaded: embedded,
      total: embedded + pending.length,
      reportsTokens,
      tokens,
      passageRate,
      tokenRate,
      seconds: (performance.now() - startedAt) / 1000,
      current: {
        name: byPath.get(last.path)?.name ?? last.path,
        section: last.section,
        passage: trimTo(last.prose, 180),
      },
    });
  }

  const stats = {
    finishedAt: new Date().toISOString(),
    passages: records.length,
    documents: new Set(records.map((record) => record.path)).size,
    seconds: (performance.now() - startedAt) / 1000,
    reportsTokens,
    tokens,
    space,
    implementation: await implementation(),
  };

  await writeIndex(records, stats);
  return { records, stats };
};

// The API deliberately returns raw vectors and leaves comparison to the page.
const cosineSimilarity = (a, b) => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let position = 0; position < a.length; position += 1) {
    dotProduct += a[position] * b[position];
    normA += a[position] * a[position];
    normB += b[position] * b[position];
  }

  return normA && normB ? dotProduct / Math.sqrt(normA * normB) : 0;
};

export const search = async (query, index, limit = 10) => {
  const active = await getEmbedder();

  const embedStarted = performance.now();
  const { embeddings, metadata } = await active.embed(query, {
    taskType: "retrieval-query",
  });
  const embedMilliseconds = performance.now() - embedStarted;

  const queryVector = embeddings[0].values;
  const space = metadata?.embeddingSpace ?? UNKNOWN_SPACE;
  const scoreStarted = performance.now();

  // Chunks compete individually, then each document is represented by its
  // best one, so a long document cannot crowd out the rest of the results.
  // Anything embedded in another space is not comparable and sits this out.
  const comparable = index.filter((stored) => stored.space === space);
  const best = new Map();
  for (const record of comparable) {
    const score = cosineSimilarity(queryVector, record.values);
    if (score > (best.get(record.path)?.score ?? -Infinity)) {
      best.set(record.path, { ...record, score, values: undefined });
    }
  }

  const matches = [...best.values()]
    .sort((first, second) => second.score - first.score)
    .slice(0, limit);

  return {
    matches,
    stats: {
      embedMilliseconds,
      scoreMilliseconds: performance.now() - scoreStarted,
      compared: comparable.length,
      tokens: embeddings[0].statistics?.tokenCount,
    },
  };
};

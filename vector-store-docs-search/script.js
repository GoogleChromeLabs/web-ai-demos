/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  availability,
  buildIndex,
  describeStore,
  implementation,
  params,
  search,
} from "./vector-store-search.js";

const BASE = "https://documents.devdocs.io/html/";
const CACHE_NAME = "devdocs-html-v1";
const DB_URL = `${BASE}db.json`;
const INDEX_URL = `${BASE}index.json`;

const statusLine = document.querySelector("#status");
const progress = document.querySelector("#progress");
const filter = document.querySelector("#filter");
const entriesList = document.querySelector("#entries");
const refreshButton = document.querySelector("#refresh");
const content = document.querySelector("#content");
const searchForm = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const searchButton = document.querySelector("#search");
const indexStatus = document.querySelector("#index-status");
const indexProgress = document.querySelector("#index-progress");
const buildButton = document.querySelector("#build-index");
const activity = document.querySelector("#index-activity");
const activityWhere = document.querySelector("#index-where");
const activityPassage = document.querySelector("#index-passage");
const activityStats = document.querySelector("#index-stats");
const results = document.querySelector("#results");
const backend = document.querySelector("#backend");
const buildStats = document.querySelector("#build-stats");
const buildStatsList = document.querySelector("#build-stats-list");

let db = {};
let entries = [];
let currentPath = "";
// What the store says about itself. The vectors are its business, so this is
// the whole of what the page keeps.
let storeInfo;

// Routes look like "#path" or "#path#fragment", so that the in-page anchors
// of a document can coexist with the entry in the URL.
const parseHash = () => {
  const raw = decodeURIComponent(location.hash.slice(1));
  const separator = raw.indexOf("#");
  return separator === -1
    ? { path: raw, fragment: "" }
    : { path: raw.slice(0, separator), fragment: raw.slice(separator + 1) };
};

const formatMegabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const fetchWithProgress = async (url, label) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded with ${response.status}`);
  }

  const total = Number(response.headers.get("content-length"));
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  progress.hidden = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.length;
    // The header reports the compressed size, so the ratio is only an estimate.
    progress.value = total ? Math.min(loaded / total, 1) : 0;
    statusLine.textContent = `Downloading ${label}: ${formatMegabytes(loaded)}`;
  }
  progress.hidden = true;

  return new Response(new Blob(chunks), {
    headers: { "content-type": "application/json" },
  });
};

const loadJson = async (url, label) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    statusLine.textContent = `Reading ${label} from the local cache…`;
    return cached.json();
  }

  const response = await fetchWithProgress(url, label);
  await cache.put(url, response.clone());
  return response.json();
};

const renderSidebar = (visible) => {
  const groups = new Map();
  for (const entry of visible) {
    const group = groups.get(entry.type) ?? [];
    group.push(entry);
    groups.set(entry.type, group);
  }

  const isFiltered = visible.length !== entries.length;
  entriesList.replaceChildren(
    ...[...groups].map(([type, group]) => {
      const details = document.createElement("details");
      details.open = isFiltered;

      const summary = document.createElement("summary");
      summary.textContent = `${type} (${group.length})`;
      details.append(summary);

      for (const entry of group) {
        const link = document.createElement("a");
        link.href = `#${entry.path}`;
        link.textContent = entry.name;
        link.dataset.path = entry.path;
        details.append(link);
      }
      return details;
    }),
  );
  markActive();
};

const markActive = () => {
  const { path } = parseHash();
  for (const link of document.querySelectorAll("#entries a, #results a")) {
    const isActive = link.dataset.path === path;
    link.classList.toggle("active", isActive);
    if (!isActive) {
      continue;
    }

    const group = link.closest("details");
    if (group) {
      group.open = true;
    }
    // While results are up they are the surface being navigated, so the entry
    // list stays put: scrolling it would push the results off screen.
    if (results.hidden && group) {
      link.scrollIntoView({ block: "nearest" });
    }
  }
};

// DevDocs links are relative to the entry, so point the ones that stay inside
// this database at the matching hash route and send the rest to MDN.
const rewriteLinks = (path) => {
  for (const link of content.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    if (href.startsWith("#")) {
      link.href = `#${path}${href}`;
      continue;
    }

    if (/^[a-z]+:/i.test(href)) {
      if (link.protocol === "http:" || link.protocol === "https:") {
        link.target = "_blank";
        link.rel = "noopener";
      }
      continue;
    }

    const resolved = new URL(href, `https://devdocs.local/${path}`);
    const target = resolved.pathname.slice(1);
    if (target in db) {
      link.href = `#${target}${resolved.hash}`;
    } else {
      link.href = `https://devdocs.io/html/${target}${resolved.hash}`;
      link.target = "_blank";
      link.rel = "noopener";
    }
  }
};

const scrollToFragment = (fragment) => {
  const target =
    fragment && content.querySelector(`[id="${CSS.escape(fragment)}"]`);
  if (target) {
    target.scrollIntoView();
  } else {
    content.scrollTo(0, 0);
  }
};

const show = ({ path, fragment }) => {
  if (!path) {
    return;
  }

  if (path === currentPath) {
    scrollToFragment(fragment);
    return;
  }

  const html = db[path];
  if (html === undefined) {
    content.replaceChildren(
      Object.assign(document.createElement("p"), {
        className: "placeholder",
        textContent: `No entry for “${path}”.`,
      }),
    );
    return;
  }

  // Parsing into an inert document keeps the stored markup from loading
  // anything while the live-sample frames, which only MDN's own scripts can
  // fill, are stripped out.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const frame of parsed.querySelectorAll("iframe")) {
    frame.remove();
  }
  content.replaceChildren(...parsed.body.childNodes);
  currentPath = path;
  rewriteLinks(path);
  markActive();
  scrollToFragment(fragment);
  document.title = `${path} · Vector store docs search`;
};

const applyFilter = () => {
  const query = filter.value.trim().toLowerCase();
  renderSidebar(
    query
      ? entries.filter(
          (entry) =>
            entry.name.toLowerCase().includes(query) ||
            entry.path.toLowerCase().includes(query),
        )
      : entries,
  );
};

const nameFor = (path) =>
  entries.find((entry) => entry.path === path)?.name ?? path;

const renderResults = (matches, stats) => {
  const heading = document.createElement("h2");
  heading.textContent = "Closest by meaning";

  // One number, because that is all the store exposes: embedding the query and
  // searching the index happen inside findNearest().
  const timing = document.createElement("p");
  timing.className = "result-stats";
  timing.textContent = [
    `found in ${Math.round(stats.milliseconds)} ms`,
    `${count(stats.chunksConsidered)} chunks returned`,
  ].join(" · ");

  const list = matches.map(({ path, score, passage }) => {
    const link = document.createElement("a");
    link.href = `#${path}`;
    link.dataset.path = path;

    const title = document.createElement("span");
    title.className = "result-title";
    title.append(nameFor(path));

    const value = document.createElement("span");
    value.className = "score";
    value.textContent = score.toFixed(2);
    title.append(value);
    link.append(title);

    const quote = document.createElement("span");
    quote.className = "result-passage";
    quote.textContent = passage;
    link.append(quote);
    return link;
  });

  results.replaceChildren(heading, timing, ...list);
  results.hidden = false;
  results.scrollIntoView({ block: "nearest" });
  markActive();
};

const summarizeIndex = () =>
  `${count(storeInfo.itemCount)} documents indexed by the vector store, kept for this origin.`;

// The search controls are only useful once embeddings exist, and a disabled
// field with no explanation reads as a broken page.
const setSearchable = (searchable) => {
  queryInput.disabled = !searchable;
  searchButton.disabled = !searchable;
  queryInput.placeholder = searchable
    ? "Search by meaning"
    : "Build the store first";
};

// Only the polyfill's model is ours to describe. A browser with its own
// implementation downloads whatever it downloads.
const modelHint = async (state) => {
  if (state === "downloading") {
    return "The embedding model is downloading.";
  }
  if (state === "available") {
    return "The embedding model is already downloaded.";
  }
  return (await implementation()) === "polyfill"
    ? "Doing so downloads EmbeddingGemma 300M once, about 420 MB."
    : "Doing so downloads the browser's embedding model once.";
};

// Says which implementation is behind the search, since the two are meant to be
// indistinguishable in use and otherwise there is no way to tell.
const showImplementation = async () => {
  try {
    const used = await implementation();
    backend.dataset.implementation = used;
    backend.textContent = used === "native" ? "native API" : "polyfill";
    backend.title =
      used === "native"
        ? "window.SemanticEmbedder is provided by the browser."
        : "The browser has no SemanticEmbedder, so built-in-ai-task-apis-polyfills provides it, running EmbeddingGemma 300M locally.";
  } catch (error) {
    backend.textContent = "unavailable";
    backend.title = error.message;
  }
};

const describeIndex = async () => {
  if (storeInfo?.itemCount) {
    indexStatus.textContent = summarizeIndex();
    buildButton.textContent = "Rebuild vector store";
    buildButton.disabled = false;
    setSearchable(true);
    return;
  }

  setSearchable(false);

  const state = await availability();
  if (state === "unavailable") {
    indexStatus.textContent =
      "The Vector Store API is unavailable here, so semantic search is off.";
    return;
  }

  // A vector store belongs to the origin that made it, so a copy of this site
  // served from somewhere else starts without one even though the documents
  // are already cached.
  indexStatus.textContent = `No vector store for this origin yet. Build one to search by meaning. ${await modelHint(state)}`;
  buildButton.disabled = false;
};

const clock = (seconds) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const count = (value) => Math.round(value).toLocaleString();

const showActivity = ({ loaded, total, rate, seconds, current }) => {
  activity.hidden = false;
  activityWhere.textContent = current.name;
  activityPassage.textContent = current.passage;
  // Documents per second is the only rate available: how many chunks the store
  // cut this document into, and how many tokens it read, stay inside it.
  activityStats.textContent = [
    `${rate.toFixed(1)} documents/s`,
    clock(seconds),
    `${total - loaded} left`,
  ].join(" · ");
};

// Everything here is read back off the store: it keeps the vectors, so it is
// also the thing that knows what was built and how it was configured. The
// build duration is the gap between the store being made and its last write.
const showBuildStats = (info, model) => {
  if (!info) {
    buildStats.hidden = true;
    return;
  }

  const seconds = (info.lastModified - info.createdAt) / 1000;
  const rows = [
    ["Documents", count(info.itemCount)],
    seconds > 0 && ["Built in", clock(seconds)],
    seconds > 0 && [
      "Speed",
      `${(info.itemCount / seconds).toFixed(1)} documents/s`,
    ],
    [
      "Chunking",
      `${count(info.configuration.maxChunkSizeTokens)} tokens, ${count(info.configuration.chunkOverlapTokens)} overlap`,
    ],
    ["Distance", info.distance_type],
    model && ["Model", model],
    ["Store id", info.id],
    ["Created", new Date(info.createdAt).toLocaleString()],
  ].filter(Boolean);

  buildStatsList.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    }),
  );
  buildStats.hidden = false;
};

const build = async () => {
  buildButton.disabled = true;
  setSearchable(false);
  indexProgress.hidden = false;
  indexProgress.value = 0;

  try {
    storeInfo = await buildIndex({
      entries,
      db,
      onProgress: (progress) => {
        if (progress.phase === "download") {
          indexProgress.value = progress.loaded;
          indexStatus.textContent = `Downloading the model: ${Math.round(progress.loaded * 100)}%`;
          return;
        }
        indexProgress.value = progress.loaded / progress.total;
        indexStatus.textContent = `Inserting document ${progress.loaded} of ${progress.total}`;
        showActivity(progress);
      },
    });
    showBuildStats(storeInfo, (await params()).model);
  } catch (error) {
    indexStatus.textContent = `Building the store failed: ${error.message}`;
    buildButton.disabled = false;
    return;
  } finally {
    indexProgress.hidden = true;
    activity.hidden = true;
  }

  await describeIndex();
};

// Emptying the field takes the results with it: they answer a question that is
// no longer being asked.
const clearResults = () => {
  results.replaceChildren();
  results.hidden = true;
  if (storeInfo?.itemCount) {
    indexStatus.textContent = summarizeIndex();
  }
};

const runSearch = async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) {
    return;
  }

  searchButton.disabled = true;
  indexStatus.textContent = "Searching…";
  try {
    const { matches, stats } = await search(query);
    renderResults(matches, stats);
    indexStatus.textContent = matches.length
      ? summarizeIndex()
      : "Nothing matched. Rebuild the store if the model has changed.";
  } catch (error) {
    indexStatus.textContent = `Search failed: ${error.message}`;
  } finally {
    searchButton.disabled = false;
  }
};

const start = async () => {
  try {
    // Sequential, so the two downloads do not fight over the progress bar.
    const index = await loadJson(INDEX_URL, "the entry index");
    db = await loadJson(DB_URL, "the documentation");
    // The database has an overview page that the entry index leaves out.
    entries = [
      { name: "HTML overview", path: "index", type: "Overview" },
      ...index.entries,
    ];
  } catch (error) {
    statusLine.textContent = `Could not load the documentation: ${error.message}`;
    return;
  }

  statusLine.textContent = `${entries.length} documents cached for this origin.`;
  filter.disabled = false;
  refreshButton.disabled = false;
  applyFilter();
  show(parseHash());

  storeInfo = await describeStore();
  if (storeInfo) {
    showBuildStats(storeInfo, (await params()).model);
  }
  await Promise.all([describeIndex(), showImplementation()]);
};

filter.addEventListener("input", applyFilter);
searchForm.addEventListener("submit", runSearch);
queryInput.addEventListener("input", () => {
  if (!queryInput.value.trim()) {
    clearResults();
  }
});
buildButton.addEventListener("click", build);

window.addEventListener("hashchange", () => {
  show(parseHash());
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  filter.disabled = true;
  await caches.delete(CACHE_NAME);
  currentPath = "";
  await start();
});

start();

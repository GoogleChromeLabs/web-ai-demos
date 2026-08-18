import {
  availability,
  BLOCKS,
  buildIndex,
  implementation,
  readIndex,
  search,
} from "./semantic-search.js";

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

let db = {};
let entries = [];
let currentPath = "";
let semanticIndex = [];

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
    goToMatch(path, fragment);
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
  goToMatch(path, fragment);
  document.title = `${path} · Semantic docs search`;
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

// The blocks each matched passage covers, which is what locates it in the
// rendered document. A passage runs across several blocks, so it is matched a
// block at a time; the last one is a prefix, since the quote is cut short.
const needles = new Map();

const needlesOf = (passage) =>
  passage
    .split("\n\n")
    .map((part) => part.replace(/…$/, "").trim())
    .filter((part) => part.length >= 12);

const normalize = (text) => text.replace(/\s+/g, " ").trim();

const leafBlocks = (root) =>
  [...root.querySelectorAll(BLOCKS)].filter(
    (node) => !node.querySelector(BLOCKS),
  );

// A matched passage is more precise than the section anchor it sits under, so
// it wins when there is one.
const goToMatch = (path, fragment) => {
  for (const marked of content.querySelectorAll(".match")) {
    marked.classList.remove("match");
  }
  if (!highlightMatch(path)) {
    scrollToFragment(fragment);
  }
};

const highlightMatch = (path) => {
  const parts = needles.get(path) ?? [];
  const blocks = leafBlocks(content);
  const matched = [];
  let from = 0;

  for (const part of parts) {
    const found = blocks.findIndex(
      (node, position) =>
        position >= from && normalize(node.textContent).includes(part),
    );
    if (found === -1) {
      break;
    }
    matched.push(blocks[found]);
    from = found + 1;
  }

  if (!matched.length) {
    return false;
  }

  for (const block of matched) {
    block.classList.add("match");
  }
  matched[0].scrollIntoView({ block: "center" });
  return true;
};

const renderResults = (matches) => {
  const heading = document.createElement("h2");
  heading.textContent = "Closest by meaning";

  needles.clear();

  const list = matches.map(({ path, score, section, fragment, passage }) => {
    needles.set(path, needlesOf(passage));

    const link = document.createElement("a");
    link.href = fragment ? `#${path}#${fragment}` : `#${path}`;
    link.dataset.path = path;
    // Clicking a result for the route already open fires no hashchange, so the
    // jump to the passage has to be made here.
    link.addEventListener("click", () => {
      if (link.getAttribute("href") === location.hash) {
        goToMatch(path, fragment);
      }
    });

    const title = document.createElement("span");
    title.className = "result-title";
    title.append(nameFor(path));

    const value = document.createElement("span");
    value.className = "score";
    value.textContent = score.toFixed(2);
    title.append(value);
    link.append(title);

    // The heading trail gets its own line: nested under two or three headings,
    // it does not survive being squeezed next to the document name.
    if (section) {
      const where = document.createElement("span");
      where.className = "result-section";
      where.textContent = section;
      link.append(where);
    }

    const quote = document.createElement("span");
    quote.className = "result-passage";
    quote.textContent = passage;
    link.append(quote);
    return link;
  });

  results.replaceChildren(heading, ...list);
  results.hidden = false;
  results.scrollIntoView({ block: "nearest" });
  markActive();
};

const summarizeIndex = () => {
  const documents = new Set(semanticIndex.map((record) => record.path)).size;
  return `Semantic index ready: ${semanticIndex.length} passages across ${documents} documents.`;
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
  if (semanticIndex.length) {
    indexStatus.textContent = summarizeIndex();
    buildButton.textContent = "Rebuild semantic index";
    buildButton.disabled = false;
    queryInput.disabled = false;
    searchButton.disabled = false;
    return;
  }

  const state = await availability();
  if (state === "unavailable") {
    indexStatus.textContent =
      "SemanticEmbedder is unavailable here, so semantic search is off.";
    return;
  }

  indexStatus.textContent =
    state === "available"
      ? "Model ready. Build the index to search by meaning."
      : "Building the index downloads the EmbeddingGemma model once (~420 MB).";
  buildButton.disabled = false;
};

const clock = (seconds) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const showActivity = ({
  loaded,
  total,
  tokens,
  tokensPerSecond,
  seconds,
  current,
}) => {
  activity.hidden = false;
  activityWhere.textContent = current.section
    ? `${current.name} › ${current.section}`
    : current.name;
  activityPassage.textContent = current.passage;
  activityStats.textContent = [
    `${Math.round(tokensPerSecond).toLocaleString()} tokens/s`,
    `${Math.round(tokens / 1000).toLocaleString()}k tokens`,
    clock(seconds),
    `${total - loaded} left`,
  ].join(" · ");
};

const build = async () => {
  buildButton.disabled = true;
  queryInput.disabled = true;
  searchButton.disabled = true;
  indexProgress.hidden = false;
  indexProgress.value = 0;

  try {
    semanticIndex = await buildIndex({
      entries,
      db,
      onProgress: (progress) => {
        if (progress.phase === "download") {
          indexProgress.value = progress.loaded;
          indexStatus.textContent = `Downloading the model: ${Math.round(progress.loaded * 100)}%`;
          return;
        }
        indexProgress.value = progress.loaded / progress.total;
        indexStatus.textContent = `Embedding passage ${progress.loaded} of ${progress.total}`;
        showActivity(progress);
      },
    });
  } catch (error) {
    indexStatus.textContent = `Indexing failed: ${error.message}`;
    buildButton.disabled = false;
    return;
  } finally {
    indexProgress.hidden = true;
    activity.hidden = true;
  }

  await describeIndex();
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
    const matches = await search(query, semanticIndex);
    renderResults(matches);
    indexStatus.textContent = matches.length
      ? summarizeIndex()
      : "No comparable vectors. Rebuild the index for the current model.";
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

  statusLine.textContent = `${entries.length} entries ready and cached locally.`;
  filter.disabled = false;
  refreshButton.disabled = false;
  applyFilter();
  show(parseHash());

  semanticIndex = await readIndex();
  await Promise.all([describeIndex(), showImplementation()]);
};

filter.addEventListener("input", applyFilter);
searchForm.addEventListener("submit", runSearch);
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

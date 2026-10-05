/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Wikimedia's EventStreams service publishes every change on every wiki as
// server-sent events. It carries the metadata of each edit, but none of the
// text, so the diff comes from the MediaWiki API.
// https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service
const STREAM_URL = 'https://stream.wikimedia.org/v2/stream/recentchange';
const WIKI = 'enwiki';
const API_URL = 'https://en.wikipedia.org/w/api.php';
// Browsers can't set `User-Agent`, and Wikimedia asks API clients to identify
// themselves with this header instead.
const API_HEADERS = {
  'Api-User-Agent':
    'wikipedia-spam-detector demo (https://github.com/GoogleChromeLabs/web-ai-demos)',
};

// The stream identifies namespaces by number; the title carries the name.
const namespaceName = ({ namespace, title }) =>
  namespace === 0 ? 'Article' : title.slice(0, title.indexOf(':'));

/**
 * Subscribes to the stream and calls `onEdit()` with every edit or page
 * creation on the English Wikipedia, until `signal` aborts. `EventSource`
 * reconnects by itself after a dropped connection.
 */
export function connectToEditStream({ onEdit, onStatus, signal }) {
  onStatus('connecting');
  const source = new EventSource(STREAM_URL);
  signal.addEventListener(
    'abort',
    () => {
      source.close();
      onStatus('disconnected');
    },
    { once: true },
  );
  source.addEventListener('open', () => onStatus('connected'));
  source.addEventListener('error', () => {
    if (!signal.aborted) {
      onStatus(
        source.readyState === EventSource.CLOSED
          ? 'disconnected'
          : 'reconnecting',
      );
    }
  });
  source.addEventListener('message', (event) => {
    let change;
    try {
      change = JSON.parse(event.data);
    } catch {
      return;
    }
    // Log entries and category changes have no revision of their own.
    if (
      change.wiki !== WIKI ||
      (change.type !== 'edit' && change.type !== 'new')
    ) {
      return;
    }
    onEdit({
      title: change.title,
      url: change.notify_url,
      user: change.user,
      bot: change.bot,
      namespace: change.namespace,
      namespaceName: namespaceName(change),
      isNew: change.type === 'new',
      sizeChange: (change.length?.new ?? 0) - (change.length?.old ?? 0),
      summary: change.comment,
      revision: change.revision.new,
      parentRevision: change.revision.old,
    });
  });
}

async function callApi(params, signal) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...params,
  });
  const response = await fetch(url, { headers: API_HEADERS, signal });
  if (!response.ok) {
    throw new Error(`The Wikipedia API answered with ${response.status}.`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.info);
  }
  return json;
}

// Collapses the runs of whitespace a diff leaves behind, and drops the parts
// that are nothing else.
const tidy = (parts, separator) =>
  parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(separator);

/**
 * Reads a MediaWiki table diff. Lines that only changed in part mark the
 * changed words with `<ins>` and `<del>`, and those words are what was added
 * or removed, one line per diff line. Lines without such marks were added or
 * removed as a whole.
 */
function parseDiff(html) {
  const doc = new DOMParser().parseFromString(
    `<table>${html}</table>`,
    'text/html',
  );
  const collect = (cellSelector, changeSelector) =>
    tidy(
      [...doc.querySelectorAll(cellSelector)].map((cell) => {
        const changes = cell.querySelectorAll(changeSelector);
        return changes.length
          ? tidy(
              [...changes].map(({ textContent }) => textContent),
              ' … ',
            )
          : cell.textContent;
      }),
      '\n',
    );
  return {
    added: collect('td.diff-addedline', 'ins.diffchange'),
    removed: collect('td.diff-deletedline', 'del.diffchange'),
  };
}

/**
 * Fetches the text an edit added and removed. A new page has no previous
 * revision, so its whole wikitext counts as added.
 */
export async function fetchEditText(change, signal) {
  if (!change.parentRevision) {
    const json = await callApi(
      {
        action: 'query',
        prop: 'revisions',
        revids: change.revision,
        rvprop: 'content',
        rvslots: 'main',
      },
      signal,
    );
    const content =
      json.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? '';
    return { added: content.trim(), removed: '' };
  }
  const json = await callApi(
    {
      action: 'compare',
      fromrev: change.parentRevision,
      torev: change.revision,
      prop: 'diff',
    },
    signal,
  );
  return parseDiff(json.compare?.body ?? '');
}

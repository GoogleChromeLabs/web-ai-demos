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
const MAX_RETRY_DELAY = 30000;

// The stream identifies namespaces by number; the title carries the name.
const namespaceName = ({ namespace, title }) =>
  namespace === 0 ? 'Article' : title.slice(0, title.indexOf(':'));

/**
 * Turns decoded text into server-sent events, following the parsing rules of
 * the HTML standard: a blank line ends an event, `data` lines are joined with
 * newlines, and lines starting with a colon are comments.
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
class EventStreamParser extends TransformStream {
  constructor() {
    let buffer = '';
    let data = [];
    let type = '';
    let id = '';
    const processLine = (line, controller) => {
      if (line === '') {
        if (data.length) {
          controller.enqueue({
            type: type || 'message',
            data: data.join('\n'),
            id,
          });
        }
        data = [];
        type = '';
        return;
      }
      if (line.startsWith(':')) {
        return;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'data') {
        data.push(value);
      } else if (field === 'event') {
        type = value;
      } else if (field === 'id' && !value.includes('\0')) {
        id = value;
      }
      // `retry` is ignored, since reconnecting is up to the reader.
    };
    super({
      transform(chunk, controller) {
        buffer += chunk;
        // A chunk can end between the CR and the LF of one line break, so a
        // trailing CR waits for the next chunk.
        const end = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
        const lines = buffer.slice(0, end).split(/\r\n|\r|\n/);
        buffer = lines.pop() + buffer.slice(end);
        for (const line of lines) {
          processLine(line, controller);
        }
      },
      // An event cut off by the end of the stream is dropped, as the standard
      // says.
    });
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });

const toEdit = (change) => ({
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
  time: Date.parse(change.meta.dt),
});

/**
 * Yields every edit and page creation on the English Wikipedia, until `signal`
 * aborts. The stream comes from `fetch()` and is read one event at a time, only
 * when the caller asks for the next edit, so a caller that takes its time
 * fills the stream's buffers, and TCP flow control slows the server down. That
 * is the backpressure `EventSource`, which reads as fast as data arrives, can't
 * give.
 *
 * After a dropped connection, the stream resumes from the time of the last
 * event read. The CORS policy of the service doesn't allow the
 * `Last-Event-ID` header, so the time goes into the `since` parameter, and
 * events already seen at that time are skipped.
 */
export async function* streamEdits({ signal, onStatus }) {
  let since = '';
  let seenAtSince = new Set();
  let retryDelay = 1000;
  while (!signal.aborted) {
    onStatus(since ? 'reconnecting' : 'connecting');
    let reader = null;
    try {
      const url = new URL(STREAM_URL);
      if (since) {
        url.searchParams.set('since', since);
      }
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      if (!response.ok) {
        throw new Error(`The stream answered with ${response.status}.`);
      }
      onStatus('connected');
      retryDelay = 1000;
      reader = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventStreamParser())
        .getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.type !== 'message') {
          continue;
        }
        let change;
        try {
          change = JSON.parse(value.data);
        } catch {
          continue;
        }
        // ISO 8601 times in UTC compare correctly as strings.
        const { dt, id } = change.meta;
        if (dt < since || (dt === since && seenAtSince.has(id))) {
          continue;
        }
        if (dt !== since) {
          since = dt;
          seenAtSince = new Set();
        }
        seenAtSince.add(id);
        // Log entries and category changes have no revision of their own.
        if (
          change.wiki === WIKI &&
          (change.type === 'edit' || change.type === 'new')
        ) {
          yield toEdit(change);
        }
      }
    } catch (err) {
      if (signal.aborted) {
        break;
      }
      console.warn('The edit stream failed:', err);
    } finally {
      // Also runs when the caller stops asking, which closes the connection.
      reader?.cancel().catch(() => {});
    }
    if (signal.aborted) {
      break;
    }
    onStatus('reconnecting');
    await sleep(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  }
  onStatus('disconnected');
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

// Collapses the runs of whitespace a diff leaves behind.
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Reads a MediaWiki table diff row by row. In a changed line, the words marked
 * with `<del>` and `<ins>` are what was removed and added, whether both sides
 * share a row or not. A row with both sides where one side has no marks, as
 * when only a space went away, adds nothing on that side. A row with one
 * unmarked side added or removed the whole line. A whole line on both sides
 * only moved, for example because a blank line above it went away, so it
 * counts as neither.
 */
function parseDiff(html) {
  const doc = new DOMParser().parseFromString(
    `<table>${html}</table>`,
    'text/html',
  );
  const added = [];
  const removed = [];
  for (const row of doc.querySelectorAll('tr')) {
    const addedCell = row.querySelector('td.diff-addedline');
    const removedCell = row.querySelector('td.diff-deletedline');
    const paired = addedCell && removedCell;
    for (const [cell, lines, marks] of [
      [addedCell, added, 'ins.diffchange'],
      [removedCell, removed, 'del.diffchange'],
    ]) {
      if (!cell) {
        continue;
      }
      const changes = [...cell.querySelectorAll(marks)];
      const line =
        changes.length || paired
          ? {
              text: changes
                .map(({ textContent }) => squash(textContent))
                .filter(Boolean)
                .join(' … '),
            }
          : { text: squash(cell.textContent), whole: true };
      if (line.text) {
        lines.push(line);
      }
    }
  }

  // Counts the whole lines on each side, and cancels out the ones that moved.
  const count = (lines) => {
    const counts = new Map();
    for (const { text, whole } of lines) {
      if (whole) {
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }
    return counts;
  };
  const addedCounts = count(added);
  const removedCounts = count(removed);
  const withoutMoved = (lines, otherCounts) =>
    lines
      .filter(({ text, whole }) => {
        if (!whole || !otherCounts.get(text)) {
          return true;
        }
        otherCounts.set(text, otherCounts.get(text) - 1);
        return false;
      })
      .map(({ text }) => text)
      .join('\n');
  return {
    added: withoutMoved(added, new Map(removedCounts)),
    removed: withoutMoved(removed, new Map(addedCounts)),
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

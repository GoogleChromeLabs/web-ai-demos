/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as smd from './parser.js';
import { isSafeUrl } from './safe-url.js';

/** Escapes a text node the way the HTML serializer would. */
function escapeText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Serializes an element's opening tag, and reports whether it's void.
 *
 * Cloning without children and trimming the closing tag off the serialization
 * means attribute quoting and escaping come from the browser's own serializer
 * rather than from string concatenation here.
 */
function tagsOf(element) {
  const html = element.cloneNode(false).outerHTML;
  const close = `</${element.localName}>`;
  return html.endsWith(close)
    ? { open: html.slice(0, -close.length), close }
    : { open: html, close: '' };
}

/**
 * Streams Markdown into HTML at the granularity the parser works at: an
 * opening tag, a run of text, a closing tag.
 *
 * A chunk is therefore *not* a balanced fragment — `<p>` arrives before the
 * text inside it, and `</p>` long after. Concatenating every chunk yields the
 * complete, well-formed HTML. To put it on screen as it arrives, pipe those
 * chunks into `renderStreamingHTML()`.
 *
 * Safety comes from construction rather than from a post-hoc scrub: every tag
 * is one the Markdown parser picked from a fixed set, all text is escaped, and
 * `href`/`src` values are scheme-checked before they're set. The model's raw
 * Markdown is separately vetted with the Sanitizer API by the caller.
 *
 * @param {object} options
 * @param {(html: string) => void} [options.onHtml] Receives each HTML chunk.
 * @param {(detail: {attribute: string, value: string}) => void} [options.onUnsafe]
 */
export function createHtmlTokenStreamer({ onHtml, onUnsafe } = {}) {
  // The nodes exist only to be serialized, so they are built in a document with
  // no browsing context: an image URL the model made up is never requested.
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');

  // Markdown puts a link's URL after its text — `[docs](url)` — so smd sets
  // `href` and `src` only when the token closes, long after the opening tag
  // would have been emitted. For these, hold everything back and emit the
  // finished element in one piece. They're small, so nothing visibly stalls.
  const LATE_ATTRIBUTE_TOKENS = new Set([
    smd.LINK,
    smd.RAW_URL,
    smd.IMAGE,
    smd.CHECKBOX,
  ]);
  let bufferDepth = 0;
  let bufferRoot = null;

  const emit = (html) => {
    if (html && bufferDepth === 0) {
      onHtml?.(html);
    }
  };

  /**
   * Emits a finished element as the same opening tag / text / closing tag
   * chunks the streaming path produces, rather than as one balanced fragment.
   *
   * Concatenated the result is identical either way, but keeping every chunk to
   * a single token means a consumer can rebuild the DOM with `createElement`
   * and `append` alone. Handing it a fragment would force `insertAdjacentHTML`,
   * which pages that enforce Trusted Types refuse.
   */
  const emitElement = (node) => {
    if (node.nodeType === 3) {
      onHtml?.(escapeText(node.data));
      return;
    }
    const { open, close } = tagsOf(node);
    onHtml?.(open);
    for (const child of node.childNodes) {
      emitElement(child);
    }
    if (close) {
      onHtml?.(close);
    }
  };

  // One frame per open token. `elements` are the elements the token opened,
  // outermost first. `deferred` holds an element opened by a descendant whose
  // closing tag belongs to this token instead — a `<tbody>` spanning rows.
  const frames = [];
  // The opening tags of the most recent token, not yet serialized: setAttr()
  // runs after addToken(), and the attributes have to be in the tag.
  let pendingFrame = null;

  const flush = () => {
    if (!pendingFrame) {
      return;
    }
    for (const element of pendingFrame.elements) {
      const { open, close } = tagsOf(element);
      pendingFrame.closers.push(close);
      emit(open);
    }
    pendingFrame = null;
  };

  const closeFrame = (frame) => {
    // A deferred tag (a <tbody> spanning rows) sits inside this frame's own
    // element, so it closes first.
    for (const close of [...frame.deferred].reverse()) {
      emit(close);
    }
    for (const close of [...frame.closers].reverse()) {
      emit(close);
    }
  };

  const data = { nodes: [root], index: 0 };

  function appendText(element, text) {
    element.appendChild(doc.createTextNode(text));
    emit(escapeText(text));
  }

  const renderer = {
    data,

    addToken(data, type) {
      if (type === smd.DOCUMENT) {
        return;
      }
      flush();

      let parent = data.nodes[data.index];
      const opened = [];
      const create = (tag) => doc.createElement(tag);

      // The parser names the elements; only the table's structure depends on
      // where in the table the token landed, so that stays here.
      const tags = smd.tokenToTags(type);
      let slot;

      switch (type) {
        case smd.CHECKBOX:
          slot = create('input');
          slot.setAttribute('type', 'checkbox');
          slot.setAttribute('disabled', '');
          break;
        case smd.CODE_BLOCK:
        case smd.CODE_FENCE:
          parent = parent.appendChild(create(tags[0]));
          opened.push(parent);
          slot = create(tags[1]);
          break;
        case smd.TABLE_ROW: {
          // The first row makes a <thead>, the second a <tbody>, and rows after
          // that reuse the <tbody> — so the <tbody> outlives its row and is
          // closed by the <table> frame instead.
          if (parent.children.length === 0) {
            parent = parent.appendChild(create('thead'));
            opened.push(parent);
          } else if (parent.children.length === 1) {
            const tbody = parent.appendChild(create('tbody'));
            const { open, close } = tagsOf(tbody);
            emit(open);
            frames.at(-1)?.deferred.push(close);
            parent = tbody;
          } else {
            parent = parent.children[1];
          }
          slot = create('tr');
          break;
        }
        case smd.TABLE_CELL:
          slot = create(
            parent.parentElement?.tagName === 'THEAD' ? 'th' : 'td'
          );
          break;
        default:
          slot = create(tags[0]);
      }

      opened.push(parent.appendChild(slot));
      data.nodes[++data.index] = slot;

      const buffered = LATE_ATTRIBUTE_TOKENS.has(type);
      if (buffered) {
        if (bufferDepth === 0) {
          bufferRoot = slot;
        }
        bufferDepth++;
      }

      pendingFrame = { elements: opened, closers: [], deferred: [], buffered };
      frames.push(pendingFrame);
    },

    setAttr(data, type, value) {
      const attribute = smd.attrToHtmlAttr(type);
      const element = data.nodes[data.index];

      // The only values the model controls that reach an attribute.
      if ((attribute === 'href' || attribute === 'src') && !isSafeUrl(value)) {
        onUnsafe?.({ attribute, value });
        return;
      }

      element.setAttribute(attribute, value);
    },

    addText(data, text) {
      flush();
      appendText(data.nodes[data.index], text);
    },

    endToken(data) {
      flush();
      data.index -= 1;
      const frame = frames.pop();
      if (!frame) {
        return;
      }
      if (frame.buffered) {
        bufferDepth--;
        if (bufferDepth === 0) {
          const element = bufferRoot;
          bufferRoot = null;
          emitElement(element);
        }
        return;
      }
      closeFrame(frame);
    },
  };

  const parser = smd.parser(renderer);

  return {
    /** @param {string} chunk Markdown, in whatever pieces it arrives. */
    write(chunk) {
      smd.parserWrite(parser, chunk);
    },
    /** Flushes the parser and closes any tags Markdown left open. */
    end() {
      smd.parserEnd(parser);
      flush();
      while (frames.length > 0) {
        const frame = frames.pop();
        if (frame.buffered) {
          bufferDepth--;
          if (bufferDepth === 0) {
            const element = bufferRoot;
            bufferRoot = null;
            emitElement(element);
          }
          continue;
        }
        closeFrame(frame);
      }
    },
  };
}

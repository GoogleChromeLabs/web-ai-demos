/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as smd from './markdown-parser.js';
import { isSafeUrl } from './sanitizer.js';

// CommonMark resolves entity references in text; upstream passes them through,
// so `AT&amp;T` rendered as the literal `AT&amp;T` and `&copy;` never became ©.
const ENTITY =
  /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
const entityCache = new Map();

function decodeEntities(doc, text) {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(ENTITY, (entity) => {
    let decoded = entityCache.get(entity);
    if (decoded === undefined) {
      // The match can only be `&...;` with no markup in it, so letting the
      // parser resolve it is safe and gets the full HTML entity table for free.
      const probe = doc.createElement('div');
      probe.innerHTML = entity;
      decoded = probe.textContent || entity;
      entityCache.set(entity, decoded);
    }
    return decoded;
  });
}

/** Strips the padding whitespace around a table cell's content. */
function trimCell(element) {
  while (element.firstChild?.nodeType === 3) {
    const trimmed = element.firstChild.textContent.replace(/^\s+/, '');
    element.firstChild.textContent = trimmed;
    if (trimmed !== '') {
      break;
    }
    element.firstChild.remove();
  }
  while (element.lastChild?.nodeType === 3) {
    const trimmed = element.lastChild.textContent.replace(/\s+$/, '');
    element.lastChild.textContent = trimmed;
    if (trimmed !== '') {
      break;
    }
    element.lastChild.remove();
  }
}

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
 * complete, well-formed HTML. To put it on screen as it arrives, pass `into`
 * and the streamer builds the DOM directly, appending nodes rather than
 * re-parsing anything.
 *
 * Safety comes from construction rather than from a post-hoc scrub: every tag
 * is one the Markdown parser picked from a fixed set, all text is escaped, and
 * `href`/`src` values are scheme-checked before they're set. The model's raw
 * Markdown is separately vetted with the Sanitizer API by the caller.
 *
 * @param {object} options
 * @param {HTMLElement} [options.into] Also build the DOM into this element.
 * @param {(html: string) => void} [options.onHtml] Receives each HTML chunk.
 * @param {(detail: {attribute: string, value: string}) => void} [options.onUnsafe]
 */
export function createHtmlTokenStreamer({ into, onHtml, onUnsafe } = {}) {
  // With no target element, build in a document that has no browsing context,
  // so an image URL the model made up is never requested.
  const doc = into
    ? into.ownerDocument
    : document.implementation.createHTMLDocument('');
  const root = into ?? doc.createElement('div');

  // Markdown puts a link's URL after its text — `[docs](url)` — so smd sets
  // `href` and `src` only when the token closes, long after the opening tag
  // would have been emitted. For these, hold everything back and emit the
  // finished element in one piece. They're small, so nothing visibly stalls.
  const LATE_ATTRIBUTE_TOKENS = new Set([
    smd.LINK,
    smd.RAW_URL,
    smd.IMAGE,
    smd.CHECKBOX,
    // A table cell arrives padded with the spaces around `| a |`, which
    // CommonMark strips. Buffering lets those be trimmed off before the cell
    // is emitted; cells are a few words, so nothing visibly stalls.
    smd.TABLE_CELL,
  ]);
  let bufferDepth = 0;
  let bufferRoot = null;

  const emit = (html) => {
    if (html && bufferDepth === 0) {
      onHtml?.(html);
    }
  };

  // One frame per open token. `elements` are the elements the token opened,
  // outermost first. `deferred` holds an element opened by a descendant whose
  // closing tag belongs to this token instead — a `<tbody>` spanning rows.
  // An entity can straddle two text callbacks (`AT&a` then `mp;T`), so a
  // trailing partial entity is held back until the rest of it arrives.
  const PARTIAL_ENTITY = /&[a-zA-Z#]?[a-zA-Z0-9]{0,31}$/;
  let entityTail = '';

  const frames = [];
  // The opening tags of the most recent token, not yet serialized: set_attr()
  // runs after add_token(), and the attributes have to be in the tag.
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
    if (element.localName === 'img') {
      // `![alt](src)` delivers the alt text as a child of the <img>, where it
      // serializes away and is lost to assistive technology.
      element.setAttribute('alt', (element.getAttribute('alt') ?? '') + text);
      return;
    }
    element.appendChild(doc.createTextNode(text));
    emit(escapeText(text));
  }

  /** Emits a held-back partial entity literally; it was never completed. */
  function flushEntityTail() {
    if (entityTail === '') {
      return;
    }
    const text = entityTail;
    entityTail = '';
    flush();
    appendText(data.nodes[data.index], text);
  }

  const renderer = {
    data,

    add_token(data, type) {
      if (type === smd.DOCUMENT) {
        return;
      }
      flushEntityTail();
      flush();

      let parent = data.nodes[data.index];
      const opened = [];
      const create = (tag) => doc.createElement(tag);
      let slot;

      switch (type) {
        case smd.BLOCKQUOTE:
          slot = create('blockquote');
          break;
        case smd.PARAGRAPH:
          slot = create('p');
          break;
        case smd.LINE_BREAK:
          slot = create('br');
          break;
        case smd.RULE:
          slot = create('hr');
          break;
        case smd.HEADING_1:
        case smd.HEADING_2:
        case smd.HEADING_3:
        case smd.HEADING_4:
        case smd.HEADING_5:
        case smd.HEADING_6:
          slot = create(`h${smd.heading_to_level(type)}`);
          break;
        case smd.ITALIC_AST:
        case smd.ITALIC_UND:
          slot = create('em');
          break;
        case smd.STRONG_AST:
        case smd.STRONG_UND:
          slot = create('strong');
          break;
        case smd.STRIKE:
          // GFM maps ~~text~~ to <del>; smd's own renderer uses <s>.
          slot = create('del');
          break;
        case smd.CODE_INLINE:
          slot = create('code');
          break;
        case smd.RAW_URL:
        case smd.LINK:
          slot = create('a');
          break;
        case smd.IMAGE:
          slot = create('img');
          break;
        case smd.LIST_UNORDERED:
          slot = create('ul');
          break;
        case smd.LIST_ORDERED:
          slot = create('ol');
          break;
        case smd.LIST_ITEM:
          slot = create('li');
          break;
        case smd.CHECKBOX:
          slot = create('input');
          slot.setAttribute('type', 'checkbox');
          slot.setAttribute('disabled', '');
          break;
        case smd.CODE_BLOCK:
        case smd.CODE_FENCE:
          parent = parent.appendChild(create('pre'));
          opened.push(parent);
          slot = create('code');
          break;
        case smd.TABLE:
          slot = create('table');
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
        case smd.EQUATION_BLOCK:
          slot = create('equation-block');
          break;
        case smd.EQUATION_INLINE:
          slot = create('equation-inline');
          break;
        default:
          slot = create('span');
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

    set_attr(data, type, value) {
      const attribute = smd.attr_to_html_attr(type);
      const element = data.nodes[data.index];

      if (attribute === 'href' || attribute === 'src') {
        // smd hands over the whole `url "Title"` payload of
        // `[text](url "Title")`, which would otherwise become part of the URL
        // and break the link.
        const titled = /^(.*?)\s+(?:"([^"]*)"|'([^']*)')$/.exec(value);
        let url = value;
        if (titled) {
          url = titled[1];
          element.setAttribute('title', titled[2] ?? titled[3]);
        }
        if (!isSafeUrl(url)) {
          onUnsafe?.({ attribute, value: url });
          return;
        }
        element.setAttribute(attribute, url);
        return;
      }

      if (attribute === 'class' && element.localName === 'code') {
        // Syntax highlighters look for `language-*`; smd emits the bare name.
        element.setAttribute(
          'class',
          value.startsWith('language-') ? value : `language-${value}`
        );
        return;
      }

      element.setAttribute(attribute, value);
    },

    add_text(data, rawText) {
      flush();
      const element = data.nodes[data.index];

      // Entity references are literal inside code spans and code blocks.
      if (element.localName === 'code') {
        appendText(element, rawText);
        return;
      }

      let text = entityTail + rawText;
      entityTail = '';
      const partial = PARTIAL_ENTITY.exec(text);
      if (partial) {
        entityTail = partial[0];
        text = text.slice(0, partial.index);
      }
      if (text !== '') {
        appendText(element, decodeEntities(doc, text));
      }
    },

    end_token(data) {
      flushEntityTail();
      flush();
      data.index -= 1;
      const frame = frames.pop();
      if (!frame) {
        return;
      }
      if (frame.buffered) {
        bufferDepth--;
        if (frame.elements.at(-1)?.localName.match(/^t[hd]$/)) {
          trimCell(frame.elements.at(-1));
        }
        if (bufferDepth === 0) {
          const element = bufferRoot;
          bufferRoot = null;
          emit(element.outerHTML);
        }
        return;
      }
      closeFrame(frame);
    },
  };

  const parser = smd.parser(renderer);

  return {
    root,
    write(chunk) {
      smd.parser_write(parser, chunk);
    },
    /** Flushes the parser and closes any tags Markdown left open. */
    end() {
      smd.parser_end(parser);
      flushEntityTail();
      flush();
      while (frames.length > 0) {
        const frame = frames.pop();
        if (frame.buffered) {
          bufferDepth--;
          if (frame.elements.at(-1)?.localName.match(/^t[hd]$/)) {
            trimCell(frame.elements.at(-1));
          }
          if (bufferDepth === 0) {
            const element = bufferRoot;
            bufferRoot = null;
            emit(element.outerHTML);
          }
          continue;
        }
        closeFrame(frame);
      }
    },
  };
}

/**
 * Vendored from streaming-markdown 0.2.15 by Damian Tarnawski, MIT licensed.
 * https://github.com/thetarnav/streaming-markdown
 *
 * Copyright (c) 2024 Damian Tarnawski
 * Copyright (c) 2026 Google LLC
 * SPDX-License-Identifier: MIT
 *
 * Upstream is unmaintained (last substantive commit May 2025) and describes
 * itself as an experiment, so this copy is where the fixes live. It keeps
 * upstream's append-only guarantee — the parser only ever emits new tokens, it
 * never revises what it already emitted — which is what lets a caller build the
 * DOM by appending and stream HTML at token granularity.
 *
 * Changes from upstream, each marked with a `FIX:` comment:
 *
 * - `_` only opens emphasis at a word boundary, per CommonMark, so
 *   snake_case_word and MAX_BUFFER_SIZE keep their underscores. `*` is
 *   unchanged. This needs `lastTextChar`, because text is flushed to the
 *   renderer at arbitrary points and a chunk boundary can empty the buffer
 *   right before the delimiter.
 * - `~~~` opens a code fence, alongside ```. `fenceChar` records which
 *   character opened it so the right one closes it. `~~strikethrough~~` still
 *   works: two tildes not followed by a third fail out to the inline path.
 *
 * - Entity references in text are resolved, so `AT&amp;T` and `&copy;` come out
 *   as `AT&T` and ©. A reference split across two chunks is held back until the
 *   rest of it arrives. Code spans and code blocks keep theirs literal.
 * - A table cell's content is trimmed, as GFM specifies, rather than carrying
 *   the padding from `| a |` through as text.
 * - `[t](url "Title")` splits the title off instead of swallowing it into the
 *   destination, where it broke the link.
 * - `![alt](src)` keeps its alt text, accumulated through `altText` because it
 *   arrives in pieces and ends up as an attribute rather than as text.
 * - A fenced block's language becomes `language-js`, the convention syntax
 *   highlighters look for, rather than a bare `js`.
 * - `~~text~~` is `<del>`, which is what GFM specifies, rather than `<s>`.
 *
 * `tokenToTags()` names the HTML element each token becomes, so a renderer
 * doesn't have to carry its own copy of that mapping. The built-in DOM and
 * logger renderers were dropped; `renderer.js` has the one this package uses.
 *
 * Every snake_case identifier was renamed to camelCase to match the rest of
 * this project. SCREAMING_SNAKE constants kept their convention. That makes a
 * line-by-line diff against upstream useless, which is a deliberate trade: this
 * is a fork rather than a patched copy, and there is no upstream left to track.
 */

/*
Streaming Markdown Parser and Renderer
MIT License
Copyright 2024 Damian Tarnawski
https://github.com/thetarnav/streaming-markdown
*/

export const DOCUMENT = 1,
  PARAGRAPH = 2,
  HEADING_1 = 3,
  HEADING_2 = 4,
  HEADING_3 = 5,
  HEADING_4 = 6,
  HEADING_5 = 7,
  HEADING_6 = 8,
  CODE_BLOCK = 9,
  CODE_FENCE = 10,
  CODE_INLINE = 11,
  ITALIC_AST = 12,
  ITALIC_UND = 13,
  STRONG_AST = 14,
  STRONG_UND = 15,
  STRIKE = 16,
  LINK = 17,
  RAW_URL = 18,
  IMAGE = 19,
  BLOCKQUOTE = 20,
  LINE_BREAK = 21,
  RULE = 22,
  LIST_UNORDERED = 23,
  LIST_ORDERED = 24,
  LIST_ITEM = 25,
  CHECKBOX = 26,
  TABLE = 27,
  TABLE_ROW = 28,
  TABLE_CELL = 29,
  EQUATION_BLOCK = 30,
  EQUATION_INLINE = 31,
  NEWLINE = 101,
  MAYBE_URL = 102,
  MAYBE_TASK = 103,
  MAYBE_BR = 104,
  MAYBE_EQ_BLOCK = 105;

/** @enum {(typeof Token)[keyof typeof Token]} */
export const Token = /** @type {const} */ ({
  Document: DOCUMENT,
  Blockquote: BLOCKQUOTE,
  Paragraph: PARAGRAPH,
  Heading1: HEADING_1,
  Heading2: HEADING_2,
  Heading3: HEADING_3,
  Heading4: HEADING_4,
  Heading5: HEADING_5,
  Heading6: HEADING_6,
  CodeBlock: CODE_BLOCK,
  CodeFence: CODE_FENCE,
  CodeInline: CODE_INLINE,
  ItalicAst: ITALIC_AST,
  ItalicUnd: ITALIC_UND,
  StrongAst: STRONG_AST,
  StrongUnd: STRONG_UND,
  Strike: STRIKE,
  Link: LINK,
  RawURL: RAW_URL,
  Image: IMAGE,
  LineBreak: LINE_BREAK,
  Rule: RULE,
  ListUnordered: LIST_UNORDERED,
  ListOrdered: LIST_ORDERED,
  ListItem: LIST_ITEM,
  Checkbox: CHECKBOX,
  Table: TABLE,
  TableRow: TABLE_ROW,
  TableCell: TABLE_CELL,
  EquationBlock: EQUATION_BLOCK,
  EquationInline: EQUATION_INLINE,
});

/**
 * @param   {Token} type
 * @returns {string    } */
export function tokenToString(type) {
  switch (type) {
    case DOCUMENT:
      return 'Document';
    case BLOCKQUOTE:
      return 'Blockquote';
    case PARAGRAPH:
      return 'Paragraph';
    case HEADING_1:
      return 'Heading1';
    case HEADING_2:
      return 'Heading2';
    case HEADING_3:
      return 'Heading3';
    case HEADING_4:
      return 'Heading4';
    case HEADING_5:
      return 'Heading5';
    case HEADING_6:
      return 'Heading6';
    case CODE_BLOCK:
      return 'CodeBlock';
    case CODE_FENCE:
      return 'CodeFence';
    case CODE_INLINE:
      return 'CodeInline';
    case ITALIC_AST:
      return 'ItalicAst';
    case ITALIC_UND:
      return 'ItalicUnd';
    case STRONG_AST:
      return 'StrongAst';
    case STRONG_UND:
      return 'StrongUnd';
    case STRIKE:
      return 'Strike';
    case LINK:
      return 'Link';
    case RAW_URL:
      return 'Raw URL';
    case IMAGE:
      return 'Image';
    case LINE_BREAK:
      return 'LineBreak';
    case RULE:
      return 'Rule';
    case LIST_UNORDERED:
      return 'ListUnordered';
    case LIST_ORDERED:
      return 'ListOrdered';
    case LIST_ITEM:
      return 'ListItem';
    case CHECKBOX:
      return 'Checkbox';
    case TABLE:
      return 'Table';
    case TABLE_ROW:
      return 'TableRow';
    case TABLE_CELL:
      return 'TableCell';
    case EQUATION_BLOCK:
      return 'EquationBlock';
    case EQUATION_INLINE:
      return 'EquationInline';
  }
}

/*  FIX: CommonMark resolves entity references in text; upstream passed them
    through, so `AT&amp;T` rendered as the literal `AT&amp;T` and `&copy;` never
    became ©. Resolving needs the full HTML entity table, so the browser's own
    parser does it, through setHTML() rather than innerHTML: pages enforcing
    Trusted Types refuse innerHTML, and refusing it here would break every
    response containing an entity rather than only an unsafe one.
*/
const ENTITY =
  /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
/** A reference cut short by a chunk boundary, held until the rest arrives. */
const PARTIAL_ENTITY = /&[a-zA-Z#]?[a-zA-Z0-9]{0,31}$/;
const entityCache = new Map();
let entityProbe = null;

function decodeEntities(text) {
  if (!text.includes('&')) return text;
  if (entityProbe === null) {
    entityProbe =
      typeof document === 'undefined'
        ? false
        : document.implementation.createHTMLDocument('').createElement('div');
    if (entityProbe && typeof entityProbe.setHTML !== 'function') {
      entityProbe = false;
    }
  }
  // Without the Sanitizer API there is no safe way to resolve a named
  // reference. Leaving it alone shows `&copy;` literally, which beats throwing.
  if (entityProbe === false) return text;

  return text.replace(ENTITY, (entity) => {
    let decoded = entityCache.get(entity);
    if (decoded === undefined) {
      entityProbe.setHTML(entity);
      decoded = entityProbe.textContent || entity;
      entityCache.set(entity, decoded);
    }
    return decoded;
  });
}

/**
 * The HTML element a token becomes.
 *
 * FIX: upstream left this to each renderer, which made sense when it aimed to
 * be renderer-agnostic. This parser targets HTML, so the vocabulary lives here:
 * one place decides that a strike is `<del>` and a fence is `<pre><code>`.
 *
 * A fence needs two elements, so this returns an array, outermost first. Table
 * rows and cells are the exception and stay with the renderer, since `<thead>`
 * versus `<tbody>` and `<th>` versus `<td>` depend on where in the table the
 * token lands rather than on the token itself.
 *
 * @param   {Token} type
 * @returns {string[]}
 */
export function tokenToTags(type) {
  switch (type) {
    case BLOCKQUOTE:
      return ['blockquote'];
    case PARAGRAPH:
      return ['p'];
    case LINE_BREAK:
      return ['br'];
    case RULE:
      return ['hr'];
    case HEADING_1:
    case HEADING_2:
    case HEADING_3:
    case HEADING_4:
    case HEADING_5:
    case HEADING_6:
      return [`h${headingToLevel(type)}`];
    case ITALIC_AST:
    case ITALIC_UND:
      return ['em'];
    case STRONG_AST:
    case STRONG_UND:
      return ['strong'];
    case STRIKE:
      return ['del'];
    case CODE_INLINE:
      return ['code'];
    case RAW_URL:
    case LINK:
      return ['a'];
    case IMAGE:
      return ['img'];
    case LIST_UNORDERED:
      return ['ul'];
    case LIST_ORDERED:
      return ['ol'];
    case LIST_ITEM:
      return ['li'];
    case CHECKBOX:
      return ['input'];
    case CODE_BLOCK:
    case CODE_FENCE:
      return ['pre', 'code'];
    case TABLE:
      return ['table'];
    case EQUATION_BLOCK:
      return ['equation-block'];
    case EQUATION_INLINE:
      return ['equation-inline'];
    default:
      return ['span'];
  }
}

export const HREF = 1,
  SRC = 2,
  LANG = 4,
  CHECKED = 8,
  START = 16,
  /*  FIX: upstream had neither. A link's title was left glued to the end of
      its href, and an image's alt text was emitted as a child of the <img>,
      where it serializes away.
  */
  TITLE = 32,
  ALT = 64;

/** @enum {(typeof Attr)[keyof typeof Attr]} */
export const Attr = /** @type {const} */ ({
  Href: HREF,
  Src: SRC,
  Lang: LANG,
  Checked: CHECKED,
  Start: START,
  Title: TITLE,
  Alt: ALT,
});

/**
 * @param   {Attr} type
 * @returns {string    } */
export function attrToHtmlAttr(type) {
  switch (type) {
    case HREF:
      return 'href';
    case SRC:
      return 'src';
    case LANG:
      return 'class';
    case CHECKED:
      return 'checked';
    case START:
      return 'start';
    case TITLE:
      return 'title';
    case ALT:
      return 'alt';
  }
}

/**
 * @param   {number} level
 * @returns {Token } */
export const levelToHeading = (level) => {
  switch (level) {
    case 1:
      return HEADING_1;
    case 2:
      return HEADING_2;
    case 3:
      return HEADING_3;
    case 4:
      return HEADING_4;
    case 5:
      return HEADING_5;
    default:
      return HEADING_6;
  }
};
export const headingFromLevel = levelToHeading;

/**
 * @param   {Token} token
 * @returns {number} */
export const headingToLevel = (token) => {
  switch (token) {
    case HEADING_1:
      return 1;
    case HEADING_2:
      return 2;
    case HEADING_3:
      return 3;
    case HEADING_4:
      return 4;
    case HEADING_5:
      return 5;
    case HEADING_6:
      return 6;
    default:
      return 0;
  }
};

/**
 * @typedef  {object      } Parser
 * @property {AnyRenderer} renderer        - {@link Renderer} interface
 * @property {string      } text            - Text to be added to the last token in the next flush
 * @property {string      } pending         - Characters for identifying tokens
 * @property {Uint32Array } tokens          - Current token and it's parents (a slice of a tree)
 * @property {number      } len             - Number of tokens in types without root
 * @property {number      } token           - Last token in the tree
 * @property {Uint8Array  } spaces
 * @property {string      } indent
 * @property {number      } indentLen
 * @property {number      } fenceEnd       - For {@link Token.CodeFence} parsing
 * @property {number      } fenceStart
 * @property {string      } fenceChar      - FIX: ` or ~, whichever opened the fence
 * @property {string      } lastTextChar  - FIX: last character handed to the renderer
 * @property {number      } blockquoteIdx  - For Blockquote parsing
 * @property {string      } hrChar         - For horizontal rule parsing
 * @property {number      } hrChars        - For horizontal rule parsing
 * @property {number      } tableState
 */

const TOKEN_ARRAY_CAP = 24;

/**
 * Makes a new Parser object.
 * @param   {AnyRenderer} renderer
 * @returns {Parser      } */
export function parser(renderer) {
  const tokens = new Uint32Array(TOKEN_ARRAY_CAP);
  tokens[0] = DOCUMENT;
  return {
    renderer: renderer,
    text: '',
    pending: '',
    tokens: tokens,
    len: 0,
    token: DOCUMENT,
    fenceEnd: 0,
    blockquoteIdx: 0,
    hrChar: '',
    hrChars: 0,
    fenceStart: 0,
    fenceChar: '',
    lastTextChar: '',
    altText: '', // FIX: an image's alt arrives in pieces; see addText
    trimCellStart: false, // FIX: see addText
    entityTail: '', // FIX: a reference split across chunks; see addText
    spaces: new Uint8Array(TOKEN_ARRAY_CAP),
    indent: '',
    indentLen: 0,
    tableState: 0,
  };
}

/**
 * Finish rendering the markdown - flushes any remaining text.
 * @param   {Parser} p
 * @returns {void  } */
export function parserEnd(p) {
  if (p.pending.length > 0) {
    parserWrite(p, '\n');
  }
}

/**
 * @param   {Parser} p
 * @returns {void  } */
function addText(p) {
  if (p.text.length === 0) return;
  console.assert(p.len > 0, 'Never adding text to root');
  /*  FIX: `![alt](src)` delivers the alt as text. An <img> has no children, so
      a renderer would drop it; it is an attribute.
  */
  if (p.tokens[p.len] === IMAGE) {
    // Held until the image closes: the text arrives in pieces, and an
    // attribute is set, not appended.
    p.altText += p.text;
    p.text = '';
    return;
  }
  /*  FIX: GFM trims a table cell's content. Upstream emitted the padding from
      `| a |` as text, leaving every renderer to undo it. The leading run goes
      at the start of the cell, the trailing run when it closes.
  */
  if (p.tokens[p.len] === TABLE_CELL) {
    if (p.trimCellStart) {
      p.text = p.text.replace(/^[ \t]+/, '');
      if (p.text !== '') p.trimCellStart = false;
    }
    if (p.pending === '|' || p.pending === '\n') {
      p.text = p.text.replace(/[ \t]+$/, '');
    }
    if (p.text === '') return;
  }
  /*  FIX: the emphasis rules need the character before a delimiter, but text
        is flushed at arbitrary points — a chunk boundary can empty p.text right
        before an `_`. Remember the last character that went out.
    */
  p.lastTextChar = p.text[p.text.length - 1];

  // References are literal inside code, and are resolved everywhere else.
  const token = p.tokens[p.len];
  if (token === CODE_INLINE || token === CODE_FENCE || token === CODE_BLOCK) {
    p.renderer.addText(p.renderer.data, p.text);
    p.text = '';
    return;
  }

  let text = p.entityTail + p.text;
  p.entityTail = '';
  const partial = PARTIAL_ENTITY.exec(text);
  if (partial) {
    p.entityTail = partial[0];
    text = text.slice(0, partial.index);
  }
  p.text = '';
  if (text !== '') {
    p.renderer.addText(p.renderer.data, decodeEntities(text));
  }
}

/** Emits a held-back partial reference literally; it was never completed. */
function flushEntityTail(p) {
  if (p.entityTail === '' || p.len === 0) return;
  const text = p.entityTail;
  p.entityTail = '';
  p.renderer.addText(p.renderer.data, text);
}

/**
 * @param   {Parser} p
 * @returns {void  } */
function ensureParagraph(p) {
  switch (p.token) {
    case LINE_BREAK:
    case DOCUMENT:
    case BLOCKQUOTE:
    case LIST_ORDERED:
    case LIST_UNORDERED:
      addToken(p, PARAGRAPH);
  }
}

/**
 * @param   {Parser} p
 * @param   {string} text
 * @returns {void  } */
function pushText(p, text) {
  ensureParagraph(p);
  p.text += text;
}

/**
 * @param   {Parser} p
 * @returns {void  } */
function endToken(p) {
  flushEntityTail(p); // FIX: see addText
  p.lastTextChar = '';
  console.assert(p.len > 0, 'No nodes to end');
  p.len -= 1;
  p.token = /** @type {Token} */ (p.tokens[p.len]);
  p.renderer.endToken(p.renderer.data);
}

/**
 * @param   {Parser} p
 * @param   {Token } token
 * @returns {void  } */
function addToken(p, token) {
  flushEntityTail(p); // FIX: see addText
  p.lastTextChar = '';
  if (token === IMAGE) {
    p.altText = '';
  }
  if (token === TABLE_CELL) {
    p.trimCellStart = true;
  }
  /*
     If a list doesn't start with a list item
     it means that there was a newline after the list:

     1. foo
     2. bar
     <empty line>
     <notAListItem> <- new token
    */
  if (
    (p.tokens[p.len] === LIST_ORDERED || p.tokens[p.len] === LIST_UNORDERED) &&
    token !== LIST_ITEM
  ) {
    endToken(p);
  }

  p.len += 1;
  p.tokens[p.len] = token;
  p.token = token;
  p.renderer.addToken(p.renderer.data, token);
}

/**
 * @param   {Parser} p
 * @param   {number} token
 * @param   {number} startIdx
 * @returns {number} */
function idxOfToken(p, token, startIdx) {
  while (startIdx <= p.len) {
    if (p.tokens[startIdx] === token) {
      return startIdx;
    }
    startIdx += 1;
  }
  return -1;
}

/**
 * End tokens until the parser has the given length.
 * @param   {Parser} p
 * @param   {number} len
 * @returns {void  } */
function endTokensToLen(p, len) {
  // TODO: specific token state should be reset only when the token ends
  p.fenceStart = 0;

  while (p.len > len) {
    endToken(p);
  }
}

/**
 * @param   {Parser} p
 * @param   {number} indent
 * @returns {number} */
function endTokensToIndent(p, indent) {
  let idx = 0;
  for (let i = 0; i <= p.len; i += 1) {
    indent -= p.spaces[i];
    if (indent < 0) {
      break;
    }
    switch (p.tokens[i]) {
      case CODE_BLOCK:
      case CODE_FENCE:
      case BLOCKQUOTE:
      case LIST_ITEM:
        idx = i;
        break;
    }
  }

  while (p.len > idx) {
    endToken(p);
  }

  return indent;
}

/**
 * @param   {Parser } p
 * @param   {Token  } listToken
 * @returns {boolean} added a new list */
function continueOrAddList(p, listToken) {
  /* will create a new list inside the last item
       if the amount of spaces is greater than the last one (with prefix)
       1. foo
          - bar      <- new nested ul
             - baz   <- new nested ul
          12. qux    <- cannot be nested in "baz" or "bar",
                        so it's a new list in "foo"
    */
  let listIdx = -1;
  let itemIdx = -1;

  for (let i = p.blockquoteIdx + 1; i <= p.len; i += 1) {
    if (p.tokens[i] === LIST_ITEM) {
      if (p.indentLen < p.spaces[i]) {
        itemIdx = -1;
        break;
      }
      itemIdx = i;
    } else if (p.tokens[i] === listToken) {
      listIdx = i;
    }
  }

  if (itemIdx === -1) {
    if (listIdx === -1) {
      endTokensToLen(p, p.blockquoteIdx);
      addToken(p, listToken);
      return true;
    }
    endTokensToLen(p, listIdx);
    return false;
  }
  endTokensToLen(p, itemIdx);
  addToken(p, listToken);
  return true;
}

/**
 * Create a new list
 * or continue the last one
 * @param   {Parser } p
 * @param   {number } prefixLength
 * @returns {void   } */
function addListItem(p, prefixLength) {
  addToken(p, LIST_ITEM);
  p.spaces[p.len] = p.indentLen + prefixLength;
  clearRootPending(p);
  p.token = MAYBE_TASK;
}

/**
 * @param   {Parser} p
 * @returns {void  } */
function clearRootPending(p) {
  p.indent = '';
  p.indentLen = 0;
  p.pending = '';
}

/**
 * @param   {number} charcode
 * @returns {boolean} */
function isDigit(charcode) {
  switch (charcode) {
    case 48:
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57:
      return true;
    default:
      return false;
  }
}

/**
 * @param   {number} charcode
 * @returns {boolean} */
function isDelimeter(charcode) {
  switch (charcode) {
    //   " "      ":"      ";"      ")"      ","      "!"      "."      "?"      "]"      "\n"
    case 32:
    case 58:
    case 59:
    case 41:
    case 44:
    case 33:
    case 46:
    case 63:
    case 93:
    case 10:
      return true;
    default:
      return false;
  }
}

/**
 * @param   {number} charcode
 * @returns {boolean} */
function isDelimeterOrNumber(charcode) {
  return isDigit(charcode) || isDelimeter(charcode);
}

/**
 * @param   {number} charcode
 * @returns {boolean} */
function isAlnum(charcode) {
  return (
    isDigit(charcode) || // 0-9
    (charcode >= 65 && charcode <= 90) || // A-Z
    (charcode >= 97 && charcode <= 122)
  ); // a-z
}

/**
 * Parse and render another chunk of markdown.
 * @param   {Parser} p
 * @param   {string} chunk
 * @returns {void  } */
export function parserWrite(p, chunk) {
  for (const char of chunk) {
    /*
         Handle newlines
        */
    if (p.token === NEWLINE) {
      switch (char) {
        case ' ':
          p.indentLen += 1;
          continue;
        case '\t':
          p.indentLen += 4;
          continue;
      }

      let indent = endTokensToIndent(p, p.indentLen);

      p.indentLen = 0;
      p.token = p.tokens[p.len];

      if (indent > 0) {
        parserWrite(p, ' '.repeat(indent));
      }
    }

    const pendingWithChar = p.pending + char;

    /*
        Token specific checks
        */
    switch (p.token) {
      case LINE_BREAK:
      case DOCUMENT:
      case BLOCKQUOTE:
      case LIST_ORDERED:
      case LIST_UNORDERED:
        console.assert(p.text.length === 0, 'Root should not have any text');

        switch (p.pending[0]) {
          case undefined:
            p.pending = char;
            continue;
          case ' ':
            console.assert(p.pending.length === 1);
            p.pending = char;
            p.indent += ' ';
            p.indentLen += 1;
            continue;
          case '\t':
            console.assert(p.pending.length === 1);
            p.pending = char;
            p.indent += '\t';
            p.indentLen += 4;
            continue;
          case '\n':
            console.assert(p.pending.length === 1);
            /*
                 Lists can have an empty line in between items:
                 1. foo
                 <empty>
                 2. bar
                */
            if (p.tokens[p.len] === LIST_ITEM && p.token === LINE_BREAK) {
              endToken(p);
              clearRootPending(p);
              p.pending = char;
              continue;
            }
            /*
                 Exit out of tokens
                 And ignore newlines in root
                */
            endTokensToLen(p, p.blockquoteIdx);
            clearRootPending(p);
            p.blockquoteIdx = 0;
            p.fenceStart = 0;
            p.pending = char;
            continue;
          /* Heading */
          case '#':
            switch (char) {
              case '#':
                if (p.pending.length < 6) {
                  p.pending = pendingWithChar;
                  continue;
                }
                break; // fail
              case ' ':
                endTokensToIndent(p, p.indentLen);
                addToken(p, headingFromLevel(p.pending.length));
                clearRootPending(p);
                continue;
            }
            break; // fail
          /* Blockquote */
          case '>': {
            const nextBlockquoteIdx = idxOfToken(
              p,
              BLOCKQUOTE,
              p.blockquoteIdx + 1
            );

            /*
                Only when there is no blockquote to the right of blockquoteIdx
                a new blockquote can be created
                */
            if (nextBlockquoteIdx === -1) {
              endTokensToLen(p, p.blockquoteIdx);
              p.blockquoteIdx += 1;
              p.fenceStart = 0;
              addToken(p, BLOCKQUOTE);
            } else {
              p.blockquoteIdx = nextBlockquoteIdx;
            }

            clearRootPending(p);
            p.pending = char;
            continue;
          }
          /* Horizontal Rule
               "-- - --- - --"
            */
          case '-':
          case '*':
          case '_':
            if (p.hrChars === 0) {
              console.assert(
                p.pending.length === 1,
                'Pending should be one character'
              );
              p.hrChars = 1;
              p.hrChar = p.pending;
            }

            if (p.hrChars > 0) {
              switch (char) {
                case p.hrChar:
                  p.hrChars += 1;
                  p.pending = pendingWithChar;
                  continue;
                case ' ':
                  p.pending = pendingWithChar;
                  continue;
                case '\n':
                  if (p.hrChars < 3) break;
                  endTokensToIndent(p, p.indentLen);
                  p.renderer.addToken(p.renderer.data, RULE);
                  p.renderer.endToken(p.renderer.data);
                  clearRootPending(p);
                  p.hrChars = 0;
                  continue;
              }

              p.hrChars = 0;
            }

            /* Unordered list
                /  * foo
                /  * *bar*
                /  * **baz**
                /*/
            if ('_' !== p.pending[0] && ' ' === p.pending[1]) {
              continueOrAddList(p, LIST_UNORDERED);
              addListItem(p, 2);
              parserWrite(p, pendingWithChar.slice(2));
              continue;
            }

            break; // fail
          /* Code Fence */
          case '`':
          /*  FIX: CommonMark also fences with tildes; upstream only handled
                backticks, so ~~~js turned into mangled strikethrough. Two
                tildes followed by anything but a third still fail out below
                and are re-dispatched as ~~strikethrough~~.
            */
          case '~': {
            const fenceChar = p.pending[0];
            /*  ``?
                      ^
                */
            if (p.pending.length < 3) {
              if (fenceChar === char) {
                p.pending = pendingWithChar;
                p.fenceStart = pendingWithChar.length;
                continue;
              }
              p.fenceStart = 0;
              break; // fail
            }

            if (fenceChar === char) {
              /*  ````?
                           ^
                    */
              if (p.pending.length === p.fenceStart) {
                p.pending = pendingWithChar;
                p.fenceStart = pendingWithChar.length;
              }
              /*  ```code`
                               ^
                    */
              else {
                addToken(p, PARAGRAPH);
                clearRootPending(p);
                p.fenceStart = 0;
                parserWrite(p, pendingWithChar);
              }
              continue;
            }

            if ('\n' === char) {
              /*  ```lang\n
                                ^
                    */
              endTokensToIndent(p, p.indentLen);

              addToken(p, CODE_FENCE);
              p.fenceChar = fenceChar;
              if (p.pending.length > p.fenceStart) {
                /*  FIX: emit the class a syntax highlighter looks for,
                    rather than the bare language name.
                */
                p.renderer.setAttr(
                  p.renderer.data,
                  LANG,
                  `language-${p.pending.slice(p.fenceStart)}`
                );
              }
              clearRootPending(p);
              p.token = NEWLINE;
              continue;
            }

            /*  ```lang\n
                        ^
                */
            p.pending = pendingWithChar;
            continue;
          }
          /*
            List Unordered for '+'
            The other list types are handled with HORIZONTAL_RULE
            */
          case '+':
            if (' ' !== char) break; // fail

            continueOrAddList(p, LIST_UNORDERED);
            addListItem(p, 2);
            continue;
          /* List Ordered */
          case '0':
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            /*
                12. foo
                   ^
                */
            if ('.' === p.pending[p.pending.length - 1]) {
              if (' ' !== char) break; // fail

              if (continueOrAddList(p, LIST_ORDERED) && p.pending !== '1.') {
                p.renderer.setAttr(
                  p.renderer.data,
                  START,
                  p.pending.slice(0, -1)
                );
              }
              addListItem(p, p.pending.length + 1);
              continue;
            } else {
              const charCode = char.charCodeAt(0);
              if (
                46 === charCode || // '.'
                isDigit(charCode) // 0-9
              ) {
                p.pending = pendingWithChar;
                continue;
              }
            }
            break; // fail
          /* Table */
          case '|':
            endTokensToLen(p, p.blockquoteIdx);

            addToken(p, TABLE);
            addToken(p, TABLE_ROW);

            p.pending = '';
            parserWrite(p, char);

            continue;
        }

        let toWrite = pendingWithChar;

        /* Add a line break and continue in previous token */
        if (p.token === LINE_BREAK) {
          p.token = p.tokens[p.len];
          p.renderer.addToken(p.renderer.data, LINE_BREAK);
          p.renderer.endToken(p.renderer.data);
        }
        /* Code Block */
        else if (p.indentLen >= 4) {
          /*
                Case where there are additional spaces
                after the indent that makes the code block
                _________________________
                       code
                ^^^^----indent
                    ^^^-part of code
                _________________________
                 \t   code
                ^^-----indent
                   ^^^-part of code
                */
          let codeStart = 0;
          for (; codeStart < 4; codeStart += 1) {
            if (p.indent[codeStart] === '\t') {
              codeStart = codeStart + 1;
              break;
            }
          }
          toWrite = p.indent.slice(codeStart) + pendingWithChar;
          addToken(p, CODE_BLOCK);
        }
        /* Paragraph */
        else {
          addToken(p, PARAGRAPH);
        }

        clearRootPending(p);
        parserWrite(p, toWrite);
        continue;
      case TABLE:
        if (p.tableState === 1) {
          switch (char) {
            case '-':
            case ' ':
            case '|':
            case ':':
              p.pending = pendingWithChar;
              continue;
            case '\n':
              p.tableState = 2;
              p.pending = '';
              continue;
            default:
              endToken(p);
              p.tableState = 0;
              break;
          }
        } else {
          switch (p.pending) {
            case '|':
              addToken(p, TABLE_ROW);
              p.pending = '';
              parserWrite(p, char);
              continue;
            case '\n':
              endToken(p);
              p.pending = '';
              p.tableState = 0;
              parserWrite(p, char);
              continue;
          }
        }
        break;
      case TABLE_ROW:
        switch (p.pending) {
          case '':
            break;
          case '|':
            addToken(p, TABLE_CELL);
            endToken(p);
            p.pending = '';
            parserWrite(p, char);
            continue;
          case '\n':
            endToken(p);
            p.tableState = Math.min(p.tableState + 1, 2);
            p.pending = '';
            parserWrite(p, char);
            continue;
          default:
            addToken(p, TABLE_CELL);
            parserWrite(p, char);
            continue;
        }
        break;
      case TABLE_CELL:
        if (p.pending === '|') {
          addText(p);
          endToken(p);
          p.pending = '';
          parserWrite(p, char);
          continue;
        }
        break;
      case CODE_BLOCK:
        switch (pendingWithChar) {
          case '\n    ':
          case '\n   \t':
          case '\n  \t':
          case '\n \t':
          case '\n\t':
            p.text += '\n';
            p.pending = '';
            continue;
          case '\n':
          case '\n ':
          case '\n  ':
          case '\n   ':
            p.pending = pendingWithChar;
            continue;
          default:
            if (p.pending.length !== 0) {
              addText(p);
              endToken(p);
              p.pending = char;
            } else {
              p.text += char;
            }
            continue;
        }
      case CODE_FENCE:
        /*  FIX: close on the character that opened the fence, not always
                a backtick.
            */
        if (char === p.fenceChar) {
          /*  ```\n<code>\n``??
                |                 ^
                */
          p.pending = pendingWithChar;
          continue;
        }
        switch (char) {
          case '\n':
            /*  ```\n<code>\n```\n
                |                    ^
                */
            if (pendingWithChar.length === p.fenceStart + p.fenceEnd + 1) {
              addText(p);
              endToken(p);
              p.pending = '';
              p.fenceStart = 0;
              p.fenceEnd = 0;
              p.fenceChar = '';
              p.token = NEWLINE;
              continue;
            }
            p.token = NEWLINE;
            break;
          case ' ':
            /*  ```\n<code>\n ??
                |                ^  (space after newline is allowed)
                */
            if (p.pending[0] === '\n') {
              p.pending = pendingWithChar;
              p.fenceEnd += 1;
              continue;
            }
            break;
        }
        // any other char
        p.text += p.pending;
        p.pending = char;
        p.fenceEnd = 1;
        continue;
      case CODE_INLINE:
        switch (char) {
          case '`':
            if (
              pendingWithChar.length ===
              p.fenceStart + Number(p.pending[0] === ' ') // 0 or 1 for space
            ) {
              addText(p);
              endToken(p);
              p.pending = '';
              p.fenceStart = 0;
            } else {
              p.pending = pendingWithChar;
            }
            continue;
          case '\n':
            p.text += p.pending;
            p.pending = '';
            p.token = LINE_BREAK;
            p.blockquoteIdx = 0;
            addText(p);
            continue;
          /* Trim space before ` */
          case ' ':
            p.text += p.pending;
            p.pending = char;
            continue;
          default:
            p.text += pendingWithChar;
            p.pending = '';
            continue;
        }
      /* Checkboxes */
      case MAYBE_TASK:
        switch (p.pending.length) {
          case 0:
            if ('[' !== char) break; // fail
            p.pending = pendingWithChar;
            continue;
          case 1:
            if (' ' !== char && 'x' !== char) break; // fail
            p.pending = pendingWithChar;
            continue;
          case 2:
            if (']' !== char) break; // fail
            p.pending = pendingWithChar;
            continue;
          case 3:
            if (' ' !== char) break; // fail
            p.renderer.addToken(p.renderer.data, CHECKBOX);
            if ('x' === p.pending[1]) {
              p.renderer.setAttr(p.renderer.data, CHECKED, '');
            }
            p.renderer.endToken(p.renderer.data);
            p.pending = ' ';
            continue;
        }

        p.token = p.tokens[p.len];
        p.pending = '';
        parserWrite(p, pendingWithChar);
        continue;
      case STRONG_AST:
      case STRONG_UND: {
        /** @type {string} */ let symbol = '*';
        /** @type {Token } */ let italic = ITALIC_AST;
        if (p.token === STRONG_UND) {
          symbol = '_';
          italic = ITALIC_UND;
        }

        if (symbol === p.pending) {
          addText(p);
          /* **Bold**
                          ^
                */
          if (symbol === char) {
            endToken(p);
            p.pending = '';
            continue;
          }
          /* **Bold*Bold->Em*
                          ^
                */
          addToken(p, italic);
          p.pending = char;
          continue;
        }

        break;
      }
      case ITALIC_AST:
      case ITALIC_UND: {
        /** @type {string} */ let symbol = '*';
        /** @type {Token } */ let strong = STRONG_AST;
        if (p.token === ITALIC_UND) {
          symbol = '_';
          strong = STRONG_UND;
        }

        switch (p.pending) {
          case symbol:
            if (symbol === char) {
              /* Decide between ***bold>em**em* and **bold*bold>em***
                                                 ^                       ^
                       With the help of the next character
                    */
              if (p.tokens[p.len - 1] === strong) {
                p.pending = pendingWithChar;
              }
              /* *em**bold
                           ^
                    */
              else {
                addText(p);
                addToken(p, strong);
                p.pending = '';
              }
            }
            /* *em*foo
                       ^
                */
            else {
              addText(p);
              endToken(p);
              p.pending = char;
            }
            continue;
          case symbol + symbol:
            const italic = p.token;
            addText(p);
            endToken(p);
            endToken(p);
            /* ***bold>em**em* or **bold*bold>em***
                               ^                      ^
                */
            if (symbol !== char) {
              addToken(p, italic);
              p.pending = char;
            } else {
              p.pending = '';
            }
            continue;
        }
        break;
      }
      case STRIKE:
        if ('~~' === pendingWithChar) {
          addText(p);
          endToken(p);
          p.pending = '';
          continue;
        }
        break;
      case MAYBE_EQ_BLOCK:
        /*
             \[?  or  $$?
               ^        ^
            */
        if (char === '\n') {
          addText(p);
          addToken(p, EQUATION_BLOCK);
          p.pending = '';
        } else {
          p.token = p.tokens[p.len];
          if (p.pending[0] === '\\') {
            p.text += '[';
          } else {
            p.text += '$$';
          }
          p.pending = '';
          parserWrite(p, char);
        }
        continue;
      case EQUATION_BLOCK:
        if ('\\]' === pendingWithChar || '$$' === pendingWithChar) {
          addText(p);
          endToken(p);
          p.pending = '';
          continue;
        }
        break;
      case EQUATION_INLINE:
        if ('\\)' === pendingWithChar || '$' === p.pending[0]) {
          addText(p);
          endToken(p);

          if (char === ')') {
            p.pending = '';
          } else {
            p.pending = char;
          }
          continue;
        }
        break;
      /* Raw URLs */
      case MAYBE_URL:
        if ('http://' === pendingWithChar || 'https://' === pendingWithChar) {
          addText(p);
          addToken(p, RAW_URL);
          p.pending = pendingWithChar;
          p.text = pendingWithChar;
        } else if (
          'http:/'[p.pending.length] === char ||
          'https:/'[p.pending.length] === char
        ) {
          p.pending = pendingWithChar;
        } else {
          p.token = p.tokens[p.len];
          parserWrite(p, char);
        }
        continue;
      case LINK:
      case IMAGE:
        if (']' === p.pending) {
          /*
                [Link](url)
                     ^
                */
          addText(p);
          if ('(' === char) {
            p.pending = pendingWithChar;
          } else {
            endToken(p);
            p.pending = char;
          }
          continue;
        }
        if (']' === p.pending[0] && '(' === p.pending[1]) {
          /*
                [Link](url)
                          ^
                */
          if (')' === char) {
            const type = p.token === LINK ? HREF : SRC;
            /*  FIX: `[t](url "Title")` carries a title after the destination.
                Upstream handed the whole thing over as the URL, which broke
                the link.
            */
            if (p.token === IMAGE && p.altText !== '') {
              p.renderer.setAttr(p.renderer.data, ALT, p.altText);
              p.altText = '';
            }
            const destination = p.pending.slice(2);
            const titled = /^(.*?)\s+(?:"([^"]*)"|'([^']*)')$/.exec(
              destination
            );
            p.renderer.setAttr(
              p.renderer.data,
              type,
              titled ? titled[1] : destination
            );
            if (titled) {
              p.renderer.setAttr(
                p.renderer.data,
                TITLE,
                titled[2] ?? titled[3]
              );
            }
            endToken(p);
            p.pending = '';
          } else {
            p.pending += char;
          }
          continue;
        }
        break;
      case RAW_URL:
        /* http://example.com?
                                 ^
            */
        if (' ' === char || '\n' === char || '\\' === char) {
          p.renderer.setAttr(p.renderer.data, HREF, p.pending);
          addText(p);
          endToken(p);
          p.pending = char;
        } else {
          p.text += char;
          p.pending = pendingWithChar;
        }
        continue;
      case MAYBE_BR:
        if (pendingWithChar.startsWith('<br')) {
          if (
            /* "<br" */
            pendingWithChar.length === 3 ||
            /* "<br " */
            char === ' ' ||
            /* "<br/" | "<br /" */
            (char === '/' &&
              (pendingWithChar.length === 4 ||
                p.pending[p.pending.length - 1] === ' '))
          ) {
            p.pending = pendingWithChar;
            continue;
          }

          /* "<br>" | "<br/>" */
          if (char === '>') {
            addText(p);
            p.token = p.tokens[p.len];
            p.renderer.addToken(p.renderer.data, LINE_BREAK);
            p.renderer.endToken(p.renderer.data);
            p.pending = '';
            continue;
          }
        }
        // Fail
        p.token = p.tokens[p.len];
        p.text += '<';
        p.pending = p.pending.slice(1);
        parserWrite(p, char);
        continue;
    }

    /*
        Common checks
        */
    switch (p.pending[0]) {
      /* Escape character */
      case '\\':
        if (
          p.token === IMAGE ||
          p.token === EQUATION_BLOCK ||
          p.token === EQUATION_INLINE
        )
          break;

        switch (char) {
          case '(':
            addText(p);
            addToken(p, EQUATION_INLINE);
            p.pending = '';
            continue;
          case '[':
            p.token = MAYBE_EQ_BLOCK;
            p.pending = pendingWithChar;
            continue;
          case '\n':
            // Escaped newline has the same affect as unescaped one
            p.pending = char;
            continue;
          default:
            let charcode = char.charCodeAt(0);
            p.pending = '';
            p.text +=
              isDigit(charcode) || // 0-9
              (charcode >= 65 && charcode <= 90) || // A-Z
              (charcode >= 97 && charcode <= 122) // a-z
                ? pendingWithChar
                : char;
            continue;
        }
      /* Newline */
      case '\n':
        switch (p.token) {
          case IMAGE:
          case EQUATION_BLOCK:
          case EQUATION_INLINE:
            break;
          case HEADING_1:
          case HEADING_2:
          case HEADING_3:
          case HEADING_4:
          case HEADING_5:
          case HEADING_6:
            addText(p);
            endTokensToLen(p, p.blockquoteIdx);
            p.blockquoteIdx = 0;
            p.pending = char;
            continue;
          default:
            addText(p);
            p.pending = char;
            p.token = LINE_BREAK;
            p.blockquoteIdx = 0;
            continue;
        }
        break;
      /* <br> */
      case '<':
        if (
          p.token !== IMAGE &&
          p.token !== EQUATION_BLOCK &&
          p.token !== EQUATION_INLINE
        ) {
          addText(p);
          p.pending = pendingWithChar;
          p.token = MAYBE_BR;
          continue;
        }
        break;
      /* `Code Inline` */
      case '`':
        if (p.token === IMAGE) break;

        if ('`' === char) {
          p.fenceStart += 1;
          p.pending = pendingWithChar;
        } else {
          p.fenceStart += 1; // started at 0, and first wasn't counted
          addText(p);
          addToken(p, CODE_INLINE);
          p.text = ' ' === char || '\n' === char ? '' : char; // trim leading space
          p.pending = '';
        }
        continue;
      case '_':
      case '*': {
        if (
          p.token === IMAGE ||
          p.token === EQUATION_BLOCK ||
          p.token === EQUATION_INLINE ||
          p.token === STRONG_AST
        )
          break;

        /** @type {Token} */ let italic = ITALIC_AST;
        /** @type {Token} */ let strong = STRONG_AST;
        const symbol = p.pending[0];
        if ('_' === symbol) {
          italic = ITALIC_UND;
          strong = STRONG_UND;
          /*  FIX: CommonMark only lets `_` open emphasis at a word
                    boundary, so identifiers keep their underscores:
                    snake_case_word, MAX_BUFFER_SIZE, __name__ mid-word.
                    `*` is unrestricted and keeps upstream's behaviour.
                */
          const prevChar =
            p.text.length > 0 ? p.text[p.text.length - 1] : p.lastTextChar;
          if (prevChar !== '' && isAlnum(prevChar.charCodeAt(0))) break;
        }

        if (p.pending.length === 1) {
          /* **Strong**
                    ^
                */
          if (symbol === char) {
            p.pending = pendingWithChar;
            continue;
          }
          /* *Em*
                    ^
                */
          if (' ' !== char && '\n' !== char) {
            addText(p);
            addToken(p, italic);
            p.pending = char;
            continue;
          }
        } else {
          /* ***Strong->Em***
                     ^
                */
          if (symbol === char) {
            addText(p);
            addToken(p, strong);
            addToken(p, italic);
            p.pending = '';
            continue;
          }
          /* **Strong**
                     ^
                */
          if (' ' !== char && '\n' !== char) {
            addText(p);
            addToken(p, strong);
            p.pending = char;
            continue;
          }
        }

        break;
      }
      case '~':
        if (p.token !== IMAGE && p.token !== STRIKE) {
          if ('~' === p.pending) {
            /* ~~Strike~~
                        ^
                    */
            if ('~' === char) {
              p.pending = pendingWithChar;
              continue;
            }
          } else {
            /* ~~Strike~~
                    |    ^
                    */
            if (' ' !== char && '\n' !== char) {
              addText(p);
              addToken(p, STRIKE);
              p.pending = char;
              continue;
            }
          }
        }
        break;
      /* $eq$ | $$eq$$ */
      case '$':
        if (p.token !== IMAGE && p.token !== STRIKE && '$' === p.pending) {
          /* $$EQUATION_BLOCK$$
                    ^
                */
          if ('$' === char) {
            p.token = MAYBE_EQ_BLOCK;
            p.pending = pendingWithChar;
            continue;
          }
          /* $123
                    ^
                */
          else if (isDelimeterOrNumber(char.charCodeAt(0))) {
            break;
          }
          /* $EQUATION_INLINE$
                    ^
                */
          else {
            addText(p);
            addToken(p, EQUATION_INLINE);
            p.pending = char;
            continue;
          }
        }
        break;
      /* [Image](url) */
      case '[':
        if (
          p.token !== IMAGE &&
          p.token !== LINK &&
          p.token !== EQUATION_BLOCK &&
          p.token !== EQUATION_INLINE &&
          ']' !== char
        ) {
          addText(p);
          addToken(p, LINK);
          p.pending = char;
          continue;
        }
        break;
      /* ![Image](url) */
      case '!':
        if (!(p.token === IMAGE) && '[' === char) {
          addText(p);
          addToken(p, IMAGE);
          p.pending = '';
          continue;
        }
        break;
      /* Trim spaces */
      case ' ':
        if (p.pending.length === 1 && ' ' === char) {
          continue;
        }
        break;
    }

    /* foo http://...
        |      ^
        */
    if (
      p.token !== IMAGE &&
      p.token !== LINK &&
      p.token !== EQUATION_BLOCK &&
      p.token !== EQUATION_INLINE &&
      'h' === char &&
      (' ' === p.pending || '' === p.pending)
    ) {
      p.text += p.pending;
      p.pending = char;

      p.token = MAYBE_URL;
      continue;
    }

    /*
        No check hit
        */
    p.text += p.pending;
    p.pending = char;
  }

  addText(p);
}

/**
 * @template T
 * @callback RendererAddToken
 * @param   {T    } data
 * @param   {Token} type
 * @returns {void } */

/**
 * @template T
 * @callback RendererEndToken
 * @param   {T    } data
 * @returns {void } */

/**
 * @template T
 * @callback RendererAddText
 * @param   {T     } data
 * @param   {string} text
 * @returns {void  } */

/**
 * @template T
 * @callback RendererSetAttr
 * @param   {T     } data
 * @param   {Attr  } type
 * @param   {string} value
 * @returns {void  } */

/**
 * The renderer interface.
 * @template T
 * @typedef  {object               } Renderer
 * @property {T                    } data      User data object. Available as first param in callbacks.
 * @property {RendererAddToken<T>} addToken When the tokens starts.
 * @property {RendererEndToken<T>} endToken When the token ends.
 * @property {RendererAddText <T>} addText  To append text to current token. Can be called multiple times or none.
 * @property {RendererSetAttr <T>} setAttr  Set additional attributes of current token eg. the link url.
 */

/** @typedef {Renderer<any>} AnyRenderer */

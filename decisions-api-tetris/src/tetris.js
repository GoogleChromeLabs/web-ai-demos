/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const COLS = 10;
export const ROWS = 20;

// Each piece lists its rotation states as cell offsets in a 4x4 box.
const SHAPES = {
  I: [
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
    ],
  ],
  O: [
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  T: [
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
  ],
  S: [
    [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
  ],
  Z: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [2, 0],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
  ],
  J: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [0, 2],
      [1, 2],
    ],
  ],
  L: [
    [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  ],
};

export const PIECES = Object.keys(SHAPES);

export const PIECE_NAMES = {
  I: 'I (straight line)',
  O: 'O (square)',
  T: 'T',
  S: 'S',
  Z: 'Z',
  J: 'J',
  L: 'L',
};

export const rotations = (type) => SHAPES[type].length;

export const cells = (piece) =>
  SHAPES[piece.type][piece.rot % rotations(piece.type)].map(([dx, dy]) => [
    piece.x + dx,
    piece.y + dy,
  ]);

export const emptyBoard = () =>
  Array.from({ length: ROWS }, () => Array(COLS).fill(null));

export function fits(board, piece) {
  return cells(piece).every(
    ([x, y]) => x >= 0 && x < COLS && y < ROWS && (y < 0 || !board[y][x]),
  );
}

export function dropY(board, piece) {
  let p = piece;
  while (fits(board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
  return p.y;
}

/** Writes `piece` into a copy of `board` and removes full rows. */
export function lock(board, piece) {
  const next = board.map((row) => row.slice());
  let overflow = false;
  for (const [x, y] of cells(piece)) {
    if (y < 0) overflow = true;
    else next[y][x] = piece.type;
  }
  const kept = next.filter((row) => row.some((c) => !c));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
  return { board: kept, cleared, overflow };
}

/** A 7-bag randomizer, so every piece shows up once per seven. */
export function bag() {
  let queue = [];
  return () => {
    if (!queue.length) {
      queue = PIECES.slice();
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    return queue.pop();
  };
}

export const spawn = (type) => ({
  type,
  rot: 0,
  x: 3,
  y: type === 'I' ? -1 : 0,
});

export function analyze(board) {
  const heights = [];
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let top = ROWS;
    for (let y = 0; y < ROWS; y++) {
      if (board[y][x]) {
        if (top === ROWS) top = y;
      } else if (top !== ROWS) {
        holes++;
      }
    }
    heights.push(ROWS - top);
  }
  let bumpiness = 0;
  for (let x = 1; x < COLS; x++) {
    bumpiness += Math.abs(heights[x] - heights[x - 1]);
  }
  return {
    heights,
    holes,
    bumpiness,
    maxHeight: Math.max(...heights),
    aggregateHeight: heights.reduce((a, b) => a + b, 0),
  };
}

/** Every distinct resting position of `type` reachable by rotating, shifting, and dropping. */
export function placements(board, type) {
  const before = analyze(board);
  const out = [];
  const seen = new Set();
  for (let rot = 0; rot < rotations(type); rot++) {
    for (let x = -3; x < COLS; x++) {
      const start = { ...spawn(type), rot, x };
      if (!fits(board, start)) continue;
      const piece = { ...start, y: dropY(board, start) };
      const key = cells(piece)
        .map(([cx, cy]) => `${cx},${cy}`)
        .sort()
        .join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      const result = lock(board, piece);
      const after = analyze(result.board);
      const xs = cells(piece).map(([cx]) => cx);
      out.push({
        piece,
        left: Math.min(...xs),
        right: Math.max(...xs),
        cleared: result.cleared,
        overflow: result.overflow,
        newHoles: after.holes - before.holes,
        after,
      });
    }
  }
  return out;
}

/** The classic hand-tuned weights (Yiyuan Lee), used as a baseline to compare against. */
export const heuristic = (p) =>
  p.overflow
    ? -Infinity
    : -0.51 * p.after.aggregateHeight +
      0.76 * p.cleared -
      0.36 * p.after.holes -
      0.18 * p.after.bumpiness;

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  COLS,
  ROWS,
  bag,
  cells,
  dropY,
  emptyBoard,
  fits,
  heuristic,
  lock,
  placements,
  rotations,
  spawn,
} from './tetris.js';
import { DecisionPlayer, QUESTION } from './decision-player.js';

const COLORS = {
  I: '#3ec5e0',
  O: '#f2c94c',
  T: '#a66bf0',
  S: '#4fc76b',
  Z: '#ec5b5b',
  J: '#4f6cf0',
  L: '#f2994a',
};
const LINE_POINTS = [0, 40, 100, 300, 1200];
const CELL = 28;

const $ = (id) => document.getElementById(id);
const ui = {
  board: $('board').getContext('2d'),
  next: $('next').getContext('2d'),
  overlay: $('overlay'),
  status: $('status'),
  progress: $('progress'),
  mode: $('mode'),
  backend: $('backend'),
  backendLabel: $('backend-label'),
  speed: $('speed'),
  start: $('start'),
  pause: $('pause'),
  score: $('score'),
  lines: $('lines'),
  pieces: $('pieces'),
  meta: $('meta'),
  ranking: $('ranking'),
  state: $('state'),
  hint: $('hint'),
};

const player = new DecisionPlayer();

let game = null;
// Bumped on every restart so a stale async turn knows to stop.
let generation = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newGame() {
  const nextType = bag();
  return {
    board: emptyBoard(),
    nextType,
    current: spawn(nextType()),
    next: nextType(),
    target: null,
    score: 0,
    lines: 0,
    pieces: 0,
    paused: false,
    over: false,
  };
}

/* Rendering */

function drawCell(ctx, x, y, color, size = CELL) {
  ctx.fillStyle = color;
  ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
}

function draw() {
  const ctx = ui.board;
  ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid');
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(COLS * CELL, y * CELL + 0.5);
    ctx.stroke();
  }
  if (!game) return;
  game.board.forEach((row, y) =>
    row.forEach((type, x) => type && drawCell(ctx, x, y, COLORS[type])),
  );
  const { current, target } = game;
  if (current && !game.over) {
    // Where the AI is heading, otherwise where a hard drop would land.
    const ghost = target ?? { ...current, y: dropY(game.board, current) };
    ctx.strokeStyle = COLORS[current.type];
    ctx.lineWidth = 2;
    for (const [x, y] of cells(ghost)) {
      if (y >= 0)
        ctx.strokeRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
    }
    ctx.lineWidth = 1;
    for (const [x, y] of cells(current)) {
      if (y >= 0) drawCell(ctx, x, y, COLORS[current.type]);
    }
  }
  drawNext();
  ui.score.textContent = game.score;
  ui.lines.textContent = game.lines;
  ui.pieces.textContent = game.pieces;
}

function drawNext() {
  const ctx = ui.next;
  const size = 16;
  ctx.clearRect(0, 0, 80, 48);
  const piece = { type: game.next, rot: 0, x: 0, y: 0 };
  const xs = cells(piece).map(([x]) => x);
  const ys = cells(piece).map(([, y]) => y);
  const ox =
    (5 - (Math.max(...xs) - Math.min(...xs) + 1)) / 2 - Math.min(...xs);
  const oy =
    (3 - (Math.max(...ys) - Math.min(...ys) + 1)) / 2 - Math.min(...ys);
  for (const [x, y] of cells(piece)) {
    drawCell(ctx, x + ox, y + oy, COLORS[game.next], size);
  }
}

function showOverlay(text) {
  ui.overlay.textContent = text;
  ui.overlay.hidden = !text;
}

/* Game rules */

function settle() {
  const { board, cleared, overflow } = lock(game.board, game.current);
  game.board = board;
  game.lines += cleared;
  game.score += LINE_POINTS[cleared];
  game.pieces++;
  game.target = null;
  game.current = spawn(game.next);
  game.next = game.nextType();
  if (overflow || !fits(game.board, game.current)) {
    game.over = true;
    showOverlay(`Game over\n${game.lines} lines`);
    ui.status.textContent = `Game over after ${game.pieces} pieces and ${game.lines} lines.`;
    ui.pause.disabled = true;
  }
  draw();
}

function tryMove(change) {
  const moved = { ...game.current, ...change(game.current) };
  if (!fits(game.board, moved)) return false;
  game.current = moved;
  draw();
  return true;
}

/* Players */

async function waitWhilePaused(gen) {
  while (game.paused && gen === generation) await sleep(100);
}

function renderDecision(ranked, chosen, extra) {
  const best = ranked.reduce((a, b) => (heuristic(b) > heuristic(a) ? b : a));
  ui.meta.textContent = `${ranked.length} landing spots${extra ?? '.'}`;
  ui.ranking.replaceChildren(
    ...ranked.slice(0, 6).map((p) => {
      const li = document.createElement('li');
      const label =
        p.text === undefined
          ? `heuristic ${heuristic(p).toFixed(2)}`
          : `clean ${Math.round(p.score * 100)}%`;
      li.textContent = `rot ${p.piece.rot}, columns ${p.left + 1}–${p.right + 1}: ${label}`;
      if (p === chosen) li.className = 'chosen';
      if (p.text !== undefined && p === best) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = ' (heuristic pick)';
        li.append(tag);
      }
      if (p.text !== undefined) {
        const text = document.createElement('span');
        text.className = 'spot';
        text.textContent = p.text;
        const bar = document.createElement('span');
        bar.className = 'bar';
        bar.style.width = `${p.score * 100}%`;
        li.append(text, bar);
      }
      return li;
    }),
  );
}

async function chooseMove(mode) {
  if (mode === 'model') {
    ui.status.textContent = `${player.name} is thinking…`;
    const { ranked, ms, asked } = await player.decide(
      game.board,
      game.current.type,
    );
    const chosen = ranked[0];
    ui.state.textContent =
      `State: ${chosen.text}\n\n` +
      `Question: ${QUESTION}\n\n` +
      `Answer: clean ${Math.round(chosen.score * 100)}%, ` +
      `messy ${Math.round((1 - chosen.score) * 100)}%.`;
    ui.status.textContent = `${player.name} is playing.`;
    renderDecision(
      ranked,
      chosen,
      `, ${asked} distinct sentences asked in ${Math.round(ms)} ms.`,
    );
    return chosen;
  }
  const ranked = placements(game.board, game.current.type).sort(
    (a, b) => heuristic(b) - heuristic(a),
  );
  ui.status.textContent = 'The heuristic baseline is playing.';
  renderDecision(ranked, ranked[0]);
  return ranked[0];
}

async function aiLoop(gen, mode) {
  while (gen === generation && !game.over) {
    await waitWhilePaused(gen);
    const move = await chooseMove(mode);
    if (gen !== generation) return;
    game.target = move.piece;
    draw();
    const step = () => sleep(Number(ui.speed.value));
    // Rotate at the spawn position, then shift, then drop. If the route is
    // blocked (a tall stack near the spawn), jump straight to the target.
    let routed = true;
    for (let r = 0; r < move.piece.rot && routed; r++) {
      routed = tryMove((p) => ({ rot: (p.rot + 1) % rotations(p.type) }));
      await step();
    }
    while (routed && game.current.x !== move.piece.x) {
      const dx = Math.sign(move.piece.x - game.current.x);
      routed = tryMove((p) => ({ x: p.x + dx }));
      await step();
      await waitWhilePaused(gen);
      if (gen !== generation) return;
    }
    if (!routed) game.current = { ...move.piece, y: game.current.y };
    while (tryMove((p) => ({ y: p.y + 1 }))) {
      if (Number(ui.speed.value)) await sleep(Number(ui.speed.value) / 4);
      if (gen !== generation) return;
    }
    game.current = move.piece;
    settle();
    await step();
  }
}

async function humanLoop(gen) {
  ui.status.textContent = 'Your turn.';
  while (gen === generation && !game.over) {
    const level = Math.floor(game.lines / 10);
    await sleep(Math.max(80, 600 - level * 50));
    if (gen !== generation) return;
    if (game.paused || game.over) continue;
    if (!tryMove((p) => ({ y: p.y + 1 }))) settle();
  }
}

document.addEventListener('keydown', (event) => {
  if (!game || game.over || game.paused || ui.mode.value !== 'human') return;
  const actions = {
    ArrowLeft: () => tryMove((p) => ({ x: p.x - 1 })),
    ArrowRight: () => tryMove((p) => ({ x: p.x + 1 })),
    ArrowDown: () => tryMove((p) => ({ y: p.y + 1 })),
    ArrowUp: () => {
      // Basic wall kicks: try in place, then one or two cells sideways.
      for (const dx of [0, -1, 1, -2, 2]) {
        if (
          tryMove((p) => ({
            rot: (p.rot + 1) % rotations(p.type),
            x: p.x + dx,
          }))
        )
          return;
      }
    },
    ' ': () => {
      game.current = { ...game.current, y: dropY(game.board, game.current) };
      settle();
    },
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  action();
});

/* Model loading */

// Shared by every caller, so starting a game while a model loads waits for
// the same download.
async function loadModel() {
  ui.progress.hidden = false;
  ui.progress.max = 1;
  ui.progress.value = 0;
  ui.status.textContent = `Loading ${player.name}…`;
  try {
    await player.load((fraction) => {
      ui.progress.value = fraction;
      ui.status.textContent = `Loading ${player.name}: ${Math.round(fraction * 100)}%…`;
    });
  } finally {
    ui.progress.hidden = true;
  }
  ui.backendLabel.hidden = player.native;
}

/* Controls */

ui.start.addEventListener('click', async () => {
  const gen = ++generation;
  const mode = ui.mode.value;
  ui.hint.hidden = mode !== 'human';
  ui.start.disabled = true;
  if (mode === 'model') {
    try {
      await loadModel();
    } catch (error) {
      console.error(error);
      ui.status.textContent = `Could not load the model: ${error.message}`;
      ui.start.disabled = false;
      return;
    }
  }
  if (gen !== generation) return;
  game = newGame();
  showOverlay('');
  ui.start.disabled = false;
  ui.start.textContent = 'Restart';
  ui.pause.disabled = false;
  ui.pause.textContent = 'Pause';
  ui.ranking.replaceChildren();
  ui.meta.textContent = 'No decision yet.';
  draw();
  (mode === 'human' ? humanLoop(gen) : aiLoop(gen, mode)).catch((error) => {
    console.error(error);
    ui.status.textContent = `Stopped: ${error.message}`;
  });
});

ui.pause.addEventListener('click', () => {
  if (!game || game.over) return;
  game.paused = !game.paused;
  ui.pause.textContent = game.paused ? 'Resume' : 'Pause';
  showOverlay(game.paused ? 'Paused' : '');
});

ui.mode.addEventListener('change', () => {
  ui.start.textContent = 'Start';
  ui.backendLabel.hidden = ui.mode.value !== 'model' || player.native;
});

// Switching takes effect with the next piece; the game waits while the other
// model loads.
ui.backend.addEventListener('change', () => {
  player.backend = ui.backend.value;
  if (!game || game.over || ui.mode.value !== 'model') return;
  loadModel().catch((error) => {
    console.error(error);
    ui.status.textContent = `Could not load ${player.name}: ${error.message}`;
  });
});

draw();

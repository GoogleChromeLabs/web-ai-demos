/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Plays Tetris through the proposed Decisions API (`DecisionModel`), using the
// polyfill from `built-in-ai-task-apis-polyfills` when the browser has no
// native implementation. The polyfill runs either Laya or open-jev.
//
// The phrasing follows the Tetris demo on https://brainfunctioncollapse.com/laya:
// each landing spot becomes a one-sentence input, and the model is asked what
// it sees ("how does the stack look?") with two options. The code does the
// counting and hands the model the conclusion in words.

import { COLS, ROWS, analyze, cells, placements } from './tetris.js';

export const BACKENDS = {
  laya: {
    name: 'Laya',
    // The checkpoint this phrasing was tuned on. The polyfill's default is
    // `convaiinnovations/laya`, a separate ~0.8 GB download.
    config: { backend: 'laya', model: 'aac6fef/laya-mlx' },
  },
  'open-jev': {
    name: 'open-jev',
    config: { backend: 'open-jev' },
  },
};

export const QUESTION = 'How does the stack look after the piece lands?';

const SCHEMA = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  questions: [
    {
      id: 'look',
      type: 'choice',
      prompt: QUESTION,
      options: [
        { label: 'clean', description: 'flat with no holes' },
        { label: 'messy', description: 'holes or a tall tower' },
      ],
    },
  ],
};

const HOLES = [
  'no holes',
  'one hole',
  'two holes',
  'three holes',
  'many holes',
];
const BUMPS = ['no bump', 'a small bump', 'a big bump', 'a tall tower'];
const LINES = ['', 'one line', 'two lines', 'three lines', 'four lines'];

// Maps `value` to a level from 0 to 3: 0 up to `from`, then one level per `step`.
const grade = (value, from, step) =>
  Math.max(0, Math.min(3, Math.ceil((value - from) / step)));

/**
 * One landing spot in a sentence. The bump is graded against the board as it
 * is now (the surface getting rougher, or the piece sticking up above the
 * average column, whichever is worse), so late-game spots still read
 * differently from each other.
 */
export function describeSpot(p, before) {
  const sum = before.heights.reduce((a, b) => a + b, 0);
  const top = Math.max(...cells(p.piece).map(([, y]) => ROWS - y));
  const bump = Math.max(
    grade(p.after.bumpiness - before.bumpiness, 0, 2),
    grade(top * COLS - sum, 3 * COLS, COLS),
  );
  const holes = HOLES[Math.min(4, Math.max(0, p.newHoles))];
  return (
    `The piece leaves ${holes} under it and makes ${BUMPS[bump]} on top.` +
    (p.cleared ? ` It completes ${LINES[p.cleared]}.` : '')
  );
}

let polyfilled = null;

/** Loads the polyfill unless the browser ships `DecisionModel` itself. */
function ensureDecisionModel() {
  polyfilled ??=
    'DecisionModel' in self
      ? Promise.resolve(false)
      : import('built-in-ai-task-apis-polyfills/decision-model').then(
          () => true,
        );
  return polyfilled;
}

export class DecisionPlayer {
  #models = new Map();
  #native = false;
  backend = 'laya';

  /** Whether the backend switch applies, which it only does for the polyfill. */
  get native() {
    return this.#native;
  }

  get name() {
    return this.#native ? 'the built-in model' : BACKENDS[this.backend].name;
  }

  /**
   * Creates the model for the current backend, or reuses it. Each backend
   * keeps its own instance (the polyfill gives each one a worker), so
   * switching back and forth only downloads and loads each model once.
   * `onProgress` gets a fraction from 0 to 1.
   */
  async load(onProgress) {
    this.#native = !(await ensureDecisionModel());
    const key = this.#native ? 'native' : this.backend;
    if (!this.#models.has(key)) {
      // The polyfill reads its backend from this global when `create()` runs.
      if (!this.#native) self.DECISION_MODEL_CONFIG = BACKENDS[key].config;
      const created = (async () => {
        if ((await DecisionModel.availability(SCHEMA)) === 'unavailable') {
          throw new Error(`${this.name} cannot run in this browser.`);
        }
        return DecisionModel.create({
          ...SCHEMA,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) =>
              onProgress?.(e.loaded),
            );
          },
        });
      })();
      this.#models.set(key, created);
      created.catch(() => this.#models.delete(key));
    }
    return this.#models.get(key);
  }

  /**
   * Asks the model how the stack looks for every landing spot and returns the
   * spots ranked by P(clean), best first. Spots that share a sentence share
   * the answer, so each distinct sentence is asked once. The sort is stable,
   * so ties go to the leftmost spot.
   */
  async decide(board, current) {
    const model = await this.load();
    const before = analyze(board);
    const spots = placements(board, current)
      .sort((a, b) => a.left - b.left || a.piece.rot - b.piece.rot)
      .map((p) => ({ ...p, text: describeSpot(p, before) }));
    const answers = new Map();
    const started = performance.now();
    for (const { text } of spots) {
      if (answers.has(text)) continue;
      const { look } = await model.decide(text);
      const clean = look.probabilities.find((p) => p.label === 'clean');
      answers.set(text, clean.probability);
    }
    const ms = performance.now() - started;
    const ranked = spots
      .map((p) => ({ ...p, score: answers.get(p.text) }))
      .sort((a, b) => b.score - a.score);
    return { ranked, ms, asked: answers.size };
  }
}

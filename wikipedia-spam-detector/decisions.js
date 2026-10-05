/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Three decisions about every edit, built on the proposed Decisions API, one
// per question type: a `boolean` spam check, a `choice` between edit types,
// and a `score` for how much the edit changes. They run in one of three modes:
// one model per decision, all at once or one after another, or a single model
// that answers all three questions. Chrome does not ship the API yet, so the
// polyfill stands in when `DecisionModel` is missing. It answers with a small
// encoder model that scores the options in one forward pass, which is fast
// enough to keep up with the live edit stream.

const CONTEXT =
  'The input is an edit to an English Wikipedia page, in wikitext: the page title, the edit summary, the size change in bytes, the text the edit added, and the text it removed.';
const EXPECTED_INPUTS = [{ type: 'text', languages: ['en'] }];

const schema = (question) => ({
  context: CONTEXT,
  expectedInputs: EXPECTED_INPUTS,
  questions: [question],
});

export const DECISIONS = {
  spam: schema({
    id: 'spam',
    type: 'boolean',
    prompt:
      'Is this edit spam, meaning it adds advertising, promotional language, self-promotion, or links to commercial websites?',
  }),
  // The first three categories are the ones patrollers act on. "test" is
  // Wikipedia's own term for good-faith experiments by newcomers, and "revert"
  // is the counter-vandalism intention from research on edit intentions
  // (Yang et al., 2017). Without it, a revert reads like a large unexplained
  // change.
  category: schema({
    id: 'category',
    type: 'choice',
    prompt: 'Which kind of edit is this?',
    options: [
      {
        label: 'legit',
        description:
          'A good-faith improvement, such as new facts, copy-editing, citations, links, or formatting',
      },
      {
        label: 'spam',
        description:
          'Advertising, promotional wording, or links to commercial or self-promotional websites',
      },
      {
        label: 'vandalism',
        description:
          'Deliberate damage, such as nonsense, insults, jokes, false information, or blanking content',
      },
      {
        label: 'test',
        description:
          'A newcomer experimenting, such as stray characters, "hello", or sample formatting, without bad intent',
      },
      // Without the hint at the edit summary, the model takes many small
      // corrections for reverts.
      {
        label: 'revert',
        description:
          'The edit summary says it reverted, undid, or rolled back an earlier edit',
      },
    ],
  }),
  // Short descriptions score better than labeled rubric entries such as
  // "Minor: a few words", which pull every answer toward the middle.
  contribution: schema({
    id: 'contribution',
    type: 'score',
    prompt: 'How much text does this edit add or remove?',
    options: [
      { label: '1', description: 'one character or word' },
      { label: '2', description: 'a few words' },
      { label: '3', description: 'one sentence' },
      { label: '4', description: 'a paragraph or table' },
      { label: '5', description: 'a whole article or most of the page' },
    ],
  }),
};

// Starting budgets for the diff text, in characters. The model counts tokens,
// and every schema leaves a different amount of room, so an input that still
// doesn't fit is cut further and tried again.
const MAX_ADDED = 1200;
const MAX_REMOVED = 300;
const MIN_TEXT = 100;

// The models the polyfill can run, as `window.DECISION_MODEL_CONFIG` values.
// The open-jev models need WebGPU, and `availability()` reports them as
// unavailable without it.
export const MODELS = {
  laya: {
    name: 'Laya, English (ModernBERT, 0.85 GB)',
    config: { backend: 'laya' },
  },
  'laya-multilingual': {
    name: 'Laya, multilingual (mmBERT, 0.68 GB)',
    config: { backend: 'laya', subfolder: 'multilingual' },
  },
  'laya-typed-decisions': {
    name: 'Laya, fine-tuned for business workflows (0.85 GB)',
    config: { backend: 'laya', subfolder: 'typed-decisions' },
  },
  'kev-0.6b': {
    name: 'kev 0.6B (Qwen3, 0.34 GB, WebGPU)',
    config: { backend: 'open-jev', model: 'kev-0.6b' },
  },
  'open-jev': {
    name: 'open-jev (DeBERTa-v3-large, 0.35 GB, WebGPU)',
    config: { backend: 'open-jev', model: 'open-jev' },
  },
  'kev-4b': {
    name: 'kev 4B (Qwen3, 2.3 GB, WebGPU)',
    config: { backend: 'open-jev', model: 'kev-4b' },
  },
};
export const DEFAULT_MODEL = 'laya';

let native;

const loadDecisionModel = async () => {
  // Settled before the import, because the polyfill defines the global itself.
  native ??= 'DecisionModel' in self;
  if (!native && !window.DECISION_MODEL_CONFIG) {
    useModel(DEFAULT_MODEL);
  }
  if (!native) {
    await import('built-in-ai-task-apis-polyfills/decision-model');
  }
  return self.DecisionModel;
};

// Whether the browser's own API answers. Its model is the browser's choice.
export const isNative = async () => {
  await loadDecisionModel();
  return native;
};

// Which implementation answers: the browser's own, or the polyfill with the
// backend it was configured with.
export const implementation = async () => {
  await loadDecisionModel();
  return native
    ? 'native API'
    : `polyfill (${window.DECISION_MODEL_CONFIG.backend})`;
};

const AVAILABILITY_ORDER = [
  'unavailable',
  'downloadable',
  'downloading',
  'available',
];

// The least ready of the three schemas.
export const availability = async () => {
  const DecisionModel = await loadDecisionModel();
  const states = await Promise.all(
    Object.values(DECISIONS).map((s) => DecisionModel.availability(s)),
  );
  return states.reduce((a, b) =>
    AVAILABILITY_ORDER.indexOf(a) <= AVAILABILITY_ORDER.indexOf(b) ? a : b,
  );
};

// All three questions in one schema, which the explainer recommends: the
// input is encoded once for all of them.
const COMBINED = {
  context: CONTEXT,
  expectedInputs: EXPECTED_INPUTS,
  questions: Object.values(DECISIONS).map(({ questions }) => questions[0]),
};

export const MODES = {
  parallel: 'Three models, in parallel',
  sequential: 'Three models, one after another',
  combined: 'One model, three questions',
};

// The separate models serve both the parallel and the sequential mode.
let separateModels = null;
let combinedModel = null;
// Counts model switches, so models that finish loading after a switch are
// thrown away.
let generation = 0;
// Aborts the downloads of the previous choice when the model is switched.
let switchController = new AbortController();

/**
 * Switches the polyfill to one of `MODELS`. The polyfill reads its
 * configuration in `create()`, so the existing models are destroyed and the
 * next `prepareModels()` creates new ones.
 */
export function useModel(id) {
  window.DECISION_MODEL_CONFIG = { ...MODELS[id].config };
  generation++;
  switchController.abort(
    new DOMException('The model was switched.', 'AbortError'),
  );
  switchController = new AbortController();
  for (const model of Object.values(separateModels ?? {})) {
    model.destroy();
  }
  combinedModel?.destroy();
  separateModels = null;
  combinedModel = null;
}

// Destroys models that were created for an earlier model choice.
const keepIfCurrent = (models, created) => {
  if (created === generation) {
    return;
  }
  for (const model of models) {
    model.destroy();
  }
  throw new DOMException('The model was switched.', 'AbortError');
};

// Reports progress only while the model it belongs to is still the choice.
const monitorWith = (onProgress, created) => (m) =>
  m.addEventListener('downloadprogress', (e) => {
    if (created === generation) {
      onProgress?.(e.loaded);
    }
  });

/**
 * Creates the models a mode needs, unless they exist. Of the separate models,
 * the first one downloads the weights and the others start once those are
 * cached, so nothing downloads twice.
 */
export async function prepareModels(mode, { onProgress } = {}) {
  const DecisionModel = await loadDecisionModel();
  const created = generation;
  const { signal } = switchController;
  if (mode === 'combined') {
    if (!combinedModel) {
      const model = await DecisionModel.create({
        ...COMBINED,
        signal,
        monitor: monitorWith(onProgress, created),
      });
      keepIfCurrent([model], created);
      combinedModel = model;
    }
    return;
  }
  if (separateModels) {
    return;
  }
  const [[firstId, firstSchema], ...rest] = Object.entries(DECISIONS);
  const first = await DecisionModel.create({
    ...firstSchema,
    signal,
    monitor: monitorWith(onProgress, created),
  });
  try {
    const others = await Promise.all(
      rest.map(([, s]) => DecisionModel.create({ ...s, signal })),
    );
    keepIfCurrent([first, ...others], created);
    separateModels = Object.fromEntries([
      [firstId, first],
      ...rest.map(([id], i) => [id, others[i]]),
    ]);
  } catch (err) {
    first.destroy();
    throw err;
  }
}

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

const describeEdit = ({ title, summary, sizeChange, added, removed }, budget) =>
  [
    `Page: ${title}`,
    `Edit summary: ${summary || '(none)'}`,
    `Size change: ${sizeChange > 0 ? '+' : ''}${sizeChange} bytes`,
    `Added:\n${clip(added, budget) || '(nothing)'}`,
    // Removed text matters most when nothing was added, as in blanking.
    `Removed:\n${clip(removed, added ? Math.min(MAX_REMOVED, budget) : budget) || '(nothing)'}`,
  ].join('\n');

// The explainer keys `probabilities` by label, and the polyfill lists them in
// option order. Both become a list.
const probabilityList = (probabilities) =>
  Array.isArray(probabilities)
    ? probabilities
    : Object.entries(probabilities).map(([label, probability]) => ({
        label,
        probability,
      }));

// Asks a model about an edit, cutting the diff further whenever the input
// doesn't fit, and resolves to the answers of the questions `ids`.
async function decide(model, ids, edit, signal) {
  let budget = MAX_ADDED;
  const start = performance.now();
  for (;;) {
    try {
      const result = await model.decide(describeEdit(edit, budget), {
        signal,
      });
      const truncated =
        Math.max(edit.added.length, edit.removed.length) > budget;
      const time = performance.now() - start;
      return Object.fromEntries(
        ids.map((id) => {
          const probabilities = probabilityList(result[id].probabilities);
          return [
            id,
            {
              ...result[id],
              probabilities,
              probabilityOf: (label) =>
                probabilities.find((p) => p.label === label)?.probability ?? 0,
              truncated,
              time,
            },
          ];
        }),
      );
    } catch (err) {
      if (err.name !== 'QuotaExceededError' || budget <= MIN_TEXT) {
        throw err;
      }
      budget = Math.max(MIN_TEXT, Math.floor(budget / 2));
    }
  }
}

/**
 * Runs every decision on an edit in the given mode. Resolves to the answers
 * keyed by decision, each with the time it took, plus the time of the whole
 * pipeline.
 */
export async function decideAll(mode, edit, { signal } = {}) {
  const start = performance.now();
  let answers;
  if (mode === 'combined') {
    answers = await decide(combinedModel, Object.keys(DECISIONS), edit, signal);
  } else if (mode === 'parallel') {
    const parts = await Promise.all(
      Object.entries(separateModels).map(([id, model]) =>
        decide(model, [id], edit, signal),
      ),
    );
    answers = Object.assign({}, ...parts);
  } else {
    answers = {};
    for (const [id, model] of Object.entries(separateModels)) {
      Object.assign(answers, await decide(model, [id], edit, signal));
    }
  }
  return { answers, time: performance.now() - start };
}

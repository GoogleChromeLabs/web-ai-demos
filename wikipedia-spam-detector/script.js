/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { connectToEditStream, fetchEditText } from './wikipedia.js';
import {
  DECISIONS,
  DEFAULT_MODEL,
  MODELS,
  MODES,
  availability,
  decideAll,
  implementation,
  isNative,
  prepareModels,
  useModel,
} from './decisions.js';

// Edits arrive faster than a diff can be fetched and checked now and then. The
// queue keeps the most recent ones and drops the oldest.
const MAX_QUEUE = 10;
const MAX_FEED = 150;
// The explainer leaves acting on a decision to the page. An edit type counts
// only when the model is at least this confident, since the small polyfill
// model often spreads its answer across several types.
const CONFIDENT = 0.5;
// Timings are averaged over this many recent edits per mode.
const TIMING_WINDOW = 20;

const $ = (id) => document.getElementById(id);
const toggleButton = $('toggle');
const namespaceSelect = $('namespace');
const skipBotsCheckbox = $('skip-bots');
const showSelect = $('show');
const modeSelect = $('mode');
const modelSelect = $('model');
const thresholdInput = $('threshold');
const thresholdValue = $('threshold-value');
const streamDot = $('stream-dot');
const streamStatus = $('stream-status');
const modelStatus = $('model-status');
const progress = $('progress');
const feed = $('feed');
const empty = $('empty');
const template = $('edit-template');
const timing = $('timing');

const CATEGORY_NAMES = {
  legit: 'Legit',
  spam: 'Spam',
  vandalism: 'Vandalism',
  test: 'Test edit',
  revert: 'Revert',
};
const CONTRIBUTION_NAMES = Object.fromEntries(
  DECISIONS.contribution.questions[0].options.map(({ label, description }) => [
    label,
    description,
  ]),
);
const DECISION_NAMES = {
  spam: 'spam',
  category: 'edit type',
  contribution: 'contribution',
};

const threshold = () => Number(thresholdInput.value);

const stats = { seen: 0, checked: 0, vandalism: 0, filtered: 0, dropped: 0 };
// P(spam) of every checked edit, so moving the threshold recounts them all.
const spamProbabilities = [];
// The most recent timings of each mode, so the modes can be compared.
const recentTimes = Object.fromEntries(Object.keys(MODES).map((m) => [m, []]));

const percent = (p) => `${Math.round(p * 100)}%`;
const ms = (time) => `${Math.round(time)} ms`;

const renderStats = () => {
  $('stat-spam').textContent = spamProbabilities
    .filter((p) => p >= threshold())
    .length.toLocaleString();
  for (const [key, value] of Object.entries(stats)) {
    $(`stat-${key}`).textContent = value.toLocaleString();
  }
  renderTiming();
};

function renderTiming() {
  const items = Object.entries(recentTimes)
    .filter(([, times]) => times.length)
    .map(([mode, times]) => {
      const average = (key) =>
        times.reduce((sum, t) => sum + t[key], 0) / times.length;
      const li = document.createElement('li');
      li.classList.toggle('current', mode === modeSelect.value);
      const parts =
        mode === 'combined'
          ? 'one pass for all three'
          : Object.entries(DECISION_NAMES)
              .map(([id, name]) => `${name} ${ms(average(id))}`)
              .join(', ');
      li.textContent = `${MODES[mode]}: ${ms(average('pipeline'))} per edit (${parts}), last ${times.length} edits`;
      return li;
    });
  if (items.length) {
    timing.replaceChildren(...items);
  } else {
    const li = document.createElement('li');
    li.textContent =
      'Timings appear once the first edits are checked. Switch modes to compare them.';
    timing.replaceChildren(li);
  }
}

const modelPromises = {};
let streamController = null;
const queue = [];
let processing = false;

// Counts status checks, so a slow check for a model that was switched away
// from doesn't overwrite the current one.
let statusCheck = 0;

async function showModelStatus() {
  const check = ++statusCheck;
  try {
    const [impl, status] = await Promise.all([
      implementation(),
      availability(),
    ]);
    if (check !== statusCheck) {
      return;
    }
    modelStatus.textContent = `${impl}, ${status}`;
    // The open-jev models are unavailable without WebGPU.
    toggleButton.disabled = status === 'unavailable';
  } catch (err) {
    if (check === statusCheck) {
      modelStatus.textContent = `${err.name}: ${err.message}`;
      toggleButton.disabled = true;
    }
  }
}

// First called from the Start click, whose user activation a model download
// needs. The parallel and sequential modes share their models.
function ensureModels(mode = modeSelect.value) {
  const key = mode === 'combined' ? 'combined' : 'separate';
  if (modelPromises[key]) {
    return modelPromises[key];
  }
  const promise = (async () => {
    modelStatus.textContent = 'loading…';
    progress.hidden = false;
    progress.value = 0;
    try {
      await prepareModels(mode, {
        onProgress: (loaded) => {
          progress.value = loaded;
          modelStatus.textContent = `downloading, ${percent(loaded)}`;
        },
      });
      await showModelStatus();
    } catch (err) {
      // After a model switch, the next model's promise is already in place.
      if (modelPromises[key] === promise) {
        delete modelPromises[key];
        modelStatus.textContent = `${err.name}: ${err.message}`;
      }
      throw err;
    } finally {
      progress.hidden = true;
    }
  })();
  modelPromises[key] = promise;
  return promise;
}

const passesFilters = (change) =>
  (namespaceSelect.value === '*' ||
    String(change.namespace) === namespaceSelect.value) &&
  !(skipBotsCheckbox.checked && change.bot);

function onEdit(change) {
  stats.seen++;
  if (!passesFilters(change)) {
    stats.filtered++;
  } else {
    queue.push(change);
    if (queue.length > MAX_QUEUE) {
      queue.shift();
      stats.dropped++;
    }
    processQueue();
  }
  renderStats();
}

async function processQueue() {
  if (processing) {
    return;
  }
  processing = true;
  while (queue.length && streamController && !streamController.signal.aborted) {
    const change = queue.shift();
    try {
      await checkEdit(change, streamController.signal);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn(`Skipped “${change.title}”:`, err);
      }
    }
  }
  processing = false;
}

async function checkEdit(change, signal) {
  const { added, removed } = await fetchEditText(change, signal);
  // Whitespace and markup-only changes leave nothing to judge.
  if (!added && !removed) {
    stats.filtered++;
    renderStats();
    return;
  }
  const edit = {
    title: change.title,
    summary: change.summary,
    sizeChange: change.sizeChange,
    added,
    removed,
  };
  const mode = modeSelect.value;
  await ensureModels(mode);
  const { answers, time } = await decideAll(mode, edit, { signal });
  stats.checked++;
  const times = recentTimes[mode];
  times.push({
    pipeline: time,
    ...Object.fromEntries(
      Object.entries(answers).map(([id, { time }]) => [id, time]),
    ),
  });
  if (times.length > TIMING_WINDOW) {
    times.shift();
  }
  spamProbabilities.push(answers.spam.probabilityOf('true'));
  if (
    answers.category.label === 'vandalism' &&
    answers.category.confidence >= CONFIDENT
  ) {
    stats.vandalism++;
  }
  renderStats();
  addCard(change, edit, answers);
}

function formatSize(change) {
  const size = change.sizeChange;
  return `${size > 0 ? '+' : size < 0 ? '−' : '±'}${Math.abs(size).toLocaleString()}`;
}

// The spam verdict and the filter both depend on the threshold, so they are
// applied again whenever it moves.
function applyVerdict(card) {
  const spam = Number(card.dataset.spamProbability) >= threshold();
  const { category } = card.dataset;
  card.dataset.flag = spam
    ? 'spam'
    : category === 'vandalism'
      ? 'vandalism'
      : '';
  card.querySelector('[data-decision="spam"] .value').textContent = spam
    ? 'Spam'
    : 'Not spam';
  card.querySelector('[data-decision="spam"]').classList.toggle('hit', spam);
  const show = showSelect.value;
  card.hidden =
    (show === 'spam' && !spam) ||
    (show === 'vandalism' && category !== 'vandalism') ||
    (show === 'flagged' &&
      !spam &&
      !['spam', 'vandalism', 'test'].includes(category));
}

function renderSpam(panel, answer) {
  const p = answer.probabilityOf('true');
  panel.querySelector('.bar-fill').style.width = percent(p);
  panel.querySelector('.detail').textContent =
    `P(spam) ${percent(p)} · ${ms(answer.time)}`;
}

function renderCategory(panel, answer) {
  const confident = answer.confidence >= CONFIDENT;
  panel.querySelector('.value').textContent =
    CATEGORY_NAMES[answer.label] + (confident ? '' : ' (unsure)');
  panel.dataset.label = answer.label;
  panel.classList.toggle('unsure', !confident);
  const stack = panel.querySelector('.stack');
  for (const { label, probability } of answer.probabilities) {
    const segment = document.createElement('span');
    segment.dataset.label = label;
    segment.style.flexGrow = probability;
    segment.title = `${CATEGORY_NAMES[label]} ${percent(probability)}`;
    stack.append(segment);
  }
  const [, runnerUp] = answer.probabilities.toSorted(
    (a, b) => b.probability - a.probability,
  );
  panel.querySelector('.detail').textContent =
    `${percent(answer.confidence)}, then ${CATEGORY_NAMES[runnerUp.label].toLowerCase()} ${percent(runnerUp.probability)} · ${ms(answer.time)}`;
}

function renderContribution(panel, answer) {
  const score = answer.expectedScore;
  panel.querySelector('.value').textContent =
    `${score.toFixed(1)} / 5 · ${CONTRIBUTION_NAMES[Math.round(score)]}`;
  const histogram = panel.querySelector('.histogram');
  const highest = Math.max(...answer.probabilities.map((p) => p.probability));
  for (const { label, probability } of answer.probabilities) {
    const bar = document.createElement('span');
    bar.style.height = percent(Math.max(probability / highest, 0.05));
    bar.classList.toggle('top', label === answer.label);
    bar.title = `${label} (${CONTRIBUTION_NAMES[label]}) ${percent(probability)}`;
    histogram.append(bar);
  }
  panel.querySelector('.detail').textContent =
    `expectedScore over 1–5 · ${ms(answer.time)}`;
}

function addCard(change, edit, answers) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.spamProbability = answers.spam.probabilityOf('true');
  card.dataset.category =
    answers.category.confidence >= CONFIDENT
      ? answers.category.label
      : 'unsure';

  const link = card.querySelector('.title');
  link.textContent = change.title;
  link.href = change.url;

  const meta = [change.user, formatSize(change), change.namespaceName];
  if (change.isNew) {
    meta.push('new page');
  }
  meta.push(new Date().toLocaleTimeString());
  card.querySelector('.meta').textContent = meta.join(' · ');

  const summary = card.querySelector('.summary');
  summary.textContent = change.summary;
  summary.hidden = !change.summary;

  renderSpam(card.querySelector('[data-decision="spam"]'), answers.spam);
  renderCategory(
    card.querySelector('[data-decision="category"]'),
    answers.category,
  );
  renderContribution(
    card.querySelector('[data-decision="contribution"]'),
    answers.contribution,
  );

  const added = card.querySelector('.added');
  added.textContent = edit.added;
  added.hidden = !edit.added;
  const removed = card.querySelector('.removed');
  removed.textContent = edit.removed;
  removed.hidden = !edit.removed;
  if (Object.values(answers).some(({ truncated }) => truncated)) {
    card.querySelector('details summary').textContent =
      'Diff (only the start was checked)';
  }

  applyVerdict(card);
  feed.prepend(card);
  while (feed.children.length > MAX_FEED) {
    feed.lastElementChild.remove();
  }
  empty.hidden = true;
}

function setStreamStatus(status) {
  streamStatus.textContent = status;
  streamDot.dataset.status = status;
}

async function start() {
  toggleButton.disabled = true;
  try {
    await ensureModels();
  } catch {
    toggleButton.disabled = false;
    return;
  }
  streamController = new AbortController();
  connectToEditStream({
    onEdit,
    onStatus: setStreamStatus,
    signal: streamController.signal,
  });
  toggleButton.textContent = 'Pause';
  toggleButton.disabled = false;
  empty.textContent = 'Waiting for edits…';
}

function pause() {
  streamController?.abort();
  streamController = null;
  queue.length = 0;
  toggleButton.textContent = 'Start';
}

toggleButton.addEventListener('click', () =>
  streamController ? pause() : start(),
);

const reapplyVerdicts = () => {
  thresholdValue.textContent = percent(threshold());
  for (const card of feed.children) {
    applyVerdict(card);
  }
  renderStats();
};
thresholdInput.addEventListener('input', reapplyVerdicts);
showSelect.addEventListener('change', reapplyVerdicts);

for (const [value, name] of Object.entries(MODES)) {
  modeSelect.append(new Option(name, value));
}
// Prepares the mode's models right away, so the stream doesn't stall on them.
modeSelect.addEventListener('change', () => {
  renderTiming();
  if (streamController) {
    ensureModels().catch(() => {});
  }
});

for (const [value, { name }] of Object.entries(MODELS)) {
  modelSelect.add(new Option(name, value));
}

// The chosen model lives in the URL, so a reload or a shared link keeps it.
const params = new URLSearchParams(location.search);
modelSelect.value = MODELS[params.get('model')]
  ? params.get('model')
  : DEFAULT_MODEL;
useModel(modelSelect.value);

// A new model starts with a fresh timing comparison, and its download needs
// another click on Start for the user activation.
modelSelect.addEventListener('change', () => {
  pause();
  useModel(modelSelect.value);
  for (const key of Object.keys(modelPromises)) {
    delete modelPromises[key];
  }
  for (const times of Object.values(recentTimes)) {
    times.length = 0;
  }
  renderTiming();
  const url = new URL(location.href);
  if (modelSelect.value === DEFAULT_MODEL) {
    url.searchParams.delete('model');
  } else {
    url.searchParams.set('model', modelSelect.value);
  }
  history.replaceState(null, '', url);
  modelStatus.textContent = 'checking…';
  showModelStatus();
});

// Only the polyfill's model is the page's to pick. The browser's own API
// chooses its model itself, so the picker stays hidden for it.
isNative().then((native) => {
  modelSelect.closest('label').hidden = native;
});

showModelStatus();

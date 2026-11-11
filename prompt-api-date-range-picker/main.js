/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FIRST_DAY_OF_WEEK,
  PRESETS,
  addDays,
  addMonths,
  day,
  daysInMonth,
  describeRange,
  isSameDay,
  isoDate,
  rangeSpec,
  resolve,
  startOfMonth,
  summarize,
  today,
} from './dates.js';
import { availability, createSession, interpret } from './model.js';
import { complete, looksFinished } from './complete.js';

const $ = (id) => document.getElementById(id);

const stateBadge = $('state-badge');
const statusText = $('status');
const query = $('query');
// The ghost lays out with `white-space: pre`, so its spans are built here: any
// whitespace between them in the markup would show up in the field.
const ghostTyped = Object.assign(document.createElement('span'), {
  className: 'typed',
});
const ghostRest = Object.assign(document.createElement('span'), {
  className: 'rest',
});
$('ghost').replaceChildren(ghostTyped, ghostRest);
const spinner = $('spinner');
const clearButton = $('clear-btn');
const presetList = $('presets');
const prevButton = $('prev-btn');
const nextButton = $('next-btn');
const monthPanels = [$('month-0'), $('month-1')];
const monthTemplate = $('month-template');
const summary = $('summary');
const applyButton = $('apply-btn');
const exampleList = $('examples');
const applied = $('applied');
const answerMeta = $('answer-meta');
const answer = $('answer');

const EXAMPLES = [
  'September 10 to October 20',
  'Last 3 Fridays',
  'Weekends since October',
  'Mondays and Wednesdays in the past 6 weeks',
  'Christmas to New Year’s Day',
  'The first 3 Sundays of August',
  'Every Tuesday this year',
];

// How long typing has to pause before the phrase goes to the model.
const DEBOUNCE_MS = 400;
// How far back the month menus reach.
const YEARS_BACK = 5;

const monthFormat = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});
const dayFormat = new Intl.DateTimeFormat('en', { dateStyle: 'full' });
const weekdayFormat = new Intl.DateTimeFormat('en', { weekday: 'narrow' });

let now = today();
let session = null;
// The month shown on the right. The left one is the month before it.
let viewEnd = startOfMonth(now);
let selection = null;
// The first click of a range picked on the calendar.
let anchor = null;
// The normalized phrase whose dates are shown.
let shownKey = '';
// Aborts the lookup in flight when the text changes again.
let controller = null;
let debounce = 0;

// What each phrase meant, keyed by its normalized text, so retyping a phrase
// or going back to one costs no model call. The shortcuts are in here from the
// start, so typing "last month" gives the same answer as clicking it.
const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ');
const cache = new Map(
  PRESETS.map(({ name, spec }) => [normalize(name), { spec, source: 'preset' }])
);

function setState(state, message) {
  stateBadge.textContent = state;
  stateBadge.dataset.state = state;
  statusText.textContent = message;
}

/* The calendar. */

function renderMonth(panel, index) {
  const month = addMonths(viewEnd, index - 1);
  const latest = addMonths(startOfMonth(now), index - 1);
  panel.replaceChildren(monthTemplate.content.cloneNode(true));

  const select = panel.querySelector('select');
  panel.querySelector('.visually-hidden').textContent =
    index === 0 ? 'First month' : 'Second month';
  for (
    let option = latest;
    option >= addMonths(latest, -12 * YEARS_BACK);
    option = addMonths(option, -1)
  ) {
    select.add(new Option(monthFormat.format(option), isoDate(option)));
  }
  select.value = isoDate(month);
  select.addEventListener('change', () => {
    const [year, number] = select.value.split('-').map(Number);
    viewEnd = addMonths(day(year, number - 1, 1), 1 - index);
    renderCalendar();
  });

  const grid = panel.querySelector('.grid');
  grid.setAttribute('aria-label', monthFormat.format(month));
  for (let i = 0; i < 7; i++) {
    const header = document.createElement('span');
    header.className = 'weekday';
    // January 4, 1970 was a Sunday, the `getDay()` index 0.
    header.textContent = weekdayFormat.format(
      day(1970, 0, 4 + ((FIRST_DAY_OF_WEEK + i) % 7))
    );
    grid.append(header);
  }

  const year = month.getFullYear();
  const last = daysInMonth(year, month.getMonth());
  const offset = (month.getDay() - FIRST_DAY_OF_WEEK + 7) % 7;
  const selected = new Set(selection?.dates.map(isoDate));
  const band = selection?.continuous && selection.dates.length > 1;
  const first = selection?.dates[0];
  const final = selection?.dates.at(-1);

  for (let date = 1; date <= last; date++) {
    const value = day(year, month.getMonth(), date);
    const column = (offset + date - 1) % 7;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.date = isoDate(value);
    if (date === 1) {
      button.style.gridColumnStart = offset + 1;
    }
    button.setAttribute('aria-label', dayFormat.format(value));
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = date;
    button.append(number);

    const isSelected = selected.has(isoDate(value));
    button.setAttribute('aria-pressed', isSelected);
    button.classList.toggle('today', isSameDay(value, now));
    button.disabled = value > now;
    if (band && isSelected) {
      button.classList.add('in-range');
      button.classList.toggle('range-start', isSameDay(value, first));
      button.classList.toggle('range-end', isSameDay(value, final));
      button.classList.toggle('row-start', column === 0 || date === 1);
      button.classList.toggle('row-end', column === 6 || date === last);
      button.classList.toggle(
        'endpoint',
        isSameDay(value, first) || isSameDay(value, final)
      );
    } else {
      button.classList.toggle('endpoint', isSelected);
    }
    button.classList.toggle('anchor', !!anchor && isSameDay(value, anchor));
    grid.append(button);
  }
}

function renderCalendar() {
  monthPanels.forEach(renderMonth);
  nextButton.disabled = viewEnd >= startOfMonth(now);
  prevButton.disabled =
    addMonths(viewEnd, -1) <= addMonths(startOfMonth(now), -12 * YEARS_BACK);
}

/** Shows the months the selection ends in. */
function reveal() {
  if (selection?.dates.length) {
    viewEnd = startOfMonth(selection.dates.at(-1));
  }
}

/* The selection. */

const SOURCES = {
  model: (ms) => `From the model, in ${(ms / 1000).toFixed(1)} s.`,
  cache: () => 'From the cache: this phrase was answered before.',
  preset: () => 'From a shortcut, with no model call.',
  calendar: () => 'Picked on the calendar, with no model call.',
};

function showSpec(spec, source, ms) {
  answerMeta.textContent = SOURCES[source](ms);
  answer.textContent = JSON.stringify(spec, null, 2);
}

function setSelection(spec, source, ms) {
  showSpec(spec, source, ms);
  try {
    selection = resolve(spec, now);
  } catch (error) {
    selection = null;
    summary.textContent = `The model's answer didn't make sense: ${error.message}`;
    applyButton.disabled = true;
    renderCalendar();
    return;
  }
  if (selection.dates.length) {
    summary.textContent = summarize(selection);
  } else {
    summary.textContent = spec.found
      ? 'No past dates match.'
      : 'No dates found. Try “Last 3 Fridays”.';
    selection = null;
  }
  applyButton.disabled = !selection;
  reveal();
  renderCalendar();
}

function clearSelection() {
  selection = null;
  anchor = null;
  summary.textContent = 'Type or select dates.';
  applyButton.disabled = true;
  renderCalendar();
}

/* The text field. */

function updateField() {
  const { value, selectionStart, selectionEnd } = query;
  const rest =
    selectionStart === value.length &&
    selectionEnd === value.length &&
    document.activeElement === query
      ? complete(value)
      : '';
  ghostTyped.textContent = value;
  // A field that scrolls would shift the text away from the ghost under it.
  ghostRest.textContent = query.scrollWidth > query.clientWidth ? '' : rest;
  clearButton.hidden = !value;
}

function acceptCompletion() {
  const rest = ghostRest.textContent;
  if (!rest) {
    return false;
  }
  query.value += rest;
  onInput();
  return true;
}

async function lookUp(text) {
  clearTimeout(debounce);
  controller?.abort();
  const key = normalize(text);
  if (!key) {
    return;
  }

  const cached = cache.get(key);
  if (cached) {
    setSelection(
      cached.spec,
      cached.source === 'model' ? 'cache' : cached.source
    );
    shownKey = key;
    return;
  }
  if (!session) {
    summary.textContent =
      'The Prompt API isn’t ready, so only the shortcuts and the calendar work.';
    return;
  }

  controller = new AbortController();
  const { signal } = controller;
  spinner.hidden = false;
  const started = performance.now();
  try {
    const spec = await interpret(session, text.trim(), signal);
    cache.set(key, { spec, source: 'model' });
    // The text may have changed while the model was answering.
    if (normalize(query.value) === key) {
      anchor = null;
      setSelection(spec, 'model', performance.now() - started);
      shownKey = key;
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      summary.textContent = `${error.name}: ${error.message}`;
    }
  } finally {
    if (controller?.signal === signal) {
      spinner.hidden = true;
    }
  }
}

function onInput() {
  updateField();
  clearTimeout(debounce);
  controller?.abort();
  spinner.hidden = true;
  if (!query.value.trim()) {
    clearSelection();
    return;
  }
  if (looksFinished(query.value)) {
    debounce = setTimeout(() => lookUp(query.value), DEBOUNCE_MS);
  }
}

query.addEventListener('input', onInput);
query.addEventListener('focus', updateField);
query.addEventListener('blur', updateField);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === query) {
    updateField();
  }
});

query.addEventListener('keydown', (event) => {
  if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowRight') {
    if (acceptCompletion()) {
      event.preventDefault();
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    // Enter on the phrase that is already shown applies it. Otherwise it asks
    // the model right away, even about a phrase that looks unfinished.
    if (selection && shownKey === normalize(query.value)) {
      applyButton.click();
    } else {
      lookUp(query.value);
    }
  } else if (event.key === 'Escape') {
    clearButton.click();
  }
});

clearButton.addEventListener('click', () => {
  query.value = '';
  onInput();
  query.focus();
});

/* Picking on the calendar. */

monthPanels.forEach((panel) =>
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('.day');
    if (!button) {
      return;
    }
    const [year, month, date] = button.dataset.date.split('-').map(Number);
    const picked = day(year, month - 1, date);
    let spec;
    if (anchor) {
      const [from, to] = picked < anchor ? [picked, anchor] : [anchor, picked];
      spec = rangeSpec(from, to);
      query.value = describeRange(from, to, now);
      anchor = null;
    } else {
      spec = rangeSpec(picked, picked);
      query.value = describeRange(picked, picked, now);
      anchor = picked;
    }
    shownKey = normalize(query.value);
    cache.set(shownKey, { spec, source: 'calendar' });
    clearTimeout(debounce);
    controller?.abort();
    const view = viewEnd;
    setSelection(spec, 'calendar');
    // Clicking shouldn't move the months out from under the pointer.
    viewEnd = view;
    renderCalendar();
    updateField();
  })
);

prevButton.addEventListener('click', () => {
  viewEnd = addMonths(viewEnd, -1);
  renderCalendar();
});
nextButton.addEventListener('click', () => {
  viewEnd = addMonths(viewEnd, 1);
  renderCalendar();
});

/* Shortcuts, examples, and applying. */

for (const { name } of PRESETS) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.addEventListener('click', () => {
    query.value = name;
    anchor = null;
    updateField();
    lookUp(name);
  });
  item.append(button);
  presetList.append(item);
}

for (const text of EXAMPLES) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', () => {
    query.value = text;
    anchor = null;
    updateField();
    lookUp(text);
  });
  item.append(button);
  exampleList.append(item);
}

applyButton.addEventListener('click', () => {
  if (!selection) {
    return;
  }
  const { dates, continuous } = selection;
  const shown = 14;
  const list = continuous
    ? `${isoDate(dates[0])} to ${isoDate(dates.at(-1))}`
    : dates.slice(0, shown).map(isoDate).join(', ') +
      (dates.length > shown ? `, and ${dates.length - shown} more` : '');
  applied.textContent = `${summarize(selection)}\n${list}`;
});

/* Start-up. */

// A page left open past midnight moves on to the new day.
setInterval(() => {
  const current = today();
  if (!isSameDay(current, now)) {
    const following = isSameDay(viewEnd, startOfMonth(now));
    now = current;
    if (following) {
      viewEnd = startOfMonth(now);
    }
    renderCalendar();
  }
}, 60_000);

async function init() {
  renderCalendar();
  updateField();

  const available = await availability();
  if (available === 'unavailable') {
    setState('error', 'The Prompt API is unavailable.');
    $('unsupported').hidden = false;
    return;
  }

  setState('busy', 'Creating the session…');
  try {
    session = await createSession({
      downloadProgress: $('download-progress'),
      onDownloadProgress({ percent }) {
        // Progress events can arrive for a model that is already on disk,
        // going straight to 100%, so only a model that wasn't available is
        // reported as downloading.
        if (available === 'available') {
          return;
        }
        setState(
          'downloading',
          percent < 100
            ? `Downloading the model: ${percent}%`
            : 'Loading the model into memory…'
        );
      },
      activationButton: $('activation-btn'),
      activationHint: $('activation-hint'),
    });
  } catch (error) {
    setState('error', `${error.name}: ${error.message}`);
    return;
  }
  setState('ready', 'Ready. Type the dates you are looking for.');

  // Whatever was typed while the model loaded gets its answer now.
  if (query.value.trim() && !selection) {
    lookUp(query.value);
  }
}

init();

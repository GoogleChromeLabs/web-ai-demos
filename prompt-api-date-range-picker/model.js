/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EasyLanguageModel } from 'easy-language-model';
import { WEEKDAYS } from './dates.js';

// One end of the range. The model picks a `kind` and fills in only the fields
// that kind needs, so it describes dates without ever computing one.
const DATE_REF = {
  type: 'object',
  properties: {
    kind: {
      enum: [
        'today',
        'date',
        'month',
        'year',
        'period',
        'ago',
        'within',
        'none',
      ],
    },
    year: { type: 'integer' },
    month: { type: 'integer' },
    day: { type: 'integer' },
    amount: { type: 'integer' },
    unit: { enum: ['day', 'week', 'month', 'year'] },
  },
  required: ['kind'],
  additionalProperties: false,
};

export const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    from: DATE_REF,
    to: DATE_REF,
    weekdays: { type: 'array', items: { enum: WEEKDAYS } },
    count: { type: 'integer' },
    which: { enum: ['last', 'first'] },
  },
  required: ['found', 'from', 'to', 'weekdays', 'count'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You turn what someone types into a date picker into JSON that describes the dates they mean. Never compute dates yourself: describe each end of the range with one of these kinds, and fill in only the fields it needs.

- "today": today.
- "date": a day of a named month, with "month" (1-12) and "day". Add "year" only if the text gives one.
- "month": a whole named month, with "month" (1-12), and "year" only if the text gives one.
- "year": a whole year named by its number, with "year".
- "period": a whole calendar week, month, or year relative to today, with "unit" and "amount" saying how many periods back: 0 for this one ("this year"), 1 for the last one ("last month").
- "ago": the single day "amount" "unit"s before today, as in "3 weeks ago".
- "within": the last "amount" "unit"s up to today, as in "the last 7 days" or "the past 3 months".
- "none": no limit, only for "from" when the text asks for the last few of something, as in "the last 3 Fridays".

"from" starts on the first day of its reference and "to" ends on the last, so a single month or period is the same reference in both.

"weekdays" keeps only those days of the week, and is empty to keep every day. "count" is 0 unless the text says how many days to keep. It keeps only the last (or, with "which": "first", the first) that many matching days. When the text names a single day, "from" and "to" are the same. When it says "since", "to" is "today". A holiday is the "date" it falls on, and a season is the months it spans: summer is June to August. Set "found" to false when the text does not describe any dates.`;

// Few-shot examples. They never mention today's date: the JSON is the same on
// any day, which is what lets the page cache answers and reuse the session.
const EXAMPLES = [
  [
    'September 10 to October 20',
    {
      found: true,
      from: { kind: 'date', month: 9, day: 10 },
      to: { kind: 'date', month: 10, day: 20 },
      weekdays: [],
      count: 0,
    },
  ],
  [
    'Last 3 Fridays',
    {
      found: true,
      from: { kind: 'none' },
      to: { kind: 'today' },
      weekdays: ['fri'],
      count: 3,
      which: 'last',
    },
  ],
  [
    'Weekends since October',
    {
      found: true,
      from: { kind: 'month', month: 10 },
      to: { kind: 'today' },
      weekdays: ['sat', 'sun'],
      count: 0,
    },
  ],
  [
    'past two weeks',
    {
      found: true,
      from: { kind: 'within', amount: 2, unit: 'week' },
      to: { kind: 'today' },
      weekdays: [],
      count: 0,
    },
  ],
  [
    'Tuesdays and Thursdays in the last 4 weeks',
    {
      found: true,
      from: { kind: 'within', amount: 4, unit: 'week' },
      to: { kind: 'today' },
      weekdays: ['tue', 'thu'],
      count: 0,
    },
  ],
  [
    'June 2024',
    {
      found: true,
      from: { kind: 'month', month: 6, year: 2024 },
      to: { kind: 'month', month: 6, year: 2024 },
      weekdays: [],
      count: 0,
    },
  ],
  [
    'weekdays last month',
    {
      found: true,
      from: { kind: 'period', unit: 'month', amount: 1 },
      to: { kind: 'period', unit: 'month', amount: 1 },
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      count: 0,
    },
  ],
  [
    'the first two Mondays of March 2025',
    {
      found: true,
      from: { kind: 'month', month: 3, year: 2025 },
      to: { kind: 'month', month: 3, year: 2025 },
      weekdays: ['mon'],
      count: 2,
      which: 'first',
    },
  ],
  [
    'since Valentine’s Day',
    {
      found: true,
      from: { kind: 'date', month: 2, day: 14 },
      to: { kind: 'today' },
      weekdays: [],
      count: 0,
    },
  ],
  [
    'Saturdays this year',
    {
      found: true,
      from: { kind: 'period', unit: 'year', amount: 0 },
      to: { kind: 'period', unit: 'year', amount: 0 },
      weekdays: ['sat'],
      count: 0,
    },
  ],
  [
    'pizza with extra cheese',
    {
      found: false,
      from: { kind: 'today' },
      to: { kind: 'today' },
      weekdays: [],
      count: 0,
    },
  ],
];

const INITIAL_PROMPTS = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...EXAMPLES.flatMap(([text, json]) => [
    { role: 'user', content: text },
    { role: 'assistant', content: JSON.stringify(json) },
  ]),
];

const LANGUAGES = { languages: ['en'] };

export const availability = () =>
  EasyLanguageModel.availability({
    expectedInputs: [{ type: 'text', ...LANGUAGES }],
    expectedOutputs: [{ type: 'text', ...LANGUAGES }],
  });

/**
 * Creates the session that holds the instructions and examples. Every lookup
 * runs in a clone of it, so lookups never see each other.
 */
export const createSession = (options) =>
  EasyLanguageModel.create({
    initialPrompts: INITIAL_PROMPTS,
    expectedInputs: [{ type: 'text', ...LANGUAGES }],
    expectedOutputs: [{ type: 'text', ...LANGUAGES }],
    // The answer is JSON that the page parses and never renders, so there is
    // no HTML to sanitize.
    sanitizer: false,
    ...options,
  });

/**
 * Puts back a year the model left out. The on-device model tends to drop it,
 * reading “March 2025” as plain March, but the year is right there in the
 * text. This only steps in when the text has exactly one year and no named
 * month or date in the answer has one.
 */
function restoreYear(spec, text) {
  const years = [...new Set(text.match(/\b(?:19|20)\d\d\b/g) ?? [])];
  const refs = [spec.from, spec.to].filter((ref) =>
    ['date', 'month', 'year'].includes(ref?.kind)
  );
  if (years.length !== 1 || !refs.length || refs.some((ref) => ref.year)) {
    return spec;
  }
  for (const ref of refs) {
    ref.year = Number(years[0]);
  }
  // In “December 20 to January 5 2025”, the start is in the year before.
  const { from, to } = spec;
  if (
    from.kind === 'date' &&
    to.kind === 'date' &&
    (from.month > to.month || (from.month === to.month && from.day > to.day))
  ) {
    from.year--;
  }
  return spec;
}

/** Asks the model what `text` means, as JSON that matches `SCHEMA`. */
export async function interpret(session, text, signal) {
  const clone = await session.clone({ signal });
  try {
    const answer = await clone.prompt(text, {
      responseConstraint: SCHEMA,
      signal,
    });
    return restoreYear(JSON.parse(answer), text);
  } finally {
    clone.destroy();
  }
}

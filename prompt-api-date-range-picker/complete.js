/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Completes the word being typed from a fixed vocabulary of date words. This
// runs on every keystroke, so it is plain string matching: a model round trip
// per key would lag behind the typing.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

// Earlier entries win, so connectors come before the month and day names that
// share their first letters ("s" completes to "since", "Se" to "September").
// Singular forms and abbreviations come after the words they are a prefix of,
// so they never get suggested, and typing one in full counts as a whole word.
const GENERAL = [
  'since',
  'to',
  'until',
  'and',
  'between',
  'from',
  'in',
  'of',
  'the',
  'this',
  'last',
  'past',
  'ago',
  'today',
  'yesterday',
  'weekends',
  'weekdays',
  'every',
  'except',
  ...MONTHS,
  ...DAYS.map((name) => `${name}s`),
  'through',
  'first',
  'week',
  'month',
  'year',
  'weeks',
  'months',
  'years',
  'days',
  'day',
  'weekend',
  ...DAYS,
  ...MONTHS.map((name) => name.slice(0, 3)),
  'Sept',
];

// After a number, the next word is a unit or a weekday: "3 weeks", "3 Fridays".
const AFTER_NUMBER = [
  'days',
  'weeks',
  'months',
  'years',
  'weekends',
  'weekdays',
  ...DAYS.map((name) => `${name}s`),
];
// After "last" or "this", it is a single period: "last week", "this month".
const AFTER_PERIOD = ['week', 'month', 'year', 'weekend'];
// After a connector, it is a date: "since October", "to Friday".
const AFTER_CONNECTOR = [
  ...MONTHS,
  'last',
  'this',
  'today',
  'yesterday',
  ...DAYS,
];
const CONNECTORS = ['since', 'to', 'until', 'through', 'from', 'in', 'of'];
// At the start, it is what the phrase is about: "September", "Weekends".
const AT_START = [
  'last',
  'this',
  'past',
  'today',
  'yesterday',
  'weekends',
  'weekdays',
  'every',
  ...MONTHS,
  ...DAYS.map((name) => `${name}s`),
];

const isNumber = (word) =>
  /^\d+$/.test(word) ||
  /^(two|three|four|five|six|seven|eight|nine|ten|few)$/i.test(word);

/**
 * The rest of the word at the end of `text`, or `''` if there is nothing to
 * add. The typed part keeps its case, and the suggestion uses the
 * vocabulary's.
 */
export function complete(text) {
  const match = /(?:^|\s)(\S*)\s+(\S+)$|^(\S+)$/.exec(text);
  if (!match) {
    return '';
  }
  const previous = (match[1] ?? '').toLowerCase();
  const word = match[2] ?? match[3];
  if (/\d/.test(word)) {
    return '';
  }
  const lower = word.toLowerCase();
  const all = [
    ...(match[3] ? AT_START : []),
    ...(isNumber(previous) ? AFTER_NUMBER : []),
    ...(CONNECTORS.includes(previous) ? AFTER_CONNECTOR : []),
    ...(['last', 'this', 'past'].includes(previous) ? AFTER_PERIOD : []),
    ...GENERAL,
  ];
  if (all.some((entry) => entry.toLowerCase() === lower)) {
    return '';
  }
  const found = all.find((entry) => entry.toLowerCase().startsWith(lower));
  return found ? found.slice(word.length) : '';
}

// Words a phrase cannot end on, because more has to follow.
const DANGLING = new Set([
  'to',
  'until',
  'through',
  'and',
  'between',
  'from',
  'in',
  'of',
  'the',
  'this',
  'last',
  'past',
  'since',
  'every',
  'except',
  'first',
]);

/**
 * Whether `text` reads like a finished phrase, which is when it is worth
 * asking the model about it. A phrase that ends mid-word or on a connector is
 * still being typed: "Weekends since O", "September 10 to".
 */
export function looksFinished(text) {
  const trimmed = text.trim();
  if (trimmed.length < 3 || complete(text)) {
    return false;
  }
  const last = trimmed.split(/\s+/).at(-1).toLowerCase();
  if (DANGLING.has(last)) {
    return false;
  }
  // "Last 3" still needs the thing there are three of.
  const words = trimmed.toLowerCase().split(/\s+/);
  return !(
    isNumber(last) && ['last', 'past', 'first'].includes(words.at(-2) ?? '')
  );
}

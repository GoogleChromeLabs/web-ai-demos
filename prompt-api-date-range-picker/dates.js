/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Everything here is plain date arithmetic. The model only says what the text
// means ("from the start of October until today, weekends only"), and this
// module works out which days that is, so the model never has to count.

/** Weekday keys in `getDay()` order, as the model's schema spells them. */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** How far back an open-ended start such as "the last 3 Fridays" may reach. */
const MAX_YEARS_BACK = 5;

/**
 * A calendar day. Noon keeps a daylight saving change, which some time zones
 * make at midnight, from pushing the date into the day before. Months are
 * zero-based and overflow, so `day(2026, 12, 1)` is January 1, 2027.
 */
export const day = (year, month, date) => new Date(year, month, date, 12);

export function today() {
  const now = new Date();
  return day(now.getFullYear(), now.getMonth(), now.getDate());
}

export const addDays = (date, days) =>
  day(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const daysInMonth = (year, month) => day(year, month + 1, 0).getDate();

/** Moves by whole months, keeping the day of the month where it exists. */
export function addMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const target = day(year, month, 1);
  const last = daysInMonth(target.getFullYear(), target.getMonth());
  return day(year, month, Math.min(date.getDate(), last));
}

export const startOfMonth = (date) =>
  day(date.getFullYear(), date.getMonth(), 1);

export const isSameDay = (a, b) => a.getTime() === b.getTime();

export const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);

/** `2026-11-11`, in local time. */
export const isoDate = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

/**
 * The first day of the week in the user's locale, as a `getDay()` index. The
 * week info reports Monday as 1 and Sunday as 7. Older engines expose it as a
 * getter, newer ones as `getWeekInfo()`.
 */
export const FIRST_DAY_OF_WEEK = (() => {
  try {
    const locale = new Intl.Locale(navigator.language);
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    return (info?.firstDay ?? 1) % 7;
  } catch {
    return 1;
  }
})();

export const startOfWeek = (date) =>
  addDays(date, -((date.getDay() - FIRST_DAY_OF_WEEK + 7) % 7));

function shift(date, amount, unit) {
  switch (unit) {
    case 'day':
      return addDays(date, amount);
    case 'week':
      return addDays(date, amount * 7);
    case 'month':
      return addMonths(date, amount);
    case 'year':
      return addMonths(date, amount * 12);
  }
  throw new RangeError(`Unknown unit "${unit}".`);
}

/** The first and last day of this week, month, or year, `back` periods ago. */
function period(now, unit, back) {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (unit) {
    case 'day': {
      const date = addDays(now, -back);
      return [date, date];
    }
    case 'week': {
      const start = addDays(startOfWeek(now), -7 * back);
      return [start, addDays(start, 6)];
    }
    case 'month':
      return [day(year, month - back, 1), day(year, month - back + 1, 0)];
    case 'year':
      return [day(year - back, 0, 1), day(year - back, 11, 31)];
  }
  throw new RangeError(`Unknown unit "${unit}".`);
}

// References to a named month or date, like "October" or "September 10". When
// the text leaves out the year, the year is worked out from the other end of
// the range, or from today.
const NAMED = new Set(['date', 'month']);

function checkNamed({ kind, month, day: date }) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`"${kind}" needs a month from 1 to 12.`);
  }
  if (kind === 'date' && (!Number.isInteger(date) || date < 1 || date > 31)) {
    throw new RangeError('"date" needs a day from 1 to 31.');
  }
}

/** The first and last day a named reference covers in `year`. */
function namedSpan(ref, year) {
  const month = ref.month - 1;
  if (ref.kind === 'date') {
    const date = day(year, month, Math.min(ref.day, daysInMonth(year, month)));
    return [date, date];
  }
  return [day(year, month, 1), day(year, month + 1, 0)];
}

/** `ref`'s span in the latest year in which it starts on or before `limit`. */
function latestOnOrBefore(ref, limit) {
  let year = limit.getFullYear();
  while (namedSpan(ref, year)[0] > limit) {
    year--;
  }
  return namedSpan(ref, year);
}

/** `ref`'s span in the earliest year in which it ends on or after `limit`. */
function earliestOnOrAfter(ref, limit) {
  let year = limit.getFullYear();
  while (namedSpan(ref, year)[1] < limit) {
    year++;
  }
  return namedSpan(ref, year);
}

/**
 * The first and last day a reference covers. `from` takes the first and `to`
 * the last, so "August" can stand at both ends of "the first 3 Sundays of
 * August". Returns `undefined` for no limit, and `null` for a named reference
 * without a year, which `resolve()` settles once the other end is known.
 */
function resolveRef(ref, now) {
  const amount = ref.amount ?? 0;
  const unit = ref.unit ?? 'day';
  switch (ref.kind) {
    case 'today':
      return [now, now];
    case 'none':
      return undefined;
    case 'ago': {
      const date = shift(now, -amount, unit);
      return [date, date];
    }
    case 'within':
      // "The last 7 days" ends today and covers seven days, so it starts six
      // days back.
      return [addDays(shift(now, -amount, unit), 1), now];
    case 'period':
      return period(now, ref.unit ?? 'month', amount);
    case 'year': {
      const year = ref.year || now.getFullYear();
      return [day(year, 0, 1), day(year, 11, 31)];
    }
  }
  if (NAMED.has(ref.kind)) {
    checkNamed(ref);
    return ref.year ? namedSpan(ref, ref.year) : null;
  }
  throw new RangeError(`Unknown kind "${ref.kind}".`);
}

/** Names a set of weekdays the way people say it: "Weekends", "Fridays". */
export function weekdayLabel(weekdays) {
  const set = new Set(weekdays);
  if (set.size === 0 || set.size === 7) {
    return '';
  }
  const is = (...days) =>
    set.size === days.length && days.every((d) => set.has(d));
  if (is('sat', 'sun')) {
    return 'Weekends';
  }
  if (is('mon', 'tue', 'wed', 'thu', 'fri')) {
    return 'Weekdays';
  }
  const names = new Intl.DateTimeFormat('en', { weekday: 'long' });
  const plural = WEEKDAYS.filter((d) => set.has(d))
    // January 4, 1970 was a Sunday, so this lands on the right weekday.
    .map((d) => `${names.format(day(1970, 0, 4 + WEEKDAYS.indexOf(d)))}s`);
  return new Intl.ListFormat('en').format(plural);
}

/**
 * Turns the model's description into the days it covers.
 *
 * Returns `{dates, label, continuous}`, with `dates` sorted and never later
 * than `now`, since this picker only looks back. `continuous` says whether
 * the dates fill the whole span from the first to the last, which the
 * calendar draws as a band.
 */
export function resolve(spec, now = today()) {
  if (!spec.found) {
    return { dates: [], label: '', continuous: false };
  }

  let fromSpan = resolveRef(spec.from, now);
  let toSpan = resolveRef(spec.to, now);

  // Without years, "September 10 to October 20" means the latest such span
  // that has started by today, and "December 20 2024 to January 5" ends in the
  // January right after it.
  if (fromSpan === null && toSpan === null) {
    // "January to December" said in November means this year, cut off at
    // today, as long as the span has started. "December 1 to December 20"
    // hasn't, so it means last year's.
    const end = namedSpan(spec.to, now.getFullYear());
    const start = latestOnOrBefore(spec.from, end[1]);
    if (start[0] <= now) {
      [fromSpan, toSpan] = [start, end];
    }
  }
  if (toSpan === null) {
    toSpan = fromSpan
      ? earliestOnOrAfter(spec.to, fromSpan[0])
      : latestOnOrBefore(spec.to, now);
  }
  if (fromSpan === null) {
    fromSpan = latestOnOrBefore(spec.from, toSpan?.[1] ?? now);
  }

  let from = fromSpan?.[0];
  let to = toSpan?.[1];
  const earliest = addMonths(now, -12 * MAX_YEARS_BACK);
  from = from ?? earliest;
  to = to ?? now;
  if (from < earliest) {
    from = earliest;
  }
  if (to > now) {
    to = now;
  }

  const weekdays = new Set(spec.weekdays ?? []);
  let dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (weekdays.size === 0 || weekdays.has(WEEKDAYS[date.getDay()])) {
      dates.push(date);
    }
  }
  if (spec.count > 0) {
    dates =
      spec.which === 'first'
        ? dates.slice(0, spec.count)
        : dates.slice(-spec.count);
  }

  const continuous =
    dates.length > 0 &&
    dates.length === daysBetween(dates[0], dates.at(-1)) + 1;
  return { dates, label: weekdayLabel([...weekdays]), continuous };
}

const rangeFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Fridays · Oct 30 – Nov 13, 2026 · 3 days" */
export function summarize({ dates, label }) {
  const days = `${dates.length} ${dates.length === 1 ? 'day' : 'days'}`;
  const range = rangeFormat.formatRange(dates[0], dates.at(-1));
  return [label, range, days].filter(Boolean).join(' · ');
}

const longFormat = (date, now) =>
  date.toLocaleDateString('en', {
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });

/** How a range picked on the calendar reads in the text field. */
export function describeRange(from, to, now = today()) {
  return isSameDay(from, to)
    ? longFormat(from, now)
    : `${longFormat(from, now)} to ${longFormat(to, now)}`;
}

/** A range picked on the calendar, in the model's format. */
export function rangeSpec(from, to) {
  const ref = (date) => ({
    kind: 'date',
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
  return { found: true, from: ref(from), to: ref(to), weekdays: [], count: 0 };
}

/**
 * The shortcuts on the side, in the same format the model writes, so they go
 * through the same `resolve()`.
 */
export const PRESETS = [
  ['Today', { kind: 'today' }],
  ['Yesterday', { kind: 'ago', amount: 1, unit: 'day' }],
  ['This week', { kind: 'period', unit: 'week', amount: 0 }],
  ['Last week', { kind: 'period', unit: 'week', amount: 1 }],
  ['This month', { kind: 'period', unit: 'month', amount: 0 }],
  ['Last month', { kind: 'period', unit: 'month', amount: 1 }],
  ['Last 3 months', { kind: 'within', amount: 3, unit: 'month' }],
].map(([name, ref]) => ({
  name,
  spec: { found: true, from: ref, to: ref, weekdays: [], count: 0 },
}));

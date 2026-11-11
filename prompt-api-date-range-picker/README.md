# Date Range Picker with the Prompt API

A date range picker that understands what you type: “September 10 to October
20”, “Last 3 Fridays”, “Weekends since October”, or “Christmas to New Year’s
Day”. The matching days light up in a two-month calendar, with a summary such
as “Fridays · Oct 30 – Nov 13, 2026 · 3 days”. The shortcuts on the side and
picking days on the calendar work as in any other date picker.

## How it works

The on-device model is good at language and unreliable at date arithmetic, so
the work is split between them:

- **The model describes.** The Prompt API answers with JSON constrained by a
  JSON Schema passed as `responseConstraint`. Each end of the range is a
  reference such as `{"kind": "month", "month": 10}`, `{"kind": "today"}`, or
  `{"kind": "within", "amount": 6, "unit": "week"}`, followed by an optional
  weekday filter and an optional count. A reference names a whole span, and
  the range starts on the first day of `from` and ends on the last day of `to`,
  so “the first 3 Sundays of August” names August at both ends. “Last 3
  Fridays” comes back as:

  ```json
  {
    "found": true,
    "from": { "kind": "none" },
    "to": { "kind": "today" },
    "weekdays": ["fri"],
    "count": 3,
    "which": "last"
  }
  ```

- **The page computes.** [`dates.js`](dates.js) resolves those references
  against today's date, fills in missing years (“December 20 to January 5”
  spans the turn of the year), applies the weekday filter and the count, and
  never selects a day in the future.

The JSON never mentions today's date, so the same phrase always gets the same
answer. That lets the page put the instructions and a few examples into one
session and run each lookup in a `clone()` of it, and cache every answer by
its phrase. The shortcuts are in that cache from the start, so typing “last
month” costs no model call either. The panel under the picker shows the JSON
for the last phrase and whether it came from the model, the cache, a shortcut,
or the calendar.

Lookups wait until typing pauses and the phrase looks finished, which means it
doesn't end mid-word or on a word like “to” or “since”. Each new keystroke
aborts the lookup in flight. <kbd>Enter</kbd> asks right away, and on a phrase
whose dates are already shown, applies them.

## Accuracy

The on-device model gets the common phrases right most of the time, but its
answers vary from run to run, and web pages can't lower its sampling
temperature. Now and then it drops a weekday filter or a count, or misreads a
holiday. The page repairs one systematic slip itself: the model tends to drop
an explicit year (“March 2025” comes back as plain March), so when the phrase
has exactly one year and the answer has none, the page puts it back. Typing a
phrase again returns the cached answer; editing it asks the model again.

## Word completion

The gray suggestion after the caret, as in “Weekends since O<i>ctober</i>”, is
plain string matching against a small vocabulary of date words in
[`complete.js`](complete.js), with a few rules for context: after a number it
suggests units and weekdays (“3 Fr<i>idays</i>”), and after “since” or “to” it
suggests months. It runs on every keystroke, where a model round trip would lag
behind the typing. Press <kbd>Tab</kbd> or <kbd>→</kbd> to accept it.

The model is driven through [`easy-language-model`](../easy-language-model/),
which handles the model download and the user activation it needs.

## Running it

```sh
npm install
npm run dev
```

Open the printed `http://localhost` URL in Chrome with the Prompt API available.
`npm run build` writes a static site to `dist/`.

<!--
 Copyright 2026 Google LLC
 SPDX-License-Identifier: Apache-2.0
-->

# Wikipedia spam detector

Watches live edits to the English Wikipedia and runs three decisions on each
one, using a model on your device and the proposed
[Decisions API](https://github.com/explainers-by-googlers/decisions-api). There
is one decision per question type:

| Decision     | Type      | Answer                                                    |
| :----------- | :-------- | :-------------------------------------------------------- |
| Spam         | `boolean` | P(spam), judged against the threshold slider              |
| Edit type    | `choice`  | `legit`, `spam`, `vandalism`, `test`, or `revert`         |
| Contribution | `score`   | `expectedScore` from 1 (one word) to 5 (most of the page) |

`test` is Wikipedia's own term for good-faith experiments by newcomers, and
`revert` is the counter-vandalism intention from research on edit intentions
([Yang et al., 2017](https://aclanthology.org/D17-1213/)). Reverts get a
category of their own because they re-add text, which otherwise reads like a
large unexplained change.

## How it works

1. The page subscribes to Wikimedia's
   [EventStreams](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service)
   `recentchange` feed with `EventSource` and keeps the edits and page creations
   on `enwiki`.
2. The feed carries metadata only, so the page fetches the diff from the
   MediaWiki API (`action=compare`) and extracts the added and removed text. A
   new page has no previous revision, and its whole wikitext counts as added.
3. The page title, edit summary, size change, and diff go to the three
   decisions. The **Run** menu picks how:
   - **Three models, in parallel**: one `DecisionModel` per decision, called
     with `Promise.all()`.
   - **Three models, one after another**: the same models, awaited in turn.
   - **One model, three questions**: a single schema with all three questions,
     which the explainer recommends because the input is encoded once.

   The page shows the average time per edit of each mode over its 20 most recent
   edits, so switching modes compares them on live traffic.

The explainer leaves acting on a decision to the page. An edit type counts
toward the filters and the vandalism counter only when its confidence is at
least 50%, and is shown as "unsure" otherwise.

## Models

Chrome does not ship the Decisions API yet, so the page loads the
[`built-in-ai-task-apis-polyfills`](https://www.npmjs.com/package/built-in-ai-task-apis-polyfills)
DecisionModel polyfill when `DecisionModel` is missing from `window`. With the
polyfill, the **Model** menu picks what it runs:

| Model                         | Backend  | Download | Notes                                  |
| :---------------------------- | :------- | :------- | :------------------------------------- |
| Laya, English (default)       | Laya     | 0.85 GB  | ModernBERT; runs on WebGPU or the CPU  |
| Laya, multilingual            | Laya     | 0.68 GB  | mmBERT, 100+ languages                 |
| Laya, fine-tuned for business | Laya     | 0.85 GB  | The `typed-decisions` checkpoint       |
| kev 0.6B                      | open-jev | 0.34 GB  | Qwen3-0.6B; needs WebGPU               |
| open-jev                      | open-jev | 0.35 GB  | DeBERTa-v3-large; needs WebGPU         |
| kev 4B                        | open-jev | 2.3 GB   | Qwen3-4B; needs WebGPU and a large GPU |

The choice is kept in the URL as `?model=`, for example `?model=kev-0.6b`, so a
reload or a shared link keeps it. Switching models pauses the stream, cancels
any download in progress, and resets the timings; press Start to load the new
model. With a native `DecisionModel`, the browser picks its own model and the
menu stays hidden.

Most of these models read 512 tokens at most, the kev models 8,192. Long diffs
are cut, and cut further when `decide()` rejects with `QuotaExceededError`. A
card whose diff was cut says so.

Edits are checked one at a time. When they arrive faster than that, the queue
keeps the 10 most recent and counts the rest as dropped.

## Observations with the polyfill

Measured in Chrome Canary on an Apple silicon Mac. With the default Laya English
model:

- A single decision takes about 165 ms on its own. With three models in
  parallel, each takes about 430 ms because the workers share the GPU, and an
  edit takes about 450 ms in all. One after another, an edit takes about 650 ms,
  and so does one model with three questions.
- The spam check separates well: obvious advertising scores P(spam) 0.75 to
  0.81, and ordinary edits stay below 0.2.
- The edit type is reliable for reverts whose summary says so (90% and up), and
  usually unsure otherwise. On a hand-labeled set of 19 edits, accuracy rose
  from 9 to 13 when the `revert` option pointed at the edit summary and the
  input gained the size change.
- The contribution score clusters between 1.5 and 3, so it orders edits better
  than it measures them.

With the other models:

- kev 0.6B got 8 of the 19 edit types right, answering `legit` for nearly
  everything.
- open-jev takes about 730 ms per edit with three models in parallel, and its
  edit type came out as an unsure `revert` for every live edit.
- The multilingual, fine-tuned, and kev 4B models are untested here.

## Running it

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that works from any path.

<!--
 Copyright 2026 Google LLC
 SPDX-License-Identifier: Apache-2.0
-->

# Wikipedia spam detector

Watches live edits to the English Wikipedia and runs three decisions on each
one, using a model on your device and the proposed
[Decisions API](https://github.com/explainers-by-googlers/decisions-api). There
is one decision per question type:

> [!IMPORTANT] This is only a demo. None of the models it uses were trained to
> detect spam or vandalism, so it is a proof of the overall concept and nothing
> more. For edit scoring that Wikipedia actually relies on, see the
> [revert risk models](https://meta.wikimedia.org/wiki/Machine_learning_models/Production/Multilingual_revert_risk)
> that Wikimedia serves on
> [Lift Wing](https://wikitech.wikimedia.org/wiki/Machine_Learning/LiftWing).

| Decision  | Type      | Answer                                              |
| :-------- | :-------- | :-------------------------------------------------- |
| Spam      | `boolean` | P(spam), judged against the threshold slider        |
| Edit type | `choice`  | `legit`, `spam`, `vandalism`, `test`, or `revert`   |
| Tone      | `score`   | The winning option, and `expectedScore` from 1 to 5 |

The tone follows Wikipedia's
[neutral point of view](https://en.wikipedia.org/wiki/Wikipedia:Neutral_point_of_view)
policy, on a scale of neutral, slightly informal, opinionated, promotional, and
abusive.

`test` is Wikipedia's own term for good-faith experiments by newcomers, and
`revert` is the counter-vandalism intention from research on edit intentions
([Yang et al., 2017](https://aclanthology.org/D17-1213/)). Reverts get a
category of their own because they re-add text, which otherwise reads like a
large unexplained change.

## How it works

1. The page reads Wikimedia's
   [EventStreams](https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams_HTTP_Service)
   `recentchange` feed and keeps the edits and page creations on `enwiki`. See
   [Stream and backpressure](#stream-and-backpressure).
2. The feed carries metadata only, so the page fetches the diff from the
   MediaWiki API (`action=compare`) and extracts the added and removed text. A
   new page has no previous revision, and its whole wikitext counts as added.
3. The page title, edit summary, size change, and diff go to the three
   decisions. The **Run** menu picks how:
   - **Three DecisionModel instances, in parallel**: one instance per decision,
     called with `Promise.all()`.
   - **Three DecisionModel instances, one after another**: the same instances,
     awaited in turn.
   - **One DecisionModel instance, three questions**: a single schema with all
     three questions, which the explainer recommends because the input is
     encoded once.

   All three modes run the same model weights. The page shows the average time
   per edit of each mode over its 20 most recent edits, so switching modes
   compares them on live traffic.

The explainer leaves acting on a decision to the page. An edit type counts
toward the filters and the vandalism counter only when its confidence is at
least 50%, and is shown as "unsure" otherwise.

The **Show** checkboxes pick which edits the feed lists: spam, vandalism, test
edits, reverts, legit edits, and unsure ones, in any combination. An edit counts
as spam when the spam check is above the threshold or the edit type confidently
says so.

The **Debug** checkbox, kept in the URL as `?debug`, adds a section to every
edit with what each decision got and gave: the schema passed to `create()`, the
input passed to `decide()` after any cutting, and the result `decide()`
returned.

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

## Stream and backpressure

The feed is a server-sent event stream, which the page reads with `fetch()`. The
response body goes through a `TextDecoderStream` and a small parser, a
`TransformStream` that follows the
[event stream rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)
of the HTML standard, and an async generator hands out one edit at a time.
Nothing is read until the page asks for the next edit. `EventSource` reads
everything as it arrives, so it can't do that.

Edits are checked one at a time, and the **When behind** menu decides what
happens when they arrive faster than that:

- **Drop older edits** reads as fast as edits arrive and keeps the 10 most
  recent in a queue, counting the rest as dropped. The feed stays close to live.
- **Hold back the stream** checks each edit before reading the next one. The
  stream's buffers fill up, TCP flow control slows the server down, and no edit
  is dropped. **Behind live** in the status line shows how far the edit being
  checked lags behind the time it was made.

After a dropped connection, the stream resumes from the time of the last event
it read. The service's CORS policy doesn't allow the `Last-Event-ID` header that
`EventSource` would send, so the time goes into the `since` query parameter, and
events already seen at that time are skipped.

## Observations with the polyfill

Measured in Chrome Canary on an Apple silicon Mac. With the default Laya English
model:

- A single decision takes about 165 ms on its own. With three instances in
  parallel, each takes about 430 ms because the workers share the GPU, and an
  edit takes about 450 ms in all. One after another, an edit takes about 650 ms,
  and so does one instance with three questions.
- The spam check separates well: obvious advertising scores P(spam) 0.75 to
  0.81, and ordinary edits stay below 0.2.
- The edit type is reliable for reverts whose summary says so (90% and up), and
  usually unsure otherwise. On a hand-labeled set of 19 edits, accuracy rose
  from 9 to 13 when the `revert` option pointed at the edit summary and the
  input gained the size change.
- The tone score orders edits well and measures them less well. On the
  hand-labeled set, neutral edits scored 1.7 to 2.4 and promotional or abusive
  ones 3.1 to 3.6. A revert that removed an insult scored 3.5, since the model
  reads the removed text too. An earlier question about the size of the edit
  clustered between 1.5 and 3, and the diff answers it without a model anyway.

With the other models:

- kev 0.6B got 8 of the 19 edit types right, answering `legit` for nearly
  everything.
- open-jev takes about 730 ms per edit with three instances in parallel, and its
  edit type came out as an unsure `revert` for every live edit.
- The multilingual, fine-tuned, and kev 4B models are untested here.

## Running it

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/` that works from any path.

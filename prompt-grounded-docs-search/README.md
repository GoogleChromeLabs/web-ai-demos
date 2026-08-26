# Prompt-grounded docs search

A viewer for the DevDocs HTML documentation database where two built-in AI APIs
divide the work: a [Vector Store](https://github.com/explainers-by-googlers/vector-store-api)
finds the document, and the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
finds the passage inside it.

It is [`vector-store-docs-search`](../vector-store-docs-search) plus grounding.
Everything about the store — inserting whole documents, `findNearest()`, the
stats read back from its metadata — works the same way there, and this README
covers only what grounding adds.

## The problem it solves

The store returns the matching chunk and the id of the document it came from,
but not where in that document the chunk sits. A chunk also arrives as one
whitespace-collapsed run that begins and ends wherever the chunker landed, so it
does not correspond to a section a reader would recognize.

So the passage is found a second way: by asking a language model to point at it.

## How it works

**One briefing, many clones.** A single session is created at startup with a
system prompt telling it to surface the passage of a document that answers a
question — to quote, never to summarize, and never to answer the question
itself. Grounding a document clones that session rather than creating a new one,
so the instructions are processed once and each document starts from the same
clean slate, with no memory of the last one. The clone is destroyed when the
answer is in.

**Structured output.** The clone is given the document and the question, and
answers under a `responseConstraint` schema of `{ section, quote }` — the
heading of the relevant section, and one sentence copied from it. That makes the
reply something to look up rather than prose to parse. Sampling is
`most-predictable`, since copying a sentence out of a document is a lookup, not
a composition.

**Saying it is working.** Reading a document, summarizing it and answering all
take long enough to need reporting, so the line above the document names the
stage it is in and carries three animating dots for as long as a model is busy.
Under `prefers-reduced-motion` the dots stay put rather than moving.

**Looking the quote up.** The page finds the quoted sentence in the rendered
document and highlights the block containing it. Every sentence of the indexed
text appears verbatim in the rendered document, so an accurate quote always
lands; when the model paraphrases instead, the named section is used and the
line above the document says the quote was not verbatim.

**Fitting the context window.** A document can be longer than the model will
accept, and the limit is only knowable from a session, so the text is measured
with `measureContextUsage()` against the clone. What does not fit is summarized
rather than cut: the [Summarizer API](https://developer.mozilla.org/en-US/docs/Web/API/Summarizer)
is asked for the whole document, and where the document is too long for that
too — `measureInputUsage()` against its `inputQuota` — its paragraphs are
grouped into batches the summarizer will take, summarized separately, and the
summaries pieced back together. The result is measured again, and summarized
again if it still does not fit, up to three passes.

Two things end that loop early. Summarizing text that is already dense can fail
to shrink it, and if the result still does not fit after the passes, paragraphs
are dropped until it does — sending more than the session accepts would
overflow rather than answer. The line above the document says which of these
happened, because it changes how the answer should be read: a quote taken from
a summary is unlikely to appear in the page word for word, so grounding falls
back to the section the model named.

## Availability

The store and the model are separate capabilities, so the header carries a badge
for each. Grounding is optional: without a language model the demo still finds
documents and opens them, just not at the passage.

The Prompt API needs a Chrome that exposes `LanguageModel` and has downloaded
the on-device model; the badge reports the state and shows download progress
while it arrives.

## Run locally

```sh
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`, and `npm run preview` serves
it.

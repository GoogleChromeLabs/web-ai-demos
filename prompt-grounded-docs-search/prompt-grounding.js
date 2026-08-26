/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Grounding a hit inside its document with the Prompt API.
//
// The vector store says which document answers a query, not where in it the
// answer is. This asks a language model to point at the passage: one session
// carries the instructions, and a clone of it carries one document, so the
// briefing is paid for once and each document starts from the same clean slate.

const SYSTEM_PROMPT = `You surface the passage of a document that answers a
question.

You are given a documentation page and a question about it. Reply with the
heading of the section that answers the question, and one sentence quoted from
that section, copied exactly as it appears. Never write a sentence of your own,
never summarize, and never answer the question itself: your only job is to point
at the text that does.

If the document does not answer the question, say so with an empty quote.`;

// Structured output, so the reply is a passage to look up rather than prose to
// parse.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    section: {
      type: "string",
      description:
        "Heading of the section that answers the question, verbatim.",
    },
    quote: {
      type: "string",
      description:
        "One sentence from that section, copied exactly, or an empty string.",
    },
  },
  required: ["section", "quote"],
  additionalProperties: false,
};

const OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

// Answering with a quote is a lookup, not a composition, so the least creative
// sampling available is the right one.
const CREATE_OPTIONS = { ...OPTIONS, samplingMode: "most-predictable" };

let briefed;

export const availability = async () => {
  if (!("LanguageModel" in self)) {
    return "unavailable";
  }
  // The same options as create(), or the answer describes a different session.
  return LanguageModel.availability(CREATE_OPTIONS);
};

// The one session that holds the instructions. Every grounding call clones it,
// so the system prompt is processed once rather than per document.
export const brief = async (onDownloadProgress) => {
  if (briefed) {
    return briefed;
  }

  briefed = await LanguageModel.create({
    ...CREATE_OPTIONS,
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownloadProgress?.(event.loaded);
      });
    },
  });
  return briefed;
};

export const forget = () => {
  briefed?.destroy();
  briefed = undefined;
  summarizer?.destroy();
  summarizer = undefined;
};

// A document can be longer than the model will accept, and the limit is only
// knowable from a session. Rather than cutting the tail off, the document is
// summarized until what is left fits: the Summarizer API is asked for the whole
// document, and where the document is too long for that too, paragraph by
// paragraph, with the summaries pieced back together.

const SUMMARIZER_OPTIONS = {
  type: "key-points",
  format: "plain-text",
  length: "short",
  expectedInputLanguages: ["en"],
  outputLanguage: "en",
};

// Enough left over for the question and the reply.
const RESERVE_TOKENS = 512;
const MAX_ROUNDS = 3;

let summarizer;

const getSummarizer = async (onDownloadProgress) => {
  if (summarizer) {
    return summarizer;
  }
  if (!("Summarizer" in self)) {
    return undefined;
  }
  // The same options as create(), or the answer describes a different session.
  if ((await Summarizer.availability(SUMMARIZER_OPTIONS)) === "unavailable") {
    return undefined;
  }

  summarizer = await Summarizer.create({
    ...SUMMARIZER_OPTIONS,
    sharedContext:
      "Reference documentation for an HTML element or attribute. Keep the wording of the source where possible.",
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownloadProgress?.(event.loaded);
      });
    },
  });
  return summarizer;
};

const prompt = (document, question) =>
  `Document:\n${document}\n\nQuestion: ${question}`;

const fits = async (session, text, question) => {
  const budget = session.contextWindow - session.contextUsage - RESERVE_TOKENS;
  return (await session.measureContextUsage(prompt(text, question))) <= budget;
};

// One pass of summarizing. Paragraphs are grouped into batches the summarizer
// will accept, and each batch is summarized on its own. Usage is measured per
// paragraph and added up rather than measured per batch: tokenization is not
// quite additive, but it is close, and it costs one measurement per paragraph
// instead of one per candidate batch.
const summarizePass = async (active, text) => {
  const paragraphs = text.split("\n\n").filter(Boolean);
  const batches = [];
  let batch = [];
  let usage = 0;

  for (const paragraph of paragraphs) {
    const cost = await active.measureInputUsage(paragraph);
    if (batch.length && usage + cost > active.inputQuota) {
      batches.push(batch);
      batch = [];
      usage = 0;
    }
    batch.push(paragraph);
    usage += cost;
  }
  if (batch.length) {
    batches.push(batch);
  }

  const summaries = [];
  for (const group of batches) {
    const input = group.join("\n\n");
    try {
      summaries.push(await active.summarize(input));
    } catch {
      // A single paragraph over the quota is the one case summarizing cannot
      // help with; it goes in as it is and the round below decides.
      summaries.push(input);
    }
  }
  return summaries.join("\n\n");
};

// The last resort, when summarizing is unavailable or has stopped helping: drop
// paragraphs off the end until what is left fits. Sending more than the session
// accepts is not an option — it would overflow rather than answer.
const trimToFit = async (session, text, question) => {
  const paragraphs = text.split("\n\n");
  while (paragraphs.length > 1) {
    paragraphs.pop();
    const shorter = paragraphs.join("\n\n");
    if (await fits(session, shorter, question)) {
      return shorter;
    }
  }
  return paragraphs.join("\n\n");
};

const condense = async (session, document, question, onProgress) => {
  if (await fits(session, document, question)) {
    return { text: document, summarized: false };
  }

  const active = await getSummarizer();
  if (!active) {
    return {
      text: await trimToFit(session, document, question),
      summarized: false,
      truncated: true,
    };
  }

  let text = document;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    onProgress?.({ phase: "summarize", round: round + 1 });
    const shorter = await summarizePass(active, text);

    // Summarizing something already dense can fail to shrink it, and going
    // round again would only burn time.
    const stalled = shorter.length >= text.length;
    text = stalled ? text : shorter;

    if (await fits(session, text, question)) {
      return { text, summarized: true };
    }
    if (stalled) {
      break;
    }
  }

  return {
    text: await trimToFit(session, text, question),
    summarized: true,
    truncated: true,
  };
};

export const groundInDocument = async ({
  document,
  question,
  signal,
  onProgress,
}) => {
  const session = await brief();
  // The clone inherits the briefing and nothing else, so one document never
  // colors the next.
  const clone = await session.clone({ signal });

  try {
    const condensed = await condense(clone, document, question, onProgress);
    onProgress?.({ phase: "ground" });
    const answer = await clone.prompt(prompt(condensed.text, question), {
      responseConstraint: RESPONSE_SCHEMA,
      signal,
    });
    return {
      ...JSON.parse(answer),
      summarized: condensed.summarized,
      truncated: condensed.truncated ?? false,
    };
  } finally {
    clone.destroy();
  }
};

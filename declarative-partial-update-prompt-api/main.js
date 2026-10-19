/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { nativeSupport } from './support.js';
import { EasyLanguageModel } from 'easy-language-model';

const $ = (id) => document.getElementById(id);

const stateBadge = $('state-badge');
const statusText = $('status');
const activationHint = $('activation-hint');
const activationButton = $('activation-btn');
const downloadProgress = $('download-progress');
const app = $('app');
const unsupported = $('unsupported');
const cityForm = $('city-form');
const cityInput = $('city-input');
const generateButton = $('generate-btn');
const stopButton = $('stop-btn');
const guide = $('guide');
const cardTemplate = $('card-template');
const wire = $('wire');
const askForm = $('ask-form');
const askInput = $('ask-input');
const askButton = $('ask-btn');
const answer = $('answer');

const SYSTEM_PROMPT =
  'You are a concise travel guide. Answer in Markdown. Never use headings, ' +
  'never add a preamble or a closing remark, and keep every answer short.';

// The order here is the order of the cards, and nothing else. Each answer is
// streamed into its own card whenever it arrives.
const SECTIONS = [
  {
    name: 'overview',
    title: 'At a glance',
    prompt: (city) =>
      `In two or three sentences, describe ${city} to a first-time visitor.`,
  },
  {
    name: 'sights',
    title: "Don't miss",
    prompt: (city) =>
      `List the five sights in ${city} a first-time visitor should not miss, ` +
      'as a bullet list with one short sentence each.',
  },
  {
    name: 'food',
    title: 'Eat and drink',
    prompt: (city) =>
      `List four local dishes or drinks to try in ${city}, as a bullet list ` +
      'with one short sentence each.',
  },
  {
    name: 'transit',
    title: 'Getting around',
    prompt: (city) =>
      `In one short paragraph, explain how a visitor gets around ${city}.`,
  },
  {
    name: 'phrases',
    title: 'Say it locally',
    prompt: (city) =>
      `Give three useful phrases in the local language of ${city}, as a ` +
      'table with the columns Phrase, Pronunciation, and Meaning.',
  },
];

const ordinals = new Intl.PluralRules('en', { type: 'ordinal' });
const ORDINAL_SUFFIXES = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinal = (n) => `${n}${ORDINAL_SUFFIXES[ordinals.select(n)]}`;

const escapeHTML = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );

// The default config drops `class`, which styles the arrival and error lines.
// Where there is no `Sanitizer`, there is no `streamHTML()` to hand it to.
const sanitizer = globalThis.Sanitizer ? new Sanitizer() : undefined;
sanitizer?.allowAttribute('class');

let session = null;
let busy = false;
// Aborts whatever is in flight, the guide or a follow-up.
let controller = null;

function showSupport() {
  $('support-streaming').textContent = nativeSupport.streamingInsertion
    ? 'native, parsed as the chunks arrive'
    : 'polyfilled by html-setters-polyfill, which buffers each stream and ' +
      'inserts it on close';
  // The same check `streamInto()` makes, after the polyfill has had its turn.
  $('support-sanitizing').textContent =
    'streamHTML' in Element.prototype
      ? 'streamHTML() with the Sanitizer API, class allowed'
      : 'streamHTMLUnsafe(), because this browser has no setHTML()';
}

function setState(state, message) {
  stateBadge.textContent = state;
  stateBadge.dataset.state = state;
  if (message) {
    statusText.textContent = message;
  }
}

function setBusy(value) {
  busy = value;
  generateButton.disabled = value;
  askButton.disabled = value;
  stopButton.disabled = !value;
  cityInput.readOnly = value;
}

/** Stamps one card per section, each showing a skeleton until it streams. */
function resetGuide() {
  guide.replaceChildren(
    ...SECTIONS.map(({ name, title }) => {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.section = name;
      card.querySelector('h2').textContent = title;
      return card;
    })
  );
  wire.replaceChildren();
}

/**
 * Opens a stream that replaces `element`'s children with the HTML written to
 * it, run through the Sanitizer API with `class` allowed.
 *
 * `html-setters-polyfill` can add `streamHTML()` only where `setHTML()` exists,
 * so fall back to `streamHTMLUnsafe()` where it doesn't. That is fine for what
 * this page writes: EasyLanguageModel's Markdown parser escapes all text the
 * model wrote and emits only tags it chose itself.
 */
function streamInto(element) {
  return 'streamHTML' in element
    ? element.streamHTML({ sanitizer })
    : element.streamHTMLUnsafe();
}

/** Mirrors one chunk into the wire log, tagged with the stream it went to. */
function logWire(name, html) {
  const span = document.createElement('span');
  span.dataset.section = name;
  span.textContent = html;
  wire.append(span);
}

/**
 * Streams one section into its card.
 *
 * Each section has a stream of its own, so all five are in flight at once, and
 * a native implementation fills each card as its chunks arrive.
 */
async function streamSection(base, { name, prompt }, city, arrival, signal) {
  const card = guide.querySelector(`[data-section="${name}"]`);
  card.dataset.state = 'queued';

  // `streamHTML()` replaces the skeleton, so the stream is opened with the
  // first chunk, and the skeleton stays up for as long as the section is only
  // queued.
  let writer = null;
  const write = async (html) => {
    if (!writer) {
      card.dataset.state = 'streaming';
      writer = streamInto(card.querySelector('.card-body')).getWriter();
    }
    logWire(name, html);
    await writer.write(html);
  };

  let clone = null;
  try {
    clone = await base.clone({ signal });
    for await (const chunk of clone.promptStreamingHTML(prompt(city), {
      signal,
    })) {
      await write(chunk);
    }
    await write(
      `<p class="arrival">Arrived ${ordinal(arrival.next())} of ` +
        `${SECTIONS.length}</p>`
    );
    card.dataset.state = 'done';
  } catch (error) {
    const message =
      error.name === 'AbortError'
        ? 'Stopped.'
        : `${error.name}: ${error.message}`;
    await write(`<p class="error">${escapeHTML(message)}</p>`);
    card.dataset.state = 'error';
  } finally {
    clone?.destroy();
    await writer?.close();
  }
}

/** A copy of `items` in random order (Fisher–Yates). */
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function writeGuide(city) {
  controller = new AbortController();
  const { signal } = controller;
  setBusy(true);
  resetGuide();
  answer.replaceChildren();
  setState('busy', `Writing the guide to ${city} in five concurrent sessions…`);

  let arrived = 0;
  const arrival = { next: () => ++arrived };
  const started = performance.now();
  // The on-device model answers one prompt at a time, so the sections finish
  // in the order they start. Starting them in a random order shows that the
  // cards don't depend on it: the layout comes from the markup, and each
  // answer streams into its own card.
  await Promise.all(
    shuffle(SECTIONS).map((section) =>
      streamSection(session, section, city, arrival, signal)
    )
  );

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  setState(
    'ready',
    signal.aborted ? 'Stopped.' : `Guide written in ${seconds} s.`
  );
  setBusy(false);
}

async function askFollowUp(question) {
  controller = new AbortController();
  const { signal } = controller;
  setBusy(true);
  setState('busy', 'Answering…');

  const sink = streamInto(answer);
  const clone = await session.clone();
  try {
    const guideText = guide.innerText;
    await clone
      .promptStreamingHTML(
        `Here is a city guide:\n\n${guideText}\n\n` +
          `Using only this guide, answer: ${question}`,
        { signal }
      )
      .pipeTo(sink, { signal });
    setState('ready', 'Answered.');
  } catch (error) {
    if (error.name === 'AbortError') {
      setState('ready', 'Stopped.');
    } else {
      answer.textContent = `${error.name}: ${error.message}`;
      setState('error', 'The follow-up failed.');
    }
  } finally {
    clone.destroy();
    setBusy(false);
  }
}

async function init() {
  showSupport();
  resetGuide();

  const availability = await EasyLanguageModel.availability();
  if (availability === 'unavailable') {
    setState('error', 'The Prompt API is unavailable.');
    unsupported.hidden = false;
    return;
  }

  setState('busy', 'Creating the session…');
  try {
    session = await EasyLanguageModel.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      downloadProgress,
      onDownloadProgress({ percent }) {
        // Progress events can arrive for a model that is already on disk,
        // going straight to 100%, so only a model that wasn't available is
        // reported as downloading.
        if (availability === 'available') {
          return;
        }
        // Once the bytes are in, the model is unpacked and loaded into memory,
        // which the progress bar shows as indeterminate.
        setState(
          'downloading',
          percent < 100
            ? `Downloading the model: ${percent}%`
            : 'Loading the model into memory…'
        );
      },
      activationButton,
      activationHint,
    });
  } catch (error) {
    setState('error', `${error.name}: ${error.message}`);
    return;
  }

  setState('ready', 'Ready. Pick a city.');
  app.hidden = false;

  cityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) {
      writeGuide(cityInput.value.trim());
    }
  });

  askForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) {
      askFollowUp(askInput.value.trim());
    }
  });

  stopButton.addEventListener('click', () => controller?.abort());
}

init();

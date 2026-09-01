// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Google LLC

import * as smd from 'https://cdn.jsdelivr.net/npm/streaming-markdown@0.0.17/smd.min.js';

import { tools } from './tools.js';

const statusEl = document.getElementById('status');
const dlProgress = document.getElementById('dl-progress');
const chatEl = document.getElementById('chat');
const formEl = document.getElementById('composer');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const resetBtn = document.getElementById('reset-btn');
const activateBtn = document.getElementById('activate-btn');
const debugLog = document.getElementById('debug-log');
const copyDebugBtn = document.getElementById('copy-debug');

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about
npm packages and GitHub repositories. You have tools available. Use them instead
of guessing: you have no reliable knowledge of star counts or of which packages
exist, and those numbers change constantly.

To find out how popular a package is, first search npm for it, then look up the
star count of the GitHub repository the search returns. Call get_repo_stars once
per repository you want to compare.

If a package is marked "sharedRepository": true, its stars belong to a
repository that holds several packages. Say that the count is for the whole
repository rather than for that package, and do not rank it against standalone
packages as though the numbers meant the same thing.

Answer in one short paragraph. Always give the exact star counts the tools gave
you, and never invent one.`;

// The model is only told what a tool is called, what it does, and what it takes.
// `execute()` stays on this side: the browser never runs it, the tool-call loop
// below does.
const declarations = tools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));
const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

// Shared by availability() and create(), so the availability check asks about
// the same session this demo actually wants: one that can emit tool calls and
// accept tool responses. Declaring the output language keeps Chrome from
// warning that none was specified.
const SESSION_OPTIONS = {
  expectedInputs: [
    { type: 'text', languages: ['en'] },    
    { type: 'tool-response' },
    // If you want to replay a session later, tool calls become inputs.
    { type: 'tool-call' },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['en'] },
    { type: 'tool-call' },
  ],
  tools: declarations,
};

// A misbehaving model could keep asking for tools forever, so cap the round
// trips per question.
const MAX_TOOL_CALLS = 8;

// `baseSession` is created once and never prompted, so it stays at the system
// prompt. Every conversation is a clone of it, which is far cheaper than
// building a session from scratch: no model load, no re-processing of the
// system prompt or the tool declarations.
let baseSession = null;
let session = null;
let busy = false;
let turn = 0;

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(text) {
  statusEl.textContent = text;
}

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.textContent = text;
  chatEl.append(el);
  el.scrollIntoView({ block: 'nearest' });
  return el;
}

// Renders one tool call as a collapsible entry in the chat, so the sequence of
// calls stays interleaved with the conversation that caused it.
function appendToolCall(name, args) {
  const details = document.createElement('details');
  details.className = 'tool-call';
  details.open = true;

  const summary = document.createElement('summary');
  const label = `${name}(${JSON.stringify(args)})`;
  summary.textContent = `⚙ ${label} …`;
  details.append(summary);

  const pre = document.createElement('pre');
  pre.textContent = 'Running…';
  details.append(pre);

  chatEl.append(details);
  details.scrollIntoView({ block: 'nearest' });

  return {
    finish(result, ms) {
      summary.textContent = `⚙ ${label} — ${ms} ms`;
      pre.textContent = JSON.stringify(result, null, 2);
    },
    fail(message) {
      summary.textContent = `⚠ ${label} failed`;
      pre.textContent = message;
    },
  };
}

// `disabled` takes a control out of the focus order and hides it from
// assistive technology, so a keyboard user tabbing through the page loses it
// while a turn runs. `aria-disabled` keeps it focusable and announces it as
// unavailable instead, which means the control still gets clicked: every
// handler below rejects the activation itself.
function setDisabled(element, value) {
  element.setAttribute('aria-disabled', String(value));
}

function isDisabled(element) {
  return element.getAttribute('aria-disabled') === 'true';
}

function setBusy(value) {
  busy = value;
  // `readonly` rather than `disabled`: it blocks typing while keeping the
  // field focusable and readable.
  userInput.readOnly = value;
  setDisabled(userInput, value);
  setDisabled(sendBtn, value);
  setDisabled(resetBtn, value);
  if (!value) {
    userInput.focus();
  }
}

// ─── Sanitizing ──────────────────────────────────────────────────────────────

// Builds a function that reports what a sanitizer would strip from a string,
// or null when there is nothing to strip. Model output has to be treated as
// untrusted, so anything removed means the turn stops rendering.
//
// The native Sanitizer API is preferred; DOMPurify is only fetched when the
// browser lacks it. The Prompt API needs Chrome 138+, which rules out the
// incompatible setHTML() of Chrome 105-118, so a plain check is enough here.
async function createUnsafeMarkupDetector() {
  if (
    typeof Element.prototype.setHTML === 'function' &&
    typeof Sanitizer === 'function'
  ) {
    console.info('[prompt-api] Sanitizing with the native Sanitizer API.');

    // Comments are stripped by default. They are harmless in Markdown, and
    // treating one as an attack would be a false alarm, so allow them.
    const sanitizer = new Sanitizer();
    sanitizer.setComments(true);

    // Both parses happen in an inert document, so nothing loads a resource or
    // fires an event handler just because it was parsed for the comparison.
    const inert = document.implementation.createHTMLDocument('');

    return (text) => {
      const raw = inert.createElement('div');
      const clean = inert.createElement('div');
      raw.innerHTML = text;
      clean.setHTML(text, { sanitizer });
      // setHTML() reports nothing about what it dropped, so compare a
      // sanitized parse against an unsanitized one: any difference is
      // something the sanitizer refused to keep.
      if (raw.innerHTML === clean.innerHTML) {
        return null;
      }
      const kept = new Set(
        [...clean.querySelectorAll('*')].map((el) => el.localName),
      );
      const droppedElement = [...raw.querySelectorAll('*')]
        .map((el) => el.localName)
        .find((name) => !kept.has(name));
      // No missing element means the element survived but an attribute on it
      // did not, as with <img onerror>.
      return droppedElement ? `<${droppedElement}>` : 'an unsafe attribute';
    };
  }

  console.info('[prompt-api] No native Sanitizer API, falling back to DOMPurify.');
  const { default: DOMPurify } = await import(
    'https://cdn.jsdelivr.net/npm/dompurify@3.2.0/dist/purify.es.mjs'
  );
  return (text) => {
    DOMPurify.sanitize(text);
    if (!DOMPurify.removed.length) {
      return null;
    }
    const removed = DOMPurify.removed[0];
    const source = removed.from?.nodeName ?? removed.element?.nodeName;
    return source ? `<${String(source).toLowerCase()}>` : 'unsafe markup';
  };
}

const detectUnsafeMarkup = await createUnsafeMarkupDetector();

// ─── Debug view ──────────────────────────────────────────────────────────────

// Interface instances (LanguageModelToolCall and friends) keep their attributes
// on the prototype, so JSON.stringify() renders them as `{}`. Copy the fields
// out by hand to get something readable.
function plainify(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(plainify);
  }
  if ('callID' in value) {
    const out = { callID: value.callID, name: value.name };
    if ('arguments' in value) {
      out.arguments = value.arguments;
    }
    if ('result' in value) {
      out.result = Array.from(value.result ?? []).map((item) => ({
        type: item.type,
        value: item.value,
      }));
    }
    if ('errorMessage' in value) {
      out.errorMessage = value.errorMessage;
    }
    return out;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, plainify(item)]),
  );
}

// Expands the shorthands the API accepts into an explicit content sequence.
// A bare string is shorthand for `[{ type: "text", value: theString }]`.
function asContent(value) {
  if (typeof value === 'string') {
    return [{ type: 'text', value }];
  }
  return Array.isArray(value) ? value : [value];
}

// Renders anything sent or received as canonical LanguageModelMessage objects:
// `{ role, content: [{ type, value }] }`. prompt() takes a bare string and
// answers with either a bare string or a content sequence, so neither leg is
// in message form to begin with. Normalizing both means the debug view shows
// exactly what you would store to replay the session later as
// `initialPrompts`.
function asMessages(role, payload) {
  // Already a list of messages, as with the tool responses sent each round.
  if (Array.isArray(payload) && payload.every((item) => item?.role)) {
    return payload.map((message) => ({
      role: message.role,
      content: asContent(message.content),
    }));
  }
  return [{ role, content: asContent(payload) }];
}

// Every message logged below, in order: the transcript the copy button hands
// over, and what you would store to replay the session.
const transcript = [];

// Records one leg of the exchange: `↑` for what the page sends into the
// session, `↓` for what the model sends back.
function logExchange(direction, label, role, payload) {
  const messages = plainify(asMessages(role, payload));
  transcript.push(...messages);

  const entry = document.createElement('div');
  entry.className = `exchange ${direction}`;

  const heading = document.createElement('div');
  heading.className = 'exchange-label';
  heading.textContent = `${direction === 'sent' ? '↑' : '↓'} ${label}`;
  entry.append(heading);

  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(messages, null, 2);
  entry.append(pre);

  debugLog.append(entry);
}

// The system prompt opens every transcript, so a replay starts where this
// session did.
function logSystemPrompt() {
  logExchange('sent', 'initialPrompts', 'system', SYSTEM_PROMPT);
}

// Records a failed round in the debug view. Deliberately not added to
// `transcript`: the copied JSON stays a valid list of messages, while the
// rendered log still explains why the exchange stopped where it did.
function logError(message) {
  const entry = document.createElement('div');
  entry.className = 'exchange failed';

  const heading = document.createElement('div');
  heading.className = 'exchange-label';
  heading.textContent = '⚠ error';
  entry.append(heading);

  const pre = document.createElement('pre');
  pre.textContent = message;
  entry.append(pre);

  debugLog.append(entry);
}

function logTurnStart(question) {
  const heading = document.createElement('div');
  heading.className = 'exchange-turn';
  heading.textContent = `Turn ${++turn}: ${question}`;
  debugLog.append(heading);
}

// ─── Tool-call loop ──────────────────────────────────────────────────────────

// Reports which of a tool's required arguments the model left out. Small
// models regularly call a tool with `arguments: {}`, and running the tool
// anyway sends undefined values to the API: a wasted request, answered with a
// misleading error. `get_repo_stars` with no arguments asks GitHub about
// `/repos/undefined/undefined` and reports "not found", which reads as "that
// repository does not exist" rather than "you forgot the arguments".
function missingArguments(tool, args) {
  const required = tool.inputSchema?.required ?? [];
  return required.filter((key) => {
    const value = args?.[key];
    return value === undefined || value === null || value === '';
  });
}

// Runs one tool the model asked for. Returns either the tool's parsed output
// or a failure message, so the caller can build a tool success or a tool error.
async function runTool(name, args) {
  const tool = toolsByName.get(name);
  if (!tool) {
    // The model hallucinated a tool. Report it as a tool error rather than
    // throwing, so it can correct itself on the next turn.
    return { ok: false, message: `There is no tool named ${name}.` };
  }

  const missing = missingArguments(tool, args);
  if (missing.length) {
    // Name what is missing, so the next attempt can fix it.
    const list = missing.map((key) => `"${key}"`).join(' and ');
    const message =
      `${name} was called without ${list}. Call it again and provide ` +
      `${missing.length > 1 ? 'those arguments' : 'that argument'}.`;
    appendToolCall(name, args ?? {}).fail(message);
    return { ok: false, message };
  }

  const entry = appendToolCall(name, args ?? {});
  const started = performance.now();
  try {
    // Tools return a JSON string, so parse it back for the `object` result.
    const parsed = JSON.parse(await tool.execute(args ?? {}));
    entry.finish(parsed, Math.round(performance.now() - started));
    return { ok: true, value: parsed };
  } catch (error) {
    entry.fail(String(error));
    return { ok: false, message: String(error) };
  }
}

// Chrome refuses a tool result that contains a JSON null anywhere inside it:
// null converts to base::Value::Type::NONE, ContainsNoneType() sees it, and
// ConvertToolSuccessToDictValue() fails, which surfaces as "Failed to
// serialize tool result. Value may contain circular references...". The whole
// turn dies on it. GitHub returns `description: null` for a repository without
// a description, so strip nulls instead of handing one over.
function withoutNulls(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined)
      .map(withoutNulls);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, withoutNulls(item)]),
    );
  }
  return value;
}

// Builds one `tool-response` content part for a call the model made.
//
// The value has to be a real LanguageModelToolSuccess or LanguageModelToolError
// instance: a plain object is rejected with "The value must be a
// LanguageModelToolSuccess or LanguageModelToolError for type:'tool-response'".
// Note the capital D in `callID`.
function toolResponsePart(call, outcome) {
  const value = outcome.ok
    ? new LanguageModelToolSuccess({
        callID: call.callID,
        name: call.name,
        // `object` takes any JSON-serializable value, minus nulls. Chrome
        // currently supports only `text` and `object` here, not `image` or
        // `audio`.
        result: [{ type: 'object', value: withoutNulls(outcome.value) ?? {} }],
      })
    : new LanguageModelToolError({
        callID: call.callID,
        name: call.name,
        errorMessage: outcome.message,
      });
  return { type: 'tool-response', value };
}

// Streams one model turn.
//
// The stream is heterogeneous: text arrives as plain strings, while each tool
// call arrives as its own structured `{ type: 'tool-call', value }` chunk
// ("Each tool call becomes a separate chunk in the stream",
// model_execution_responder.cc). Text is rendered as it arrives; tool calls are
// collected for the caller to run.
async function streamResponse(input) {
  const calls = [];
  let text = '';
  let bubble = null;
  let parser = null;

  for await (const chunk of session.promptStreaming(input)) {
    if (typeof chunk !== 'string') {
      if (chunk?.type === 'tool-call') {
        calls.push(chunk.value);
      } else {
        console.warn('[prompt-api] Unrecognized stream chunk:', chunk);
        globalThis.lastChunk = chunk;
      }
      continue;
    }

    text += chunk;
    // The bubble is created on the first text chunk, so a turn that only calls
    // tools does not leave an empty one behind.
    if (!bubble) {
      bubble = appendMessage('assistant', '');
      parser = smd.parser(smd.default_renderer(bubble));
    }

    // Check everything received so far, never the chunk alone: dangerous
    // markup can be split across chunk boundaries. Anything a sanitizer would
    // remove means the output is unsafe, so stop rendering rather than show a
    // cleaned-up version that is no longer what the model said.
    const unsafe = detectUnsafeMarkup(text);
    if (unsafe) {
      smd.parser_end(parser);
      appendMessage(
        'error',
        `Rendering stopped: the sanitizer would remove ${unsafe} from this ` +
          `response.`,
      );
      return { calls, parts: [], blocked: true };
    }

    // Appends only the new nodes, instead of re-parsing everything so far.
    smd.parser_write(parser, chunk);
  }

  if (parser) {
    smd.parser_end(parser);
    bubble.scrollIntoView({ block: 'nearest' });
  }

  // Reassemble the turn as a canonical content sequence, so the debug view
  // still shows a replayable message even though it arrived in pieces.
  const parts = [];
  if (text) {
    parts.push({ type: 'text', value: text });
  }
  for (const call of calls) {
    parts.push({ type: 'tool-call', value: call });
  }
  return { calls, parts, blocked: false };
}

async function ask(question) {
  if (busy || !session) {
    return;
  }
  appendMessage('user', question);
  setBusy(true);
  setStatus('Thinking…');
  logTurnStart(question);

  try {
    logExchange('sent', 'promptStreaming()', 'user', question);
    let { calls, parts, blocked } = await streamResponse(question);
    logExchange('received', 'response', 'assistant', parts);
    if (blocked) {
      return;
    }

    // Keep going as long as the model asks for tools rather than just
    // talking: run what it asked for, feed the results back, stream again.
    let rounds = 0;
    while (calls.length) {
      if (++rounds > MAX_TOOL_CALLS) {
        appendMessage(
          'error',
          `Stopped after ${MAX_TOOL_CALLS} tool calls without a final answer.`,
        );
        return;
      }
      setStatus(`Calling ${calls.map((call) => call.name).join(', ')}…`);

      const responses = [];
      for (const call of calls) {
        const outcome = await runTool(call.name, call.arguments);
        responses.push(toolResponsePart(call, outcome));
      }

      setStatus('Thinking…');
      // Tool responses must use the user role: the role enum is only
      // "system", "user", and "assistant". Every response for this round
      // travels in one message.
      const messages = [{ role: 'user', content: responses }];
      logExchange('sent', `promptStreaming() round ${rounds}`, 'user', messages);
      ({ calls, parts, blocked } = await streamResponse(messages));
      logExchange('received', `response ${rounds}`, 'assistant', parts);
      if (blocked) {
        return;
      }
    }

  } catch (error) {
    appendMessage('error', `Something went wrong: ${error.message}`);
    logError(`${error.name}: ${error.message}`);
  } finally {
    // In `finally`, so the status is correct however the turn ended: a normal
    // answer, a sanitizer stop, the tool-call cap, or a thrown error.
    setStatus(
      `Ready. Context: ${session.contextUsage} / ${session.contextWindow} tokens.`,
    );
    setBusy(false);
  }
}

// ─── Session ─────────────────────────────────────────────────────────────────

// Creates the pristine base session and takes the first clone from it. Called
// straight from a click when the model still has to be downloaded, because
// create() then needs transient user activation.
async function createSession() {
  setDisabled(activateBtn, true);
  setStatus('Preparing the model…');

  try {
    // The base session is created once and kept pristine: it is only ever
    // cloned, never prompted.
    baseSession = await LanguageModel.create({
      ...SESSION_OPTIONS,
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor(m) {
        dlProgress.style.display = 'block';
        m.addEventListener('downloadprogress', (e) => {
          const total = e.total ?? 1;
          dlProgress.value = e.loaded;
          dlProgress.max = total;
          setStatus(
            `Downloading the model: ${Math.round((e.loaded / total) * 100)}%`,
          );
        });
      },
    });
    session = await baseSession.clone();
    logSystemPrompt();
  } catch (error) {
    dlProgress.style.display = 'none';
    setDisabled(activateBtn, false);
    setStatus(`Could not create a session: ${error.message}`);
    return;
  }

  dlProgress.style.display = 'none';
  activateBtn.hidden = true;
  setStatus(
    `Ready. Tools available: ${tools.map((tool) => tool.name).join(', ')}.`,
  );
  setBusy(false);
}

async function initSession() {
  if (!('LanguageModel' in self)) {
    setStatus(
      'The Prompt API is not available. Use Chrome 138 or later on desktop.',
    );
    return;
  }

  const availability = await LanguageModel.availability(SESSION_OPTIONS);
  if (availability === 'unavailable') {
    setStatus('The Prompt API is not available on this device.');
    return;
  }

  // The model is already on the device, so a session can be created right
  // away, without any interaction.
  if (availability === 'available') {
    await createSession();
    return;
  }

  // "downloadable" or "downloading": create() has to be called with transient
  // user activation, which a page-load call does not have. Wait for a click.
  // See https://developer.chrome.com/docs/ai/get-started#user-activation.
  activateBtn.textContent =
    availability === 'downloading'
      ? 'Finish downloading the model'
      : 'Download the model';
  activateBtn.hidden = false;
  setDisabled(activateBtn, false);
  setStatus(
    'The model has to be downloaded before this demo can run. Click the ' +
      'button to start; the download is a few gigabytes and only happens once.',
  );
}

// Throws away the conversation by destroying the clone and taking a fresh one.
// The base session, and with it the loaded model, is untouched.
async function resetSession() {
  if (busy || !baseSession) {
    return;
  }
  setBusy(true);
  setStatus('Resetting session…');

  session?.destroy();
  session = await baseSession.clone();

  chatEl.replaceChildren();
  debugLog.replaceChildren();
  transcript.length = 0;
  logSystemPrompt();
  turn = 0;
  setBusy(false);
  setStatus('Session reset. The model has forgotten the conversation.');
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  // Submitting is still possible while aria-disabled, by clicking Send or by
  // pressing Enter in the field, so refuse it here.
  if (isDisabled(sendBtn)) {
    return;
  }
  const question = userInput.value.trim();
  if (!question) {
    return;
  }
  userInput.value = '';
  ask(question);
});

copyDebugBtn.addEventListener('click', async () => {
  // One JSON array of every message, in order.
  await navigator.clipboard.writeText(JSON.stringify(transcript, null, 2));
  const label = copyDebugBtn.textContent;
  copyDebugBtn.textContent = `Copied ${transcript.length} messages`;
  setTimeout(() => {
    copyDebugBtn.textContent = label;
  }, 2000);
});

activateBtn.addEventListener('click', () => {
  if (isDisabled(activateBtn)) {
    return;
  }
  // The click is what grants the transient activation create() needs.
  if (!navigator.userActivation?.isActive) {
    setStatus('Interact with the page first, then try again.');
    return;
  }
  createSession();
});

resetBtn.addEventListener('click', () => {
  if (isDisabled(resetBtn)) {
    return;
  }
  resetSession();
});

for (const button of document.querySelectorAll('.example')) {
  button.addEventListener('click', () => {
    // The example buttons are never marked unavailable, but they start a turn
    // just like Send does, so they get the same guard.
    if (busy || !session) {
      return;
    }
    ask(button.textContent.trim());
  });
}

initSession();

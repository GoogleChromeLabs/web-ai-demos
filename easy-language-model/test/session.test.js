/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DomEvent } from './dom.js';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { EasyLanguageModel } from '../src/easy-language-model.js';
import { fakeCompactionApis, fakeLanguageModel, stubGlobals } from './stubs.js';

// Sanitization needs the real HTML Sanitizer API, which Node has no
// implementation of. Those behaviours are covered by test/sanitizer.browser.html
// instead; everything here is about session plumbing.
const NO_SANITIZER = { sanitizer: false, userActivation: 'ignore' };

let restore = () => {};
afterEach(() => {
  restore();
  restore = () => {};
});

function install(script, options = {}) {
  const globals = {
    LanguageModel: fakeLanguageModel(script, options),
    ...fakeCompactionApis(),
  };
  if (options.userActivation) {
    globals.navigator = { userActivation: options.userActivation };
  }
  restore = stubGlobals(globals);
}

const newScript = (response = '') => ({ response, sessions: [] });

const drain = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

describe('creating a session', () => {
  it('waits for a gesture when the model must be downloaded', async () => {
    const script = newScript();
    install(script, {
      availability: ['downloadable'],
      userActivation: { isActive: false },
    });

    let asked = 0;
    const pending = EasyLanguageModel.create({
      ...NO_SANITIZER,
      userActivation: 'wait',
      onUserActivationRequired: () => asked++,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(asked, 1, 'should have asked for a gesture');
    assert.equal(
      script.sessions.length,
      0,
      'must not create before the gesture'
    );

    // Only a trusted event releases the wait, so `isTrusted` has to be forced
    // on: it is a read-only getter.
    const gesture = new DomEvent('pointerdown', { bubbles: true });
    Object.defineProperty(gesture, 'isTrusted', { value: true });
    document.dispatchEvent(gesture);
    await pending;
    assert.equal(script.sessions.length, 1);
  });

  it('needs no gesture when the model is already available', async () => {
    const script = newScript();
    install(script, { userActivation: { isActive: false } });
    let asked = 0;
    await EasyLanguageModel.create({
      ...NO_SANITIZER,
      userActivation: 'wait',
      onUserActivationRequired: () => asked++,
    });
    assert.equal(asked, 0);
  });

  it('throws rather than waiting when asked to', async () => {
    install(newScript(), {
      availability: ['downloadable'],
      userActivation: { isActive: false },
    });
    await assert.rejects(
      EasyLanguageModel.create({ sanitizer: false, userActivation: 'throw' }),
      { name: 'UserActivationRequiredError' }
    );
  });

  it('reports download states in order and drives a progress element', async () => {
    const script = newScript();
    script.progress = [
      { loaded: 0.25, total: 1 },
      { loaded: 0.5, total: 1 },
      { loaded: 1, total: 1 },
    ];
    install(script, { availability: ['downloadable'] });

    const states = [];
    const progress = document.createElement('progress');
    await EasyLanguageModel.create({
      ...NO_SANITIZER,
      progress,
      onDownloadStateChange: (state) => states.push(state),
    });

    assert.deepEqual(states, [
      'checking',
      'downloadable',
      'downloading',
      'extracting',
      'ready',
    ]);
    assert.equal(progress.hidden, true, 'hidden once ready');
  });

  it('rejects when the model is unavailable', async () => {
    install(newScript(), { availability: ['unavailable'] });
    await assert.rejects(EasyLanguageModel.create(NO_SANITIZER), {
      name: 'LanguageModelUnavailableError',
    });
  });
});

describe('prompting', () => {
  it('returns the response and records both sides', async () => {
    const script = newScript('Hello **world**.');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    assert.equal(await session.prompt('hi'), 'Hello **world**.');
    assert.deepEqual(session.history, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello **world**.' },
    ]);
  });

  it('streams Markdown chunks that rejoin into the response', async () => {
    const script = newScript('# Title\n\nSome *text* here.\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const chunks = await drain(session.promptStreaming('x'));
    assert.equal(chunks.join(''), script.response);
  });

  it('holds back an unfinished tag but not a bare < in prose', async () => {
    const script = newScript('if 1 < 2 and 3 > 2 then done');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const chunks = await drain(session.promptStreaming('x'));
    assert.equal(chunks.join(''), script.response);
  });

  it('streams HTML finer than a block', async () => {
    const script = newScript('# Title\n\nA **bold** para.\n\n- one\n- two\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const html = await drain(session.promptStreamingHTML('x'));
    assert.equal(
      html.join(''),
      '<h1>Title</h1><p>A <strong>bold</strong> para.</p>' +
        '<ul><li>one</li><li>two</li></ul>'
    );
    assert.ok(
      html.length > 8,
      `expected token-level chunks, got ${html.length}`
    );
    assert.equal(html[0], '<h1>');
  });

  it('renders into an element and surfaces both representations', async () => {
    const script = newScript('# Title\n\nA **bold** para.\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);

    const into = document.createElement('div');
    const html = [];
    const markdown = [];
    const returned = await session.renderStreaming('x', {
      into,
      onHtml: (chunk) => html.push(chunk),
      onMarkdown: (chunk) => markdown.push(chunk),
    });

    const expected = '<h1>Title</h1><p>A <strong>bold</strong> para.</p>';
    assert.equal(into.innerHTML, expected);
    assert.equal(html.join(''), expected);
    assert.equal(returned, script.response);
    assert.equal(markdown.join(''), script.response);
  });

  it('carries history into a clone without linking them', async () => {
    const script = newScript('ok');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    await session.prompt('first');
    const clone = await session.clone();
    assert.deepEqual(clone.history, session.history);
    await clone.prompt('second');
    assert.equal(session.history.length, 2, 'original must not grow');
    assert.equal(clone.history.length, 4);
  });
});

describe('aborting', () => {
  it('passes a signal through to the underlying session', async () => {
    const script = newScript('some response');
    let seenSignal;
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    // The fake records what it was handed.
    session.session.promptStreaming = function (input, options) {
      seenSignal = options?.signal;
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    };
    const controller = new AbortController();
    await drain(session.promptStreaming('x', { signal: controller.signal }));
    assert.equal(seenSignal, controller.signal);
  });

  it('surfaces the abort and leaves the session usable', async () => {
    const script = newScript('some response');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const controller = new AbortController();
    session.session.promptStreaming = function () {
      return new ReadableStream({
        start(streamController) {
          streamController.enqueue('partial ');
          controller.signal.addEventListener('abort', () =>
            streamController.error(controller.signal.reason)
          );
        },
      });
    };

    const stream = session.promptStreaming('x', { signal: controller.signal });
    const reader = stream.getReader();
    assert.equal((await reader.read()).value, 'partial ');
    controller.abort();
    await assert.rejects(reader.read(), { name: 'AbortError' });

    // An aborted turn is not recorded, so history does not drift.
    assert.deepEqual(session.history, []);
  });
});

describe('compacting', () => {
  const conversation = async (session) => {
    await session.prompt('tell me about foxes and their many varied habits');
    await session.prompt('and about dogs and their many varied habits too');
  };

  it('summarizes, swaps the session, and reports what it saved', async () => {
    const script = newScript(
      'The quick brown fox jumps over the lazy dog repeatedly.'
    );
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    await conversation(session);

    const before = session.history.length;
    const old = session.session;
    const stats = await session.compact();

    assert.equal(stats.messages, before, 'every message survives');
    assert.equal(old.destroyed, true, 'the old session is released');
    assert.notEqual(session.session, old, 'a new session takes over');
    assert.equal(session.history[1].content, 'The quick brown', 'summarized');
    assert.equal(
      session.session.options.initialPrompts.length,
      before,
      'the summaries seed the new session'
    );
    assert.deepEqual(stats.languages, ['en']);
  });

  it('re-attaches listeners onto the new session', async () => {
    const script = newScript('The quick brown fox jumps over the lazy dog.');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    await conversation(session);

    let overflows = 0;
    session.addEventListener('contextoverflow', () => overflows++);
    await session.compact();
    session.session.dispatchEvent(new Event('contextoverflow'));
    assert.equal(overflows, 1);
  });

  it('rebuilds from the untouched history when compaction fails', async () => {
    const script = newScript('The quick brown fox jumps over the lazy dog.');
    let creates = 0;
    install(script, {
      onCreate(options) {
        // Fail only the create that carries the compacted summaries, so the
        // recovery path runs with the old session already destroyed.
        creates++;
        if (creates === 2) {
          throw new Error('seeding failed');
        }
      },
    });

    const session = await EasyLanguageModel.create(NO_SANITIZER);
    await conversation(session);
    const full = session.history.length;

    await assert.rejects(session.compact(), { message: 'seeding failed' });

    assert.ok(session.session, 'a working session must remain');
    assert.equal(session.session.destroyed, false);
    assert.equal(session.history.length, full, 'full history is restored');
    assert.equal(
      await session.prompt('still alive?'),
      script.response,
      'the session is usable again'
    );
  });
});

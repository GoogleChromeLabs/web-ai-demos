/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DomEvent } from './dom.js';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { EasyLanguageModel } from '../src/easy-language-model.js';
import { renderStreamingHTML } from 'streaming-markdown-html';
import { fakeCompactionApis, fakeLanguageModel, stubGlobals } from './stubs.js';

// Sanitization needs the real HTML Sanitizer API, which Node has no
// implementation of. Those behaviours are covered by test/sanitizer.browser.html
// instead; everything here is about session plumbing.
const NO_SANITIZER = { sanitizer: false };

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
  it('waits for the button when the model must be downloaded', async () => {
    const script = newScript();
    install(script, {
      availability: ['downloadable'],
      userActivation: { isActive: false },
    });
    const button = document.createElement('button');
    button.hidden = true;
    document.body.append(button);

    let asked = 0;
    const pending = EasyLanguageModel.create({
      ...NO_SANITIZER,
      activationButton: button,
      onUserActivationRequired: () => asked++,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(asked, 1, 'should have asked for a gesture');
    assert.equal(button.hidden, false, 'and revealed the button');
    assert.equal(script.sessions.length, 0, 'must not create before the click');

    // Only a trusted click releases the wait, so `isTrusted` has to be forced
    // on: it is a read-only getter.
    const click = new DomEvent('click', { bubbles: true });
    Object.defineProperty(click, 'isTrusted', { value: true });
    button.dispatchEvent(click);
    await pending;
    assert.equal(script.sessions.length, 1);
    assert.equal(button.hidden, true, 'and hid it again');
  });

  it('takes no notice of clicks anywhere else', async () => {
    const script = newScript();
    install(script, {
      availability: ['downloadable'],
      userActivation: { isActive: false },
    });
    const button = document.createElement('button');
    document.body.append(button);

    const pending = EasyLanguageModel.create({
      ...NO_SANITIZER,
      activationButton: button,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const stray = new DomEvent('click', { bubbles: true });
    Object.defineProperty(stray, 'isTrusted', { value: true });
    document.body.dispatchEvent(stray);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(script.sessions.length, 0, 'a stray click must not count');

    const onButton = new DomEvent('click', { bubbles: true });
    Object.defineProperty(onButton, 'isTrusted', { value: true });
    button.dispatchEvent(onButton);
    await pending;
    assert.equal(script.sessions.length, 1);
  });

  it('needs no gesture when the model is already available', async () => {
    const script = newScript();
    install(script, { userActivation: { isActive: false } });
    let asked = 0;
    await EasyLanguageModel.create({
      ...NO_SANITIZER,
      activationButton: document.createElement('button'),
      onUserActivationRequired: () => asked++,
    });
    assert.equal(asked, 0);
  });

  it('creates without waiting when no button is given', async () => {
    // Nothing to wait on, so the wrapper invents no wait: create() is called
    // as it stands and the browser decides.
    let reached = false;
    install(newScript(), {
      availability: ['downloadable'],
      userActivation: { isActive: false },
      onCreate: () => {
        reached = true;
      },
    });
    await EasyLanguageModel.create(NO_SANITIZER);
    assert.ok(reached, 'create() was called without waiting for a gesture');
  });

  it('drives a progress element through the download and hides it after', async () => {
    const script = newScript();
    script.progress = [
      { loaded: 0.25, total: 1 },
      { loaded: 0.5, total: 1 },
      { loaded: 1, total: 1 },
    ];
    install(script, { availability: ['downloadable'] });

    const seen = [];
    const progress = document.createElement('progress');
    await EasyLanguageModel.create({
      ...NO_SANITIZER,
      progress,
      onDownloadProgress: (p) => seen.push(p.percent),
    });

    assert.deepEqual(seen, [0.25, 0.5, 1], 'every event reported');
    assert.equal(progress.hidden, true, 'hidden once ready');
  });

  it('leaves the progress element alone when nothing is downloaded', async () => {
    const script = newScript();
    install(script);
    const progress = document.createElement('progress');
    await EasyLanguageModel.create({ ...NO_SANITIZER, progress });
    assert.equal(progress.hidden, true);
  });

  it('forwards unknown options to both calls, unchanged', async () => {
    const script = newScript();
    const created = [];
    const asked = [];
    install(script, { onCreate: (options) => created.push(options) });
    const base = globalThis.LanguageModel;
    globalThis.LanguageModel = {
      ...base,
      async availability(options) {
        asked.push(options);
        return 'available';
      },
    };

    // Stand-in for whatever the Prompt API adds next.
    const options = {
      ...NO_SANITIZER,
      somethingNew: 42,
      samplingMode: 'balanced',
    };
    await EasyLanguageModel.availability(options);
    await EasyLanguageModel.create(options);

    assert.equal(asked[0].somethingNew, 42, 'reached availability()');
    assert.equal(created[0].somethingNew, 42, 'reached create()');
    for (const seen of [asked[0], created[0]]) {
      assert.ok(!('sanitizer' in seen), "the wrapper's own options stay out");
      assert.ok(!('userActivation' in seen), 'and so do its behaviour flags');
    }
  });

  it('exports only what callers need', async () => {
    const api = await import('../src/index.js');
    assert.deepEqual(Object.keys(api).sort(), [
      'EasyLanguageModel',
      'renderStreamingHTML',
    ]);
  });

  it('offers nothing beyond the Prompt API and its own additions', async () => {
    install(newScript());
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    // Removed as inventions: an escape hatch, a feature-detect availability()
    // already covers, and deprecated or extension-only members.
    for (const gone of [
      'session',
      'measureInputUsage',
      'inputUsage',
      'inputQuota',
      'onquotaoverflow',
      'topK',
      'temperature',
    ]) {
      assert.ok(!(gone in session), gone);
    }
    assert.equal(EasyLanguageModel.supported, undefined, 'supported');
    assert.equal(EasyLanguageModel.params, undefined, 'params');
  });

  it('lets the Prompt API report an unavailable model itself', async () => {
    // `availability()` is the caller's to check. `create()` asks only to drive
    // download reporting and the gesture check, and never pre-empts the Prompt
    // API's own error with one of its own.
    install(newScript(), {
      availability: ['unavailable'],
      createRejects: true,
    });
    await assert.rejects(EasyLanguageModel.create(NO_SANITIZER), (error) => {
      assert.notEqual(error.name, 'LanguageModelUnavailableError');
      assert.match(error.message, /unavailable/i);
      return true;
    });
  });

  it('reports an unsupported browser through availability()', async () => {
    const { LanguageModel } = globalThis;
    delete globalThis.LanguageModel;
    try {
      assert.equal(await EasyLanguageModel.availability(), 'unavailable');
    } finally {
      globalThis.LanguageModel = LanguageModel;
    }
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

  it('promptHTML() returns the whole response as HTML', async () => {
    const script = newScript('# Title\n\nA **bold** para.\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    assert.equal(
      await session.promptHTML('x'),
      '<h1>Title</h1><p>A <strong>bold</strong> para.</p>'
    );
  });

  it('promptHTML() agrees with the streaming form and records history', async () => {
    const script = newScript('# Title\n\nA **bold** para.\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const whole = await session.promptHTML('x');
    const streamed = (await drain(session.promptStreamingHTML('x'))).join('');
    assert.equal(whole, streamed);
    assert.deepEqual(
      session.history.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant']
    );
  });

  it('promptStreamingHTML() touches nothing, even handed an element', async () => {
    const script = newScript('# Title\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);
    const into = document.createElement('div');
    const html = await drain(session.promptStreamingHTML('x', { into }));
    assert.equal(html.join(''), '<h1>Title</h1>', 'the stream still yields');
    assert.equal(into.innerHTML, '', 'rendering belongs to renderStreaming()');
  });

  it('pipes into an element and surfaces the Markdown alongside', async () => {
    const script = newScript('# Title\n\nA **bold** para.\n');
    install(script);
    const session = await EasyLanguageModel.create(NO_SANITIZER);

    const into = document.createElement('div');
    const markdown = [];
    await session
      .promptStreamingHTML('x', {
        onMarkdownChunk: (chunk) => markdown.push(chunk),
      })
      .pipeTo(renderStreamingHTML(into));

    assert.equal(
      into.innerHTML,
      '<h1>Title</h1><p>A <strong>bold</strong> para.</p>'
    );
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
    script.sessions.at(-1).promptStreaming = function (input, options) {
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
    script.sessions.at(-1).promptStreaming = function () {
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
    const old = script.sessions.at(-1);
    const stats = await session.compact();
    const replacement = script.sessions.at(-1);

    assert.equal(stats.messages, before, 'every message survives');
    assert.equal(old.destroyed, true, 'the old session is released');
    assert.notEqual(replacement, old, 'a new session takes over');
    assert.equal(session.history[1].content, 'The quick brown', 'summarized');
    assert.equal(
      replacement.options.initialPrompts.length,
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
    script.sessions.at(-1).dispatchEvent(new Event('contextoverflow'));
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

    assert.equal(
      script.sessions.at(-1).destroyed,
      false,
      'a working session must remain'
    );
    assert.equal(session.history.length, full, 'full history is restored');
    assert.equal(
      await session.prompt('still alive?'),
      script.response,
      'the session is usable again'
    );
  });
});

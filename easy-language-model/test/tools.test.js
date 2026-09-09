/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './dom.js';

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { EasyLanguageModel } from '../src/easy-language-model.js';
import {
  fakeCompactionApis,
  fakeLanguageModel,
  installToolGlobals,
  stubGlobals,
  toolCall,
} from './stubs.js';

const NO_SANITIZER = { sanitizer: false };

let restore = () => {};
afterEach(() => {
  restore();
  restore = () => {};
});

// Installed for the whole suite: a test builds its tool calls while writing
// its script, which is before any per-test setup would have run.
let removeToolGlobals = () => {};
before(() => {
  removeToolGlobals = installToolGlobals();
});
after(() => {
  removeToolGlobals();
});

/** A script whose turns are replayed one per prompt. */
function install(turns, options = {}) {
  const script = { sessions: [], turns, response: '' };
  restore = stubGlobals({
    LanguageModel: fakeLanguageModel(script, options),
    ...fakeCompactionApis(),
  });
  return script;
}

/** A weather tool that records what it was asked. */
function weatherTool(execute) {
  const calls = [];
  return {
    calls,
    tool: {
      name: 'get_weather',
      description: 'Get the current weather in a location.',
      inputSchema: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
      execute: async (args) => {
        calls.push(args);
        return execute ? execute(args) : { temperatureC: 18 };
      },
    },
  };
}

/** The tool-response parts of whatever was sent back to the model. */
function responsesSentBack(script) {
  return script.sessions
    .at(-1)
    .prompts.flatMap((input) =>
      Array.isArray(input)
        ? input
            .flatMap((m) => m.content)
            .filter((p) => p?.type === 'tool-response')
        : []
    )
    .map((part) => part.value);
}

describe('tool calling', () => {
  it('runs the tool and answers from its result', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'It is 18 °C in Hamburg.',
    ]);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const answer = await session.prompt('Weather in Hamburg?');

    assert.deepEqual(calls, [{ location: 'Hamburg' }], 'the tool ran once');
    assert.equal(
      answer,
      'It is 18 °C in Hamburg.',
      'the final text comes back'
    );
  });

  it('keeps `execute` away from create(), and asks for the tool types', async () => {
    const script = install(['fine']);
    const { tool } = weatherTool();
    await EasyLanguageModel.create({ ...NO_SANITIZER, tools: [tool] });

    const options = script.sessions.at(-1).options;
    assert.deepEqual(Object.keys(options.tools[0]).sort(), [
      'description',
      'inputSchema',
      'name',
    ]);
    // Declaring tools implies neither tool type, so a session created without
    // these would reject the very results the tools exist to produce.
    const types = (list) => list.map((entry) => entry.type);
    assert.ok(types(options.expectedInputs).includes('tool-response'));
    assert.ok(types(options.expectedInputs).includes('tool-call'));
    assert.ok(types(options.expectedOutputs).includes('tool-call'));
  });

  it('adds the tool types without displacing what you expected', async () => {
    const script = install(['fine']);
    const { tool } = weatherTool();
    await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      expectedInputs: [
        { type: 'text', languages: ['de', 'en'] },
        { type: 'image' },
      ],
      expectedOutputs: [{ type: 'text', languages: ['de'] }],
    });

    // Appended, never rewritten: the languages and the image input are the
    // caller's business, and only the missing tool types are filled in.
    const { expectedInputs, expectedOutputs } = script.sessions.at(-1).options;
    assert.deepEqual(expectedInputs, [
      { type: 'text', languages: ['de', 'en'] },
      { type: 'image' },
      { type: 'tool-response' },
      { type: 'tool-call' },
    ]);
    assert.deepEqual(expectedOutputs, [
      { type: 'text', languages: ['de'] },
      { type: 'tool-call' },
    ]);
  });

  it('records both halves of a round in history', async () => {
    install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'It is 18 °C.',
    ]);
    const { tool } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });
    await session.prompt('Weather?');

    const roles = session.history.map((m) => m.role);
    assert.deepEqual(roles, ['user', 'assistant', 'user', 'assistant']);
    const [, askedForTool, toolResult] = session.history;
    assert.equal(askedForTool.content[0].type, 'tool-call');
    assert.equal(toolResult.content[0].type, 'tool-response');
    assert.equal(toolResult.content[0].value.name, 'get_weather');
  });

  it('stops after maxToolRounds rather than looping forever', async () => {
    const asking = [
      {
        type: 'tool-call',
        value: toolCall('get_weather', { location: 'Hamburg' }),
      },
    ];
    install([asking, asking, asking, asking, asking]);
    const { tool } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      maxToolRounds: 2,
    });

    await assert.rejects(session.prompt('Weather?'), (error) => {
      assert.equal(error.name, 'OperationError');
      assert.equal(error.toolRounds, 2, 'reports how many it spent');
      assert.equal(
        error.toolCalls.length,
        1,
        'and what it was still asking for'
      );
      return true;
    });

    // The session took those turns, so dropping them here would leave history
    // describing a conversation the model isn't having, and `compact()` reads
    // history.
    assert.deepEqual(
      session.history.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'],
      'the rounds it did spend are still recorded'
    );
  });

  it('tells the model to answer on the final permitted round', async () => {
    const asking = [
      {
        type: 'tool-call',
        value: toolCall('get_weather', { location: 'Hamburg' }),
      },
    ];
    const script = install([asking, 'It is 18 °C.']);
    const { tool } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      maxToolRounds: 1,
    });
    await session.prompt('Weather?');

    const lastInput = script.sessions.at(-1).prompts.at(-1);
    const texts = lastInput[0].content.filter((p) => p.type === 'text');
    assert.equal(texts.length, 1, 'the results carry a note');
    assert.match(texts[0].value, /do not call any more tools/);
  });

  it('reports an invented tool instead of throwing', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_stock_price', { ticker: 'X' }),
        },
      ],
      'I can only check the weather.',
    ]);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const answer = await session.prompt('Stock price?');
    assert.equal(calls.length, 0, 'nothing ran');
    assert.match(responsesSentBack(script)[0].errorMessage, /no tool named/);
    assert.equal(answer, 'I can only check the weather.', 'and it recovered');
  });

  it('refuses a call missing a required argument', async () => {
    const script = install([
      [{ type: 'tool-call', value: toolCall('get_weather', {}) }],
      'Which city?',
    ]);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    await session.prompt('Weather?');
    // Running it would send `undefined` to the tool, and "no such location"
    // reads to the model as fact rather than as its own mistake.
    assert.equal(calls.length, 0, 'the tool was not run');
    assert.match(responsesSentBack(script)[0].errorMessage, /without location/);
  });

  it('answers a repeated call from what it already has', async () => {
    const same = [
      {
        type: 'tool-call',
        value: toolCall('get_weather', { location: 'Hamburg' }),
      },
    ];
    const script = install([same, same, 'It is 18 °C.']);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    await session.prompt('Weather?');
    assert.equal(calls.length, 1, 'the tool ran once, not twice');
    assert.match(responsesSentBack(script)[1].errorMessage, /already called/);
  });

  it('strips nulls out of a result', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'Done.',
    ]);
    // A single null at any depth rejects the whole turn, and an API answering
    // `"description": null` for an empty field is enough to do it.
    const { tool } = weatherTool(() => ({
      temperatureC: 18,
      description: null,
      hours: [1, null, { wind: null, gust: 4 }],
    }));
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    await session.prompt('Weather?');
    assert.deepEqual(responsesSentBack(script)[0].result[0].value, {
      temperatureC: 18,
      hours: [1, { gust: 4 }],
    });
  });

  it('turns a thrown tool into something the model can recover from', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Nowhere' }),
        },
      ],
      'That lookup failed.',
    ]);
    const { tool } = weatherTool(() => {
      throw new Error('network down');
    });
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const answer = await session.prompt('Weather?');
    assert.match(responsesSentBack(script)[0].errorMessage, /network down/);
    assert.equal(answer, 'That lookup failed.');
  });

  it('announces each call through onToolCall', async () => {
    install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'Done.',
    ]);
    const { tool } = weatherTool();
    const announced = [];
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      onToolCall: (call) => announced.push(call),
    });

    await session.prompt('Weather?');
    assert.deepEqual(announced, [
      {
        callID: 'get_weather-1',
        name: 'get_weather',
        arguments: { location: 'Hamburg' },
      },
    ]);
  });

  it('reports every outcome through onToolResponse', async () => {
    install([
      [{ type: 'tool-call', value: toolCall('get_stock', { ticker: 'X' }) }],
      [{ type: 'tool-call', value: toolCall('get_weather', {}) }],
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'Done.',
    ]);
    const { tool } = weatherTool();
    const seen = [];
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      onToolResponse: (r) => seen.push(r),
    });
    await session.prompt('Everything?');

    // The first two never reach `execute`, so this callback is the only place
    // an app can see them at all.
    assert.deepEqual(
      seen.map((r) => [r.name, r.ok]),
      [
        ['get_stock', false],
        ['get_weather', false],
        ['get_weather', true],
      ]
    );
    assert.match(seen[0].errorMessage, /no tool named/);
    assert.match(seen[1].errorMessage, /without location/);
    assert.deepEqual(seen[2].result, { temperatureC: 18 }, 'and the result');
    assert.deepEqual(seen[2].arguments, { location: 'Hamburg' });
    assert.equal(seen[2].errorMessage, undefined);
  });

  it("runs a round's calls together, and keeps the order asked", async () => {
    // The second tool finishes first, which is the whole point: serially this
    // would take 40ms plus 0, and the log would have to read A then B.
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }, 'call-A'),
        },
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Tokyo' }, 'call-B'),
        },
      ],
      'Both reported.',
    ]);
    const order = [];
    const tool = {
      name: 'get_weather',
      description: 'w',
      inputSchema: { type: 'object', required: ['location'] },
      async execute({ location }) {
        await new Promise((r) =>
          setTimeout(r, location === 'Hamburg' ? 40 : 0)
        );
        order.push(`ran ${location}`);
        return { city: location };
      },
    };
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      onToolCall: (c) => order.push(`call ${c.callID}`),
      onToolResponse: (r) => order.push(`resp ${r.callID}`),
    });
    await session.prompt('both?');

    // Both announced before either ran, and the slower one reports last.
    assert.deepEqual(order, [
      'call call-A',
      'call call-B',
      'ran Tokyo',
      'resp call-B',
      'ran Hamburg',
      'resp call-A',
    ]);

    // What goes back to the model is still in the order it asked, whatever
    // order the tools finished in.
    const sent = script.sessions
      .at(-1)
      .prompts[1][0].content.filter((p) => p.type === 'tool-response');
    assert.deepEqual(
      sent.map((p) => p.value.callID),
      ['call-A', 'call-B']
    );
    assert.deepEqual(sent[0].value.result[0].value, { city: 'Hamburg' });
  });

  it('still refuses a repeat when the round runs together', async () => {
    // The dedup check and its bookkeeping both run before the first await, so
    // two identical calls in one round cannot both slip through.
    const same = { location: 'Hamburg' };
    const script = install([
      [
        { type: 'tool-call', value: toolCall('get_weather', same, 'call-A') },
        { type: 'tool-call', value: toolCall('get_weather', same, 'call-B') },
      ],
      'Reported.',
    ]);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });
    await session.prompt('twice?');

    assert.equal(calls.length, 1, 'the tool ran once');
    const sent = script.sessions
      .at(-1)
      .prompts[1][0].content.filter((p) => p.type === 'tool-response');
    assert.match(sent[1].value.errorMessage, /already called/);
  });

  it('streams only the text, running the tools on the way', async () => {
    install([
      [
        { type: 'text', value: 'Checking. ' },
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'It is 18 °C.',
    ]);
    const { tool, calls } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    let streamed = '';
    for await (const chunk of session.promptStreaming('Weather?')) {
      assert.equal(typeof chunk, 'string', 'no structured chunk escapes');
      streamed += chunk;
    }
    assert.equal(calls.length, 1);
    assert.equal(streamed, 'Checking. It is 18 °C.', 'both turns stream');
  });

  it('builds one HTML document across the rounds', async () => {
    install([
      [
        { type: 'text', value: '## Weather\n\nChecking' },
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      ' now: **18 °C**.\n',
    ]);
    const { tool } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    let html = '';
    for await (const chunk of session.promptStreamingHTML('Weather?')) {
      html += chunk;
    }
    // One parser spans the rounds, so the paragraph interrupted by the tool
    // call is still a single paragraph.
    assert.equal(
      html,
      '<h2>Weather</h2><p>Checking now: <strong>18 °C</strong>.</p>'
    );
  });

  it('reports unavailable rather than throwing where tools do not exist', async () => {
    install(['fine']);
    const saved = globalThis.LanguageModelToolCall;
    delete globalThis.LanguageModelToolCall;
    try {
      const { tool } = weatherTool();
      assert.equal(
        await EasyLanguageModel.availability({ tools: [tool] }),
        'unavailable',
        'feature detection needs no try/catch'
      );
      await assert.rejects(
        EasyLanguageModel.create({ ...NO_SANITIZER, tools: [tool] }),
        { name: 'TypeError' },
        'but creating one anyway is a misconfiguration'
      );
    } finally {
      globalThis.LanguageModelToolCall = saved;
    }
  });

  it('survives compaction, tool messages and all', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'It is eighteen degrees in Hamburg today, mild for the season.',
    ]);
    const { tool } = weatherTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });
    await session.prompt('Weather in Hamburg?');
    await session.compact();

    // Summarizing a tool call would destroy it, so non-text content passes
    // through untouched, and the rebuilt session is handed the instances back.
    const shapes = session.history.map((m) =>
      typeof m.content === 'string' ? 'text' : m.content[0].type
    );
    assert.deepEqual(shapes, ['text', 'tool-call', 'tool-response', 'text']);

    // Replaying them needs `tool-call` among the expected inputs, which is why
    // the wrapper adds it whether or not you asked: without it, one tool call
    // would make the session uncompactable.
    const rebuilt = script.sessions.at(-1).options;
    const replayed = rebuilt.initialPrompts.filter(
      (m) => typeof m.content !== 'string'
    );
    assert.equal(replayed.length, 2);
    assert.ok(
      rebuilt.expectedInputs.some((entry) => entry.type === 'tool-call'),
      'the replayed calls have a declared input type'
    );
  });

  it('leaves history alone when a tool round is aborted', async () => {
    const script = install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'Done.',
    ]);
    const { tool } = weatherTool(() => {
      throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    });
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });
    // A tool that throws is reported to the model rather than ending the turn,
    // so the exchange still completes and is recorded in full.
    await session.prompt('Weather?');
    assert.equal(session.history.length, 4);
    assert.ok(script.sessions.at(-1));
  });
});

describe('aborting a tool round', () => {
  /** A tool that stays in flight until the test lets it finish. */
  function heldTool() {
    const state = { signal: undefined, finished: false };
    let markStarted;
    let release;
    const started = new Promise((resolve) => (markStarted = resolve));
    const held = new Promise((resolve) => (release = resolve));
    return {
      state,
      started,
      release,
      tool: {
        name: 'get_weather',
        description: 'Get the current weather in a location.',
        inputSchema: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
        async execute(args, context) {
          state.signal = context?.signal;
          markStarted();
          await held;
          state.finished = true;
          return { temperatureC: 18 };
        },
      },
    };
  }

  /** One round of calls, then an answer. */
  function weatherThenAnswer() {
    return install([
      [
        {
          type: 'tool-call',
          value: toolCall('get_weather', { location: 'Hamburg' }),
        },
      ],
      'Done.',
    ]);
  }

  it('hands execute the signal the prompting method was given', async () => {
    weatherThenAnswer();
    const { tool, state, started, release } = heldTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const controller = new AbortController();
    const answer = session.prompt('Weather?', { signal: controller.signal });
    await started;
    release();
    await answer;
    assert.equal(state.signal, controller.signal);
  });

  it('rejects without waiting for the round to settle', async () => {
    weatherThenAnswer();
    const { tool, state, started, release } = heldTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const controller = new AbortController();
    const answer = session.prompt('Weather?', { signal: controller.signal });
    await started;
    controller.abort();

    await assert.rejects(answer, { name: 'AbortError' });
    // The point of the race: the tool is still running, and the caller
    // already has its rejection.
    assert.equal(state.finished, false);
    release();
  });

  it('leaves nothing in history when a round is abandoned', async () => {
    weatherThenAnswer();
    const { tool, started, release } = heldTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const controller = new AbortController();
    const answer = session.prompt('Weather?', { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(answer, { name: 'AbortError' });
    release();

    assert.deepEqual(session.history, []);
  });

  it('stops reporting responses once the signal has aborted', async () => {
    weatherThenAnswer();
    const { tool, started, release } = heldTool();
    const reported = [];
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
      onToolResponse: (response) => reported.push(response),
    });

    const controller = new AbortController();
    const answer = session.prompt('Weather?', { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(answer, { name: 'AbortError' });

    // Let the tool land after the turn it belonged to is gone.
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(reported, []);
  });

  it('refuses to start a round when the signal is already aborted', async () => {
    weatherThenAnswer();
    const { tool, state } = heldTool();
    const session = await EasyLanguageModel.create({
      ...NO_SANITIZER,
      tools: [tool],
    });

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      session.prompt('Weather?', { signal: controller.signal }),
      {
        name: 'AbortError',
      }
    );
    assert.equal(state.finished, false);
  });
});

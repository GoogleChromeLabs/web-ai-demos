/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Whether this browser implements tool calling. */
export function isToolUseSupported() {
  return 'LanguageModelToolCall' in globalThis;
}

/**
 * Removes every `null` and `undefined`, at any depth.
 *
 * One of them anywhere in a result rejects the whole turn with a message about
 * circular references, which is a long way from the truth: an API answering
 * `"description": null` for an empty field is enough to do it.
 */
export function stripNullish(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null).map(stripNullish);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item != null)
        .map(([key, item]) => [key, stripNullish(item)])
    );
  }
  return value;
}

/**
 * Splits the caller's tools into what the model sees and what actually runs.
 *
 * The two halves travel together because that is how they are easiest to write,
 * but `execute` must not reach `create()`.
 *
 * @param {Array<{name: string, description: string, inputSchema: object, execute: Function}>} tools
 */
export function splitTools(tools) {
  const declarations = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
  return { declarations, byName: new Map(tools.map((t) => [t.name, t])) };
}

/**
 * Adds the content types tool calling needs to what the caller expected.
 *
 * A session accepts text and nothing else until `expectedInputs` says
 * otherwise, and declaring `tools` doesn't imply either tool type. So passing
 * `tools` without these produces a session that rejects the tool results that
 * were the entire point. `tool-call` is listed as an input too, so a stored
 * conversation can be replayed through `initialPrompts`.
 */
export function withToolExpectations({ expectedInputs, expectedOutputs }) {
  const add = (list, types) => {
    const present = new Set(list.map((entry) => entry.type));
    return [
      ...list,
      ...types.filter((t) => !present.has(t)).map((type) => ({ type })),
    ];
  };
  return {
    expectedInputs: add(expectedInputs, ['tool-response', 'tool-call']),
    expectedOutputs: add(expectedOutputs, ['tool-call']),
  };
}

/** Builds the `tool-response` part that answers one call. */
export async function runToolCall(call, byName, { seen } = {}) {
  const fail = (errorMessage) => ({
    type: 'tool-response',
    value: new LanguageModelToolError({
      callID: call.callID,
      name: call.name,
      errorMessage,
    }),
  });

  const tool = byName.get(call.name);
  // Models invent tools. Saying so lets it correct itself, where throwing
  // would end the turn on the model's mistake.
  if (!tool) {
    return fail(`There is no tool named ${call.name}.`);
  }

  const args = call.arguments ?? {};

  // Running with a missing argument sends `undefined` to the tool, and what
  // comes back misleads: a weather lookup for `undefined` reports "no such
  // location", which the model reads as fact rather than as its own mistake.
  const missing = (tool.inputSchema?.required ?? []).filter(
    (key) => args[key] == null || args[key] === ''
  );
  if (missing.length) {
    return fail(`${call.name} was called without ${missing.join(' and ')}.`);
  }

  // A model that asks the same thing twice is not making progress, and running
  // the tool again would only confirm the answer it already has.
  const signature = `${call.name}(${JSON.stringify(args)})`;
  if (seen?.has(signature)) {
    return fail(
      `${call.name} was already called with these arguments, and the result is ` +
        `in this conversation. Use it rather than calling again.`
    );
  }
  seen?.add(signature);

  try {
    const output = await tool.execute(args);
    return {
      type: 'tool-response',
      value: new LanguageModelToolSuccess({
        callID: call.callID,
        name: call.name,
        result: [{ type: 'object', value: stripNullish(output) }],
      }),
    };
  } catch (error) {
    // Returned, not re-thrown: an error the model can read is one it can
    // recover from.
    return fail(String(error));
  }
}

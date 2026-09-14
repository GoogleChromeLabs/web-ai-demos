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
 * Whether `value` is an instance of any of the named globals, each looked up
 * when asked, since not every context has every one: a worker has no DOM, and
 * Node has no `ImageBitmap`.
 */
function isInstanceOf(value, names) {
  return names.some((name) => {
    const constructor = globalThis[name];
    return typeof constructor === 'function' && value instanceof constructor;
  });
}

const IMAGE_SOURCES = [
  'Blob',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'HTMLVideoElement',
  'ImageBitmap',
  'ImageData',
  'OffscreenCanvas',
  'SVGImageElement',
  'VideoFrame',
];

const AUDIO_SOURCES = ['AudioBuffer', 'HTMLAudioElement'];

/**
 * Raw bytes are a valid value for both `image` and `audio`, so the bytes
 * decide: the common audio containers are recognized by their signature, and
 * everything else is taken for an image.
 *
 * @param {ArrayBuffer | ArrayBufferView} buffer
 * @returns {'image' | 'audio'}
 */
function sniffBufferType(buffer) {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  const ascii = (start, end) =>
    String.fromCharCode(...bytes.subarray(start, end));

  const isAudio =
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') ||
    ascii(0, 4) === 'OggS' ||
    ascii(0, 4) === 'fLaC' ||
    ascii(0, 3) === 'ID3' ||
    (ascii(4, 8) === 'ftyp' && ascii(8, 12) === 'M4A ') ||
    // An MPEG audio frame sync, which a JPEG (FF D8) does not match.
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  return isAudio ? 'audio' : 'image';
}

/**
 * Wraps what `execute` returned in the result item the Prompt API wants, its
 * `type` picked from the value itself.
 *
 * Only a structured result goes through stripNullish(). Walking a `Blob` or a
 * typed array as if it were a plain object would hand the model `{}` or a map
 * of indices in place of the image or audio it was.
 *
 * @returns {{type: 'text' | 'image' | 'audio' | 'object', value: unknown}}
 */
export function toToolResultItem(value) {
  if (typeof value === 'string') return { type: 'text', value };
  // A null result rejects the turn just as a nested one does, and a tool that
  // returns nothing has nothing to say.
  if (value == null) return { type: 'text', value: '' };
  if (isInstanceOf(value, AUDIO_SOURCES)) return { type: 'audio', value };
  if (isInstanceOf(value, IMAGE_SOURCES)) return { type: 'image', value };
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return { type: sniffBufferType(value), value };
  }
  return { type: 'object', value: stripNullish(value) };
}

/**
 * Splits the caller's tools into what the model sees and what actually runs.
 *
 * The two halves travel together because that is how they are easiest to write.
 * Chrome ignores `execute` and surfaces every call to the caller, so dropping it
 * from the declaration changes nothing today and keeps the loop ours if that
 * ever changes.
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

/**
 * Builds the `tool-response` part that answers one call.
 *
 * `signal` is the one the caller passed to the prompting method, handed on so a
 * tool can cancel its own work: `fetch()` and most APIs worth calling from a
 * tool take one. It arrives as a second argument rather than mixed into
 * `arguments`, which stay exactly what the model sent.
 */
export async function runToolCall(call, byName, { seen, signal } = {}) {
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
    const output = await tool.execute(args, { signal });
    return {
      type: 'tool-response',
      value: new LanguageModelToolSuccess({
        callID: call.callID,
        name: call.name,
        result: [toToolResultItem(output)],
      }),
    };
  } catch (error) {
    // Returned, not re-thrown: an error the model can read is one it can
    // recover from.
    return fail(String(error));
  }
}

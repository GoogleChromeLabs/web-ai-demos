/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// The published declarations use the Prompt API's ambient types. TypeScript
// does not carry a `/// <reference types>` from a .js source into the emitted
// .d.ts, and it does not pick the package up on its own from a dependency, so
// without this a consumer sees `LanguageModelPrompt` and friends as errors —
// or, with skipLibCheck on, silently as `any`.

import { readFileSync, writeFileSync } from 'node:fs';

const ENTRY = 'dist/types/src/index.d.ts';
const REFERENCE = '/// <reference types="dom-chromium-ai" />\n';

const current = readFileSync(ENTRY, 'utf8');
if (!current.startsWith(REFERENCE)) {
  writeFileSync(ENTRY, REFERENCE + current);
}
console.log(`Prompt API types referenced from ${ENTRY}`);

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { EasyLanguageModel } from './easy-language-model.js';
// The Markdown half, re-exported so nothing the README teaches needs a second
// package in your dependencies. Both come from `streaming-markdown-html`, which
// knows nothing about the Prompt API and can be used on its own.
export { markdownToHtml, renderStreamingHTML } from 'streaming-markdown-html';

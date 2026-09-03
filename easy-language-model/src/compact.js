/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeDownloadProgress } from './download.js';

/**
 * Session compacting: summarize the conversation so far with the Summarizer
 * API and restart the session with those summaries as `initialPrompts`.
 *
 * The browser never evicts `initialPrompts` during runtime overflow handling,
 * so a compacted summary stays anchored in context while the raw history it
 * replaced no longer costs anything.
 */

/** Picks the summarizer format so a message's formatting survives. */
export function looksLikeMarkdown(text) {
  return /(?:^#{1,6} |^[-*+] |\d+\. |\*\*|__|\[.+?\]\(|^> |^```)/m.test(text);
}

/**
 * Splits text into alternating prose and code-fence segments.
 *
 * @returns {Array<{type: 'prose'|'code', content: string}>}
 */
export function splitByCodeFences(text) {
  const parts = [];
  const fence = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
  let lastIndex = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'prose',
        content: text.slice(lastIndex, match.index),
      });
    }
    parts.push({ type: 'code', content: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'prose', content: text.slice(lastIndex) });
  }
  return parts;
}

/**
 * Holds the Summarizer and LanguageDetector instances used for compaction.
 *
 * Summarizers are cached per format + language pair, so a long conversation in
 * one language only ever creates one.
 */
export class Compactor {
  #summarizers = new Map();
  #detector = null;
  #options;

  constructor(options = {}) {
    this.#options = options;
  }

  get #fallbackLanguage() {
    return this.#options.fallbackLanguage ?? navigator.language;
  }

  #report(status) {
    this.#options.onStatus?.(status);
  }

  async #getDetector() {
    if (this.#detector) {
      return this.#detector;
    }
    if (!('LanguageDetector' in globalThis)) {
      return null;
    }
    if ((await LanguageDetector.availability()) === 'unavailable') {
      return null;
    }
    this.#detector = await LanguageDetector.create({
      monitor: (m) =>
        m.addEventListener('downloadprogress', (event) =>
          this.#options.onDownloadProgress?.(
            normalizeDownloadProgress(event, 'language-detector')
          )
        ),
    });
    return this.#detector;
  }

  /** Top detected language, or `null` when the detector isn't confident. */
  async detectLanguage(
    text,
    threshold = this.#options.confidenceThreshold ?? 0.7
  ) {
    const detector = await this.#getDetector();
    if (!detector) {
      return null;
    }
    const results = await detector.detect(text);
    return results.length > 0 && results[0].confidence >= threshold
      ? results[0].detectedLanguage
      : null;
  }

  async #getSummarizer(format, lang) {
    const key = `${format}:${lang}`;
    const cached = this.#summarizers.get(key);
    if (cached) {
      return cached;
    }
    if (!('Summarizer' in globalThis)) {
      throw new Error('The Summarizer API is needed to compact a session.');
    }

    const base = {
      type: 'tldr',
      format,
      length: 'short',
      expectedInputLanguages: [lang],
      // Covers the `context` string passed at summarize time.
      expectedContextLanguages: [lang],
      outputLanguage: lang,
    };

    // 'speed' selects the smaller, lower-latency model. It doesn't support
    // every language, so fall back to 'auto'.
    let options = { ...base, preference: 'speed' };
    let availability = await Summarizer.availability(options);
    if (availability === 'unavailable') {
      options = { ...base, preference: 'auto' };
      availability = await Summarizer.availability(options);
    }
    if (availability === 'unavailable') {
      throw new Error(
        `The Summarizer API is unavailable for "${lang}" on this device.`
      );
    }

    const summarizer = await Summarizer.create({
      ...options,
      monitor: (m) =>
        m.addEventListener('downloadprogress', (event) =>
          this.#options.onDownloadProgress?.(
            normalizeDownloadProgress(event, 'summarizer')
          )
        ),
    });
    this.#summarizers.set(key, summarizer);
    return summarizer;
  }

  async #summarize(text, role, summarizer) {
    const summary = await summarizer.summarize(
      text.trim().replace(/\n{3,}/g, '\n\n'),
      {
        context:
          `This is a ${role} turn from a chat conversation. ` +
          `Preserve its key meaning as concisely as possible.`,
      }
    );
    const trimmed = summary.trim();
    // A "summary" that grew is no summary at all.
    return trimmed.length < text.length ? trimmed : text;
  }

  /** Summarizes prose, passing fenced code through untouched. */
  async #summarizeMessage(content, role, summarizer) {
    if (this.#options.preserveCodeFences === false) {
      return this.#summarize(content, role, summarizer);
    }
    const parts = splitByCodeFences(content);
    if (parts.length === 1 && parts[0].type === 'prose') {
      return this.#summarize(parts[0].content, role, summarizer);
    }
    const out = [];
    for (const part of parts) {
      if (part.type === 'code') {
        out.push(part.content.trim());
      } else if (part.content.trim()) {
        out.push(await this.#summarize(part.content.trim(), role, summarizer));
      }
    }
    return out.join('\n\n');
  }

  /**
   * Compacts a message list.
   *
   * Messages with the `system` role, and non-text content, pass through
   * verbatim: a system prompt is an instruction, not a transcript, and
   * summarizing it changes the model's behavior.
   *
   * @param {Array<{role: string, content: any}>} history
   * @returns {Promise<{messages: Array, languages: string[]}>}
   */
  async compact(history) {
    const messages = [];
    const languages = new Set();

    for (const [index, message] of history.entries()) {
      const passThrough =
        message.role === 'system' || typeof message.content !== 'string';
      if (passThrough) {
        messages.push({ role: message.role, content: message.content });
        continue;
      }

      this.#report(`Compacting message ${index + 1} of ${history.length}…`);

      const detected = await this.detectLanguage(message.content);
      if (detected) {
        languages.add(detected);
      }
      const lang = detected ?? this.#fallbackLanguage;
      const format = looksLikeMarkdown(message.content)
        ? 'markdown'
        : 'plain-text';
      const summarizer = await this.#getSummarizer(format, lang);

      messages.push({
        role: message.role,
        content: await this.#summarizeMessage(
          message.content,
          message.role,
          summarizer
        ),
      });
    }

    return {
      messages,
      languages: languages.size > 0 ? [...languages] : [this.#fallbackLanguage],
    };
  }

  /** Releases the cached Summarizer and LanguageDetector instances. */
  destroy() {
    for (const summarizer of this.#summarizers.values()) {
      summarizer.destroy();
    }
    this.#summarizers.clear();
    this.#detector?.destroy();
    this.#detector = null;
  }
}

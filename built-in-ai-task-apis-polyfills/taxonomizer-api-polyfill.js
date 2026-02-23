/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTaskModel } from './base-task-model.js';
import { TaxonomizerPromptBuilder } from './taxonomizer-prompt-builder.js';

/**
 * Taxonomizer API Polyfill
 * Backed by Prompt API Polyfill (LanguageModel)
 */

export class Taxonomizer extends BaseTaskModel {
  #options;

  constructor(session, builder, options) {
    super(session, builder);
    this.#options = options;
  }

  static availability(options = {}) {
    // We proxy availability to the base task model which checks LanguageModel availability
    return super.baseAvailability(options);
  }

  static async create(options = {}) {
    this._checkContext();

    await this.ensureLanguageModel();
    this._checkContext();

    const builder = new TaxonomizerPromptBuilder();
    const { systemPrompt, initialPrompts } = builder.buildPrompt('');

    const sessionOptions = {
      initialPrompts: [
        { role: 'system', content: systemPrompt },
        ...initialPrompts,
      ],
      signal: options.signal,
      monitor: options.monitor,
    };

    const win = this.__window || globalThis;
    const session = await win.LanguageModel.create(sessionOptions);
    const taxonomizer = new this(session, builder, options);

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          taxonomizer.destroy(options.signal.reason);
        },
        { once: true }
      );
    }

    return taxonomizer;
  }

  async categorize(input, options = {}) {
    this._checkContext();

    if (typeof input !== 'string') {
      throw new Error('Input must be a string.');
    }

    if (input.trim() === '') {
      return [];
    }

    const resultString = await this._runTask(input, options);
    try {
      return this.#parseResults(resultString);
    } catch (e) {
      // Try again with code fence removal
      try {
        const cleaned = resultString.replace(/```json\n?|\n?```/g, '').trim();
        return this.#parseResults(cleaned);
      } catch (e2) {
        const win = this.constructor.__window || globalThis;
        const EX = win.DOMException || globalThis.DOMException || Error;
        console.error('Failed to parse Taxonomizer results:', resultString);
        throw new EX('Failed to parse categorization results.', 'UnknownError');
      }
    }
  }

  #parseResults(jsonString) {
    let results = JSON.parse(jsonString);
    if (!Array.isArray(results)) {
      throw new Error('Categorization results must be an array.');
    }

    // 1. Basic cleaning and validation
    results = results.map((res) => ({
      id: String(res.id || 'unknown'),
      confidence: Math.max(0, Number(res.confidence || 0)),
    }));

    // 2. Sort by decreasing confidence
    results.sort((a, b) => b.confidence - a.confidence);

    // 3. Handle sum to 1
    let finalResults = [];
    let unknownResult = null;
    let currentSum = 0;

    for (const res of results) {
      // Normalize 'und' to 'unknown' just in case
      if (res.id === 'und' || res.id === 'unknown') {
        unknownResult = res;
        res.id = 'unknown';
        continue;
      }

      if (currentSum + res.confidence <= 1) {
        finalResults.push(res);
        currentSum += res.confidence;
      } else {
        // Capped if it exceeds 1
        const remaining = 1 - currentSum;
        if (remaining > 0) {
          res.confidence = remaining;
          finalResults.push(res);
          currentSum = 1;
        }
        break;
      }
    }

    // 4. Handle "unknown"
    if (unknownResult) {
      unknownResult.confidence = Math.max(0, 1 - currentSum);
      finalResults.push(unknownResult);
    } else if (currentSum < 1) {
      finalResults.push({
        id: 'unknown',
        confidence: 1 - currentSum,
      });
    }

    return finalResults;
  }

  // Static helper as requested by the user
  static getCategoryName(id) {
    return TaxonomizerPromptBuilder.getCategoryName(id);
  }
}

// Global exposure if in browser
BaseTaskModel.exposeAPIGlobally(
  'Taxonomizer',
  Taxonomizer,
  '__FORCE_TAXONOMIZER_POLYFILL__'
);

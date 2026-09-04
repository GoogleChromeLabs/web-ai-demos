/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './dom.js';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Compactor } from '../src/compact.js';
import { normalizeDownloadProgress } from '../src/download.js';
import { EasyLanguageModel } from '../src/easy-language-model.js';

/**
 * Every payload must survive the percentage an app works out from it, which is
 * the whole reason `loaded` and `total` are settled before being handed over.
 */
function assertUsable(progress, label) {
  for (const field of ['loaded', 'total']) {
    assert.ok(
      Number.isFinite(progress[field]),
      `${label}: ${field} was ${progress[field]}`
    );
  }
  assert.equal(typeof progress.resource, 'string', `${label}: resource`);
  const percent = Math.round((progress.loaded / progress.total) * 100);
  assert.ok(
    Number.isFinite(percent) && percent >= 0 && percent <= 100,
    `${label}: loaded / total came out as ${percent}`
  );
}

class FakeMonitor extends EventTarget {}

function fireProgress(monitor, detail) {
  const m = new FakeMonitor();
  monitor(m);
  m.dispatchEvent(Object.assign(new Event('downloadprogress'), detail));
}

describe('normalizeDownloadProgress', () => {
  it('passes a byte count through', () => {
    const p = normalizeDownloadProgress({ loaded: 50, total: 200 }, 'x');
    assert.deepEqual(p, { resource: 'x', loaded: 50, total: 200 });
  });

  it('treats a missing total as a fraction', () => {
    const p = normalizeDownloadProgress({ loaded: 0.4 }, 'x');
    assertUsable(p, 'no total');
    assert.deepEqual(p, { resource: 'x', loaded: 0.4, total: 1 });
  });

  it('never reports more loaded than total', () => {
    const p = normalizeDownloadProgress({ loaded: 5, total: 2 }, 'x');
    assert.equal(p.loaded, 2, 'so a percentage can never exceed 100');
  });

  it('survives a zero total and a missing loaded', () => {
    assertUsable(
      normalizeDownloadProgress({ loaded: 1, total: 0 }, 'x'),
      'zero'
    );
    assertUsable(normalizeDownloadProgress({}, 'x'), 'empty');
  });
});

describe('progress payloads reaching the app', () => {
  const saved = {};

  afterEach(() => {
    for (const key of Object.keys(saved)) {
      globalThis[key] = saved[key];
      delete saved[key];
    }
  });

  const stub = (key, value) => {
    saved[key] = globalThis[key];
    globalThis[key] = value;
  };

  it('reports a usable payload while creating a session', async () => {
    const seen = [];
    stub('LanguageModel', {
      async availability() {
        return 'downloadable';
      },
      async create(options) {
        fireProgress(options.monitor, { loaded: 0.5, total: 1 });
        return new (class extends EventTarget {
          contextUsage = 0;
          contextWindow = 100;
          destroy() {}
        })();
      },
    });

    await EasyLanguageModel.create({
      // linkedom has no Sanitizer API; this test is about progress reporting.
      sanitizer: false,
      onDownloadProgress: (p) => seen.push(p),
    });

    assert.equal(seen.length, 1);
    assertUsable(seen[0], 'language model');
    assert.equal(seen[0].resource, 'language-model');
  });

  // The compactor downloads a Summarizer and a LanguageDetector of its own.
  // These used to arrive unnormalized, so an app working out a percentage from
  // them rendered NaN.
  it('reports usable payloads while compacting', async () => {
    const seen = [];
    stub('Summarizer', {
      async availability() {
        return 'available';
      },
      async create(options) {
        fireProgress(options.monitor, { loaded: 0.25, total: 1 });
        return {
          async summarize() {
            return 'short';
          },
          destroy() {},
        };
      },
    });
    stub('LanguageDetector', {
      async availability() {
        return 'available';
      },
      async create(options) {
        fireProgress(options.monitor, { loaded: 120, total: 480 });
        return {
          async detect() {
            return [{ detectedLanguage: 'en', confidence: 0.99 }];
          },
          destroy() {},
        };
      },
    });

    const compactor = new Compactor({
      onDownloadProgress: (p) => seen.push(p),
    });
    await compactor.compact([
      { role: 'user', content: 'a long message that can be summarized down' },
    ]);

    assert.ok(seen.length >= 2, `expected both resources, got ${seen.length}`);
    for (const progress of seen) {
      assertUsable(progress, progress.resource);
    }
    assert.deepEqual([...new Set(seen.map((p) => p.resource))].sort(), [
      'language-detector',
      'summarizer',
    ]);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupE2ETest as originalSetupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';
import { loadStats, saveStats, saveSession, clearSession } from '../src/lib/db';
import { tick } from 'svelte';
import { createGameStore } from '../src/lib/gameStore.svelte';
import { IDBFactory } from 'fake-indexeddb';

// Enforce indexedDB availability for early beforeEach database calls
globalThis.indexedDB = new IDBFactory();

async function setupE2ETest(options?: {
  allowDuplicates?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard' | 'impossible';
  skipWait?: boolean;
  skipDbInit?: boolean;
  skipMockReset?: boolean;
  availability?: 'readily' | 'after-download' | 'unavailable';
  score?: number;
  streak?: number;
  highScore?: number;
}) {
  return originalSetupE2ETest({
    difficulty: options?.difficulty ?? 'easy',
    allowDuplicates: options?.allowDuplicates ?? false,
    skipWait: options?.skipWait,
    skipDbInit: options?.skipDbInit,
    skipMockReset: options?.skipMockReset,
    availability: options?.availability,
    score: options?.score,
    streak: options?.streak,
    highScore: options?.highScore
  });
}

describe('Wordup PWA - Adversarial and Coverage Hardening Tests', () => {
  beforeEach(async () => {
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions(['APPLE', 'PEACH']);
    
    try {
      await clearSession();
      await saveStats({ streak: 0, score: 5, highScore: 5, difficulty: 'hard', allowDuplicates: false });
    } catch (err) {
      console.warn('Database cleanup failed, continuing...', err);
    }
  });

  // Gap 1: AI Hint Race Condition Abort Path (New Game forced)
  it('1. should abort AI suggestions and not deduct points if a new game is started while suggestions are loading', async () => {
    // Setup deferred prompt promise
    let resolvePrompt: (val: string) => void = () => {};
    const promptPromise = new Promise<string>(resolve => {
      resolvePrompt = resolve;
    });

    vi.spyOn(globalThis.LanguageModel, 'create').mockResolvedValue({
      prompt: async (text: string) => {
        if (text.includes("suggest 15 valid")) {
          return promptPromise;
        }
        return 'APPLE';
      },
      destroy: () => {}
    });

    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest({ score: 5, highScore: 5 });

    try {
      // Make 1st guess to unlock help button
      await harness.typeWord('PATCH');
      await harness.clickButton('GUESS!');

      // Click the help button '?' (starts loading suggestions)
      await harness.clickButton('?');

      // Verify that while loading, the score is still 5 (no premature deduction!)
      let tempStats = await harness.getStatsState();
      expect(tempStats.score).toBe(5);

      // While suggestions are loading, click the GENERATE button to start a new game
      await harness.clickButton('GENERATE');

      // Resolve the AI suggestions prompt
      resolvePrompt('APPLE, APRON, APPLY');
      await tick();
      // Additional small wait to ensure microtasks clear
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify that no suggestions are displayed in the UI (since new game was forced)
      const suggestions = await harness.getSuggestions();
      expect(suggestions).toEqual([]);

      // Verify score is reset to 0 (correct active game abandonment behavior!)
      const stats = await harness.getStatsState();
      expect(stats.score).toBe(0);
    } finally {
      await harness.cleanup();
      vi.restoreAllMocks();
    }
  });

  // Gap 2: AI Hint Constraint Filtering Accuracy
  it('2. should strictly filter AI suggestions against green, yellow, and gray constraints', async () => {
    // Secret word is SLATE
    setNextGeneratedWords(['SLATE']);

    const harness = await setupE2ETest();
    // Mock the suggestions returned by the prompt
    setNextSuggestions(['SLATE', 'SHARE', 'PLATE', 'STALE']);

    try {
      // Submit guess STARE
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // Click the help button '?'
      await harness.clickButton('?');

      // Get suggestions from the UI
      const suggestions = await harness.waitForSuggestions();

      // Verify that ONLY 'SLATE' is shown
      // - 'SHARE' is rejected because it contains 'R' (gray)
      // - 'PLATE' is rejected because it doesn't start with 'S' (green at 0)
      // - 'STALE' is rejected because 'T' is at position 1 (which was yellow at position 1 in 'STARE')
      expect(suggestions).toEqual(['SLATE']);
    } finally {
      await harness.cleanup();
    }
  });

  // Gap 3: revealWord Active Game Guard
  it('3. should throw an error when revealWord is called during active gameplay', async () => {
    const game = createGameStore();
    await game.init();
    
    expect(game.state.gameStatus).toBe('playing');

    // Attempting to reveal the word should throw an error
    expect(() => game.revealWord()).toThrow('Cannot reveal secret word while game is active.');
  });

  // Gap 4: AI Word Generation Absolute Failure (API missing)
  it('4. should transition to error state if LanguageModel API is completely undefined', async () => {
    // Save original LanguageModel
    const originalLanguageModel = globalThis.LanguageModel;
    
    // Temporarily delete LanguageModel to simulate lack of browser support
    // @ts-ignore
    delete globalThis.LanguageModel;

    const harness = await setupE2ETest({ skipMockReset: true });
    try {
      // Verify that the game transitions to 'error' status
      const status = await harness.getAppStatus();
      expect(status.status).toBe('error');
      expect(status.message).toContain('Chrome Prompt API (LanguageModel) is not supported in this browser.');
    } finally {
      await harness.cleanup();
      // Restore LanguageModel
      globalThis.LanguageModel = originalLanguageModel;
    }
  });
});

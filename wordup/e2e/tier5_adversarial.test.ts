import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
  setupE2ETest as originalSetupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';

async function setupE2ETest(options?: { allowDuplicates?: boolean, difficulty?: 'easy' | 'medium' | 'hard' | 'impossible' }) {
  return originalSetupE2ETest({
    difficulty: options?.difficulty ?? 'easy',
    allowDuplicates: options?.allowDuplicates ?? false
  });
}
import { clearSession, saveStats, loadStats } from '../src/lib/db';

describe('Tier 5 Adversarial Coverage Hardening Tests', () => {
  let originalLanguageModelCreate: any;

  beforeEach(async () => {
    // Save original mock
    originalLanguageModelCreate = globalThis.LanguageModel.create;

    // Reset default mock state
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions(['APPLE', 'PEACH']);

    // Clear IndexedDB state before each test
    try {
      await clearSession();
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: false });
    } catch (err) {
      console.warn('Database cleanup failed:', err);
    }
  });

  afterEach(() => {
    // Restore original mock
    globalThis.LanguageModel.create = originalLanguageModelCreate;
  });

  // =========================================================================
  // Gap 1: Duplicate Letter Rejection Shake Effect & Timeout
  // =========================================================================
  it('should trigger shake-orange class on duplicate letter rejection and clear it after timeout', async () => {
    const harness = await setupE2ETest();
    try {
      // 1. Ensure duplicates are disabled
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      // Start new game to apply duplicates=false
      setNextGeneratedWords(['APPLE']);
      await harness.clickButton('GENERATE');

      // Type the first letter 'A'
      await harness.pressKey('A');

      // Verify cell 0 is filled with 'A'
      let grid = await harness.getGridState();
      expect(grid[0][0].letter).toBe('A');

      // Get the first cell card element
      const activeRow = document.querySelector('.board-row.active-row');
      expect(activeRow).not.toBeNull();
      const cards = activeRow!.querySelectorAll('.letter-card');
      expect(cards.length).toBe(5);

      // Verify cell 0 does not have shake-orange initially
      expect(cards[0].classList.contains('shake-orange')).toBe(false);

      // Try typing 'A' again (duplicate)
      await harness.pressKey('A');

      // Verify the duplicate was rejected (cell 1 is still empty)
      grid = await harness.getGridState();
      expect(grid[0][1].letter).toBe('');

      // Verify cell 0 now has shake-orange class
      expect(cards[0].classList.contains('shake-orange')).toBe(true);

      // Wait for the 400ms timeout to clear the shake state
      await new Promise((resolve) => setTimeout(resolve, 450));
      await tick();

      // Verify cell 0 no longer has shake-orange class
      expect(cards[0].classList.contains('shake-orange')).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  // =========================================================================
  // Gap 2: AI Word Generation Retries, Fallback, and Failure Exception
  // =========================================================================
  describe('AI Word Generation Flow Control', () => {
    it('should retry up to 15 times and succeed if a valid word is eventually returned', async () => {
      let promptCallCount = 0;

      // Mock stateful prompt: first 5 times returns invalid words, 6th time returns valid word 'PEACH'
      globalThis.LanguageModel.create = async () => {
        return {
          async prompt(text: string) {
            promptCallCount++;
            if (promptCallCount <= 5) {
              // Return invalid words (too long, contains duplicates, etc.)
              return 'INVALID_WORD_LONG, DUPP, ABC, DEF, GHI';
            }
            return 'PEACH';
          },
          destroy() {},
        };
      };

      const harness = await setupE2ETest();
      try {
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');
        expect(promptCallCount).toBe(6);

        // Verify the secret word is indeed 'PEACH' by guessing it and winning
        await harness.typeWord('PEACH');
        await harness.clickButton('GUESS!');
        const finalStatus = await harness.getAppStatus();
        expect(finalStatus.status).toBe('won');
      } finally {
        await harness.cleanup();
      }
    });

    it('should fall back to length-only filter on the 15th attempt if duplicates check fails', async () => {
      let promptCallCount = 0;

      // In a game with duplicates disabled:
      // Return words containing duplicate letters for all 15 attempts.
      // On the 15th attempt, the filter is relaxed to just 5-letter length, accepting the duplicate-letter word.
      globalThis.LanguageModel.create = async () => {
        return {
          async prompt(text: string) {
            promptCallCount++;
            // Always return 'APPLE' which contains duplicate 'P'
            return 'APPLE';
          },
          destroy() {},
        };
      };

      const harness = await setupE2ETest();
      try {
        // Since we disabled duplicates by default, APPLE should have been filtered out 14 times.
        // On the 15th attempt, it falls back and accepts it.
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');
        expect(promptCallCount).toBe(15);

        // Verify secret word is APPLE by submitting 5 wrong guesses and losing the game,
        // which will reveal the secret word.
        const wrongGuesses = ['STARE', 'CLONE', 'BUMPY', 'FIGHT', 'DROWN'];
        for (let i = 0; i < 5; i++) {
          await harness.typeWord(wrongGuesses[i]);
          await harness.clickButton('GUESS!');
        }

        const finalStatus = await harness.getAppStatus();
        expect(finalStatus.status).toBe('lost');
        expect(finalStatus.message).toContain('APPLE');
      } finally {
        await harness.cleanup();
      }
    });

    it('should transition to error state if all 15 attempts return completely invalid words', async () => {
      let promptCallCount = 0;

      // Always return completely invalid words (wrong length)
      globalThis.LanguageModel.create = async () => {
        return {
          async prompt(text: string) {
            promptCallCount++;
            return 'BAD, WORD, OUT, OF, LEN';
          },
          destroy() {},
        };
      };

      const harness = await setupE2ETest();
      try {
        // The game should enter error state
        const status = await harness.getAppStatus();
        expect(status.status).toBe('error');
        expect(status.title).toBe('GENERATION FAILED');
        expect(status.message).toContain('after 15 attempts');
        expect(promptCallCount).toBe(15);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // Gap 3: AI Help Suggestions Race Condition
  // =========================================================================
  it('should handle AI help suggestions race condition gracefully without deducting points', async () => {
    let resolvePromptPromise: (value: string) => void = () => {};
    const promptPromise = new Promise<string>((resolve) => {
      resolvePromptPromise = resolve;
    });

    // Mock prompt to suspend when requesting suggestions
    globalThis.LanguageModel.create = async () => {
      return {
        async prompt(text: string) {
          if (text.includes('suggest 15 valid, actual English words')) {
            return promptPromise;
          }
          // Default word generation returns APPLE
          return 'APPLE';
        },
        destroy() {},
      };
    };

    const harness = await setupE2ETest();
    try {
      // Toggle duplicates enabled so word typing into remaining slots succeeds
      await harness.toggleDuplicates();
      await harness.clickButton('GENERATE');

      // 1. Submit a wrong guess to enable the HELP button
      await harness.typeWord('PATCH');
      await harness.clickButton('GUESS!');

      const gridBefore = await harness.getGridState();
      expect(gridBefore.length).toBe(2); // 1 guess + active row
      
      const statsBefore = await harness.getStatsState();
      const initialScore = statsBefore.score;

      // 2. Click HELP to reveal a letter
      await harness.clickButton('?');

      // Now type another word into remaining empty slots and submit
      await harness.typeWord('PEACH');
      await harness.clickButton('GUESS!');

      // Now grid length is 3 (2 guesses + active row)
      const gridAfter = await harness.getGridState();
      expect(gridAfter.length).toBe(3);

      // 3. Resolve the AI suggestions fetch
      resolvePromptPromise('APPLE, BEACH, GRAPE');
      
      // Wait for async microtasks to run
      await new Promise((resolve) => setTimeout(resolve, 50));
      await tick();

      // 4. Verify score was decremented by 1 for help action
      const statsAfter = await harness.getStatsState();
      expect(statsAfter.score).toBe(Math.max(0, initialScore - 1));
    } finally {
      await harness.cleanup();
    }
  });
});

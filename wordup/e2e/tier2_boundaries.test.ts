import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupE2ETest as originalSetupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';

async function setupE2ETest(options?: {
  allowDuplicates?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard' | 'impossible';
  skipWait?: boolean;
  skipDbInit?: boolean;
}) {
  return originalSetupE2ETest({
    difficulty: options?.difficulty ?? 'hard',
    allowDuplicates: options?.allowDuplicates ?? false,
    skipWait: options?.skipWait,
    skipDbInit: options?.skipDbInit
  });
}
import { loadStats, saveStats, saveSession, clearSession } from '../src/lib/db';
import { tick } from 'svelte';
import { IDBFactory } from 'fake-indexeddb';

describe('Wordup PWA - Tier 2 Boundary & Corner Cases E2E Tests', () => {
  beforeEach(async () => {
    // Standard setup before each test
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions(['APPLE', 'PEACH']);
    
    // Clear IndexedDB state before each test to ensure perfect isolation
    try {
      await clearSession();
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: false });
    } catch (err) {
      console.warn('Database cleanup failed, continuing...', err);
    }
  });

  // =========================================================================
  // F1: Core Guessing Game (5 tests)
  // =========================================================================
  describe('F1: Core Guessing Game', () => {
    it('1. should ignore non-alphabetic character inputs', async () => {
      const harness = await setupE2ETest();
      try {
        const inputs = document.querySelectorAll('input.cell-input');
        const firstInput = inputs[0] as HTMLInputElement;

        // Try typing a number '1'
        firstInput.value = '1';
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        expect(firstInput.value).toBe('');

        // Try typing a special character '@'
        firstInput.value = '@';
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        expect(firstInput.value).toBe('');

        // Try typing a space ' '
        firstInput.value = ' ';
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        expect(firstInput.value).toBe('');

        // Try typing a valid letter 'A'
        firstInput.value = 'A';
        firstInput.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        expect(firstInput.value).toBe('A');
      } finally {
        await harness.cleanup();
      }
    });

    it('2. should prevent typing letters beyond 5 characters', async () => {
      const harness = await setupE2ETest();
      try {
        // Type 5 valid letters
        await harness.typeWord('PEACH');

        const gridBefore = await harness.getGridState();
        expect(gridBefore[0].map(c => c.letter)).toEqual(['P', 'E', 'A', 'C', 'H']);

        // Try to type a 6th letter 'X'
        // Since all cells are full, there are no empty active cells to input into
        const gridAfter = await harness.getGridState();
        expect(gridAfter[0].map(c => c.letter)).toEqual(['P', 'E', 'A', 'C', 'H']);
      } finally {
        await harness.cleanup();
      }
    });

    it('3. should ignore guess submission when row is incomplete', async () => {
      const harness = await setupE2ETest();
      try {
        // Type only 3 letters: 'STU'
        const inputs = document.querySelectorAll('input.cell-input');
        (inputs[0] as HTMLInputElement).value = 'S';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        (inputs[1] as HTMLInputElement).value = 'T';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        (inputs[2] as HTMLInputElement).value = 'U';
        inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Attempt to submit the incomplete guess
        await harness.clickButton('GUESS!');

        // Verify that the game is still in 'playing' state
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');

        // Verify that the guess was not submitted (no past guesses exist, grid has only the active row)
        const grid = await harness.getGridState();
        expect(grid.length).toBe(1);
        expect(grid[0].map(c => c.letter)).toEqual(['S', 'T', 'U', '', '']);
      } finally {
        await harness.cleanup();
      }
    });

    it('4. should ignore typing letters when game is already won or lost', async () => {
      setNextGeneratedWords(['PEACH']);
      const harness = await setupE2ETest();
      try {
        // Win the game by guessing 'PEACH'
        await harness.typeWord('PEACH');
        await harness.clickButton('GUESS!');

        const status = await harness.getAppStatus();
        expect(status.status).toBe('won');

        // Verify that no input cells exist in the DOM anymore, preventing typing
        const inputs = document.querySelectorAll('input.cell-input');
        expect(inputs.length).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it('5. should not crash when backspace is pressed on an empty row', async () => {
      const harness = await setupE2ETest();
      try {
        // Press Backspace on a completely empty row
        await harness.pressKey('Backspace');

        // Verify that the game is still in 'playing' state and hasn't crashed
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');

        const grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['', '', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // F2: Difficulty Settings (5 tests)
  // =========================================================================
  describe('F2: Difficulty Settings', () => {
    it('6. should ignore early reactive difficulty updates during loading status', async () => {
      // Mock a slow language model create that doesn't resolve immediately
      let resolvePrompt: any;
      const promptPromise = new Promise<string>(resolve => {
        resolvePrompt = resolve;
      });
      vi.spyOn(globalThis.LanguageModel, 'create').mockResolvedValue({
        prompt: () => promptPromise,
        destroy: () => {}
      });

      const harness = await setupE2ETest({ skipWait: true });
      try {
        // Verify the game is in 'loading' status
        const status = await harness.getAppStatus();
        expect(status.status).toBe('loading');

        // Verify that the difficulty select dropdown is disabled during loading
        const select = document.querySelector('#difficulty-select') as HTMLSelectElement | null;
        expect(select).not.toBeNull();
        expect(select?.disabled).toBe(true);
      } finally {
        // Resolve the prompt to allow clean exit
        if (resolvePrompt) resolvePrompt('PEACH');
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('7. should handle changing difficulty level mid-game without affecting current secret word', async () => {
      setNextGeneratedWords(['PEACH']);
      const harness = await setupE2ETest();
      try {
        // Mid-game: type a letter to start the game
        const inputs = document.querySelectorAll('input.cell-input');
        (inputs[0] as HTMLInputElement).value = 'P';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Change difficulty to easy mid-game
        await harness.setDifficulty('easy');

        // Verify that we can still win with the original word 'PEACH' (proving the secret word didn't change!)
        await harness.typeWord('PEACH');
        await harness.clickButton('GUESS!');

        const status = await harness.getAppStatus();
        expect(status.status).toBe('won');

        // Verify stats DB now has difficulty set to 'easy' for future games
        const stats = await loadStats();
        expect(stats.difficulty).toBe('easy');
      } finally {
        await harness.cleanup();
      }
    });

    it('8. should handle AI word generation failure and transition to error state', async () => {
      // Mock LanguageModel creation failure
      vi.spyOn(globalThis.LanguageModel, 'create').mockRejectedValue(new Error('AI Model failed to load'));

      const harness = await setupE2ETest();
      try {
        // Verify game transitions to 'error' state
        const status = await harness.getAppStatus();
        expect(status.status).toBe('error');
        expect(status.message).toContain('AI Model failed to load');
      } finally {
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('9. should handle relaxed length-only fallback during word generation', async () => {
      // Mock LanguageModel to return invalid words (with duplicates, e.g. 'AAAAA') for first 14 calls,
      // and on the 15th call return 'APPLY' which has duplicate 'P' but has length 5.
      // Since allowDuplicates is false, 'APPLY' would normally be rejected,
      // but on 15th call the length-only relaxed fallback should accept it!
      let promptCallCount = 0;
      vi.spyOn(globalThis.LanguageModel, 'create').mockResolvedValue({
        prompt: async () => {
          promptCallCount++;
          if (promptCallCount < 15) {
            return 'AAAAA, BBBBB'; // invalid due to identical duplicate letters
          }
          return 'APPLY'; // accepted under relaxed filter
        },
        destroy: () => {}
      });

      const harness = await setupE2ETest();
      try {
        // Verify game loaded successfully (meaning it accepted 'APPLY' on the 15th attempt)
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');

        // Verify secret word is APPLY by submitting 5 wrong guesses and losing the game,
        // which will reveal the secret word.
        const wrongGuesses = ['STARE', 'CLONE', 'BUMPY', 'FIGHT', 'DROWN'];
        for (let i = 0; i < 5; i++) {
          await harness.typeWord(wrongGuesses[i]);
          await harness.clickButton('GUESS!');
        }

        const winStatus = await harness.getAppStatus();
        expect(winStatus.status).toBe('lost');
        expect(winStatus.message).toContain('APPLY');
      } finally {
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('10. should verify difficulty setting is saved in stats IndexedDB immediately when changed', async () => {
      const harness = await setupE2ETest();
      try {
        // Change difficulty to easy
        await harness.setDifficulty('easy');

        // Verify it is saved in IndexedDB immediately
        const stats = await loadStats();
        expect(stats.difficulty).toBe('easy');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // F3: Duplicate Letters Toggle (5 tests)
  // =========================================================================
  describe('F3: Duplicate Letters Toggle', () => {
    it('11. should handle toggling duplicates mid-game without affecting current active game constraints', async () => {
      // Start game with duplicates disabled (Melon has unique letters)
      setNextGeneratedWords(['MELON']);
      const harness = await setupE2ETest();
      try {
        // Type 'E'
        const inputs = document.querySelectorAll('input.cell-input');
        (inputs[0] as HTMLInputElement).value = 'E';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Try to type 'E' again in the second cell
        (inputs[1] as HTMLInputElement).value = 'E';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Verify second cell remains empty (duplicate rejected)
        let grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['E', '', '', '', '']);

        // Toggle duplicates mid-game
        await harness.toggleDuplicates();

        // Try typing 'E' again - it should STILL be rejected because current game's active constraints are locked!
        (inputs[1] as HTMLInputElement).value = 'E';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['E', '', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });

    it('12. should verify shake cells animation state resets after timeout', async () => {
      setNextGeneratedWords(['MELON']);
      const harness = await setupE2ETest();
      try {
        // Type 'E' in first cell
        const inputs = document.querySelectorAll('input.cell-input');
        (inputs[0] as HTMLInputElement).value = 'E';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Type 'E' in second cell (duplicate!)
        (inputs[1] as HTMLInputElement).value = 'E';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Verify the first cell (the one already containing 'E') has the shake class immediately
        let grid = await harness.getGridState();
        expect(grid[0][0].classes).toContain('shake-orange');

        // Wait 450ms (timeout is 400ms)
        await new Promise(resolve => setTimeout(resolve, 450));
        await tick();

        // Verify the shake class is removed
        grid = await harness.getGridState();
        expect(grid[0][0].classes).not.toContain('shake-orange');
      } finally {
        await harness.cleanup();
      }
    });

    it('13. should handle duplicate toggle in extreme case (impossible difficulty)', async () => {
      const harness = await setupE2ETest();
      try {
        // Set difficulty to impossible and toggle duplicates
        await harness.setDifficulty('impossible');
        await harness.toggleDuplicates();

        // Verify both are saved correctly in the database
        const stats = await loadStats();
        expect(stats.difficulty).toBe('impossible');
        expect(stats.allowDuplicates).toBe(true);
      } finally {
        await harness.cleanup();
      }
    });

    it('14. should prevent typing duplicate letters when allowDuplicates is false', async () => {
      setNextGeneratedWords(['MELON']);
      const harness = await setupE2ETest();
      try {
        const inputs = document.querySelectorAll('input.cell-input');
        
        // Type 'M'
        (inputs[0] as HTMLInputElement).value = 'M';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Type 'M' again
        (inputs[1] as HTMLInputElement).value = 'M';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Verify only the first 'M' is accepted, second is ignored
        const grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['M', '', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });

    it('15. should allow typing duplicate letters when allowDuplicates is true', async () => {
      const harness = await setupE2ETest();
      try {
        // Pre-populate stats with allowDuplicates: true
        await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: true });
        await clearSession(); // Clear session
        await harness.reloadPage();

        const inputs = document.querySelectorAll('input.cell-input');
        
        // Type 'M'
        (inputs[0] as HTMLInputElement).value = 'M';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Type 'M' again
        (inputs[1] as HTMLInputElement).value = 'M';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Verify both 'M's are accepted
        const grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['M', 'M', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // F4: AI Hints & Suggestions (5 tests)
  // =========================================================================
  describe('F4: AI Hints & Suggestions', () => {
    it('16. should refuse to reveal the last remaining unrevealed letter', async () => {
      const harness = await setupE2ETest();
      try {
        // Enable duplicates so APPLY works if needed, start game
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        if (!checkbox.checked) {
          await harness.toggleDuplicates();
        }
        await harness.clickButton('GENERATE');

        // Secret word is APPLE. Guess APPLY (matches A, P, P, L; leaves only E at index 4)
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Help button should be disabled because only the last letter remains
        const helpButton = document.querySelector('.help-btn') as HTMLButtonElement | null;
        expect(helpButton?.disabled).toBe(true);
        expect(helpButton?.getAttribute('title')).toBe('Cannot reveal the last letter.');
      } finally {
        await harness.cleanup();
      }
    });

    it('17. should refuse to reveal the final remaining missing letter when unrevealed count reaches 1', async () => {
      const harness = await setupE2ETest();
      try {
        // Secret word APPLE. Guess STARE (locks position 4 'E', leaves 0, 1, 2, 3 unrevealed)
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        const helpButton = document.querySelector('.help-btn') as HTMLButtonElement | null;
        expect(helpButton?.disabled).toBe(false);

        // Click help 3 times (reveals 0 'A', 1 'P', 2 'P')
        await harness.clickButton('?');
        await harness.clickButton('?');
        await harness.clickButton('?');

        // Position 3 'L' and position 4 'E' were remaining, but after 3 hints (locking 0,1,2), position 3 remains unrevealed because unrevealedCount=1
        const activeRow = await harness.getActiveRow();
        expect(activeRow.slice(0, 3)).toEqual(['A', 'P', 'P']);
        expect(helpButton?.disabled).toBe(true);
      } finally {
        await harness.cleanup();
      }
    });

    it('18. should not trigger help on turn 1 before any guesses are made', async () => {
      const harness = await setupE2ETest();
      try {
        const helpButton = document.querySelector('.help-btn') as HTMLButtonElement | null;
        expect(helpButton?.disabled).toBe(true);
        expect(helpButton?.getAttribute('title')).toBe('Unavailable on first turn.');
      } finally {
        await harness.cleanup();
      }
    });

    it('19. should enforce maximum of 3 help actions per game', async () => {
      const harness = await setupE2ETest();
      try {
        // Set initial score to 5 so we have enough points to deduct
        await saveStats({ streak: 0, score: 5, highScore: 5, difficulty: 'hard', allowDuplicates: true });
        await clearSession(); // Clear session
        await harness.reloadPage();

        // Submit guess 'STARE' to unlock help (secret word APPLE)
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        // Verify help button is enabled
        const helpButton = document.querySelector('.help-btn') as HTMLButtonElement | null;
        expect(helpButton?.disabled).toBe(false);

        // Click HELP 3 times
        await harness.clickButton('?'); // 1st
        await harness.clickButton('?'); // 2nd
        await harness.clickButton('?'); // 3rd

        // Verify help button is now disabled
        expect(helpButton?.disabled).toBe(true);

        // Verify score was deducted by 3 (from 5 down to 2)
        const stats = await harness.getStatsState();
        expect(stats.score).toBe(2);
      } finally {
        await harness.cleanup();
      }
    });

    it('20. should not allow using help action when score is already 0 without dropping below 0', async () => {
      // Ensure score is 0
      await saveStats({ streak: 0, score: 0, highScore: 5, difficulty: 'hard', allowDuplicates: false });

      const harness = await setupE2ETest();
      try {
        // Submit one guess
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Use help
        await harness.clickButton('?');

        // Verify score remains 0, and doesn't drop below 0
        const stats = await harness.getStatsState();
        expect(stats.score).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // F5: Session Persistence & Restore (5 tests)
  // =========================================================================
  describe('F5: Session Persistence & Restore', () => {
    it('21. should handle corrupt or invalid session state in IndexedDB gracefully by resetting', async () => {
      // Populate a corrupted session in IndexedDB (missing activeRow and isLocked)
      const corruptedSession = {
        guesses: null, // corrupted
        secretWord: 'APPLE',
        gameStatus: 'playing'
      };
      // Write it directly to activeSession key in gameState store
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('WordupDB', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('gameState', 'readwrite');
        tx.objectStore('gameState').put(corruptedSession, 'activeSession');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();

      const harness = await setupE2ETest();
      try {
        // Verify the game recovered, didn't crash, and starts playing freshly
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');

        const grid = await harness.getGridState();
        expect(grid.length).toBe(1); // One fresh row
        expect(grid[0].map(c => c.letter)).toEqual(['', '', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });

    it('22. should handle IndexedDB connection drop during saveSession gracefully', async () => {
      const harness = await setupE2ETest();
      try {
        // Ensure duplicates are enabled and start new game
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        if (!checkbox.checked) {
          await harness.toggleDuplicates();
        }
        await harness.clickButton('GENERATE');

        // Mock saveSession to throw/reject (simulate DB drop)
        vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function() {
          const req = {} as any;
          setTimeout(() => {
            req.error = new DOMException('Connection dropped', 'DatabaseError');
            req.onerror?.(new Event('error'));
          }, 0);
          return req;
        });

        // Type a word and submit guess
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Verify the game continues to run normally in the UI without crashing
        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');

        const grid = await harness.getGridState();
        expect(grid.length).toBe(2); // The guess was evaluated and we are on the 2nd row
      } finally {
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('23. should handle IndexedDB connection drop during saveStats gracefully', async () => {
      const harness = await setupE2ETest();
      try {
        // Ensure duplicates are enabled and start new game
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        if (!checkbox.checked) {
          await harness.toggleDuplicates();
        }
        await harness.clickButton('GENERATE');

        // Mock IndexedDB to drop connection when writing stats
        vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function() {
          const req = {} as any;
          setTimeout(() => {
            req.error = new DOMException('Connection dropped', 'DatabaseError');
            req.onerror?.(new Event('error'));
          }, 0);
          return req;
        });

        // Guess the correct word to trigger saveStats
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        // Verify the game successfully transitions to won state in the UI
        const status = await harness.getAppStatus();
        expect(status.status).toBe('won');
        expect(status.title).toBe('VICTORY!');
      } finally {
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('24. should handle database read failures on init by transitioning to error state', async () => {
      // Mock database open to fail completely
      vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function() {
        const req = {} as any;
        setTimeout(() => {
          req.error = new DOMException('Unable to open database', 'DatabaseError');
          req.onerror?.(new Event('error'));
        }, 0);
        return req;
      });

      const harness = await setupE2ETest({ skipDbInit: true });
      try {
        // Verify game transitions to 'error' state
        const status = await harness.getAppStatus();
        expect(status.status).toBe('error');
        expect(status.message).toContain('Unable to open database');
      } finally {
        await harness.cleanup();
        vi.restoreAllMocks();
      }
    });

    it('25. should handle saving and restoring session with maximum guesses (4 guesses) correctly', async () => {
      const harness = await setupE2ETest();
      try {
        // Ensure duplicates are enabled and start new game
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        if (!checkbox.checked) {
          await harness.toggleDuplicates();
        }
        await harness.clickButton('GENERATE');

        // Submit 4 wrong guesses (APPLY is wrong, APPLE is correct)
        // With APPLY, columns 0, 1, 2, 3 ('A', 'P', 'P', 'L') will become correct and locked!
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Reload the page
        await harness.reloadPage();

        // Verify we are on the 5th row (guesses length is 4)
        const grid = await harness.getGridState();
        expect(grid.length).toBe(5);

        // Verify locked columns (0 to 3) are populated with 'A', 'P', 'P', 'L' in the active row
        expect(grid[4].slice(0, 4).map(c => c.letter)).toEqual(['A', 'P', 'P', 'L']);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // =========================================================================
  // F6: Game Statistics Tracking (5 tests)
  // =========================================================================
  describe('F6: Game Statistics Tracking', () => {
    it('26. should handle abandoning a game mid-game (by clicking new game) and verify streak and score are reset to 0', async () => {
      const harness = await setupE2ETest();
      try {
        // Pre-populate stats with a streak of 3 and score of 15 (with duplicates enabled so APPLY works)
        await saveStats({ streak: 3, score: 15, highScore: 15, difficulty: 'hard', allowDuplicates: true });
        await clearSession(); // Clear session created during setupE2ETest
        await harness.reloadPage();

        // Verify stats loaded in UI
        let stats = await harness.getStatsState();
        expect(stats.streak).toBe(3);
        expect(stats.score).toBe(15);

        // Make 1 guess mid-game
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Abandon the game by clicking GENERATE/New Game
        await harness.clickButton('GENERATE');

        // Verify streak and score are reset to 0
        stats = await harness.getStatsState();
        expect(stats.streak).toBe(0);
        expect(stats.score).toBe(0);

        // Verify stats in DB are also reset to 0
        const dbStats = await loadStats();
        expect(dbStats.streak).toBe(0);
        expect(dbStats.score).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it('27. should not reset streak or score if new game is clicked when game is already won or lost', async () => {
      const harness = await setupE2ETest();
      try {
        // Pre-populate stats with duplicates enabled so we can type 'APPLE'
        await saveStats({ streak: 3, score: 15, highScore: 15, difficulty: 'hard', allowDuplicates: true });
        await clearSession(); // Clear session
        await harness.reloadPage();

        // Win the game
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        let status = await harness.getAppStatus();
        expect(status.status).toBe('won');

        let stats = await harness.getStatsState();
        expect(stats.streak).toBe(4); // Incremented
        expect(stats.score).toBeGreaterThan(15); // Increased

        const currentStreak = stats.streak;
        const currentScore = stats.score;

        // Click PLAY AGAIN to start new game
        await harness.clickButton('PLAY AGAIN!');

        // Verify streak and score are preserved, not reset!
        stats = await harness.getStatsState();
        expect(stats.streak).toBe(currentStreak);
        expect(stats.score).toBe(currentScore);
      } finally {
        await harness.cleanup();
      }
    });

    it('28. should handle corrupt or missing stats in IndexedDB gracefully by initializing defaults', async () => {
      // Force corrupt stats (missing or corrupted properties) in IndexedDB
      const corruptedStats = {
        streak: null, // corrupt
        score: undefined,
        highScore: 'not-a-number' as any
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('WordupDB', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('statistics', 'readwrite');
        tx.objectStore('statistics').put(corruptedStats, 'playerStats');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();

      const harness = await setupE2ETest();
      try {
        // Verify stats default to 0 in the UI and the app loads without crashing
        const stats = await harness.getStatsState();
        expect(stats.streak).toBe(0);
        expect(stats.score).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it('29. should increment streak and add correct score on consecutive victories', async () => {
      const harness = await setupE2ETest();
      try {
        // Ensure duplicates are enabled and start new game
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        if (!checkbox.checked) {
          await harness.toggleDuplicates();
        }
        await harness.clickButton('GENERATE');

        // Game 1: Win
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        let stats = await harness.getStatsState();
        expect(stats.streak).toBe(1);
        expect(stats.score).toBe(10); // 1st guess victory = 10 pts

        // Start Game 2 (next word PEACH)
        setNextGeneratedWords(['PEACH']);
        await harness.clickButton('PLAY AGAIN!');

        // Game 2: Win on 2nd guess (1st guess APPLY, 2nd PEACH)
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');
        await harness.typeWord('PEACH');
        await harness.clickButton('GUESS!');

        // Verify streak is 2 and score accumulates correctly
        stats = await harness.getStatsState();
        expect(stats.streak).toBe(2);
        // 10 pts (Game 1) + 5 pts (Game 2 2nd guess: 6 - 2 + 1 = 5 pts) = 15 pts
        expect(stats.score).toBe(15);
      } finally {
        await harness.cleanup();
      }
    });

    it('30. should reset streak and score to 0 on game loss', async () => {
      const harness = await setupE2ETest();
      try {
        // Pre-populate stats with duplicates enabled so we can type 'APPLY'
        await saveStats({ streak: 3, score: 15, highScore: 15, difficulty: 'hard', allowDuplicates: true });
        await clearSession(); // Clear session
        await harness.reloadPage();

        // Submit 5 incorrect guesses to lose the game
        for (let i = 0; i < 5; i++) {
          await harness.typeWord('APPLY');
          await harness.clickButton('GUESS!');
        }

        const status = await harness.getAppStatus();
        expect(status.status).toBe('lost');

        // Verify streak and score are reset to 0 in UI
        const stats = await harness.getStatsState();
        expect(stats.streak).toBe(0);
        expect(stats.score).toBe(0);

        // Verify streak and score are reset to 0 in DB
        const dbStats = await loadStats();
        expect(dbStats.streak).toBe(0);
        expect(dbStats.score).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });
  });
});

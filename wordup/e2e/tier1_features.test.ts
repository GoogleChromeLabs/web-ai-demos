import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tick } from 'svelte';
import {
  setupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';
import { loadSession, loadStats, saveStats, clearSession } from '../src/lib/db';

describe('Tier 1 Feature Coverage E2E Tests', () => {
  const originalLanguageModelCreate = globalThis.LanguageModel.create;

  beforeEach(() => {
    globalThis.LanguageModel.create = originalLanguageModelCreate;
    // Default setup for each test: readily available AI, default word APPLE
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions([]);
  });

  // ==========================================
  // F1: Core Guessing Game (5 tests)
  // ==========================================
  describe('F1: Core Guessing Game', () => {
    it('should render empty board on start', async () => {
      const harness = await setupE2ETest();
      try {
        const grid = await harness.getGridState();
        // Since no guesses are made, only the active row is rendered (1 row, 5 cells)
        expect(grid.length).toBe(1);
        expect(grid[0].length).toBe(5);
        expect(grid[0].map(c => c.letter)).toEqual(['', '', '', '', '']);
        expect(grid[0].map(c => c.status)).toEqual(['input', 'input', 'input', 'input', 'input']);
      } finally {
        await harness.cleanup();
      }
    });

    it('should handle typing letters', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('ABCDE');
        const grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
      } finally {
        await harness.cleanup();
      }
    });

    it('should handle backspacing letters', async () => {
      const harness = await setupE2ETest();
      try {
        // Type two letters
        const activeRow = document.querySelector('.board-row.active-row');
        const inputs = Array.from(activeRow!.querySelectorAll('input.cell-input')) as HTMLInputElement[];
        
        inputs[0].value = 'A';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
        
        inputs[1].value = 'B';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        let grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['A', 'B', '', '', '']);

        // Backspace
        await harness.pressKey('Backspace');
        grid = await harness.getGridState();
        expect(grid[0].map(c => c.letter)).toEqual(['A', '', '', '', '']);
      } finally {
        await harness.cleanup();
      }
    });

    it('should handle submitting guess and displaying status colors', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        const grid = await harness.getGridState();
        // After submitting, the guess row is row 0, and the new active row is row 1
        expect(grid.length).toBe(2);
        
        // Check status colors for the submitted guess
        expect(grid[0][0].status).toBe('correct'); // A
        expect(grid[0][1].status).toBe('correct'); // P
        expect(grid[0][2].status).toBe('correct'); // P
        expect(grid[0][3].status).toBe('correct'); // L
        expect(grid[0][4].status).toBe('absent');  // Y
      } finally {
        await harness.cleanup();
      }
    });

    it('should handle game win and game loss', async () => {
      // Test Win
      const harnessWin = await setupE2ETest();
      try {
        await harnessWin.typeWord('APPLE');
        await harnessWin.clickButton('GUESS!');
        const status = await harnessWin.getAppStatus();
        expect(status.status).toBe('won');
        expect(status.title).toBe('VICTORY!');
      } finally {
        await harnessWin.cleanup();
      }

      // Test Loss
      const harnessLoss = await setupE2ETest();
      try {
        // Submit 5 wrong guesses
        for (let i = 0; i < 5; i++) {
          await harnessLoss.typeWord('APPLY');
          await harnessLoss.clickButton('GUESS!');
        }
        const status = await harnessLoss.getAppStatus();
        expect(status.status).toBe('lost');
        expect(status.title).toBe('GAME OVER');
      } finally {
        await harnessLoss.cleanup();
      }
    });

    it('should stay on victory screen when winning via Enter keypress without auto-restarting game', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLE');
        await harness.pressKey('Enter');
        
        const status = await harness.getAppStatus();
        expect(status.status).toBe('won');
        expect(status.title).toBe('VICTORY!');
      } finally {
        await harness.cleanup();
      }
    });

    it('should stay on game over screen when losing via Enter keypress without auto-restarting game', async () => {
      const harness = await setupE2ETest();
      try {
        for (let i = 0; i < 5; i++) {
          await harness.typeWord('APPLY');
          await harness.pressKey('Enter');
        }
        const status = await harness.getAppStatus();
        expect(status.status).toBe('lost');
        expect(status.title).toBe('GAME OVER');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // ==========================================
  // F2: Difficulty Settings (5 tests)
  // ==========================================
  describe('F2: Difficulty Settings', () => {
    it('should allow changing difficulty setting in UI', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.setDifficulty('easy');
        const select = document.querySelector('#difficulty-select') as HTMLSelectElement;
        expect(select.value).toBe('easy');
      } finally {
        await harness.cleanup();
      }
    });

    it('should persist difficulty setting to database on change', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.setDifficulty('impossible');
        await harness.reloadPage();
        const select = document.querySelector('#difficulty-select') as HTMLSelectElement;
        expect(select.value).toBe('impossible');
      } finally {
        await harness.cleanup();
      }
    });

    it('should start new game with easy difficulty', async () => {
      const harness = await setupE2ETest();
      try {
        const originalCreate = globalThis.LanguageModel.create;
        const promptsCalled: string[] = [];
        globalThis.LanguageModel.create = async (options?: any) => {
          const session = await originalCreate(options);
          const originalPrompt = session.prompt;
          session.prompt = async (text: string) => {
            promptsCalled.push(text);
            return originalPrompt.call(session, text);
          };
          return session;
        };

        await harness.setDifficulty('easy');
        await harness.clickButton('GENERATE');

        expect(promptsCalled.some(p => p.includes('easy'))).toBe(true);

        globalThis.LanguageModel.create = originalCreate;
      } finally {
        await harness.cleanup();
      }
    });

    it('should start new game with impossible difficulty', async () => {
      const harness = await setupE2ETest();
      try {
        const originalCreate = globalThis.LanguageModel.create;
        const promptsCalled: string[] = [];
        globalThis.LanguageModel.create = async (options?: any) => {
          const session = await originalCreate(options);
          const originalPrompt = session.prompt;
          session.prompt = async (text: string) => {
            promptsCalled.push(text);
            return originalPrompt.call(session, text);
          };
          return session;
        };

        await harness.setDifficulty('impossible');
        await harness.clickButton('GENERATE');

        expect(promptsCalled.some(p => p.includes('impossible'))).toBe(true);

        globalThis.LanguageModel.create = originalCreate;
      } finally {
        await harness.cleanup();
      }
    });

    it('should display the correct difficulty description text in the dashboard', async () => {
      const harness = await setupE2ETest();
      try {
        const originalCreate = globalThis.LanguageModel.create;
        let resolvePrompt: (value: string) => void;
        const promptPromise = new Promise<string>(resolve => {
          resolvePrompt = resolve;
        });

        globalThis.LanguageModel.create = async () => {
          return {
            async prompt() {
              return promptPromise;
            },
            destroy() {}
          };
        };

        // Set difficulty to medium
        await harness.setDifficulty('medium');
        
        // Click GENERATE to start new game and trigger loading screen
        await harness.clickButton('GENERATE');

        // Check description in the loading panel
        const status = await harness.getAppStatus();
        expect(status.status).toBe('loading');
        expect(status.message).toBe('A little challenging, duplicate letters allowed');

        // Clean up
        resolvePrompt!('APPLE');
        await tick();
        globalThis.LanguageModel.create = originalCreate;
      } finally {
        await harness.cleanup();
      }
    });
  });

  // ==========================================
  // F3: Duplicate Letters Toggle (5 tests)
  // ==========================================
  describe('F3: Duplicate Letters Toggle', () => {

    it('should allow toggling duplicate letters in UI', async () => {
      const harness = await setupE2ETest();
      // Overrides duplicates back to false for this test
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
      await clearSession();
      await harness.reloadPage();
      try {
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);

        await harness.toggleDuplicates();
        expect(checkbox.checked).toBe(true);
      } finally {
        await harness.cleanup();
      }
    });

    it('should persist duplicate letters toggle to database', async () => {
      const harness = await setupE2ETest();
      // Overrides duplicates back to false for this test
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
      await clearSession();
      await harness.reloadPage();
      try {
        await harness.toggleDuplicates(); // Set to true
        await harness.reloadPage();
        const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
      } finally {
        await harness.cleanup();
      }
    });

    it('should start new game with duplicates allowed', async () => {
      const harness = await setupE2ETest();
      // Overrides duplicates back to false for this test
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
      await clearSession();
      await harness.reloadPage();
      try {
        const originalCreate = globalThis.LanguageModel.create;
        const promptsCalled: string[] = [];
        globalThis.LanguageModel.create = async (options?: any) => {
          const session = await originalCreate(options);
          const originalPrompt = session.prompt;
          session.prompt = async (text: string) => {
            promptsCalled.push(text);
            return originalPrompt.call(session, text);
          };
          return session;
        };

        await harness.toggleDuplicates(); // True
        await harness.clickButton('GENERATE');

        // If duplicates are allowed, the prompt should NOT contain "no duplicate letters" constraint
        const prompt = promptsCalled.find(p => p.includes('Generate exactly 20 different 5-letter English words'));
        expect(prompt).toBeDefined();
        expect(prompt!.includes('no duplicate letters')).toBe(false);

        globalThis.LanguageModel.create = originalCreate;
      } finally {
        await harness.cleanup();
      }
    });

    it('should reject duplicate letter input when duplicates are disabled', async () => {
      const harness = await setupE2ETest();
      // Overrides duplicates back to false for this test
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
      await clearSession();
      await harness.reloadPage();
      try {
        const activeRow = document.querySelector('.board-row.active-row');
        const inputs = Array.from(activeRow!.querySelectorAll('input.cell-input')) as HTMLInputElement[];

        // Type 'A' into first cell
        inputs[0].value = 'A';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Type 'A' into second cell (duplicate)
        inputs[1].value = 'A';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Second cell should be rejected (reset to '')
        expect(inputs[1].value).toBe('');

        // First cell should have the shake-orange class
        const cards = Array.from(activeRow!.querySelectorAll('.letter-card'));
        expect(cards[0].classList.contains('shake-orange')).toBe(true);
      } finally {
        await harness.cleanup();
      }
    });

    it('should allow duplicate letter input when duplicates are enabled', async () => {
      const harness = await setupE2ETest();
      // Overrides duplicates back to false for this test
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
      await clearSession();
      await harness.reloadPage();
      try {
        await harness.toggleDuplicates(); // Enable duplicates
        await harness.clickButton('GENERATE'); // Start new game with duplicates enabled!

        const activeRow = document.querySelector('.board-row.active-row');
        const inputs = Array.from(activeRow!.querySelectorAll('input.cell-input')) as HTMLInputElement[];

        // Type 'A' into first cell
        inputs[0].value = 'A';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Type 'A' into second cell
        inputs[1].value = 'A';
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        await tick();

        // Both should be accepted
        expect(inputs[0].value).toBe('A');
        expect(inputs[1].value).toBe('A');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // ==========================================
  // F4: AI Hints & Suggestions (5 tests)
  // ==========================================
  describe('F4: AI Hints & Suggestions', () => {
    it('should show help button disabled or active depending on game state', async () => {
      const harness = await setupE2ETest();
      try {
        const helpBtn = document.querySelector('.help-btn') as HTMLButtonElement;
        // On start, disabled because no guesses made yet
        expect(helpBtn.disabled).toBe(true);

        // Make a wrong guess that leaves >1 letters unrevealed
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        // Should now be enabled
        expect(helpBtn.disabled).toBe(false);
      } finally {
        await harness.cleanup();
      }
    });

    it('should not trigger suggestions if no guesses have been made yet', async () => {
      const harness = await setupE2ETest();
      try {
        const helpBtn = document.querySelector('.help-btn') as HTMLButtonElement;
        expect(helpBtn.disabled).toBe(true);

        // Click it anyway (it shouldn't do anything)
        helpBtn.click();
        await tick();

        const suggestions = await harness.getSuggestions();
        expect(suggestions.length).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it('should reveal a missing letter in the right spot when help is clicked', async () => {
      const harness = await setupE2ETest();
      try {
        // Submit guess 'STARE' against secret word 'APPLE'
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        // Click help
        await harness.clickButton('?');

        const activeRow = await harness.getActiveRow();
        expect(activeRow[0]).toBe('A');
      } finally {
        await harness.cleanup();
      }
    });

    it('should lock the revealed letter in the active row', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        await harness.clickButton('?');

        const activeRow = await harness.getActiveRow();
        expect(activeRow[0]).toBe('A');
      } finally {
        await harness.cleanup();
      }
    });

    it('should decrement score when help action is used', async () => {
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: false });
      const harness = await setupE2ETest({ streak: 0, score: 0, highScore: 0 });
      try {
        // 1. Win a game first to gain score (10 pts)
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');
        let stats = await harness.getStatsState();
        expect(stats.score).toBe(10);

        // 2. Play again
        await harness.clickButton('PLAY AGAIN');

        // 3. Make a guess to enable help
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        // 4. Trigger help
        await harness.clickButton('?');

        // Score should decrement by 1 (10 -> 9)
        stats = await harness.getStatsState();
        expect(stats.score).toBe(9);
      } finally {
        await harness.cleanup();
      }
    });
  });

  // ==========================================
  // F5: Session Persistence & Restore (5 tests)
  // ==========================================
  describe('F5: Session Persistence & Restore', () => {
    it('should save mid-game session state to database after each guess', async () => {
      await clearSession();
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Directly load session from database and verify it's saved
        const session = await loadSession();
        expect(session).not.toBeNull();
        expect(session?.guesses.length).toBe(1);
        expect(session?.guesses[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);
      } finally {
        await harness.cleanup();
      }
    });

    it('should restore mid-game session state on page reload', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLY');
        await harness.clickButton('GUESS!');

        // Reload page
        await harness.reloadPage();

        // Verify board is restored
        const grid = await harness.getGridState();
        expect(grid.length).toBe(2); // Past guess + active row
        expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);

        const status = await harness.getAppStatus();
        expect(status.status).toBe('playing');
      } finally {
        await harness.cleanup();
      }
    });

    it('should persist session state on game win', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');
        
        // Status should be won
        let status = await harness.getAppStatus();
        expect(status.status).toBe('won');

        // Reload page
        await harness.reloadPage();

        // Session should be persisted, so it starts in 'won' state
        status = await harness.getAppStatus();
        expect(status.status).toBe('won');
        
        const grid = await harness.getGridState();
        expect(grid.length).toBe(1); // The winning guess row (no active row since game is over)
        expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'E']);
      } finally {
        await harness.cleanup();
      }
    });

    it('should persist session state on game loss', async () => {
      const harness = await setupE2ETest();
      try {
        // Lose the game by submitting 5 wrong guesses
        for (let i = 0; i < 5; i++) {
          await harness.typeWord('APPLY');
          await harness.clickButton('GUESS!');
        }

        let status = await harness.getAppStatus();
        expect(status.status).toBe('lost');

        // Reload page
        await harness.reloadPage();

        // Should restore in 'lost' state
        status = await harness.getAppStatus();
        expect(status.status).toBe('lost');

        const grid = await harness.getGridState();
        expect(grid.length).toBe(5); // 5 guesses (no active row since game is over)
      } finally {
        await harness.cleanup();
      }
    });

    it('should restore help actions used count on page reload', async () => {
      const harness = await setupE2ETest();
      try {
        // Submit guess to enable help
        await harness.typeWord('STARE');
        await harness.clickButton('GUESS!');

        // Use help
        await harness.clickButton('?');

        // Remaining help count should be 2
        let helpCountEl = document.querySelector('.help-count');
        expect(helpCountEl?.textContent?.trim()).toBe('2');

        // Reload page
        await harness.reloadPage();

        // Verify remaining help count is still 2
        helpCountEl = document.querySelector('.help-count');
        expect(helpCountEl?.textContent?.trim()).toBe('2');
      } finally {
        await harness.cleanup();
      }
    });
  });

  // ==========================================
  // F6: Game Statistics Tracking (5 tests)
  // ==========================================
  describe('F6: Game Statistics Tracking', () => {
    it('should initialize stats with zero on fresh start', async () => {
      const harness = await setupE2ETest();
      try {
        const stats = await harness.getStatsState();
        expect(stats.streak).toBe(0);
        expect(stats.score).toBe(0);
        expect(stats.best).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it('should increment streak and score on game win', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        const stats = await harness.getStatsState();
        expect(stats.streak).toBe(1);
        expect(stats.score).toBe(10); // Guessed in 1 attempt = 10 pts
        expect(stats.best).toBe(10);
      } finally {
        await harness.cleanup();
      }
    });

    it('should reset streak and score to zero on game loss', async () => {
      const harness = await setupE2ETest();
      try {
        // 1. Win game 1 to get streak=1, score=10
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');
        
        let stats = await harness.getStatsState();
        expect(stats.streak).toBe(1);
        expect(stats.score).toBe(10);

        // 2. Play again
        await harness.clickButton('PLAY AGAIN');
        
        // 3. Lose game 2 by submitting 5 wrong guesses
        setNextGeneratedWords(['PEACH']);
        for (let i = 0; i < 5; i++) {
          await harness.typeWord('APPLY');
          await harness.clickButton('GUESS!');
        }

        // 4. Verify streak and score are reset to 0, but best remains 10
        stats = await harness.getStatsState();
        expect(stats.streak).toBe(0);
        expect(stats.score).toBe(0);
        expect(stats.best).toBe(10);
      } finally {
        await harness.cleanup();
      }
    });

    it('should persist stats across page reload', async () => {
      const harness = await setupE2ETest();
      try {
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        await harness.reloadPage();

        const stats = await harness.getStatsState();
        expect(stats.streak).toBe(1);
        expect(stats.score).toBe(10);
        expect(stats.best).toBe(10);
      } finally {
        await harness.cleanup();
      }
    });

    it('should update high score when current score exceeds it', async () => {
      const harness = await setupE2ETest();
      try {
        // Win game 1 (score = 10)
        await harness.typeWord('APPLE');
        await harness.clickButton('GUESS!');

        let stats = await harness.getStatsState();
        expect(stats.score).toBe(10);
        expect(stats.best).toBe(10);

        // Play again
        setNextGeneratedWords(['PEACH']);
        await harness.clickButton('PLAY AGAIN');

        // Win game 2 (score = 10 + 10 = 20)
        await harness.typeWord('PEACH');
        await harness.clickButton('GUESS!');

        stats = await harness.getStatsState();
        expect(stats.score).toBe(20);
        expect(stats.best).toBe(20);
      } finally {
        await harness.cleanup();
      }
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';
import { saveStats, saveSession, loadStats, type LetterCell } from '../src/lib/db';

describe('Wordup PWA E2E Tier 3: Cross-Feature Combinations', () => {
  beforeEach(() => {
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions(['APPLE', 'GRAPE', 'PEACH']);
  });

  it('should combine Difficulty setting and Duplicate Letters toggle', async () => {
    const harness = await setupE2ETest();

    // Set up a spy on LanguageModel.prompt to capture prompts
    const originalCreate = globalThis.LanguageModel.create;
    const prompts: string[] = [];
    
    globalThis.LanguageModel.create = async (options) => {
      const session = await originalCreate(options);
      return {
        async prompt(text: string) {
          prompts.push(text);
          return session.prompt(text);
        },
        destroy() {
          session.destroy();
        }
      };
    };

    try {
      // 1. Set easy difficulty and enable duplicates
      await harness.setDifficulty('easy');
      
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (!checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(true);

      // Click GENERATE to start a new game under these rules
      prompts.length = 0; // clear recorded prompts
      await harness.clickButton('GENERATE');
      
      // Verify word generation was called with easy and duplicates enabled
      expect(prompts.length).toBeGreaterThan(0);
      const easyPrompt = prompts.find(p => p.includes('Generate exactly 20 different 5-letter English words'));
      expect(easyPrompt).toBeDefined();
      expect(easyPrompt).toContain('easy');
      // Duplicate clause should be empty when duplicates are allowed
      expect(easyPrompt).not.toContain('no duplicate letters');

      // 2. Set impossible difficulty and disable duplicates
      await harness.setDifficulty('impossible');
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      // Click GENERATE to start a new game under these rules
      prompts.length = 0; // clear recorded prompts
      await harness.clickButton('GENERATE');

      // Verify word generation was called with impossible and duplicates disabled
      expect(prompts.length).toBeGreaterThan(0);
      const impossiblePrompt = prompts.find(p => p.includes('Generate exactly 20 different 5-letter English words'));
      expect(impossiblePrompt).toBeDefined();
      expect(impossiblePrompt).toContain('impossible');
      // Duplicate clause should be present when duplicates are disabled
      expect(impossiblePrompt).toContain('no duplicate letters');
    } finally {
      // Restore original mock
      globalThis.LanguageModel.create = originalCreate;
      await harness.cleanup();
    }
  });

  it('should verify AI suggestions conform to the active duplicates toggle', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Start a game with duplicates disabled (allowDuplicates = false)
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      setNextGeneratedWords(['GRAPE']);
      await harness.clickButton('GENERATE');

      // Make a guess to enable HELP button
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // Mock AI response to return a list of words, some with duplicates
      // 'APPLE' has duplicate 'P', 'CRANE' and 'GRAPE' have unique letters
      setNextSuggestions(['APPLE', 'CRANE', 'GRAPE']);

      // Trigger HELP
      await harness.clickButton('?');

      // Verify that 'APPLE' (contains duplicates) is filtered out
      let suggestions = await harness.waitForSuggestions();
      expect(suggestions).not.toContain('APPLE');
      expect(suggestions).toContain('CRANE');
      expect(suggestions).toContain('GRAPE');

      // 2. Now start a game with duplicates enabled (allowDuplicates = true)
      if (!checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(true);

      setNextGeneratedWords(['APPLE']);
      await harness.clickButton('GENERATE');

      // Make a guess to enable HELP button
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // Mock AI suggestions again
      setNextSuggestions(['APPLE', 'CABLE', 'HALVE']);

      // Trigger HELP
      await harness.clickButton('?');

      // Verify that 'APPLE' (contains duplicates) is allowed and shown
      suggestions = await harness.waitForSuggestions();
      expect(suggestions).toContain('APPLE');
      expect(suggestions).toContain('CABLE');
      expect(suggestions).toContain('HALVE');
    } finally {
      await harness.cleanup();
    }
  });

  it('should verify AI suggestions conform to green/yellow/gray letter constraints of current game', async () => {
    const harness = await setupE2ETest();

    try {
      // Secret word is SLATE
      setNextGeneratedWords(['SLATE']);
      await harness.clickButton('GENERATE');

      // Guess is STARE
      // Feedback: S (green), T (yellow), A (green), R (gray/absent), E (green)
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // Mock LanguageModel raw response with different words:
      // - SLATE: matches S at 0, A at 2, E at 4, has T, no R -> Fits!
      // - SPATE: matches S at 0, A at 2, E at 4, has T, no R -> Fits!
      // - SHARE: contains R (absent) -> Fails!
      // - CRATE: no S at 0, contains R -> Fails!
      setNextSuggestions(['SLATE', 'SPATE', 'SHARE', 'CRATE']);

      // Trigger HELP
      await harness.clickButton('?');

      // Verify only conforming suggestions are displayed
      const suggestions = await harness.waitForSuggestions();
      expect(suggestions).toEqual(['SLATE', 'SPATE']);
    } finally {
      await harness.cleanup();
    }
  });

  it('should update and persist stats after restoring a saved session and then winning', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Pre-populate IndexedDB with a saved mid-game session and existing stats
      const initialStats = {
        streak: 3,
        score: 15,
        highScore: 20,
        difficulty: 'hard' as const,
        allowDuplicates: false
      };

      const restoredGuesses: LetterCell[][] = [
        [
          { letter: 'A', status: 'correct' },
          { letter: 'P', status: 'correct' },
          { letter: 'P', status: 'correct' },
          { letter: 'L', status: 'correct' },
          { letter: 'Y', status: 'absent' }
        ]
      ];

      const savedSession = {
        guesses: restoredGuesses,
        activeRow: ['A', 'P', 'P', 'L', ''],
        isLocked: [true, true, true, true, false],
        gameStatus: 'playing' as const,
        secretWord: 'APPLE',
        helpActionsUsed: 0,
        difficulty: 'hard' as const,
        allowDuplicates: false
      };

      // Save to database
      await saveStats(initialStats);
      await saveSession(savedSession);

      // 2. Reload the page to load the saved state
      await harness.reloadPage();

      // Verify page restored the state correctly
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');

      let grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);
      expect(grid[1].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', '']); // active row pre-filled

      let stats = await harness.getStatsState();
      expect(stats.streak).toBe(3);
      expect(stats.score).toBe(15);
      expect(stats.best).toBe(20);

      // 3. Complete the game successfully: Type 'E' in the final slot and submit
      await harness.typeWord('APPLE'); // typeWord will fill empty unlocked cell
      await harness.clickButton('GUESS!');

      // Verify game is won
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      expect(status.title).toBe('VICTORY!');

      // Verify stats updated:
      // Streak increases by 1 -> 4
      // Score: 15 + (6 - 2 attempts + 1) = 20 pts
      // HighScore: best of 20 and 20 -> 20 pts
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(4);
      expect(stats.score).toBe(20);
      expect(stats.best).toBe(20);

      // Verify stats persisted in DB
      const persistedStats = await loadStats();
      expect(persistedStats.streak).toBe(4);
      expect(persistedStats.score).toBe(20);
      expect(persistedStats.highScore).toBe(20);
    } finally {
      await harness.cleanup();
    }
  });

  it('should handle using AI hints in very hard difficulty', async () => {
    const harness = await setupE2ETest();

    try {
      // Set difficulty to very hard and start game
      await harness.setDifficulty('very_hard');
      setNextGeneratedWords(['PEACH']);
      await harness.clickButton('GENERATE');

      // Submit first guess: APPLE
      // A (present/yellow), P (present/yellow), L/E (absent) -> wait, PEACH has P and A and E.
      // PEACH: P (correct/green at index 0? No, P is at index 1 in APPLE, PEACH has P at 0. So P is present/yellow).
      // Let's type 'PEARL'
      await harness.typeWord('PEARL');
      await harness.clickButton('GUESS!');

      // Verify game is still playing
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');

      // Click HELP
      setNextSuggestions(['PEACH']);
      await harness.clickButton('?');

      // Verify suggestion is displayed
      const suggestions = await harness.waitForSuggestions();
      expect(suggestions).toContain('PEACH');

      // Click suggestion to autofill
      await harness.clickSuggestion('PEACH');

      // Submit guess
      await harness.clickButton('GUESS!');

      // Verify game won
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      expect(status.title).toBe('VICTORY!');
    } finally {
      await harness.cleanup();
    }
  });

  it('should handle duplicate letter rejection on locked/pre-filled cells', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Start a game with duplicates disabled
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      setNextGeneratedWords(['GRAPE']);
      await harness.clickButton('GENERATE');

      // Guess 'GRATE'
      // G, R, A, E are correct (indices 0, 1, 2, 4) and locked.
      // Active row becomes: ['G', 'R', 'A', '', 'E']
      await harness.typeWord('GRATE');
      await harness.clickButton('GUESS!');

      // Verify active row locked states
      let grid = await harness.getGridState();
      expect(grid[1].map(c => c.letter)).toEqual(['G', 'R', 'A', '', 'E']);

      // 2. Try to type 'R' (which is already locked at index 1) in the unlocked cell (index 3)
      await harness.pressKey('R');
      
      // Verify 'R' was REJECTED because it's a duplicate letter and duplicates are disabled
      grid = await harness.getGridState();
      expect(grid[1][3].letter).toBe('');

      // 3. Try to type 'P' (uniquely valid letter) in the unlocked cell (index 3)
      await harness.pressKey('P');

      // Verify 'P' was ACCEPTED
      grid = await harness.getGridState();
      expect(grid[1][3].letter).toBe('P');
    } finally {
      await harness.cleanup();
    }
  });
});

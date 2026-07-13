import { describe, it, expect, beforeEach } from 'vitest';
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
import { saveStats, saveSession, loadStats, type LetterCell } from '../src/lib/db';

describe('Wordup PWA E2E Tier 4: Real-World Application Scenarios', () => {
  beforeEach(() => {
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
    setNextSuggestions(['APPLE', 'GRAPE', 'PEACH']);
  });

  it('Scenario 1: Standard Multi-Game Playthrough', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Fresh session on Medium difficulty
      await harness.setDifficulty('medium');
      await harness.toggleDuplicates();
      
      // Game 1: Win in 3 attempts
      setNextGeneratedWords(['APPLE']);
      await harness.clickButton('GENERATE');

      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');
      await harness.typeWord('ALIVE');
      await harness.clickButton('GUESS!');

      await harness.typeWord('APPLE');
      await harness.clickButton('GUESS!');

      // Verify Game 1 win
      let status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      let stats = await harness.getStatsState();
      expect(stats.streak).toBe(1);
      // Win on 3rd attempt: 6 - 3 + 1 = 4 points
      expect(stats.score).toBe(4);
      expect(stats.best).toBe(4);

      // Game 2: Win in 1 attempt
      setNextGeneratedWords(['PEACH']);
      await harness.clickButton('PLAY AGAIN!');

      await harness.typeWord('PEACH');
      await harness.clickButton('GUESS!');

      // Verify Game 2 win
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(2);
      // Win on 1st attempt: +10 points. Total: 4 + 10 = 14 points
      expect(stats.score).toBe(14);
      expect(stats.best).toBe(14);

      // Game 3: Lose in 5 attempts
      setNextGeneratedWords(['GRAPE']);
      await harness.clickButton('PLAY AGAIN!');

      // Submit 5 wrong guesses
      const wrongGuesses = ['WORDS', 'STARE', 'SLATE', 'SPATE', 'SHARE'];
      for (const guess of wrongGuesses) {
        await harness.typeWord(guess);
        await harness.clickButton('GUESS!');
      }

      // Verify Game 3 loss
      status = await harness.getAppStatus();
      expect(status.status).toBe('lost');
      stats = await harness.getStatsState();
      // Streak resets to 0, score resets to 0, best remains 14
      expect(stats.streak).toBe(0);
      expect(stats.score).toBe(0);
      expect(stats.best).toBe(14);
    } finally {
      await harness.cleanup();
    }
  });

  it('Scenario 2: Settings Changes and Persistence Flow', async () => {
    const harness = await setupE2ETest();

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
      // 1. Start on Hard difficulty with duplicates disabled
      await harness.setDifficulty('hard');
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      setNextGeneratedWords(['SLATE']);
      await harness.clickButton('GENERATE');

      // Play a guess
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // 2. Change difficulty to Easy and enable duplicates mid-game
      await harness.setDifficulty('easy');
      if (!checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(true);

      // 3. Finish current game under the old rules (still Hard, no duplicates)
      await harness.typeWord('SLATE');
      await harness.clickButton('GUESS!');

      let status = await harness.getAppStatus();
      expect(status.status).toBe('won');

      // 4. Start a new game
      prompts.length = 0; // clear recorded prompts
      await harness.clickButton('PLAY AGAIN!');

      // Verify the new game is initialized with Easy difficulty and duplicates enabled
      expect(prompts.length).toBeGreaterThan(0);
      const newGamePrompt = prompts.find(p => p.includes('Generate exactly 20 different 5-letter English words'));
      expect(newGamePrompt).toBeDefined();
      expect(newGamePrompt).toContain('easy');
      expect(newGamePrompt).not.toContain('no duplicate letters');

      // 5. Simulate page reload and verify state is preserved
      await harness.reloadPage();
      
      const difficultySelect = document.querySelector('#difficulty-select') as HTMLSelectElement;
      expect(difficultySelect.value).toBe('easy');
      const updatedCheckbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      expect(updatedCheckbox.checked).toBe(true);
    } finally {
      globalThis.LanguageModel.create = originalCreate;
      await harness.cleanup();
    }
  });

  it('Scenario 3: AI-Assisted Recovery Flow', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Pre-populate DB: Hard difficulty, score 5, streak 1, best 5
      const initialStats = {
        streak: 1,
        score: 5,
        highScore: 5,
        difficulty: 'hard' as const,
        allowDuplicates: false
      };

      // 2 wrong guesses, secret word is SPARE
      const restoredGuesses: LetterCell[][] = [
        [
          { letter: 'S', status: 'correct' },
          { letter: 'T', status: 'absent' },
          { letter: 'O', status: 'absent' },
          { letter: 'R', status: 'correct' },
          { letter: 'E', status: 'correct' }
        ],
        [
          { letter: 'S', status: 'correct' },
          { letter: 'L', status: 'absent' },
          { letter: 'O', status: 'absent' },
          { letter: 'R', status: 'correct' },
          { letter: 'E', status: 'correct' }
        ]
      ];

      const savedSession = {
        guesses: restoredGuesses,
        activeRow: ['S', '', '', 'R', 'E'],
        isLocked: [true, false, false, true, true],
        gameStatus: 'playing' as const,
        secretWord: 'SPARE',
        helpActionsUsed: 0,
        difficulty: 'hard' as const,
        allowDuplicates: false
      };

      await saveStats(initialStats);
      await saveSession(savedSession);

      // Reload page to restore mid-game session
      await harness.reloadPage();

      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');
      let stats = await harness.getStatsState();
      expect(stats.score).toBe(5);

      // 2. We are stuck on guess 3. Use HELP (reveals missing letter at index 1: 'P')
      await harness.clickButton('?');

      // Score should be decremented by 1 (penalty for help)
      stats = await harness.getStatsState();
      expect(stats.score).toBe(4);

      let activeRow = await harness.getActiveRow();
      expect(activeRow).toEqual(['S', 'P', '', 'R', 'E']);

      // Fill remaining letter 'A' (index 2) by typing SPARE
      await harness.typeWord('SPARE');
      await harness.clickButton('GUESS!');

      // Verify game is won
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');

      // Score calculation:
      // Starting score: 5
      // 1 Help action used: -1
      // Guess 3 is correct: +4 (6 - 3 + 1 = 4 points)
      // Total score: 5 - 1 + 4 = 8 points
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(2);
      expect(stats.score).toBe(8);
      expect(stats.best).toBe(8);

      // 4. Verify persistence after reload (won game cleared mid-game session, ready for next game)
      await harness.reloadPage();
      status = await harness.getAppStatus();
      expect(status.status).toBe('playing');
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(2);
      expect(stats.score).toBe(8);
    } finally {
      await harness.cleanup();
    }
  });

  it('Scenario 4: Disruption and Recovery (Database Drop & Page Reload)', async () => {
    const harness = await setupE2ETest();

    try {
      // Start a session
      setNextGeneratedWords(['SLATE']);
      await harness.clickButton('GENERATE');

      // Play 1st guess: STARE
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');

      // Play 2nd guess: SPARE
      await harness.typeWord('SPARE');
      await harness.clickButton('GUESS!');

      // Simulate browser tab closed/refreshed
      await harness.reloadPage();

      // Verify recovery of board state
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');

      let grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['S', 'T', 'A', 'R', 'E']);
      expect(grid[1].map(c => c.letter)).toEqual(['S', 'P', 'A', 'R', 'E']);

      // Play 3rd guess: SLATE (correct word)
      await harness.typeWord('SLATE');
      await harness.clickButton('GUESS!');

      // Verify game is won and stats updated
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      expect(status.title).toBe('VICTORY!');

      let stats = await harness.getStatsState();
      expect(stats.streak).toBe(1);
      // Won in 3rd attempt: 6 - 3 + 1 = 4 points
      expect(stats.score).toBe(4);
    } finally {
      await harness.cleanup();
    }
  });

  it('Scenario 5: Complete User Journey', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Visit PWA and verify initial stats are 0
      let stats = await harness.getStatsState();
      expect(stats.streak).toBe(0);
      expect(stats.score).toBe(0);
      expect(stats.best).toBe(0);

      // 2. Customize settings to Easy, duplicates allowed
      await harness.setDifficulty('easy');
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement;
      if (!checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(true);

      // Game 1: Win in 1 attempt
      setNextGeneratedWords(['APPLE']);
      await harness.clickButton('GENERATE');

      await harness.typeWord('APPLE');
      await harness.clickButton('GUESS!');

      // Verify Game 1 stats (+10 points for 1st attempt win)
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(1);
      expect(stats.score).toBe(10);

      // Game 2: Win in 1 attempt
      setNextGeneratedWords(['PEACH']);
      await harness.clickButton('PLAY AGAIN!');

      await harness.typeWord('PEACH');
      await harness.clickButton('GUESS!');

      // Verify Game 2 stats (streak 2, score 20)
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(2);
      expect(stats.score).toBe(20);

      // 3. Switch to Impossible difficulty, duplicates disabled
      await harness.setDifficulty('impossible');
      if (checkbox.checked) {
        await harness.toggleDuplicates();
      }
      expect(checkbox.checked).toBe(false);

      // Start new game under these rules (Game 3)
      setNextGeneratedWords(['GRAPE']);
      await harness.clickButton('PLAY AGAIN!');

      // Play 2 guesses
      await harness.typeWord('STARE');
      await harness.clickButton('GUESS!');
      await harness.typeWord('SLATE');
      await harness.clickButton('GUESS!');

      // 4. Close the app (simulate reload without database drop)
      await harness.reloadPage();

      // Verify state restored
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');
      let grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['S', 'T', 'A', 'R', 'E']);
      expect(grid[1].map(c => c.letter)).toEqual(['S', 'L', 'A', 'T', 'E']);

      // Play 3rd guess (incorrectly): SPARE
      await harness.typeWord('SPARE');
      await harness.clickButton('GUESS!');

      // 5. On 4th attempt, use a hint and win
      // Click HELP: reveals index 0 ('G') in activeRow ['G', '', 'A', 'P', 'E']
      await harness.clickButton('?');

      // Score decremented by 1 (penalty for help) -> 20 - 1 = 19
      stats = await harness.getStatsState();
      expect(stats.score).toBe(19);

      let activeRow = await harness.getActiveRow();
      expect(activeRow).toEqual(['G', '', 'A', '', 'E']);

      // Type the full word 'GRAPE' into active row to fill positions 1 and 3
      await harness.typeWord('GRAPE');
      await harness.clickButton('GUESS!');

      // Verify game is won
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');

      // Final stats check:
      // Game 1 win in 1: +10 (total 10)
      // Game 2 win in 1: +10 (total 20)
      // Game 3 win in 4 with 1 hint: -1 (hint penalty) + 3 (win points) -> +2
      // Final total score: 20 + 2 = 22
      // Streak: 3
      // Best score: 22
      stats = await harness.getStatsState();
      expect(stats.streak).toBe(3);
      expect(stats.score).toBe(22);
      expect(stats.best).toBe(22);

      // Verify persisted in DB
      const persistedStats = await loadStats();
      expect(persistedStats.streak).toBe(3);
      expect(persistedStats.score).toBe(22);
      expect(persistedStats.highScore).toBe(22);
    } finally {
      await harness.cleanup();
    }
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  setupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';

describe('Wordup PWA E2E Sanity Test', () => {
  beforeEach(() => {
    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE']);
  });

  it('should play a full winning game, reload, and verify state persistence', async () => {
    const harness = await setupE2ETest();

    try {
      // 1. Verify initial playing state
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');

      // 2. Type a near-miss guess: "APPLY"
      await harness.typeWord('APPLY');
      
      // Verify letters are typed in active row inputs
      let grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);

      // Submit the guess
      await harness.clickButton('GUESS!');

      // Verify the guess colors are applied
      grid = await harness.getGridState();
      expect(grid[0][0].status).toBe('correct'); // A
      expect(grid[0][1].status).toBe('correct'); // P
      expect(grid[0][2].status).toBe('correct'); // P
      expect(grid[0][3].status).toBe('correct'); // L
      expect(grid[0][4].status).toBe('absent');  // Y

      // 3. Type the correct guess: "APPLE"
      await harness.typeWord('APPLE');
      await harness.clickButton('GUESS!');

      // Verify game won
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      expect(status.title).toBe('VICTORY!');

      // Verify stats updated (streak and score should be > 0)
      let stats = await harness.getStatsState();
      expect(stats.streak).toBe(1);
      expect(stats.score).toBeGreaterThan(0);

      // 4. Simulate page reload to test persistence
      await harness.reloadPage();

      // After reload, game should restore to the won state, keeping the same grid and stats
      status = await harness.getAppStatus();
      expect(status.status).toBe('won');
      expect(status.title).toBe('VICTORY!');

      stats = await harness.getStatsState();
      expect(stats.streak).toBe(1);
      expect(stats.score).toBeGreaterThan(0);

      grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);
      expect(grid[1].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'E']);
    } finally {
      harness.cleanup();
    }
  });
});

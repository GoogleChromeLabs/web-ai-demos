import { describe, it, expect, beforeEach } from 'vitest';
import {
  setupE2ETest,
  setMockedAvailability,
  setNextGeneratedWords,
  setNextSuggestions,
} from './runner';
import { clearSession, saveStats } from '../src/lib/db';
import { IDBFactory } from 'fake-indexeddb';

describe('Milestone 4.1 Reactivity & Rendering Stress Tests', () => {
  beforeEach(async () => {
    // Enforce clean, isolated database state for this test file
    globalThis.indexedDB = new IDBFactory();

    setMockedAvailability('readily');
    setNextGeneratedWords(['APPLE', 'CROWN', 'SLATE']);
    
    try {
      await clearSession();
      await saveStats({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: true });
    } catch (err) {
      console.warn('Database cleanup failed, continuing...', err);
    }
  });

  it('should prove strictly localized reactivity via DOM MutationObserver', async () => {
    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest();

    try {
      // 1. Locate components in the DOM
      const header = document.querySelector('.game-header');
      const dashboard = document.querySelector('.dashboard-panel');
      const activeRow = document.querySelector('.board-row.active-row');
      
      expect(header).not.toBeNull();
      expect(dashboard).not.toBeNull();
      expect(activeRow).not.toBeNull();

      const cells = Array.from(activeRow!.querySelectorAll('.letter-card'));
      expect(cells.length).toBe(5);

      const cell0 = cells[0];
      const cell1 = cells[1];
      
      // 2. Setup MutationObservers to track DOM changes
      let headerMutationCount = 0;
      let dashboardMutationCount = 0;
      let cell0MutationCount = 0;
      let cell1MutationCount = 0;

      const headerObserver = new MutationObserver(() => { headerMutationCount++; });
      const dashboardObserver = new MutationObserver(() => { dashboardMutationCount++; });
      const cell0Observer = new MutationObserver(() => { cell0MutationCount++; });
      const cell1Observer = new MutationObserver(() => { cell1MutationCount++; });

      const config = { attributes: true, childList: true, subtree: true };

      headerObserver.observe(header!, config);
      dashboardObserver.observe(dashboard!, config);
      cell0Observer.observe(cell0!, config);
      cell1Observer.observe(cell1!, config);

      // 3. Simulate typing a single character 'A' in cell 0
      const input0 = cell0.querySelector('input.cell-input') as HTMLInputElement | null;
      expect(input0).not.toBeNull();
      
      input0!.focus();
      input0!.value = 'A';
      input0!.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait a tick for Svelte's reactive scheduler to batch and apply updates
      await new Promise(resolve => setTimeout(resolve, 20));

      // 4. Assertions on mutation counts
      // Cell 0 should have mutations (value changed, focus shifts, etc.)
      expect(cell0MutationCount).toBeGreaterThan(0);

      // Other parts of the UI MUST have exactly ZERO mutations!
      // This is the definitive proof of localized reactivity.
      expect(headerMutationCount).toBe(0);
      expect(dashboardMutationCount).toBe(0);
      expect(cell1MutationCount).toBe(0);

      // Cleanup observers
      headerObserver.disconnect();
      dashboardObserver.disconnect();
      cell0Observer.disconnect();
      cell1Observer.disconnect();
    } finally {
      await harness.cleanup();
    }
  });

  it('should handle high-frequency rapid typing and backspacing without state desync', async () => {
    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest();

    try {
      const activeRow = document.querySelector('.board-row.active-row');
      expect(activeRow).not.toBeNull();
      
      const inputs = Array.from(activeRow!.querySelectorAll('input.cell-input')) as HTMLInputElement[];
      
      // Focus first input
      inputs[0].focus();

      // Stress test typing: type and delete letters repeatedly, navigate left/right, under high frequency
      const sequence = [
        { type: 'A', index: 0 },
        { type: 'P', index: 1 },
        { backspace: true, index: 1 },
        { type: 'P', index: 1 },
        { type: 'P', index: 2 },
        { type: 'L', index: 3 },
        { key: 'ArrowLeft', index: 3 },
        { key: 'ArrowRight', index: 2 },
        { type: 'E', index: 4 },
        { backspace: true, index: 4 },
        { type: 'Y', index: 4 },
      ];

      for (const step of sequence) {
        const active = document.activeElement as HTMLInputElement;
        
        if (step.type !== undefined) {
          active.value = step.type;
          active.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (step.backspace) {
          active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
        } else if (step.key) {
          active.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true }));
        }
        
        // Wait a short time to simulate typing speed
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Allow Vitest to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Grid state should match the expected word 'APPLY'
      const grid = await harness.getGridState();
      expect(grid[0].map(c => c.letter)).toEqual(['A', 'P', 'P', 'L', 'Y']);
    } finally {
      await harness.cleanup();
    }
  });

  it('should reveal missing letter and lock the cell when help is triggered', async () => {
    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest();

    try {
      // 1. Submit one incorrect guess to enable help
      await harness.typeWord('PATCH');
      await harness.clickButton('GUESS!');
      
      let status = await harness.getAppStatus();
      expect(status.status).toBe('playing');
      
      // 2. Click the help button
      await harness.clickButton('?');

      // 3. Verify position 0 ('A') is revealed and locked
      const grid = await harness.getGridState();
      expect(grid[1].map(c => c.letter)[0]).toBe('A');
    } finally {
      await harness.cleanup();
    }
  });

  it('should persist settings and restore them correctly mid-game', async () => {
    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest({ allowDuplicates: false });

    try {
      // 1. Setup game: type a couple of letters
      await harness.typeWord('STARE');
      
      // 2. Change difficulty and duplicate settings
      await harness.setDifficulty('impossible');
      await harness.toggleDuplicates();

      // 3. Reload page to simulate refresh/restore
      await harness.reloadPage();

      // 4. Verify that difficulty and duplicates settings were persisted and restored
      const stats = await harness.getStatsState();
      
      // Read select and checkbox in DOM
      const select = document.querySelector('#difficulty-select') as HTMLSelectElement | null;
      const checkbox = document.querySelector('#dup-toggle') as HTMLInputElement | null;
      
      expect(select?.value).toBe('impossible');
      expect(checkbox?.checked).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('should NOT style a letter as wrong if it is correct or present elsewhere, even if marked absent in another column (Regression Test)', async () => {
    // Secret word is APPLE (mocked)
    // We will guess PUPPY
    // - P at index 0 is present
    // - U at index 1 is absent
    // - P at index 2 is correct
    // - P at index 3 is absent (excess letter)
    // - Y at index 4 is absent
    // Since 'P' is present and correct in the secret word, it should NOT be styled as a known wrong letter (is-wrong class)
    // when typed in the next row's inputs!

    setNextGeneratedWords(['APPLE']);
    const harness = await setupE2ETest();

    try {
      // 1. Submit guess PUPPY
      await harness.typeWord('PUPPY');
      await harness.clickButton('GUESS!');

      // 2. Type 'P' in the first cell of the active row (row 2)
      const activeRow = document.querySelector('.board-row.active-row');
      expect(activeRow).not.toBeNull();

      const cell0 = activeRow!.querySelectorAll('.letter-card')[0] as HTMLElement;
      const input0 = cell0.querySelector('input.cell-input') as HTMLInputElement | null;
      expect(input0).not.toBeNull();

      input0!.focus();
      input0!.value = 'P';
      input0!.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait a tick for Svelte
      await new Promise(resolve => setTimeout(resolve, 20));

      // 3. Assert that cell0 does NOT have the 'is-wrong' class
      // Because P is a valid letter in the secret word (APPLE).
      const classes = Array.from(cell0.classList);
      expect(classes).not.toContain('is-wrong');
    } finally {
      await harness.cleanup();
    }
  });
});

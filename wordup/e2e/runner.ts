import { mount, unmount, tick } from 'svelte';
import App from '../src/App.svelte';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB, saveStats } from '../src/lib/db';
import { vi } from 'vitest';

// Types and Interfaces for LanguageModel
declare global {
  interface LanguageModel {
    availability(): Promise<'readily' | 'after-download' | 'unavailable'>;
    create(options?: any): Promise<LanguageModelSession>;
  }
  interface LanguageModelSession {
    prompt(text: string): Promise<string>;
    destroy(): void;
  }
  var LanguageModel: LanguageModel;
}

// Global Mock State
const mockState = {
  availability: 'readily' as 'readily' | 'after-download' | 'unavailable',
  nextGeneratedWords: [] as string[],
  nextSuggestions: null as string[] | null,
};

// Mock LanguageModel Implementation
class MockLanguageModelSession implements LanguageModelSession {
  async prompt(text: string): Promise<string> {
    if (text.includes("Generate exactly 20 different 5-letter English words")) {
      if (mockState.nextGeneratedWords.length > 0) {
        return mockState.nextGeneratedWords.join(', ');
      }
      return 'APPLE, BANAN, ORANG, GRAPE, PEACH';
    } else if (text.includes("suggest 15 valid, actual English words")) {
      if (mockState.nextSuggestions !== null) {
        return mockState.nextSuggestions.join(', ');
      }
      return 'APPLE, GRAPE, PEACH';
    }
    return '';
  }
  destroy() {}
}

const MockLanguageModel: LanguageModel = {
  async availability() {
    return mockState.availability;
  },
  async create(options?: any) {
    return new MockLanguageModelSession();
  }
};

// Expose mock to globalThis
globalThis.LanguageModel = MockLanguageModel;

// Helper functions to control the mock
export function setMockedAvailability(status: 'readily' | 'after-download' | 'unavailable') {
  mockState.availability = status;
}

export function setNextGeneratedWords(words: string[]) {
  mockState.nextGeneratedWords = [...words];
}

export function setNextSuggestions(suggestions: string[] | null) {
  mockState.nextSuggestions = suggestions ? [...suggestions] : null;
}

// Types for Grid Cell and App Status
export interface GridCellState {
  letter: string;
  status: 'correct' | 'present' | 'absent' | 'empty' | 'input' | string;
  classes: string[];
}

export interface AppStatus {
  status: 'playing' | 'won' | 'lost' | 'loading' | 'error';
  title: string;
  message: string;
  hintError: string | null;
}

// setupE2ETest implementation
export async function setupE2ETest(options?: {
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
  // Enforce clean, uncontaminated global LanguageModel mock
  if (!options?.skipMockReset) {
    globalThis.LanguageModel = MockLanguageModel;
  }

  // Reset mock state
  mockState.availability = options?.availability ?? 'readily';
  mockState.nextSuggestions = null;

  // Mock Canvas 2D Context for JSDOM
  const mockCtx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);

  // Enforce clean, isolated database state for this test
  await closeDB();
  globalThis.indexedDB = new IDBFactory();

  // Initialize with customizable stats, defaulting to allowDuplicates: true
  if (!options?.skipDbInit) {
    await saveStats({
      streak: options?.streak ?? 0,
      score: options?.score ?? 0,
      highScore: options?.highScore ?? 0,
      difficulty: options?.difficulty ?? 'easy',
      allowDuplicates: options?.allowDuplicates ?? true
    });
  }

  let currentContainer: HTMLDivElement | null = document.createElement('div');
  document.body.appendChild(currentContainer);

  let currentAppInstance: any = mount(App, { target: currentContainer });
  await tick(); // Wait for onMount
  
  if (!options?.skipWait) {
    await waitForLoading(); // Wait for async database init to complete and render the active row
  }

  // Helper: type a word cell-by-cell
  async function typeWord(word: string) {
    if (word.length !== 5) {
      throw new Error(`Word must be exactly 5 letters long: "${word}"`);
    }

    const activeRow = currentContainer?.querySelector('.board-row.active-row');
    if (!activeRow) {
      throw new Error('Active row not found in DOM');
    }

    const cards = Array.from(activeRow.querySelectorAll('.letter-card'));
    for (let i = 0; i < 5; i++) {
      const card = cards[i];
      if (!card) continue;
      
      const input = card.querySelector('input.cell-input') as HTMLInputElement | null;
      if (input && !input.disabled) {
        input.value = word[i].toUpperCase();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
      }
    }
  }

  // Helper: trigger a keyboard event on the active element
  async function pressKey(key: string) {
    let activeEl = document.activeElement as HTMLInputElement | null;
    
    // Auto-focus first empty non-disabled cell input if not focused
    if (!activeEl || !activeEl.classList.contains('cell-input')) {
      const activeRow = currentContainer?.querySelector('.board-row.active-row');
      const firstInput = activeRow?.querySelector('input.cell-input:not([disabled])') as HTMLInputElement | null;
      if (firstInput) {
        firstInput.focus();
        activeEl = firstInput;
      }
    }

    if (activeEl && activeEl.classList.contains('cell-input')) {
      if (/^[a-zA-Z]$/.test(key)) {
        // Simulating character typing in JSDOM:
        // 1. Set the value
        activeEl.value = key.toUpperCase();
        // 2. Dispatch input event
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
      } else {
        // Dispatch keydown event for control keys (Backspace, Enter, etc.)
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await tick();
      }
    } else {
      const el = activeEl || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await tick();
    }
  }

  // Helper: click a button matching the label (RegExp or string)
  async function clickButton(labelRegex: RegExp | string) {
    if (!currentContainer) throw new Error('Container not mounted');
    const elements = Array.from(
      currentContainer.querySelectorAll('button, [role="button"], label, input[type="button"], input[type="submit"]')
    );
    const match = elements.find(el => {
      const text = el.textContent?.trim() || '';
      if (typeof labelRegex === 'string') {
        return text.toUpperCase().includes(labelRegex.toUpperCase());
      } else {
        return labelRegex.test(text);
      }
    });

    if (!match) {
      throw new Error(`Button or clickable element matching "${labelRegex}" not found`);
    }

    match.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    await waitForLoading();
  }

  // Helper: extract grid state
  async function getGridState(): Promise<GridCellState[][]> {
    if (!currentContainer) return [];
    const rows = Array.from(currentContainer.querySelectorAll('.board-row'));
    return rows.map(row => {
      const cards = Array.from(row.querySelectorAll('.letter-card'));
      return cards.map(card => {
        const input = card.querySelector('input.cell-input') as HTMLInputElement | null;
        const letter = input ? input.value : (card.querySelector('.letter-text')?.textContent?.trim() || '');
        const classes = Array.from(card.classList);
        
        let status = 'empty';
        if (classes.includes('correct')) status = 'correct';
        else if (classes.includes('present')) status = 'present';
        else if (classes.includes('absent')) status = 'absent';
        else if (classes.includes('empty')) status = 'empty';
        else if (classes.includes('input-card')) status = 'input';

        return { letter, status, classes };
      });
    });
  }

  // Helper: extract stats state
  async function getStatsState() {
    if (!currentContainer) return { streak: 0, score: 0, best: 0 };
    const statBoxes = Array.from(currentContainer.querySelectorAll('.stat-box'));
    let streak = 0;
    let score = 0;
    let best = 0;

    statBoxes.forEach(box => {
      const label = box.querySelector('.stat-label')?.textContent?.trim().toUpperCase();
      const valText = box.querySelector('.stat-val')?.textContent?.trim() || '';
      const val = parseInt(valText.replace(/[^0-9]/g, ''), 10) || 0;

      if (label === 'STREAK') streak = val;
      else if (label === 'SCORE') score = val;
      else if (label === 'BEST') best = val;
    });

    return { streak, score, best };
  }

  // Helper: extract AI suggestions
  async function getSuggestions(): Promise<string[]> {
    if (!currentContainer) return [];
    const bubbles = Array.from(currentContainer.querySelectorAll('.suggestion-bubble'));
    return bubbles.map(bubble => bubble.textContent?.trim() || '');
  }

  // Helper: click a specific suggestion bubble
  async function clickSuggestion(word: string) {
    if (!currentContainer) throw new Error('Container not mounted');
    const bubbles = Array.from(currentContainer.querySelectorAll('.suggestion-bubble'));
    const match = bubbles.find(bubble => bubble.textContent?.trim().toUpperCase() === word.toUpperCase());
    if (!match) {
      throw new Error(`Suggestion bubble for word "${word}" not found`);
    }
    match.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
  }

  // Helper: change difficulty
  async function setDifficulty(level: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible') {
    if (!currentContainer) throw new Error('Container not mounted');
    const select = currentContainer.querySelector('#difficulty-select') as HTMLSelectElement | null;
    if (!select) throw new Error('Difficulty select not found');
    select.value = level;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  }

  // Helper: toggle duplicate letters
  async function toggleDuplicates() {
    if (!currentContainer) throw new Error('Container not mounted');
    const checkbox = currentContainer.querySelector('#dup-toggle') as HTMLInputElement | null;
    if (!checkbox) throw new Error('Duplicates toggle checkbox not found');
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  }

  // Helper: get app overlay and status messages
  async function getAppStatus(): Promise<AppStatus> {
    if (!currentContainer) {
      return { status: 'loading', title: '', message: '', hintError: null };
    }

    const gameOverPanel = currentContainer.querySelector('.game-over-panel');
    const loadingPanel = currentContainer.querySelector('.game-loading-panel');
    const errorPanel = currentContainer.querySelector('.game-error-panel');
    const hintError = currentContainer.querySelector('.hint-error-notice');

    let status: AppStatus['status'] = 'playing';
    let title = '';
    let message = '';

    if (gameOverPanel) {
      status = gameOverPanel.classList.contains('won') ? 'won' : 'lost';
      title = gameOverPanel.querySelector('.game-over-title')?.textContent?.trim() || '';
      message = gameOverPanel.querySelector('.game-over-text')?.textContent?.trim() || '';
    } else if (loadingPanel) {
      status = 'loading';
      title = loadingPanel.querySelector('.game-loading-title')?.textContent?.trim() || '';
      message = loadingPanel.querySelector('.game-loading-text')?.textContent?.trim() || '';
    } else if (errorPanel) {
      status = 'error';
      title = errorPanel.querySelector('.game-error-title')?.textContent?.trim() || '';
      message = errorPanel.querySelector('.game-error-text')?.textContent?.trim() || '';
    }

    return {
      status,
      title,
      message,
      hintError: hintError?.textContent?.trim() || null,
    };
  }

  // Helper: reload page (simulate unmount and remount, keeping IndexedDB)
  async function reloadPage() {
    if (currentAppInstance) {
      unmount(currentAppInstance);
      currentAppInstance = null;
    }
    if (currentContainer) {
      currentContainer.innerHTML = '';
    } else {
      currentContainer = document.createElement('div');
      document.body.appendChild(currentContainer);
    }
    currentAppInstance = mount(App, { target: currentContainer });
    await tick();
    await waitForLoading();
  }

  async function waitForLoading() {
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const status = await getAppStatus();
      if (status.status !== 'loading') {
        break;
      }
      await tick();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  async function waitForSuggestions(): Promise<string[]> {
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const list = await getSuggestions();
      if (list.length > 0) {
        return list;
      }
      await tick();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return getSuggestions();
  }

  async function waitForHelpButtonActive() {
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      if (!currentContainer?.querySelector('.thinking-loader')) {
        await tick();
        return;
      }
      await tick();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  async function waitForHintError(): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const status = await getAppStatus();
      if (status.hintError) {
        return status.hintError;
      }
      await tick();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const finalStatus = await getAppStatus();
    if (!finalStatus.hintError) {
      console.log("TIMEOUT DOM CONTENT IN waitForHintError:", currentContainer?.innerHTML);
    }
    return finalStatus.hintError || '';
  }

  // Helper: clean up DOM and unmount app
  async function cleanup() {
    if (currentAppInstance) {
      unmount(currentAppInstance);
      currentAppInstance = null;
    }
    if (currentContainer) {
      currentContainer.remove();
      currentContainer = null;
    }
    await closeDB();
  }

  await waitForLoading();

  async function getActiveRow(): Promise<string[]> {
    if (!currentContainer) return ['', '', '', '', ''];
    const activeRow = currentContainer.querySelector('.board-row.active-row');
    if (!activeRow) return ['', '', '', '', ''];
    const cards = Array.from(activeRow.querySelectorAll('.letter-card'));
    return cards.map(card => {
      const input = card.querySelector('input.cell-input') as HTMLInputElement | null;
      return input ? input.value : (card.querySelector('.letter-text')?.textContent?.trim() || '');
    });
  }

  return {
    typeWord,
    pressKey,
    clickButton,
    getGridState,
    getActiveRow,
    getStatsState,
    getSuggestions,
    clickSuggestion,
    setDifficulty,
    toggleDuplicates,
    getAppStatus,
    reloadPage,
    cleanup,
    waitForSuggestions,
    waitForHintError,
    waitForHelpButtonActive,
  };
}

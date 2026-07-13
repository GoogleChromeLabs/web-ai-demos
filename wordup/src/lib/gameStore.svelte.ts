import {
  loadStats,
  loadSession,
  getWordHistory,
  type LetterCell
} from './db';
import { generateWord } from './promptClient';
import type { GameState, GameStore } from './gameStoreTypes';
import {
  safeSaveStats,
  safeSaveSession,
  safeClearSession,
  safeAddToHistory,
  safeSaveGameOutcome
} from './gameStoreDb';
import {
  evaluateGuess,
  calculatePoints,
  getSyncedActiveRow,
  resolveSessionState
} from './gameStoreHelpers';

declare const process: { env: { DEBUG?: string } };

export function createGameStore(): GameStore {
  // Private variables (Securely hidden from outside window/inspections)
  let secretWord = '';
  let activeGenerationId = 0;

  // Reactive states using Svelte 5 runes
  let guesses = $state<LetterCell[][]>([]);
  let activeRow = $state<string[]>(['', '', '', '', '']);
  let isLocked = $state<boolean[]>([false, false, false, false, false]);
  let gameStatus = $state<'loading' | 'playing' | 'won' | 'lost' | 'error'>('loading');
  let errorMessage = $state<string>('');
  let streak = $state<number>(0);
  let score = $state<number>(0);
  let highScore = $state<number>(0);
  let difficulty = $state<'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible'>('hard');
  let allowDuplicates = $state<boolean>(false);
  let activeDifficulty = $state<'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible'>('hard');
  let activeAllowDuplicates = $state<boolean>(false);
  let helpActionsUsed = $state<number>(0);
  let shakeCells = $state<boolean[]>([false, false, false, false, false]);
  let downloadProgress = $state<number | null>(null);

  function syncLockedColumns() {
    activeRow = getSyncedActiveRow(isLocked, secretWord);
  }

  async function init() {
    const generationId = ++activeGenerationId;
    try {
      gameStatus = 'loading';
      errorMessage = '';
      const stats = await loadStats();
      if (generationId !== activeGenerationId) return;
      streak = stats?.streak || 0;
      score = stats?.score || 0;
      highScore = stats?.highScore || 0;

      if (stats?.difficulty) {
        difficulty = stats.difficulty;
      }
      if (stats?.allowDuplicates !== undefined) {
        allowDuplicates = stats.allowDuplicates;
      }

      const saved = await loadSession();
      if (generationId !== activeGenerationId) return;
      const history = await getWordHistory();
      if (generationId !== activeGenerationId) return;

      const resolved = resolveSessionState(saved, stats?.difficulty || 'hard', stats?.allowDuplicates || false);

      if (resolved.shouldClearCorrupt) {
        await safeClearSession();
      }

      guesses = resolved.guesses;
      activeRow = resolved.activeRow;
      isLocked = resolved.isLocked;
      secretWord = resolved.secretWord;
      helpActionsUsed = resolved.helpActionsUsed;
      activeDifficulty = resolved.difficulty;
      activeAllowDuplicates = resolved.allowDuplicates;
      let targetStatus = resolved.gameStatus;

      if (!secretWord) {
        downloadProgress = null;
        const word = await generateWord(activeDifficulty, activeAllowDuplicates, history, (loaded, total) => {
          const ratio = loaded / total;
          downloadProgress = ratio < 1 ? ratio : null;
        });
        if (generationId !== activeGenerationId) return;
        secretWord = word.toUpperCase();
        downloadProgress = null;
        await safeSaveSession({
          guesses: $state.snapshot(guesses),
          activeRow: $state.snapshot(activeRow),
          isLocked: $state.snapshot(isLocked),
          gameStatus: targetStatus,
          secretWord,
          helpActionsUsed,
          difficulty: activeDifficulty,
          allowDuplicates: activeAllowDuplicates
        });
        if (generationId !== activeGenerationId) return;
      }

      gameStatus = targetStatus;
    } catch (err: any) {
      if (generationId !== activeGenerationId) return;
      gameStatus = 'error';
      errorMessage = err.message || 'Failed to initialize the game.';
      console.error('Game initialization failed:', err);
    }
  }

  function addLetter(char: string, index?: number) {
    if (gameStatus !== 'playing') return;
    if (!/^[a-zA-Z]$/.test(char)) return;
    
    let targetIndex = (index !== undefined && index >= 0 && index < 5 && !isLocked[index])
      ? index
      : activeRow.findIndex((c, i) => c === '' && !isLocked[i]);

    if (targetIndex === -1) return;

    const cleanChar = char.toUpperCase();
    if (!activeAllowDuplicates) {
      const existingIdx = activeRow.findIndex(c => c === cleanChar);
      if (existingIdx !== -1 && existingIdx !== targetIndex) {
        shakeCells[existingIdx] = true;
        setTimeout(() => {
          shakeCells[existingIdx] = false;
        }, 400);
        return; // Reject duplicate input
      }
    }

    activeRow[targetIndex] = cleanChar;
  }

  function deleteLetter(index?: number) {
    if (gameStatus !== 'playing') return;
    if (index !== undefined && index >= 0 && index < 5) {
      if (!isLocked[index]) {
        activeRow[index] = '';
      }
      return;
    }

    let targetIndex = -1;
    for (let i = 4; i >= 0; i--) {
      if (activeRow[i] !== '' && !isLocked[i]) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex !== -1) {
      activeRow[targetIndex] = '';
    }
  }

  async function submitGuess() {
    if (gameStatus !== 'playing') return;
    if (activeRow.some(c => c === '')) return;

    const guessStr = activeRow.join('').toUpperCase();
    
    const { guessCells, newIsLocked } = evaluateGuess(activeRow, secretWord, isLocked);
    
    if (typeof process !== 'undefined' && process.env.DEBUG === '1') {
      console.log('[DEBUG] Secret Word:', secretWord, 'Guess:', guessStr, 'Evaluation:', JSON.stringify(guessCells));
    }

    guesses.push(guessCells);
    isLocked = newIsLocked;

    if (guessStr === secretWord.toUpperCase()) {
      gameStatus = 'won';
      streak += 1;

      const attemptsUsed = guesses.length;
      const pointsEarned = calculatePoints(attemptsUsed);
      score += pointsEarned;

      if (score > highScore) highScore = score;

      await safeSaveGameOutcome(
        { streak, score, highScore, difficulty, allowDuplicates },
        {
          guesses: $state.snapshot(guesses),
          activeRow: $state.snapshot(activeRow),
          isLocked: $state.snapshot(isLocked),
          gameStatus: 'won',
          secretWord,
          helpActionsUsed,
          difficulty: activeDifficulty,
          allowDuplicates: activeAllowDuplicates
        },
        secretWord
      );
    } else if (guesses.length >= 5) {
      gameStatus = 'lost';
      streak = 0;
      score = 0;
      await safeSaveGameOutcome(
        { streak, score, highScore, difficulty, allowDuplicates },
        {
          guesses: $state.snapshot(guesses),
          activeRow: $state.snapshot(activeRow),
          isLocked: $state.snapshot(isLocked),
          gameStatus: 'lost',
          secretWord,
          helpActionsUsed,
          difficulty: activeDifficulty,
          allowDuplicates: activeAllowDuplicates
        },
        secretWord
      );
    } else {
      syncLockedColumns();
      await safeSaveSession({
        guesses: $state.snapshot(guesses),
        activeRow: $state.snapshot(activeRow),
        isLocked: $state.snapshot(isLocked),
        gameStatus: 'playing',
        secretWord,
        helpActionsUsed,
        difficulty: activeDifficulty,
        allowDuplicates: activeAllowDuplicates
      });
    }
  }

  function revealWord(): string {
    if (gameStatus === 'playing') {
      throw new Error('Cannot reveal secret word while game is active.');
    }
    return secretWord.toUpperCase();
  }

  function fillActiveRow(word: string) {
    if (gameStatus !== 'playing') return;
    const chars = word.toUpperCase().split('');
    for (let i = 0; i < 5; i++) {
      if (!isLocked[i] && chars[i]) {
        activeRow[i] = chars[i];
      }
    }
  }

  function getCanUseHelp(): boolean {
    if (gameStatus !== 'playing') return false;
    if (guesses.length === 0) return false;
    if (helpActionsUsed >= 3) return false;
    const unrevealedIndices = [0, 1, 2, 3, 4].filter(i => !isLocked[i]);
    return unrevealedIndices.length > 1;
  }

  async function useHelpAction(): Promise<boolean> {
    if (!getCanUseHelp()) return false;

    const unrevealedIndices = [0, 1, 2, 3, 4].filter(i => !isLocked[i]);
    const chosenIndex = unrevealedIndices[0];

    isLocked[chosenIndex] = true;
    activeRow[chosenIndex] = secretWord[chosenIndex].toUpperCase();

    helpActionsUsed += 1;
    score = Math.max(0, score - 1);
    await safeSaveStats({ streak, score, highScore, difficulty, allowDuplicates });
    await safeSaveSession({
      guesses: $state.snapshot(guesses),
      activeRow: $state.snapshot(activeRow),
      isLocked: $state.snapshot(isLocked),
      gameStatus: 'playing',
      secretWord,
      helpActionsUsed,
      difficulty: activeDifficulty,
      allowDuplicates: activeAllowDuplicates
    });

    return true;
  }

  async function forceNewGame() {
    const isAbandoning = gameStatus === 'playing' && guesses.length > 0;
    if (isAbandoning) {
      streak = 0;
      score = 0;
    }

    gameStatus = 'loading';
    errorMessage = '';
    try {
      await safeClearSession();
      secretWord = '';
      guesses = [];
      isLocked = [false, false, false, false, false];
      activeRow = ['', '', '', '', ''];
      helpActionsUsed = 0;
      shakeCells = [false, false, false, false, false];
      activeDifficulty = difficulty;
      activeAllowDuplicates = allowDuplicates;

      if (isAbandoning) {
        await safeSaveStats({ streak, score, highScore, difficulty, allowDuplicates });
      }

      await init();
    } catch (err: any) {
      gameStatus = 'error';
      errorMessage = err.message || 'Failed to start a new game.';
    }
  }

  const stableState: GameState = {
    get guesses() { return guesses; },
    get activeRow() { return activeRow; },
    get isLocked() { return isLocked; },
    get gameStatus() { return gameStatus; },
    get errorMessage() { return errorMessage; },
    get streak() { return streak; },
    get score() { return score; },
    get highScore() { return highScore; },
    get difficulty() { return difficulty; },
    get allowDuplicates() { return allowDuplicates; },
    get activeAllowDuplicates() { return activeAllowDuplicates; },
    get helpActionsUsed() { return helpActionsUsed; },
    get shakeCells() { return shakeCells; },
    get downloadProgress() { return downloadProgress; }
  };

  return {
    get state(): GameState {
      return stableState;
    },

    get difficulty() { return difficulty; },
    set difficulty(val) {
      if (gameStatus === 'loading') return;
      difficulty = val;
      (async () => {
        await safeSaveStats({ streak, score, highScore, difficulty, allowDuplicates });
      })();
    },

    get allowDuplicates() { return allowDuplicates; },
    set allowDuplicates(val) {
      if (gameStatus === 'loading') return;
      allowDuplicates = val;
      (async () => {
        await safeSaveStats({ streak, score, highScore, difficulty, allowDuplicates });
      })();
    },

    init,
    addLetter,
    deleteLetter,
    submitGuess,
    revealWord,
    fillActiveRow,
    useHelpAction,
    get canUseHelp() { return getCanUseHelp(); },
    forceNewGame
  };
}

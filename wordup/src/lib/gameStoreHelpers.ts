import type { LetterCell, SavedSession } from './db';

export interface ResolvedSession {
  guesses: LetterCell[][];
  activeRow: string[];
  isLocked: boolean[];
  gameStatus: 'playing' | 'won' | 'lost';
  secretWord: string;
  helpActionsUsed: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
  allowDuplicates: boolean;
  shouldClearCorrupt: boolean;
}

/**
 * Evaluates the user's guess against the secret word and determines which columns are now locked.
 */
export function evaluateGuess(
  activeRow: string[],
  secretWord: string,
  currentIsLocked: boolean[]
): {
  guessCells: LetterCell[];
  newIsLocked: boolean[];
} {
  const guessStr = activeRow.join('').toUpperCase();
  const secretLetters = secretWord.toUpperCase().split('');
  const guessLetters = guessStr.split('');
  
  const guessCells: LetterCell[] = [];
  const newIsLocked = [...currentIsLocked];

  // Pre-fill correct matches first
  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === secretLetters[i]) {
      guessCells[i] = { letter: guessLetters[i], status: 'correct' };
      newIsLocked[i] = true;
      secretLetters[i] = '_'; // Consume
      guessLetters[i] = '';   // Clear
    }
  }

  // Then check present matches
  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === '') continue; // Already correct
    const matchIndex = secretLetters.indexOf(guessLetters[i]);
    if (matchIndex !== -1) {
      guessCells[i] = { letter: guessLetters[i], status: 'present' };
      secretLetters[matchIndex] = '_'; // Consume
    } else {
      guessCells[i] = { letter: guessLetters[i], status: 'absent' };
    }
  }

  return { guessCells, newIsLocked };
}

/**
 * Calculates points earned based on the number of attempts used.
 * 1st guess = 10 pts. Remainder: 1 pt per remaining guess + 1.
 */
export function calculatePoints(attemptsUsed: number): number {
  return attemptsUsed === 1 ? 10 : (6 - attemptsUsed + 1);
}

/**
 * Returns a new activeRow pre-populated with correctly placed (locked) letters from the secret word.
 */
export function getSyncedActiveRow(isLocked: boolean[], secretWord: string): string[] {
  const newActiveRow = ['', '', '', '', ''];
  for (let i = 0; i < 5; i++) {
    if (isLocked[i] && secretWord) {
      newActiveRow[i] = secretWord[i].toUpperCase();
    } else {
      newActiveRow[i] = '';
    }
  }
  return newActiveRow;
}

/**
 * Pure helper to resolve the session state from IndexedDB data or default values.
 */
export function resolveSessionState(
  saved: SavedSession | null,
  defaultDifficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible',
  defaultAllowDuplicates: boolean
): ResolvedSession {
  if (
    saved &&
    Array.isArray(saved.guesses) &&
    Array.isArray(saved.activeRow) &&
    Array.isArray(saved.isLocked) &&
    saved.secretWord
  ) {
    return {
      guesses: saved.guesses,
      activeRow: saved.activeRow,
      isLocked: saved.isLocked,
      gameStatus: saved.gameStatus,
      secretWord: saved.secretWord.toUpperCase(),
      helpActionsUsed: saved.helpActionsUsed || 0,
      difficulty: saved.difficulty || defaultDifficulty,
      allowDuplicates: saved.allowDuplicates !== undefined ? saved.allowDuplicates : defaultAllowDuplicates,
      shouldClearCorrupt: false
    };
  }

  return {
    guesses: [],
    activeRow: ['', '', '', '', ''],
    isLocked: [false, false, false, false, false],
    gameStatus: 'playing',
    secretWord: '',
    helpActionsUsed: 0,
    difficulty: defaultDifficulty,
    allowDuplicates: defaultAllowDuplicates,
    shouldClearCorrupt: saved !== null
  };
}


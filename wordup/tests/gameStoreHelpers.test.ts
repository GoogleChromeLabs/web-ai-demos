import { describe, it, expect } from 'vitest';
import {
  calculatePoints,
  getSyncedActiveRow,
  evaluateGuess
} from '../src/lib/gameStoreHelpers';
import type { LetterCell } from '../src/lib/db';

function isLetterKnownWrong(letter: string, guesses: LetterCell[][]): boolean {
  let found = false;
  let hasCorrectOrPresent = false;
  for (const row of guesses) {
    for (const cell of row) {
      if (cell.letter === letter) {
        found = true;
        if (cell.status === 'correct' || cell.status === 'present') {
          hasCorrectOrPresent = true;
        }
      }
    }
  }
  return found && !hasCorrectOrPresent;
}

describe('Game Store Helpers', () => {
  describe('isLetterKnownWrong', () => {
    it('should return true if a letter is absent in guesses and not correct/present anywhere else', () => {
      const guesses: LetterCell[][] = [
        [
          { letter: 'A', status: 'absent' },
          { letter: 'B', status: 'correct' },
          { letter: 'C', status: 'present' },
          { letter: 'D', status: 'absent' },
          { letter: 'E', status: 'absent' }
        ]
      ];
      expect(isLetterKnownWrong('A', guesses)).toBe(true);
      expect(isLetterKnownWrong('D', guesses)).toBe(true);
    });

    it('should return false if a letter is correct or present in any guess, even if absent in another', () => {
      const guesses: LetterCell[][] = [
        [
          { letter: 'A', status: 'absent' },
          { letter: 'B', status: 'correct' },
          { letter: 'C', status: 'present' }
        ],
        [
          { letter: 'A', status: 'correct' },
          { letter: 'B', status: 'absent' },
          { letter: 'C', status: 'absent' }
        ]
      ];
      // A is absent in row 0 but correct in row 1 -> not known wrong
      expect(isLetterKnownWrong('A', guesses)).toBe(false);
      // B is correct in row 0 but absent in row 1 -> not known wrong
      expect(isLetterKnownWrong('B', guesses)).toBe(false);
      // C is present in row 0 but absent in row 1 -> not known wrong
      expect(isLetterKnownWrong('C', guesses)).toBe(false);
    });

    it('should return false if a letter has never been guessed', () => {
      const guesses: LetterCell[][] = [
        [
          { letter: 'A', status: 'absent' }
        ]
      ];
      expect(isLetterKnownWrong('Z', guesses)).toBe(false);
    });
  });

  describe('calculatePoints', () => {
    it('should award 10 points for the first attempt', () => {
      expect(calculatePoints(1)).toBe(10);
    });

    it('should award correct decreasing points for subsequent attempts', () => {
      expect(calculatePoints(2)).toBe(5); // 6 - 2 + 1 = 5
      expect(calculatePoints(3)).toBe(4); // 6 - 3 + 1 = 4
      expect(calculatePoints(6)).toBe(1); // 6 - 6 + 1 = 1
    });
  });

  describe('getSyncedActiveRow', () => {
    it('should pre-populate only locked letters', () => {
      const isLocked = [true, false, true, false, false];
      const secretWord = 'APPLE';
      expect(getSyncedActiveRow(isLocked, secretWord)).toEqual(['A', '', 'P', '', '']);
    });
  });
});

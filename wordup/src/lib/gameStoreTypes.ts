import type { LetterCell } from './db';

export interface GameState {
  guesses: LetterCell[][];
  activeRow: string[];
  isLocked: boolean[];
  gameStatus: 'loading' | 'playing' | 'won' | 'lost' | 'error';
  errorMessage: string;
  streak: number;
  score: number;
  highScore: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
  allowDuplicates: boolean;
  activeAllowDuplicates: boolean;
  helpActionsUsed: number;
  shakeCells: boolean[];
  downloadProgress: number | null;
}

export interface GameStore {
  readonly state: GameState;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
  allowDuplicates: boolean;
  init(): Promise<void>;
  addLetter(char: string, index?: number): void;
  deleteLetter(index?: number): void;
  submitGuess(): Promise<void>;
  revealWord(): string;
  fillActiveRow(word: string): void;
  useHelpAction(): Promise<boolean>;
  readonly canUseHelp: boolean;
  forceNewGame(): Promise<void>;
}

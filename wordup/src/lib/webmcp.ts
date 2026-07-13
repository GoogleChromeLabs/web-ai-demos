import type { GameStore } from './gameStoreTypes';

export interface WebMCPRegisterToolOptions {
  signal?: AbortSignal;
}

export function registerWebMCPTools(game: GameStore, options?: WebMCPRegisterToolOptions) {
  const modelContext = (document as any).modelContext || (navigator as any).modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return;
  }

  const signal = options?.signal;

  // 1. start_new_game
  modelContext.registerTool(
    {
      name: 'start_new_game',
      description: 'Start a new WordUp game, optionally choosing the difficulty and duplicate letters settings.',
      inputSchema: {
        type: 'object',
        properties: {
          difficulty: {
            type: 'string',
            enum: ['easy', 'medium', 'hard', 'very_hard', 'impossible'],
            description: 'Difficulty level determining allowed guesses and secret word criteria.'
          },
          allowDuplicates: {
            type: 'boolean',
            description: 'Whether duplicate letters are permitted in secret words and guesses.'
          }
        }
      },
      async execute(input: { difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible'; allowDuplicates?: boolean } = {}) {
        if (input.difficulty) {
          game.difficulty = input.difficulty;
        }
        if (typeof input.allowDuplicates === 'boolean') {
          game.allowDuplicates = input.allowDuplicates;
        }
        await game.forceNewGame();
        return {
          status: game.state.gameStatus,
          difficulty: game.state.difficulty,
          allowDuplicates: game.state.allowDuplicates,
          message: 'Started a new game.'
        };
      }
    },
    { signal }
  );

  // 2. type_guess
  modelContext.registerTool(
    {
      name: 'type_guess',
      description: 'Type a 5-letter guess word into the active row of the game board.',
      inputSchema: {
        type: 'object',
        properties: {
          word: {
            type: 'string',
            description: 'The 5-letter word to type into the active input row.'
          }
        },
        required: ['word']
      },
      execute(input: { word: string }) {
        if (!input.word || typeof input.word !== 'string') {
          return { error: 'A valid 5-letter word string is required.' };
        }
        const word = input.word.trim().toUpperCase();
        if (word.length !== 5) {
          return { error: `Word must be exactly 5 letters long (received ${word.length}).` };
        }
        game.fillActiveRow(word);
        return {
          activeRow: [...game.state.activeRow],
          isLocked: [...game.state.isLocked]
        };
      }
    },
    { signal }
  );

  // 3. submit_guess
  modelContext.registerTool(
    {
      name: 'submit_guess',
      description: 'Submit the current 5-letter guess in the active row, optionally filling a word first.',
      inputSchema: {
        type: 'object',
        properties: {
          word: {
            type: 'string',
            description: 'Optional 5-letter word to type into active row before submitting.'
          }
        }
      },
      async execute(input?: { word?: string }) {
        if (input?.word) {
          const word = input.word.trim().toUpperCase();
          if (word.length !== 5) {
            return { error: `Word must be exactly 5 letters long (received ${word.length}).` };
          }
          game.fillActiveRow(word);
        }

        const currentActiveRow = [...game.state.activeRow];
        const hasEmptySlots = currentActiveRow.some(letter => !letter || letter.trim() === '');
        if (hasEmptySlots) {
          return {
            error: 'Cannot submit an incomplete guess. All 5 positions must contain a letter.',
            activeRow: currentActiveRow
          };
        }

        await game.submitGuess();
        const guessesCount = game.state.guesses.length;
        const lastGuessFeedback = guessesCount > 0 ? game.state.guesses[guessesCount - 1] : null;

        return {
          gameStatus: game.state.gameStatus,
          guessesCount,
          lastGuessFeedback,
          activeRow: [...game.state.activeRow],
          isLocked: [...game.state.isLocked]
        };
      }
    },
    { signal }
  );

  // 4. get_current_guess
  modelContext.registerTool(
    {
      name: 'get_current_guess',
      description: 'See the current active row letters typed so far and locked letter positions.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          activeRow: [...game.state.activeRow],
          isLocked: [...game.state.isLocked],
          gameStatus: game.state.gameStatus,
          guessesCount: game.state.guesses.length,
          canUseHelp: game.canUseHelp
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 5. apply_hint
  modelContext.registerTool(
    {
      name: 'apply_hint',
      description: 'Apply a help hint to reveal one missing letter in the right spot (costs 1 point).',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      async execute() {
        if (!game.canUseHelp) {
          return {
            success: false,
            message: 'Help is currently unavailable (first turn, 3 hints limit reached, or only 1 missing letter remains).'
          };
        }

        const prevLocked = [...game.state.isLocked];
        const success = await game.useHelpAction();
        const newLocked = [...game.state.isLocked];
        const newActiveRow = [...game.state.activeRow];

        let revealedIndex = -1;
        let revealedLetter = '';
        for (let i = 0; i < 5; i++) {
          if (!prevLocked[i] && newLocked[i]) {
            revealedIndex = i;
            revealedLetter = newActiveRow[i];
            break;
          }
        }

        return {
          success,
          revealedIndex,
          revealedLetter,
          activeRow: newActiveRow,
          isLocked: newLocked,
          helpActionsUsed: game.state.helpActionsUsed,
          score: game.state.score
        };
      }
    },
    { signal }
  );

  // 6. get_stats
  modelContext.registerTool(
    {
      name: 'get_stats',
      description: 'Load user game statistics including streak, current score, high score, and difficulty settings.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          streak: game.state.streak,
          score: game.state.score,
          highScore: game.state.highScore,
          difficulty: game.state.difficulty,
          allowDuplicates: game.state.allowDuplicates
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 7. get_previous_guesses
  modelContext.registerTool(
    {
      name: 'get_previous_guesses',
      description: 'Get an array, in order, of all previous guesses submitted so far in the active game.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          guesses: [...game.state.guesses],
          guessesCount: game.state.guesses.length
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 8. get_game_state
  modelContext.registerTool(
    {
      name: 'get_game_state',
      description: 'Get the overall current game state including an ordered list of previous guesses, current active row, locked positions, and game status.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          gameStatus: game.state.gameStatus,
          guesses: [...game.state.guesses],
          activeRow: [...game.state.activeRow],
          isLocked: [...game.state.isLocked],
          guessesCount: game.state.guesses.length,
          difficulty: game.state.difficulty,
          allowDuplicates: game.state.allowDuplicates,
          helpActionsUsed: game.state.helpActionsUsed,
          canUseHelp: game.canUseHelp
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 9. get_game_settings
  modelContext.registerTool(
    {
      name: 'get_game_settings',
      description: 'Get the current game settings including difficulty level and whether duplicate letters are allowed.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          difficulty: game.state.difficulty,
          allowDuplicates: game.state.allowDuplicates
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 10. get_settings
  modelContext.registerTool(
    {
      name: 'get_settings',
      description: 'Get the current game settings including difficulty level and whether duplicate letters are allowed.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        return {
          difficulty: game.state.difficulty,
          allowDuplicates: game.state.allowDuplicates
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 11. get_hints_info
  modelContext.registerTool(
    {
      name: 'get_hints_info',
      description: 'Get information on hint usage, including how many hints have been used and how many hints are left.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        const maxHints = 3;
        const hintsUsed = game.state.helpActionsUsed;
        const hintsRemaining = Math.max(0, maxHints - hintsUsed);
        return {
          hintsUsed,
          hintsRemaining,
          hintsLeft: hintsRemaining,
          maxHints,
          canUseHelp: game.canUseHelp
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );

  // 12. get_hint_status
  modelContext.registerTool(
    {
      name: 'get_hint_status',
      description: 'Get status on hints, including how many hints have been used and how many hints are left.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      execute() {
        const maxHints = 3;
        const hintsUsed = game.state.helpActionsUsed;
        const hintsRemaining = Math.max(0, maxHints - hintsUsed);
        return {
          hintsUsed,
          hintsRemaining,
          hintsLeft: hintsRemaining,
          maxHints,
          canUseHelp: game.canUseHelp
        };
      },
      annotations: { readOnlyHint: true }
    },
    { signal }
  );
}


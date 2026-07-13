import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGameStore } from '../src/lib/gameStore.svelte';
import { loadStats, saveStats, loadSession, saveSession, clearSession, addToWordHistory, getWordHistory, saveGameOutcome } from '../src/lib/db';
import { generateWord } from '../src/lib/promptClient';

// Mock db and promptClient
vi.mock('../src/lib/db', () => ({
  loadStats: vi.fn(),
  saveStats: vi.fn(),
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  clearSession: vi.fn().mockResolvedValue(undefined),
  addToWordHistory: vi.fn(),
  getWordHistory: vi.fn(),
  saveGameOutcome: vi.fn(),
}));

vi.mock('../src/lib/promptClient', () => ({
  generateWord: vi.fn(),
}));

describe('Game Store', () => {
  let mockStats: { streak: number; score: number; highScore: number; difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible'; allowDuplicates: boolean } = { streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: false };
  let mockSession: any = null;
  let mockHistory: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();

    mockStats = { streak: 0, score: 0, highScore: 0, difficulty: 'hard', allowDuplicates: false };
    mockSession = null;
    mockHistory = [];

    vi.mocked(loadStats).mockImplementation(async () => mockStats);
    vi.mocked(saveStats).mockImplementation(async (stats) => {
      mockStats = { ...mockStats, ...stats };
    });
    vi.mocked(loadSession).mockImplementation(async () => mockSession);
    vi.mocked(saveSession).mockImplementation(async (session) => {
      mockSession = session;
    });
    vi.mocked(clearSession).mockImplementation(async () => {
      mockSession = null;
    });
    vi.mocked(getWordHistory).mockImplementation(async () => mockHistory);
    vi.mocked(addToWordHistory).mockImplementation(async (word) => {
      mockHistory.push(word);
    });
    vi.mocked(saveGameOutcome).mockImplementation(async (stats, session, historyWord) => {
      mockStats = { ...mockStats, ...stats };
      mockSession = session;
      if (historyWord) {
        mockHistory.push(historyWord);
      }
    });
  });

  it('should initialize with default state and generate a word if no session exists', async () => {
    // Setup mocks
    vi.mocked(loadStats).mockResolvedValue({ streak: 2, score: 8, highScore: 10 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue(['REACT']);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Verify stats loaded
    expect(store.state.streak).toBe(2);
    expect(store.state.score).toBe(8);
    expect(store.state.highScore).toBe(10);

    // Verify game status and default active row
    expect(store.state.gameStatus).toBe('playing');
    expect(store.state.guesses).toEqual([]);
    expect(store.state.activeRow).toEqual(['', '', '', '', '']);
    expect(store.state.isLocked).toEqual([false, false, false, false, false]);

    // Verify generateWord called with difficulty, allowDuplicates, and history
    expect(generateWord).toHaveBeenCalledWith('hard', false, ['REACT'], expect.any(Function));

    // Verify session saved after generating new word
    expect(saveSession).toHaveBeenCalledWith({
      guesses: [],
      activeRow: ['', '', '', '', ''],
      isLocked: [false, false, false, false, false],
      gameStatus: 'playing',
      secretWord: 'SHINE',
      helpActionsUsed: 0,
      difficulty: 'hard',
      allowDuplicates: false
    });
  });

  it('should restore state and secret word from a saved session', async () => {
    // Setup mocks
    vi.mocked(loadStats).mockResolvedValue({ streak: 1, score: 5, highScore: 10 });
    vi.mocked(loadSession).mockResolvedValue({
      guesses: [
        [
          { letter: 'S', status: 'correct' },
          { letter: 'T', status: 'absent' },
          { letter: 'A', status: 'absent' },
          { letter: 'R', status: 'absent' },
          { letter: 'E', status: 'present' }
        ]
      ],
      activeRow: ['S', '', '', '', ''],
      isLocked: [true, false, false, false, false],
      gameStatus: 'playing',
      secretWord: 'SHINE',
      helpActionsUsed: 0,
      difficulty: 'hard',
      allowDuplicates: false
    });
    vi.mocked(getWordHistory).mockResolvedValue([]);

    const store = createGameStore();
    await store.init();

    // Verify states restored
    expect(store.state.gameStatus).toBe('playing');
    expect(store.state.guesses.length).toBe(1);
    expect(store.state.isLocked).toEqual([true, false, false, false, false]);
    expect(store.state.activeRow).toEqual(['S', '', '', '', '']);

    // generateWord should NOT have been called because session was loaded
    expect(generateWord).not.toHaveBeenCalled();
  });

  it('should allow adding and deleting letters in empty slots', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Add letters
    store.addLetter('a');
    store.addLetter('b');
    expect(store.state.activeRow).toEqual(['A', 'B', '', '', '']);

    // Delete letter
    store.deleteLetter();
    expect(store.state.activeRow).toEqual(['A', '', '', '', '']);

    // Add more
    store.addLetter('c');
    store.addLetter('d');
    store.addLetter('e');
    store.addLetter('f');
    expect(store.state.activeRow).toEqual(['A', 'C', 'D', 'E', 'F']);

    // Adding more than 5 shouldn't do anything
    store.addLetter('g');
    expect(store.state.activeRow).toEqual(['A', 'C', 'D', 'E', 'F']);
  });

  it('should process guess, lock correct columns, pre-fill them, and save session', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Guess 1: STARE
    'STARE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    // S (correct), T (absent), A (absent), R (absent), E (correct)
    expect(store.state.guesses[0]).toEqual([
      { letter: 'S', status: 'correct' },
      { letter: 'T', status: 'absent' },
      { letter: 'A', status: 'absent' },
      { letter: 'R', status: 'absent' },
      { letter: 'E', status: 'correct' }
    ]);

    // S is locked in column 0, E is locked in column 4!
    expect(store.state.isLocked).toEqual([true, false, false, false, true]);

    // Next active row should pre-fill 'S' in column 0 and 'E' in column 4
    expect(store.state.activeRow).toEqual(['S', '', '', '', 'E']);

    // Verify session saved with progress
    expect(saveSession).toHaveBeenLastCalledWith({
      guesses: [
        [
          { letter: 'S', status: 'correct' },
          { letter: 'T', status: 'absent' },
          { letter: 'A', status: 'absent' },
          { letter: 'R', status: 'absent' },
          { letter: 'E', status: 'correct' }
        ]
      ],
      activeRow: ['S', '', '', '', 'E'],
      isLocked: [true, false, false, false, true],
      gameStatus: 'playing',
      secretWord: 'SHINE',
      helpActionsUsed: 0,
      difficulty: 'hard',
      allowDuplicates: false
    });
  });

  it('should handle duplicate letters in guess correctly against single letter in secret word', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: true });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE'); // One 'E' at index 4

    const store = createGameStore();
    await store.init();

    // Guess: GEESE
    'GEESE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    // G (absent), E (absent), E (absent), S (present), E (correct)
    expect(store.state.guesses[0]).toEqual([
      { letter: 'G', status: 'absent' },
      { letter: 'E', status: 'absent' },
      { letter: 'E', status: 'absent' },
      { letter: 'S', status: 'present' },
      { letter: 'E', status: 'correct' }
    ]);
  });

  it('should secure the secret word and only reveal it when game is won or lost', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Secret word should not be revealable while playing
    expect(() => store.revealWord()).toThrow('Cannot reveal secret word while game is active.');

    // Win the game
    'SHINE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.gameStatus).toBe('won');
    // Secret word can now be revealed
    expect(store.revealWord()).toBe('SHINE');
  });

  it('should handle game win: update streak/score, save stats, add to history, clear session', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 3, score: 12, highScore: 15 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Win on 1st guess: 10 pts
    'SHINE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.gameStatus).toBe('won');
    expect(store.state.streak).toBe(4);
    expect(store.state.score).toBe(22); // 12 + 10 = 22
    expect(store.state.highScore).toBe(22); // 22 > 15

    expect(saveGameOutcome).toHaveBeenCalledWith(
      { streak: 4, score: 22, highScore: 22, difficulty: 'hard', allowDuplicates: false },
      expect.objectContaining({ gameStatus: 'won', secretWord: 'SHINE' }),
      'SHINE'
    );
  });

  it('should handle game loss: reset streak, save stats, add to history, clear session', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 5, score: 20, highScore: 20 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // 5 incorrect guesses
    for (let i = 0; i < 5; i++) {
      // Clear active row if there are locked columns (none here yet, but just in case)
      // Actually, let's just input a wrong word 'STARE'
      // Wait, since 'S' is correct, column 0 will lock to 'S' after the first guess.
      // So subsequent guesses must start with 'S'. Let's guess 'STONE', 'SLATE', 'SHARE', 'SHAPE'
      const guess = i === 0 ? 'STARE' : (i === 1 ? 'STONE' : (i === 2 ? 'SLATE' : (i === 3 ? 'SHARE' : 'SHAPE')));
      
      // Clear active row except locked columns.
      // Wait! store.addLetter only adds to empty slots.
      // After first guess 'STARE', isLocked = [true, false, false, false, false] (S is correct, E is present but not locked)
      // So activeRow becomes ['S', '', '', '', '']
      // To input 'STONE', we just add T, O, N, E.
      if (i > 0) {
        // Active row already has 'S' pre-filled due to syncLockedColumns.
        guess.substring(1).split('').forEach(char => store.addLetter(char));
      } else {
        guess.split('').forEach(char => store.addLetter(char));
      }
      await store.submitGuess();
    }

    expect(store.state.gameStatus).toBe('lost');
    expect(store.state.guesses.length).toBe(5);
    expect(store.state.streak).toBe(0); // Reset streak!
    expect(store.state.score).toBe(0);  // Score is reset to 0 on loss!
    expect(store.state.highScore).toBe(20); // High score remains!

    expect(saveGameOutcome).toHaveBeenCalledWith(
      { streak: 0, score: 0, highScore: 20, difficulty: 'hard', allowDuplicates: false },
      expect.objectContaining({ gameStatus: 'lost', secretWord: 'SHINE' }),
      'SHINE'
    );
  });

  it('should return early on submitGuess() if activeRow is incomplete, and not save session or push to guesses', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Reset calls to saveSession after init
    vi.mocked(saveSession).mockClear();

    // Add only 3 letters, leaving 2 empty
    store.addLetter('S');
    store.addLetter('H');
    store.addLetter('I');

    expect(store.state.activeRow).toEqual(['S', 'H', 'I', '', '']);

    await store.submitGuess();

    // Verify it returned early:
    // - guesses is still empty
    expect(store.state.guesses).toEqual([]);
    // - saveSession was NOT called
    expect(saveSession).not.toHaveBeenCalled();
    // - gameStatus is still playing
    expect(store.state.gameStatus).toBe('playing');
  });

  it('should award correct score based on attempts when winning on subsequent attempts', async () => {
    // Formula: 6 - attempts + 1
    // e.g. 2nd attempt = 6 - 2 + 1 = 5 pts
    // 3rd attempt = 6 - 3 + 1 = 4 pts
    // 4th attempt = 6 - 4 + 1 = 3 pts
    // 5th attempt = 6 - 5 + 1 = 2 pts
    
    const testCases = [
      { attempts: 2, expectedPoints: 5 },
      { attempts: 3, expectedPoints: 4 },
      { attempts: 4, expectedPoints: 3 },
      { attempts: 5, expectedPoints: 2 },
    ];

    for (const tc of testCases) {
      vi.clearAllMocks();
      vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 10, highScore: 10 });
      vi.mocked(loadSession).mockResolvedValue(null);
      vi.mocked(getWordHistory).mockResolvedValue([]);
      vi.mocked(generateWord).mockResolvedValue('SHINE');

      const store = createGameStore();
      await store.init();

      // Make wrong guesses up to attempts - 1
      for (let i = 1; i < tc.attempts; i++) {
        if (i === 1) {
          'STONE'.split('').forEach(char => store.addLetter(char));
        } else {
          'TONE'.split('').forEach(char => store.addLetter(char));
        }
        await store.submitGuess();
      }

      // Now make the winning guess 'SHINE'
      'HINE'.split('').forEach(char => store.addLetter(char));
      await store.submitGuess();

      expect(store.state.gameStatus).toBe('won');
      expect(store.state.guesses.length).toBe(tc.attempts);
      expect(store.state.score).toBe(10 + tc.expectedPoints);
      expect(saveGameOutcome).toHaveBeenCalledWith(
        {
          streak: 1,
          score: 10 + tc.expectedPoints,
          highScore: 10 + tc.expectedPoints,
          difficulty: 'hard',
          allowDuplicates: false
        },
        expect.objectContaining({ gameStatus: 'won', secretWord: 'SHINE' }),
        'SHINE'
      );
    }
  });

  it('should only add valid single alphabetic characters to activeRow', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Try adding invalid characters
    store.addLetter('1');
    store.addLetter('!');
    store.addLetter(' ');
    store.addLetter('ab'); // multiple characters
    expect(store.state.activeRow).toEqual(['', '', '', '', '']);

    // Try adding valid characters
    store.addLetter('a');
    store.addLetter('B');
    expect(store.state.activeRow).toEqual(['A', 'B', '', '', '']);
  });

  it('should be completely case-insensitive and handle lowercase secret words safely', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('train'); // Lowercase secret word!

    const store = createGameStore();
    await store.init();

    // Guess "CRANE"
    'crane'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.guesses[0]).toEqual([
      { letter: 'C', status: 'absent' },
      { letter: 'R', status: 'correct' },
      { letter: 'A', status: 'correct' },
      { letter: 'N', status: 'present' },
      { letter: 'E', status: 'absent' }
    ]);
  });

  it('should transition to error status if word generation fails during init', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockRejectedValue(new Error('Gemini Nano is not running'));

    const store = createGameStore();
    await store.init();

    expect(store.state.gameStatus).toBe('error');
    expect((store.state as any).errorMessage).toBe('Gemini Nano is not running');
  });

  it('should start in loading status and transition to playing only after init resolves', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    
    // Make generateWord return a promise that we can control
    let resolveWordGen: (word: string) => void = () => {};
    const wordGenPromise = new Promise<string>((resolve) => {
      resolveWordGen = resolve;
    });
    vi.mocked(generateWord).mockReturnValue(wordGenPromise as any);

    const store = createGameStore();
    expect(store.state.gameStatus).toBe('loading');

    // Call init but do not await yet
    const initPromise = store.init();
    
    // Should still be loading
    expect(store.state.gameStatus).toBe('loading');

    // Resolve word generation
    resolveWordGen('SHINE');
    
    // Await init to finish
    await initPromise;

    // Should now be playing
    expect(store.state.gameStatus).toBe('playing');
  });

  it('should NOT clear session or regenerate word when difficulty or duplicates are changed with 0 guesses (requires clicking GENERATE)', async () => {
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    expect(generateWord).toHaveBeenCalledWith('hard', false, [], expect.any(Function));

    vi.mocked(generateWord).mockClear();
    vi.mocked(clearSession).mockClear();

    // Change settings: should NOT trigger generation
    store.difficulty = 'easy';
    store.allowDuplicates = true;
    
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(clearSession).not.toHaveBeenCalled();
    expect(generateWord).not.toHaveBeenCalled();
    expect(store.state.difficulty).toBe('easy');
    expect(store.state.allowDuplicates).toBe(true);

    // Call forceNewGame: now it should clear session and generate with new settings!
    await store.forceNewGame();
    expect(clearSession).toHaveBeenCalled();
    expect(generateWord).toHaveBeenCalledWith('easy', true, [], expect.any(Function));
  });

  it('should NOT regenerate word or clear session when settings are changed but guesses exist', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    'STONE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    vi.mocked(generateWord).mockClear();
    vi.mocked(clearSession).mockClear();

    store.difficulty = 'easy';
    
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(clearSession).not.toHaveBeenCalled();
    expect(generateWord).not.toHaveBeenCalled();
    expect(store.state.difficulty).toBe('easy');
    expect(saveStats).toHaveBeenCalledWith(expect.objectContaining({
      difficulty: 'easy'
    }));
  });

  it('should manage help actions: reveal missing letter in right spot, deduct score, track usage, and save session', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 10, highScore: 10, difficulty: 'hard', allowDuplicates: false });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('PLANT');

    const store = createGameStore();
    await store.init();

    // Submit a wrong guess first to move to round 2 (1 guess made, no letters matched)
    'CROWD'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.score).toBe(10);
    expect(store.state.helpActionsUsed).toBe(0);
    expect(store.canUseHelp).toBe(true);

    const success = await store.useHelpAction();
    expect(success).toBe(true);
    expect(store.state.helpActionsUsed).toBe(1);
    expect(store.state.score).toBe(9);
    expect(store.state.isLocked[0]).toBe(true);
    expect(store.state.activeRow[0]).toBe('P');
    expect(saveStats).toHaveBeenCalledWith({ streak: 0, score: 9, highScore: 10, difficulty: 'hard', allowDuplicates: false });

    expect(saveSession).toHaveBeenLastCalledWith({
      guesses: [
        [
          { letter: 'C', status: 'absent' },
          { letter: 'R', status: 'absent' },
          { letter: 'O', status: 'absent' },
          { letter: 'W', status: 'absent' },
          { letter: 'D', status: 'absent' }
        ]
      ],
      activeRow: ['P', '', '', '', ''],
      isLocked: [true, false, false, false, false],
      gameStatus: 'playing',
      secretWord: 'PLANT',
      helpActionsUsed: 1,
      difficulty: 'hard',
      allowDuplicates: false
    });
  });

  it('should enforce a flat total of 3 help actions per game and not reveal the last letter', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 10, highScore: 10 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('PLANT');

    const store = createGameStore();
    await store.init();

    // 0 guesses: calling help fails immediately
    const successOnStart = await store.useHelpAction();
    expect(successOnStart).toBe(false);

    // Submit guess 1 ('CROWD' -> 0 matches)
    'CROWD'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    // Row 2 - take 3 hints in sequence
    expect(await store.useHelpAction()).toBe(true); // reveals 'P' (idx 0)
    expect(await store.useHelpAction()).toBe(true); // reveals 'L' (idx 1)
    expect(await store.useHelpAction()).toBe(true); // reveals 'A' (idx 2)
    expect(store.state.helpActionsUsed).toBe(3);
    expect(store.state.activeRow).toEqual(['P', 'L', 'A', '', '']);
    expect(store.canUseHelp).toBe(false); // Cap reached

    // 4th hint fails because cap of 3 reached
    expect(await store.useHelpAction()).toBe(false);
  });

  it('should refuse to reveal the final letter when only 1 unrevealed letter remains (at any index), but allow position 4 when multiple letters remain', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 10, highScore: 10 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('PLANT');

    const store = createGameStore();
    await store.init();

    // Case A: 2 unrevealed letters left at indices 3 ('N') and 4 ('T')
    // Guess 'PLACE': matches P, L, A (indices 0, 1, 2 locked; 3 and 4 missing)
    'PLACE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.isLocked).toEqual([true, true, true, false, false]);
    expect(store.canUseHelp).toBe(true);

    // 1st Help reveals position 3 ('N')
    expect(await store.useHelpAction()).toBe(true);
    expect(store.state.activeRow).toEqual(['P', 'L', 'A', 'N', '']);

    // Now only index 4 ('T') is unrevealed (count = 1). Help must refuse!
    expect(store.canUseHelp).toBe(false);
    expect(await store.useHelpAction()).toBe(false);
  });

  it('should fill active row with suggestion letters safely bypassing locked columns', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0 });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    'STONE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.isLocked).toEqual([true, false, false, true, true]);
    expect(store.state.activeRow).toEqual(['S', '', '', 'N', 'E']);

    store.fillActiveRow('SHINE');

    expect(store.state.activeRow).toEqual(['S', 'H', 'I', 'N', 'E']);
  });

  it('should persist difficulty and allowDuplicates settings on change and load them on init', async () => {
    vi.mocked(loadStats).mockResolvedValue({
      streak: 3,
      score: 15,
      highScore: 20,
      difficulty: 'hard',
      allowDuplicates: true
    });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    expect(store.state.difficulty).toBe('hard');
    expect(store.state.allowDuplicates).toBe(true);

    store.difficulty = 'impossible';
    expect(saveStats).toHaveBeenLastCalledWith(expect.objectContaining({
      difficulty: 'impossible',
      allowDuplicates: true
    }));

    store.allowDuplicates = false;
    expect(saveStats).toHaveBeenLastCalledWith(expect.objectContaining({
      difficulty: 'impossible',
      allowDuplicates: false
    }));
  });

  it('should allow difficulty and allowDuplicates settings to be changed when the game is won or lost', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Submit a correct guess to win the game
    'SHINE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    expect(store.state.gameStatus).toBe('won');
    expect(store.state.guesses.length).toBe(1);

    // Now change settings: it should be allowed because gameStatus is 'won'
    store.difficulty = 'impossible';
    expect(store.state.difficulty).toBe('impossible');
    expect(saveStats).toHaveBeenLastCalledWith(expect.objectContaining({
      difficulty: 'impossible'
    }));
  });

  it("should break the player's streak (reset to 0) when starting a new game (abandoning) mid-game, but preserve it when starting a new game after won/lost", async () => {
    vi.mocked(loadStats).mockResolvedValue({
      streak: 5,
      score: 10,
      highScore: 20,
      difficulty: 'hard',
      allowDuplicates: false
    });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    // Connect saveStats to loadStats mock so writes update subsequent reads!
    vi.mocked(saveStats).mockImplementation(async (stats) => {
      vi.mocked(loadStats).mockResolvedValue(stats);
    });

    const store = createGameStore();
    await store.init();

    expect(store.state.streak).toBe(5);

    // Make 1 wrong guess so guesses.length > 0 (game in progress)
    'STONE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();
    expect(store.state.gameStatus).toBe('playing');
    expect(store.state.guesses.length).toBe(1);

    // Trigger forceNewGame (abandoning!)
    await store.forceNewGame();

    // The streak and score should be reset to 0 in both the store state and database stats!
    expect(store.state.streak).toBe(0);
    expect(store.state.score).toBe(0);
    expect(store.state.highScore).toBe(20); // High score remains 20!
    expect(saveStats).toHaveBeenCalledWith(expect.objectContaining({
      streak: 0,
      score: 0
    }));

    // Now, if we win this next game, the streak should increment to 1 (not 6!)
    'SHINE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();
    expect(store.state.gameStatus).toBe('won');
    expect(store.state.streak).toBe(1);
  });

  it('should shake the first instance cell and block input when trying to write a duplicate letter and allowDuplicates is false', async () => {
    vi.useFakeTimers();
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Add 'S' -> index 0
    store.addLetter('S');
    expect(store.state.activeRow).toEqual(['S', '', '', '', '']);
    expect(store.state.shakeCells).toEqual([false, false, false, false, false]);

    // Try to add 'S' again (duplicate!). It would go into index 1.
    store.addLetter('S');
    
    // It should be rejected (activeRow unchanged) and trigger shake on the first instance (index 0)!
    expect(store.state.activeRow).toEqual(['S', '', '', '', '']);
    expect(store.state.shakeCells[0]).toBe(true);

    // Advance timers by 400ms
    vi.advanceTimersByTime(400);
    
    // Shake status should clear!
    expect(store.state.shakeCells[0]).toBe(false);

    vi.useRealTimers();
  });

  it('should enforce duplicate rules based on the active game settings even if the toggle is changed mid-game', async () => {
    vi.mocked(loadStats).mockResolvedValue({ streak: 0, score: 0, highScore: 0, difficulty: 'easy', allowDuplicates: false });
    vi.mocked(loadSession).mockResolvedValue(null);
    vi.mocked(getWordHistory).mockResolvedValue([]);
    vi.mocked(generateWord).mockResolvedValue('SHINE');

    const store = createGameStore();
    await store.init();

    // Active game starts with duplicates disabled
    expect(store.state.activeAllowDuplicates).toBe(false);

    // Make 1 guess to make the game active
    'STONE'.split('').forEach(char => store.addLetter(char));
    await store.submitGuess();

    // Clear active row and pre-fill S, N, and E
    expect(store.state.activeRow).toEqual(['S', '', '', 'N', 'E']);

    // Change setting mid-game: enable duplicates!
    store.allowDuplicates = true;
    expect(store.state.allowDuplicates).toBe(true);
    expect(store.state.activeAllowDuplicates).toBe(false); // Active game should still be false!

    // Try to add 'S' again (duplicate!). It should be BLOCKED and shake index 0 because active game still has duplicates disabled!
    store.addLetter('S');
    expect(store.state.activeRow).toEqual(['S', '', '', 'N', 'E']);
    expect(store.state.shakeCells[0]).toBe(true);

    // Connect saveStats to loadStats so forceNewGame captures the new setting
    vi.mocked(saveStats).mockImplementation(async (stats) => {
      vi.mocked(loadStats).mockResolvedValue(stats);
    });

    // Abandon current game and start new game (captures the new setting: allowDuplicates = true)
    await store.forceNewGame();
    expect(store.state.activeAllowDuplicates).toBe(true);

    // In the new game, typing duplicate 'S' should be ALLOWED!
    store.addLetter('S');
    store.addLetter('S');
    expect(store.state.activeRow).toEqual(['S', 'S', '', '', '']);
    expect(store.state.shakeCells).toEqual([false, false, false, false, false]);
  });
});


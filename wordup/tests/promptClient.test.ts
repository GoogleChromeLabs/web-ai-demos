import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWord, getSuggestions } from '../src/lib/promptClient';

describe('Prompt API Client', () => {
  beforeEach(() => {
    // Reset global LanguageModel
    if ('LanguageModel' in global) {
      delete (global as any).LanguageModel;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate a 5-letter word without duplicate letters (happy path)', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["SHINE"]'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('impossible', false, []);
    expect(word).toBe('SHINE');
    expect(word.length).toBe(5);
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('impossible'),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('no duplicate letters'),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it('should allow duplicate letters when allowDuplicates is true', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["APPLE"]'), // 'P' is duplicated
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('easy', true, []);
    expect(word).toBe('APPLE');
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.not.stringContaining('no duplicate letters'),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
  });

  it('should map medium difficulty to "a little challenging" in the prompt', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["SHINE"]'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('medium', false, []);
    expect(word).toBe('SHINE');
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('a little challenging'),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
  });

  it('should retry when mock model returns a word with duplicate letters but allowDuplicates is false', async () => {
    const mockSession = {
      prompt: vi.fn()
        .mockResolvedValueOnce('["APPLE"]') // has duplicates (P), should reject and retry
        .mockResolvedValueOnce('["SHINE"]'), // no duplicates, should accept
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('hard', false, []);
    expect(word).toBe('SHINE');
    expect(mockSession.prompt).toHaveBeenCalledTimes(2);
  });

  it('should retry when mock model returns a word in usedWords', async () => {
    const mockSession = {
      prompt: vi.fn()
        .mockResolvedValueOnce('["SHINE"]') // in usedWords, should reject and retry
        .mockResolvedValueOnce('["APPLE"]'), // no duplicates (with allowDuplicates: true), should accept
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('very_hard', true, ['SHINE']);
    expect(word).toBe('APPLE');
    expect(mockSession.prompt).toHaveBeenCalledTimes(2);
  });

  it('should retry when mock model returns a word that is not 5 letters long', async () => {
    const mockSession = {
      prompt: vi.fn()
        .mockResolvedValueOnce('["DOG"]') // 3 letters, reject
        .mockResolvedValueOnce('["LONGERWORD"]') // 10 letters, reject
        .mockResolvedValueOnce('["SHINE"]'), // 5 letters, accept
      destroy: vi.fn(),
    };

    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('impossible', false, []);
    expect(word).toBe('SHINE');
    expect(mockSession.prompt).toHaveBeenCalledTimes(3);
  });

  it('should throw an error after 15 failed attempts', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["DOG"]'), // always invalid (3 letters)
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    await expect(generateWord('impossible', false, [])).rejects.toThrow(
      'Failed to generate a valid word after 15 attempts.'
    );
    expect(mockSession.prompt).toHaveBeenCalledTimes(15);
    expect(mockSession.destroy).toHaveBeenCalled();
  });

  it('should throw an error if LanguageModel is unsupported', async () => {
    // LanguageModel is not defined on global
    await expect(generateWord('easy', false, [])).rejects.toThrow(
      'Chrome Prompt API (LanguageModel) is not supported in this browser.'
    );
  });

  it('should map medium difficulty to "a little challenging" in the prompt', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('SHINE'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('medium', false, []);
    expect(word).toBe('SHINE');
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('a little challenging')
    );
    expect(mockSession.prompt).not.toHaveBeenCalledWith(
      expect.stringContaining('medium')
    );
  });

  it('should formulate prompt with green, yellow, and gray constraints and parse comma-separated suggestions', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["FINCH", "CHINK", "PINCH", "WINCH"]'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const guess1 = [
      { letter: 'C', status: 'present' },
      { letter: 'R', status: 'absent' },
      { letter: 'A', status: 'absent' },
      { letter: 'N', status: 'present' },
      { letter: 'E', status: 'absent' },
    ];
    const guess2 = [
      { letter: 'S', status: 'absent' },
      { letter: 'H', status: 'present' },
      { letter: 'I', status: 'present' },
      { letter: 'N', status: 'present' },
      { letter: 'E', status: 'absent' },
    ];

    const suggestions = await getSuggestions([guess1, guess2], false);
    
    expect(suggestions).toEqual(['FINCH', 'PINCH', 'WINCH']);
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining("All 5 letters in the word MUST BE UNIQUE (no duplicate letters)."),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Letter 'C' MUST BE present but MUST NOT be at"),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining("MUST NOT BE PRESENT AT ANY INDEX"),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
  });

  it('should throw an error if LanguageModel is unavailable', async () => {
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('unavailable'),
    } as any;

    await expect(generateWord('easy', false, [])).rejects.toThrow(
      'On-device LanguageModel is unavailable on this system.'
    );
  });

  it('should fall back to picking any 5-letter word regardless of duplicate and history constraints on the 15th attempt', async () => {
    const mockSession = {
      prompt: vi.fn()
        .mockResolvedValue('["APPLE", "SHINE"]'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const word = await generateWord('easy', false, ['SHINE']);
    expect(['APPLE', 'SHINE']).toContain(word);
    expect(mockSession.prompt).toHaveBeenCalledTimes(15);
  });

  describe('getSuggestions retries', () => {
    it('should retry getSuggestions up to 5 times if invalid suggestions are returned, and succeed when a valid one is found', async () => {
      const mockSession = {
        prompt: vi.fn()
          .mockResolvedValueOnce('["CLIMB"]')
          .mockResolvedValueOnce('["STONE"]')
          .mockResolvedValueOnce('["SHINE"]'),
        destroy: vi.fn(),
      };
      global.LanguageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(mockSession),
      } as any;

      const guesses = [
        [
          { letter: 'S', status: 'correct' },
          { letter: 'T', status: 'absent' },
          { letter: 'O', status: 'absent' },
          { letter: 'N', status: 'correct' },
          { letter: 'E', status: 'correct' }
        ]
      ];

      const list = await getSuggestions(guesses as any, false);
      expect(list).toEqual(['SHINE']);
      expect(mockSession.prompt).toHaveBeenCalledTimes(3);
    });

    it('should return an empty array if all 5 attempts fail to return any valid suggestion', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue('["CLIMB"]'),
        destroy: vi.fn(),
      };
      global.LanguageModel = {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(mockSession),
      } as any;

      const guesses = [
        [
          { letter: 'S', status: 'correct' },
          { letter: 'T', status: 'absent' },
          { letter: 'O', status: 'absent' },
          { letter: 'N', status: 'correct' },
          { letter: 'E', status: 'correct' }
        ]
      ];

      const list = await getSuggestions(guesses as any, false);
      expect(list).toEqual([]);
      expect(mockSession.prompt).toHaveBeenCalledTimes(5);
    });
  });

  it('should formulate prompt with correct 1-based indexing for green and yellow letters', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue('["SHINE"]'),
      destroy: vi.fn(),
    };
    global.LanguageModel = {
      availability: vi.fn().mockResolvedValue('readily'),
      create: vi.fn().mockResolvedValue(mockSession),
    } as any;

    const guesses = [
      [
        { letter: 'S', status: 'correct' },
        { letter: 'H', status: 'present' },
        { letter: 'I', status: 'absent' },
        { letter: 'N', status: 'absent' },
        { letter: 'E', status: 'absent' }
      ]
    ];

    await getSuggestions(guesses as any, false);

    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Letter at index 1 (1-indexed) MUST be 'S'"),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );

    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Letter 'H' MUST BE present but MUST NOT be at Index 2, (1-index)"),
      expect.objectContaining({ responseConstraint: expect.any(Object) })
    );
  });
});


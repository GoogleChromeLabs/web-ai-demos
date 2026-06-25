import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openDB,
  closeDB,
  saveStats,
  loadStats,
  saveSession,
  loadSession,
  clearSession,
  addToWordHistory,
  getWordHistory,
  type GameStats,
  type SavedSession
} from '../src/lib/db';

describe('IndexedDB Persistence Service', () => {
  // Before each test, we might want to clear the database to ensure test isolation.
  // Since we don't have a direct deleteDB helper exported, we can do it via raw indexedDB if available.
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  describe('openDB', () => {
    it('should successfully open the database and return an IDBDatabase instance', async () => {
      const db = await openDB();
      expect(db).toBeInstanceOf(IDBDatabase);
      expect(db.name).toBe('WordupDB');
      expect(db.objectStoreNames.contains('statistics')).toBe(true);
      expect(db.objectStoreNames.contains('gameState')).toBe(true);
      expect(db.objectStoreNames.contains('wordHistory')).toBe(true);
      db.close();
    });
  });

  describe('Game Statistics', () => {
    it('should return default stats when no stats have been saved', async () => {
      const stats = await loadStats();
      expect(stats).toEqual({ streak: 0, score: 0, highScore: 0 });
    });

    it('should save and load statistics successfully', async () => {
      const sampleStats: GameStats = { streak: 5, score: 150, highScore: 300 };
      await saveStats(sampleStats);
      
      const loadedStats = await loadStats();
      expect(loadedStats).toEqual(sampleStats);
    });

    it('should overwrite existing statistics when saving new ones', async () => {
      const firstStats: GameStats = { streak: 1, score: 10, highScore: 10 };
      const secondStats: GameStats = { streak: 2, score: 30, highScore: 30 };
      
      await saveStats(firstStats);
      await saveStats(secondStats);
      
      const loadedStats = await loadStats();
      expect(loadedStats).toEqual(secondStats);
    });
  });

  describe('Game Session State', () => {
    it('should return null when no session is saved', async () => {
      const session = await loadSession();
      expect(session).toBeNull();
    });

    it('should save and load a game session successfully', async () => {
      const sampleSession: SavedSession = {
        guesses: [
          [{ letter: 'W', status: 'correct' }, { letter: 'O', status: 'present' }, { letter: 'R', status: 'absent' }, { letter: 'D', status: 'absent' }, { letter: 'S', status: 'absent' }]
        ],
        activeRow: ['U', 'P'],
        isLocked: [true, false, false, false, false],
        gameStatus: 'playing',
        secretWord: 'WORDS',
        helpActionsUsed: 0,
        difficulty: 'easy',
        allowDuplicates: false
      };
      
      await saveSession(sampleSession);
      const loaded = await loadSession();
      expect(loaded).toEqual(sampleSession);
    });

    it('should clear a saved session successfully', async () => {
      const sampleSession: SavedSession = {
        guesses: [],
        activeRow: [],
        isLocked: [],
        gameStatus: 'playing',
        secretWord: 'SHINE',
        helpActionsUsed: 0,
        difficulty: 'hard',
        allowDuplicates: false
      };
      
      await saveSession(sampleSession);
      await clearSession();
      
      const loaded = await loadSession();
      expect(loaded).toBeNull();
    });
  });

  describe('Word History', () => {
    it('should return an empty array when no words have been added', async () => {
      const history = await getWordHistory();
      expect(history).toEqual([]);
    });

    it('should add words to history and retrieve them in order', async () => {
      await addToWordHistory('apple');
      await addToWordHistory('banana');
      await addToWordHistory('cherry');

      const history = await getWordHistory();
      expect(history).toEqual(['apple', 'banana', 'cherry']);
    });

    it('should limit the retrieved history to the last 15 words (FIFO)', async () => {
      // Add 20 words
      const words: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const word = `word${i}`;
        words.push(word);
        await addToWordHistory(word);
      }

      const history = await getWordHistory();
      expect(history.length).toBe(15);
      // The first 5 words (word1 to word5) should be discarded
      expect(history[0]).toBe('word6');
      expect(history[14]).toBe('word20');
    });
  });
});

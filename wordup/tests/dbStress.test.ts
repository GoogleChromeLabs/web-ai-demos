import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { createGameStore } from '../src/lib/gameStore.svelte';

// Mock only the promptClient to avoid Chrome Gemini Nano API dependencies
vi.mock('../src/lib/promptClient', () => ({
  generateWord: vi.fn().mockResolvedValue('SHINE'),
}));

describe('IndexedDB Caching & Stress Tests', () => {
  // Clear the database between tests for isolation
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(async () => {
    await closeDB();
  });

  describe('Single-Connection Cache Verification', () => {
    it('should return the identical Promise instance for concurrent openDB calls', () => {
      const p1 = openDB();
      const p2 = openDB();
      const p3 = openDB();

      expect(p1).toBe(p2);
      expect(p2).toBe(p3);
    });

    it('should return the exact same database connection instance for concurrent openDB calls', async () => {
      const [db1, db2, db3] = await Promise.all([openDB(), openDB(), openDB()]);
      
      expect(db1).toBeInstanceOf(IDBDatabase);
      expect(db2).toBeInstanceOf(IDBDatabase);
      expect(db3).toBeInstanceOf(IDBDatabase);
      
      // Strict equality check to prove they reference the exact same object in memory
      expect(db1).toBe(db2);
      expect(db2).toBe(db3);
    });

    it('should reset the cache after closeDB is called', async () => {
      const db1 = await openDB();
      expect(db1).toBeInstanceOf(IDBDatabase);
      
      await closeDB();
      
      const db2 = await openDB();
      expect(db2).toBeInstanceOf(IDBDatabase);
      
      // A new connection should have been established, meaning different object references
      expect(db1).not.toBe(db2);
    });

    it('should reset the cache when the connection closes abruptly (onclose event)', async () => {
      const db1 = await openDB();
      
      // Simulate database close event by triggering the onclose handler if present
      if (db1.onclose) {
        db1.onclose(new Event('close'));
      }
      
      const db2 = await openDB();
      expect(db2).toBeInstanceOf(IDBDatabase);
      expect(db1).not.toBe(db2);
    });

    it('should close the connection and reset the cache on versionchange to avoid blocking upgrades', async () => {
      const db1 = await openDB();
      expect(db1.version).toBe(1);

      // Trigger a version change from "another connection" by opening version 2
      const upgradePromise = new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('WordupDB', 2);
        req.onupgradeneeded = () => {
          const db2 = req.result;
          if (!db2.objectStoreNames.contains('statistics')) {
            db2.createObjectStore('statistics');
          }
          if (!db2.objectStoreNames.contains('gameState')) {
            db2.createObjectStore('gameState');
          }
          if (!db2.objectStoreNames.contains('wordHistory')) {
            db2.createObjectStore('wordHistory');
          }
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
          reject(new Error('Upgrade was blocked! The onversionchange handler failed to close the connection.'));
        };
      });

      await upgradePromise;

      // Mock indexedDB.open so that when openDB() tries to open version 1,
      // it actually opens version 2 (since version 1 will throw a VersionError now).
      const originalOpen = indexedDB.open;
      indexedDB.open = function (name, version) {
        if (name === 'WordupDB' && version === 1) {
          return originalOpen.call(this, name, 2);
        }
        return originalOpen.apply(this, arguments as any);
      };

      try {
        // Now, opening the database again should yield a new connection with version 2
        const db3 = await openDB();
        expect(db3).toBeInstanceOf(IDBDatabase);
        expect(db3).not.toBe(db1);
        expect(db3.version).toBe(2);
      } finally {
        indexedDB.open = originalOpen;
      }
    });

    it('should recover and allow subsequent connections if a transient open error occurs', async () => {
      const originalOpen = indexedDB.open;
      
      // Mock indexedDB.open to fail once
      let fail = true;
      indexedDB.open = function (name, version) {
        if (fail) {
          const mockReq = {} as any;
          setTimeout(() => {
            mockReq.error = new DOMException('Simulated IndexedDB open failure', 'UnknownError');
            if (mockReq.onerror) {
              mockReq.onerror({ target: mockReq } as any);
            }
          }, 10);
          return mockReq;
        }
        return originalOpen.apply(this, arguments as any);
      };

      // The first call to openDB should fail and reject
      await expect(openDB()).rejects.toThrow('Simulated IndexedDB open failure');

      // Now disable the failure mock
      fail = false;

      // The second call should succeed and return a valid connection
      const db = await openDB();
      expect(db).toBeInstanceOf(IDBDatabase);

      // Restore original open function
      indexedDB.open = originalOpen;
    });

    it('should prevent race condition in closeDB() where concurrent openDB() callers could get a closed connection', async () => {
      // 1. Trigger openDB to start opening
      const p1 = openDB();
      
      // 2. Call closeDB() immediately. It should clear dbPromise synchronously
      const p_close = closeDB();
      
      // 3. Call openDB() again. It should get a NEW promise, not reuse the one being closed
      const p2 = openDB();
      
      // 4. Await all of them
      const [db1, _, db2] = await Promise.all([p1, p_close, p2]);
      
      // 5. db2 should be a fresh connection and should be open/usable, whereas db1 is closed
      expect(db2).toBeInstanceOf(IDBDatabase);
      expect(db1).not.toBe(db2);
      
      // Verify db2 is usable by doing a successful transaction
      const statsPromise = saveStats({ streak: 10, score: 100, highScore: 100 });
      await expect(statsPromise).resolves.not.toThrow();
    });

    it('should reject openDB and clear the cache if the connection is blocked', async () => {
      const originalOpen = indexedDB.open;
      
      // Mock indexedDB.open to trigger onblocked
      indexedDB.open = function () {
        const mockReq = {} as any;
        setTimeout(() => {
          if (mockReq.onblocked) {
            mockReq.onblocked(new Event('blocked'));
          }
        }, 10);
        return mockReq;
      } as any;

      // The call to openDB should reject due to being blocked
      await expect(openDB()).rejects.toThrow('Database connection blocked by another tab/session.');

      // Restore original open function
      indexedDB.open = originalOpen;
    });
  });

  describe('Concurrency & Transaction Stress Tests', () => {
    it('should handle many concurrent read and write operations without errors or lockups', async () => {
      const CONCURRENCY_LIMIT = 50;
      
      // Prepare a set of concurrent operations
      const operations: Promise<any>[] = [];
      
      for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        // Interleave saves and loads across all three stores
        if (i % 3 === 0) {
          operations.push(saveStats({ streak: i, score: i * 10, highScore: 500 }));
          operations.push(loadStats());
        } else if (i % 3 === 1) {
          operations.push(saveSession({
            guesses: [[{ letter: 'A', status: 'correct' }]],
            activeRow: ['B'],
            isLocked: [true],
            gameStatus: 'playing',
            secretWord: `WORD${i}`,
            helpActionsUsed: 1,
            difficulty: 'medium',
            allowDuplicates: false
          }));
          operations.push(loadSession());
        } else {
          operations.push(addToWordHistory(`WORD${i}`));
          operations.push(getWordHistory());
        }
      }

      // Run all 100+ operations in parallel and verify they all resolve successfully
      const results = await Promise.all(operations);
      expect(results.length).toBe(CONCURRENCY_LIMIT * 2);

      // Verify final state in the database is consistent
      const finalStats = await loadStats();
      expect(finalStats.highScore).toBe(500);

      const finalHistory = await getWordHistory();
      expect(finalHistory.length).toBeLessThanOrEqual(15); // limit is 15
    });

    it('should handle concurrent writes to the same record and resolve consistently', async () => {
      const writes = Array.from({ length: 20 }, (_, i) => saveStats({
        streak: i,
        score: i,
        highScore: 100
      }));

      // Fire 20 writes to the same key 'playerStats' concurrently
      await Promise.all(writes);

      // Verify the database is still in a clean state and can be read
      const stats = await loadStats();
      expect(stats.highScore).toBe(100);
      expect(stats.streak).toBeGreaterThanOrEqual(0);
      expect(stats.streak).toBeLessThan(20);
    });
  });

  describe('Game Store & Database Integration & Type Safety', () => {
    it('should initialize the store, save progress to DB, and restore state correctly', async () => {
      // Create a store that uses the real (fake-indexeddb backed) database layer
      const store1 = createGameStore();
      
      // Initialize the store. It should load default stats and generate a new word "SHINE"
      await store1.init();
      
      expect(store1.state.gameStatus).toBe('playing');
      expect(store1.state.streak).toBe(0);
      
      // Simulate playing: add letters and submit a guess
      // "SHINE" is the secret word. Let's guess "STARE"
      store1.addLetter('S');
      store1.addLetter('T');
      store1.addLetter('A');
      store1.addLetter('R');
      store1.addLetter('E');
      
      await store1.submitGuess();
      
      // Confirm guess was recorded in state
      expect(store1.state.guesses.length).toBe(1);
      expect(store1.state.isLocked).toEqual([true, false, false, false, true]); // S and E locked

      // The state should have been saved to the database.
      // Let's create a NEW store instance to simulate a page reload, and initialize it.
      const store2 = createGameStore();
      await store2.init();

      // The second store should restore the exact progress of the first store from the database
      expect(store2.state.gameStatus).toBe('playing');
      expect(store2.state.guesses.length).toBe(1);
      expect(store2.state.guesses[0]).toEqual([
        { letter: 'S', status: 'correct' },
        { letter: 'T', status: 'absent' },
        { letter: 'A', status: 'absent' },
        { letter: 'R', status: 'absent' },
        { letter: 'E', status: 'correct' }
      ]);
      expect(store2.state.isLocked).toEqual([true, false, false, false, true]);
      expect(store2.state.activeRow).toEqual(['S', '', '', '', 'E']); // Pre-filled locked columns
    });

    it('should update and persist streaks, scores, and history when a game is won', async () => {
      const store = createGameStore();
      await store.init(); // Secret word is "SHINE"

      // Guess "SHINE" to win the game
      store.addLetter('S');
      store.addLetter('H');
      store.addLetter('I');
      store.addLetter('N');
      store.addLetter('E');

      await store.submitGuess();

      expect(store.state.gameStatus).toBe('won');
      expect(store.state.streak).toBe(1);
      expect(store.state.score).toBe(10); // 1st attempt = 10 points
      expect(store.state.highScore).toBe(10);

      // Verify statistics were persisted in the database
      const dbStats = await loadStats();
      expect(dbStats).toEqual({
        streak: 1,
        score: 10,
        highScore: 10,
        difficulty: 'hard',
        allowDuplicates: false
      });

      // Verify session was NOT cleared on win, but has status 'won'
      const session = await loadSession();
      expect(session).not.toBeNull();
      expect(session?.gameStatus).toBe('won');

      // Verify word history was updated
      const history = await getWordHistory();
      expect(history).toEqual(['SHINE']);
    });

    it('should reset streak and score on game loss and persist to database', async () => {
      // Pre-populate stats with a streak
      await saveStats({ streak: 5, score: 50, highScore: 100 });

      const store = createGameStore();
      await store.init(); // Secret word is "SHINE"

      // Submit 5 incorrect guesses
      for (let i = 0; i < 5; i++) {
        store.addLetter('W');
        store.addLetter('O');
        store.addLetter('R');
        store.addLetter('D');
        store.addLetter('S');
        await store.submitGuess();
      }

      expect(store.state.gameStatus).toBe('lost');
      expect(store.state.streak).toBe(0);
      expect(store.state.score).toBe(0);
      expect(store.state.highScore).toBe(100); // High score remains

      // Verify database stats match
      const dbStats = await loadStats();
      expect(dbStats.streak).toBe(0);
      expect(dbStats.score).toBe(0);
      expect(dbStats.highScore).toBe(100);

      // Verify word history contains "SHINE"
      const history = await getWordHistory();
      expect(history).toEqual(['SHINE']);
    });
  });
});

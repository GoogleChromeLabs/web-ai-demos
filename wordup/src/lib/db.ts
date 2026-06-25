export interface LetterCell {
  letter: string;
  status: 'correct' | 'present' | 'absent';
}

export interface GameStats {
  streak: number;
  score: number;
  highScore: number;
  difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
  allowDuplicates?: boolean;
}

export interface SavedSession {
  guesses: LetterCell[][];
  activeRow: string[];
  isLocked: boolean[];
  gameStatus: 'playing' | 'won' | 'lost';
  secretWord: string;
  helpActionsUsed: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
  allowDuplicates: boolean;
}

const DB_NAME = 'WordupDB';
const STORE_STATS = 'statistics';
const STORE_SESSION = 'gameState';
const STORE_HISTORY = 'wordHistory';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      reject(new Error('IndexedDB is not supported or defined in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Database connection blocked by another tab/session.'));
    };
    request.onsuccess = () => {
      const db = request.result;

      // Monkey-patch db.close to ensure the promise cache is cleared when connection is closed programmatically
      const originalClose = db.close;
      db.close = function () {
        dbPromise = null;
        originalClose.apply(this);
      };

      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STATS)) {
        db.createObjectStore(STORE_STATS);
      }
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION);
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { autoIncrement: true });
      }
    };
  });

  return dbPromise;
}

export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const promise = dbPromise;
    dbPromise = null; // Clear the cache synchronously to prevent concurrent openDB race conditions
    try {
      const db = await promise;
      db.close();
    } catch (err) {
      // Ignore open errors during close operations
    }
  }
}

export async function saveStats(stats: GameStats): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_STATS, 'readwrite');
      const store = tx.objectStore(STORE_STATS);
      store.put(stats, 'playerStats');
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function loadStats(): Promise<GameStats> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_STATS, 'readonly');
      const store = tx.objectStore(STORE_STATS);
      const request = store.get('playerStats');
      request.onsuccess = () => {
        resolve(request.result || { streak: 0, score: 0, highScore: 0 });
      };
      request.onerror = () => {
        reject(request.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function saveSession(session: SavedSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSION, 'readwrite');
      const store = tx.objectStore(STORE_SESSION);
      store.put(session, 'activeSession');
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function loadSession(): Promise<SavedSession | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSION, 'readonly');
      const store = tx.objectStore(STORE_SESSION);
      const request = store.get('activeSession');
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function clearSession(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSION, 'readwrite');
      const store = tx.objectStore(STORE_SESSION);
      store.delete('activeSession');
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function addToWordHistory(word: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_HISTORY, 'readwrite');
      const store = tx.objectStore(STORE_HISTORY);
      store.add(word);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function getWordHistory(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_HISTORY, 'readonly');
      const store = tx.objectStore(STORE_HISTORY);
      const words: string[] = [];
      
      // Use a cursor in reverse order ('prev') to fetch only the last 15 records
      const request = store.openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor && words.length < 15) {
          words.push(cursor.value as string);
          cursor.continue();
        } else {
          // Since we traversed in reverse (newest first), reverse back to chronological order
          resolve(words.reverse());
        }
      };
      
      request.onerror = () => {
        reject(request.error);
      };
      
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function saveGameOutcome(stats: GameStats, session: SavedSession, historyWord?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const stores = [STORE_STATS, STORE_SESSION];
      if (historyWord) {
        stores.push(STORE_HISTORY);
      }
      const tx = db.transaction(stores, 'readwrite');

      const statsStore = tx.objectStore(STORE_STATS);
      statsStore.put(stats, 'playerStats');

      const sessionStore = tx.objectStore(STORE_SESSION);
      sessionStore.put(session, 'activeSession');

      if (historyWord) {
        const historyStore = tx.objectStore(STORE_HISTORY);
        historyStore.add(historyWord);
      }

      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
      tx.onabort = () => {
        reject(tx.error || new Error('Transaction aborted'));
      };
    } catch (err) {
      reject(err);
    }
  });
}

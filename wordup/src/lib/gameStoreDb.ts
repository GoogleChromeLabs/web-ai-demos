import {
  saveStats,
  saveSession,
  clearSession,
  addToWordHistory,
  saveGameOutcome,
  type GameStats,
  type SavedSession
} from './db';

export async function safeSaveStats(stats: GameStats): Promise<void> {
  try {
    await saveStats(stats);
  } catch (err) {
    console.error('Failed to save stats:', err);
  }
}

export async function safeSaveSession(session: SavedSession): Promise<void> {
  try {
    await saveSession(session);
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

export async function safeClearSession(): Promise<void> {
  try {
    await clearSession();
  } catch (err) {
    console.error('Failed to clear session:', err);
  }
}

export async function safeAddToHistory(word: string): Promise<void> {
  try {
    await addToWordHistory(word);
  } catch (err) {
    console.error('Failed to add word to history:', err);
  }
}

export async function safeSaveGameOutcome(stats: GameStats, session: SavedSession, historyWord?: string): Promise<void> {
  try {
    await saveGameOutcome(stats, session, historyWord);
  } catch (err) {
    console.error('Failed to save game outcome:', err);
  }
}


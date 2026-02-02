import { execSync } from 'node:child_process';

/**
 * Copies text to the system clipboard.
 * @param {string} text 
 * @returns {boolean}
 */
export function copyToClipboard(text) {
  try {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'pbcopy' : platform === 'win32' ? 'clip' : 'xclip -selection clipboard';
    execSync(cmd, { input: text });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Promisified readline.question
 * @param {import('node:readline').Interface} rl 
 * @param {string} query 
 * @returns {Promise<string>}
 */
export function ask(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

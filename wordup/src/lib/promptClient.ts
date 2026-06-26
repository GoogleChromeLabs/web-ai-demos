import type { LetterCell } from './db';

// Type declarations for window/global LanguageModel
declare global {
  interface LanguageModel {
    availability(options?: any): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
    create(options?: any): Promise<LanguageModelSession>;
  }
  interface LanguageModelSession {
    prompt(text: string): Promise<string>;
    destroy(): void;
  }
  var LanguageModel: LanguageModel;
}

// Local declaration of process for Vite's compile-time define replacement
declare const process: {
  env: {
    DEBUG?: string;
  };
};

// Global debug log helper checking feature flag process.env.DEBUG === '1'
function debugLog(...args: any[]) {
  if (process.env.DEBUG === '1') {
    console.log(...args);
  }
}

export async function generateWord(
  difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible',
  allowDuplicates: boolean,
  usedWords: string[]
): Promise<string> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('Chrome Prompt API (LanguageModel) is not supported in this browser.');
  }

  const availability = await LanguageModel.availability();
  if (availability === 'unavailable') {
    throw new Error('On-device LanguageModel is unavailable on this system.');
  }

  const session = await LanguageModel.create();

  try {
    let word = '';
    let attempts = 0;
    const maxAttempts = 15;

    while (attempts < maxAttempts) {
      attempts++;
      
      // Map difficulty to prompt adjectives
      let difficultyWord = difficulty as string;
      if (difficulty === 'medium') {
        difficultyWord = 'a little challenging';
      } else if (difficulty === 'very_hard') {
        difficultyWord = 'very hard';
      }

      // Formulate structured prompt requesting 20 words
      const duplicateClause = allowDuplicates ? '' : 'where each letter in the word is completely unique (no duplicate letters) ';
      const promptText = `Generate exactly 20 different 5-letter English words that are ${difficultyWord} to guess, ${duplicateClause}. Proper nouns, abbreviations, or combinations of random letters are strictly forbidden. Return only the words as a comma-separated list, in all uppercase. Do not include any introductory or concluding text, explanations, or formatting. Example format: WORD1, WORD2, WORD3, WORD4, WORD5`;

      debugLog(`[AI WORD GENERATION] Attempt ${attempts}/${maxAttempts}`);
      debugLog(`[AI WORD GENERATION] Prompt: "${promptText}"`);

      const response = await session.prompt(promptText);
      debugLog(`[AI WORD GENERATION] Raw Response: "${response}"`);

      // Parse comma-separated list
      const rawWords = response.split(',')
        .map(w => w.trim().toUpperCase().replace(/[^A-Z]/g, ''));
      
      debugLog(`[AI WORD GENERATION] Parsed Words:`, rawWords);

      // Filter words strictly
      const validWords = rawWords.filter(w => {
        if (w.length !== 5) return false;
        if (!allowDuplicates) {
          if (new Set(w).size !== 5) return false;
        }
        if (usedWords.includes(w)) return false;
        return true;
      });

      debugLog(`[AI WORD GENERATION] Valid Candidates after strict filtering:`, validWords);

      if (validWords.length > 0) {
        // Pick a random word from the valid candidates
        const chosen = validWords[Math.floor(Math.random() * validWords.length)];
        debugLog(`[AI WORD GENERATION] Success! Chosen Word: "${chosen}"`);
        word = chosen;
        break;
      }

      // Fallback on the 15th (last) attempt: re-filter only by length === 5
      if (attempts === maxAttempts) {
        debugLog(`[AI WORD GENERATION] Final 15th attempt: applying relaxed length-only filter`);
        const fiveLetterWords = rawWords.filter(w => w.length === 5);
        debugLog(`[AI WORD GENERATION] 5-letter words available for fallback:`, fiveLetterWords);
        
        if (fiveLetterWords.length > 0) {
          const chosen = fiveLetterWords[Math.floor(Math.random() * fiveLetterWords.length)];
          debugLog(`[AI WORD GENERATION] Success (Fallback)! Chosen Word: "${chosen}"`);
          word = chosen;
          break;
        }
      }
    }

    if (!word) {
      throw new Error('Failed to generate a valid word after 15 attempts.');
    }

    return word;
  } finally {
    session.destroy();
  }
}

export async function getSuggestions(
  guesses: LetterCell[][],
  allowDuplicates: boolean
): Promise<string[]> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('Chrome Prompt API (LanguageModel) is not supported in this browser.');
  }

  const availability = await LanguageModel.availability();
  if (availability === 'unavailable') {
    throw new Error('On-device LanguageModel is unavailable on this system.');
  }

  const session = await LanguageModel.create();

  try {
    const correctLetters: string[] = ['', '', '', '', ''];
    const absentLetters = new Set<string>();
    const presentOrCorrectLetters = new Set<string>();
    const yellowMap: { [key: string]: number[] } = {};
    const absentIndicesMap: { [key: string]: number[] } = {};

    for (const guess of guesses) {
      guess.forEach((cell, idx) => {
        const char = cell.letter.toUpperCase();
        if (cell.status === 'correct') {
          correctLetters[idx] = char;
          presentOrCorrectLetters.add(char);
        } else if (cell.status === 'present') {
          presentOrCorrectLetters.add(char);
          if (!yellowMap[char]) yellowMap[char] = [];
          if (!yellowMap[char].includes(idx)) yellowMap[char].push(idx);
        } else if (cell.status === 'absent') {
          absentLetters.add(char);
          if (!absentIndicesMap[char]) absentIndicesMap[char] = [];
          if (!absentIndicesMap[char].includes(idx)) absentIndicesMap[char].push(idx);
        }
      });
    }

    for (const char of absentLetters) {
      if (presentOrCorrectLetters.has(char)) {
        if (!yellowMap[char]) yellowMap[char] = [];
        const indices = absentIndicesMap[char] || [];
        for (const idx of indices) {
          if (!yellowMap[char].includes(idx)) {
            yellowMap[char].push(idx);
          }
        }
      }
    }

    for (const char of presentOrCorrectLetters) {
      absentLetters.delete(char);
    }

    const promptParts: string[] = [];
    promptParts.push("You are playing a word guessing game similar to Wordle. The secret word is a valid 5-letter English word. The following are HARD CONSTRAINTS for choosing words:\n\n- No proper nouns, abbreviations, or combinations of random letters");
    
    if (allowDuplicates) {
      promptParts.push("- Duplicate letters are allowed in the word.");
    } else {
      promptParts.push("- All 5 letters in the word MUST BE UNIQUE (no duplicate letters).");
    }

    for (let i = 0; i < 5; i++) {
      if (correctLetters[i]) {
        promptParts.push(`Letter at index ${i + 1} (1-indexed) MUST be '${correctLetters[i]}'`);
      }
    }

    for (const char in yellowMap) {
      promptParts.push(`Letter '${char}' MUST BE present but MUST NOT be at ${yellowMap[char].map(idx => `Index ${idx + 1}, (1-index)`).join(', ')}`);
    }

    if (absentLetters.size > 0) {
      promptParts.push(`- Letters ${Array.from(absentLetters).join(', ')} MUST NOT BE PRESENT AT ANY INDEX. These letters are STRICTLY BANNED from being used`);
    }

    promptParts.push("\nBased on these STRONG REQUIREMENTS AND CONSTRAINTS, suggest 15 valid, actual English words that fit ALL of the rules above. Words that do not fit the rules above are STRICTLY FORBIDDEN.");
    promptParts.push("Return ONLY the list of words, uppercase, separated by commas. DO NOT include any introductory or concluding text, explanations, or formatting. Example format: WORD1, WORD2, WORD3.");

    const promptText = promptParts.join("\n");
    
    const maxAttempts = 5;
    let finalSuggestions: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      debugLog(`[AI HELP SUGGESTIONS] Attempt ${attempt}/${maxAttempts}`);
      debugLog(`[AI HELP SUGGESTIONS] Prompt sent to LanguageModel:\n${promptText}`);
      
      const response = await session.prompt(promptText);
      debugLog(`[AI HELP SUGGESTIONS] Attempt ${attempt} Raw Response: "${response}"`);
      
      const rawWords = response.split(',')
        .map(w => w.trim().toUpperCase().replace(/[^A-Z]/g, ''));
      
      debugLog(`[AI HELP SUGGESTIONS] Attempt ${attempt} Parsed raw words:`, rawWords);

      const validSuggestions: string[] = [];
      for (const word of rawWords) {
        if (word.length !== 5) {
          debugLog(`[AI HELP SUGGESTIONS] Rejected: "${word}" has length ${word.length} (expected 5)`);
          continue;
        }
        
        let hasAbsentChar = false;
        let absentCharTrigger = '';
        for (const char of word) {
          if (absentLetters.has(char)) {
            hasAbsentChar = true;
            absentCharTrigger = char;
            break;
          }
        }
        if (hasAbsentChar) {
          debugLog(`[AI HELP SUGGESTIONS] Rejected: "${word}" contains gray/absent letter "${absentCharTrigger}"`);
          continue;
        }

        let conformsToGreen = true;
        let greenMismatchIndex = -1;
        for (let i = 0; i < 5; i++) {
          if (correctLetters[i] && word[i] !== correctLetters[i]) {
            conformsToGreen = false;
            greenMismatchIndex = i;
            break;
          }
        }
        if (!conformsToGreen) {
          debugLog(`[AI HELP SUGGESTIONS] Rejected: "${word}" does not have green letter "${correctLetters[greenMismatchIndex]}" at position ${greenMismatchIndex + 1}`);
          continue;
        }

        let conformsToYellow = true;
        let yellowViolationReason = '';
        for (const char in yellowMap) {
          if (!word.includes(char)) {
            conformsToYellow = false;
            yellowViolationReason = `missing yellow letter "${char}"`;
            break;
          }
          const wrongIndices = yellowMap[char];
          let atWrongPosition = false;
          let wrongPosIndex = -1;
          for (const idx of wrongIndices) {
            if (word[idx] === char) {
              atWrongPosition = true;
              wrongPosIndex = idx;
              break;
            }
          }
          if (atWrongPosition) {
            conformsToYellow = false;
            yellowViolationReason = `has yellow letter "${char}" at forbidden position ${wrongPosIndex + 1}`;
            break;
          }
        }
        if (!conformsToYellow) {
          debugLog(`[AI HELP SUGGESTIONS] Rejected: "${word}" violates yellow constraints: ${yellowViolationReason}`);
          continue;
        }

        if (!allowDuplicates) {
          const unique = new Set(word);
          if (unique.size !== 5) {
            debugLog(`[AI HELP SUGGESTIONS] Rejected: "${word}" contains duplicate letters (unique count: ${unique.size})`);
            continue;
          }
        }

        debugLog(`[AI HELP SUGGESTIONS] Accepted: "${word}" conforms to all constraints`);
        validSuggestions.push(word);
      }

      if (validSuggestions.length > 0) {
        finalSuggestions = Array.from(new Set(validSuggestions)).slice(0, 5);
        debugLog(`[AI HELP SUGGESTIONS] Attempt ${attempt} Success! Valid suggestions:`, finalSuggestions);
        break; // Success! Break the retry loop
      } else {
        debugLog(`[AI HELP SUGGESTIONS] Attempt ${attempt} yielded 0 valid suggestions. Retrying...`);
      }
    }

    debugLog(`[AI HELP SUGGESTIONS] Final validated suggestions returned to UI:`, finalSuggestions);
    return finalSuggestions;
  } finally {
    session.destroy();
  }
}

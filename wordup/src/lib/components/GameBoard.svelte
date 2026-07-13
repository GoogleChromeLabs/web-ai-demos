<script lang="ts">
  import type { LetterCell } from '../db';


  let {
    guesses,
    activeRow,
    isLocked,
    gameStatus,
    shakeCells,
    addLetter,
    deleteLetter,
    onSubmitGuess,
    onActivity
  } = $props<{
    guesses: LetterCell[][];
    activeRow: string[];
    isLocked: boolean[];
    gameStatus: 'loading' | 'playing' | 'won' | 'lost' | 'error';
    shakeCells: boolean[];
    addLetter: (char: string) => void;
    deleteLetter: () => void;
    onSubmitGuess: () => void;
    onActivity?: () => void;
  }>();

  let inputRefs: HTMLInputElement[] = [];
  let prevActiveRow = [...activeRow];
  let prevGuessesLength = guesses.length;

  let announcement = $state('');

  const knownWrongLetters = $derived.by(() => {
    const absent = new Set<string>();
    const correctOrPresent = new Set<string>();
    for (const row of guesses) {
      for (const cell of row) {
        if (!cell.letter) continue;
        const char = cell.letter.toLowerCase();
        if (cell.status === 'absent') {
          absent.add(char);
        } else if (cell.status === 'correct' || cell.status === 'present') {
          correctOrPresent.add(char);
        }
      }
    }
    for (const char of correctOrPresent) {
      absent.delete(char);
    }
    return absent;
  });

  $effect(() => {
    // 1. Detect new guess submission
    if (guesses.length > prevGuessesLength) {
      const lastGuess = guesses[guesses.length - 1];
      const guessStr = lastGuess.map((c: LetterCell) => c.letter).join('');
      const evaluation = lastGuess.map((c: LetterCell, idx: number) => `Column ${idx + 1} ${c.letter} is ${c.status}`).join(', ');
      announcement = `Submitted guess ${guesses.length}: ${guessStr}. Results: ${evaluation}.`;
      prevGuessesLength = guesses.length;
      prevActiveRow = [...activeRow];
      return;
    }

    // 2. Detect activeRow changes
    const currentWord = activeRow.filter((c: string) => c !== '').join('');
    const prevWord = prevActiveRow.filter((c: string) => c !== '').join('');
    
    if (currentWord !== prevWord) {
      if (currentWord.length > prevWord.length) {
        // Characters added
        if (currentWord.length - prevWord.length > 1) {
          // Multi-character fill (AI suggestion)
          announcement = `Filled active row with word: ${currentWord}.`;
        } else {
          // Single character entered
          const addedIndex = activeRow.findIndex((c: string, i: number) => c !== '' && prevActiveRow[i] === '');
          if (addedIndex !== -1) {
            announcement = `Entered ${activeRow[addedIndex]} in column ${addedIndex + 1}.`;
          }
        }
      } else if (currentWord.length < prevWord.length) {
        // Characters deleted
        if (currentWord.length === 0) {
          announcement = `Cleared active row.`;
        } else {
          announcement = `Deleted letter.`;
        }
      }
    }
    prevActiveRow = [...activeRow];
    prevGuessesLength = guesses.length;
  });

  export function focusFirstEmptyCell() {
    const idx = activeRow.findIndex((c: string, i: number) => c === '' && !isLocked[i]);
    if (idx !== -1 && inputRefs[idx]) {
      inputRefs[idx].focus();
    }
  }

  function handleInput(e: Event, idx: number) {
    if (onActivity) onActivity();
    const target = e.target as HTMLInputElement;
    const val = target.value.toUpperCase();
    
    if (val) {
      addLetter(val);
      target.value = activeRow[idx];
      
      if (activeRow[idx] !== '') {
        const nextIdx = activeRow.findIndex((c: string, i: number) => i > idx && !isLocked[i]);
        if (nextIdx !== -1 && inputRefs[nextIdx]) {
          inputRefs[nextIdx].focus();
        }
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent, idx: number) {
    if (onActivity) onActivity();
    if (e.key === 'Backspace') {
      if (activeRow[idx] === '') {
        deleteLetter();
        let prevIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
          if (!isLocked[i]) {
            prevIdx = i;
            break;
          }
        }
        if (prevIdx !== -1 && inputRefs[prevIdx]) {
          inputRefs[prevIdx].focus();
        }
      } else {
        deleteLetter();
      }
    } else if (e.key === 'Enter') {
      onSubmitGuess();
    } else if (e.key === 'ArrowLeft') {
      let prevIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (!isLocked[i]) {
          prevIdx = i;
          break;
        }
      }
      if (prevIdx !== -1 && inputRefs[prevIdx]) {
        inputRefs[prevIdx].focus();
        e.preventDefault();
      }
    } else if (e.key === 'ArrowRight') {
      let nextIdx = -1;
      for (let i = idx + 1; i < 5; i++) {
        if (!isLocked[i]) {
          nextIdx = i;
          break;
        }
      }
      if (nextIdx !== -1 && inputRefs[nextIdx]) {
        inputRefs[nextIdx].focus();
        e.preventDefault();
      }
    }
  }

</script>

{#if gameStatus === 'playing' || gameStatus === 'won' || gameStatus === 'lost'}
  <main class="game-board-area" role="grid" aria-label="Wordup Game Board">
    <!-- Visually hidden announcement area for screen readers -->
    <div class="sr-only" aria-live="polite">{announcement}</div>

    <div class="grid-5x5">
      <!-- Past Guess Rows -->
      {#each guesses as guess, rowIndex}
        <div class="board-row" role="row" aria-label="Row {rowIndex + 1}">
          {#each guess as cell, i}
            <div 
              class="letter-card {cell.status}" 
              role="gridcell" 
              aria-label="Row {rowIndex + 1}, Column {i + 1}: {cell.letter}, {cell.status}"
              data-index={rowIndex * 5 + i + 1}
            >
              <span class="letter-text">{cell.letter}</span>
            </div>
          {/each}
        </div>
      {/each}

      <!-- Active Row (only if playing) -->
      {#if gameStatus === 'playing'}
        <div class="board-row active-row" role="row" aria-label="Row {guesses.length + 1} (Active)">
          {#each activeRow as letter, i}
            <div 
              class="letter-card input-card" 
              role="gridcell"
              class:locked={isLocked[i]} 
              class:has-val={letter !== ''}
              class:is-wrong={letter !== '' && knownWrongLetters.has(letter.toLowerCase())}
              class:shake-orange={shakeCells[i]}
              data-index={guesses.length * 5 + i + 1}
              aria-label={isLocked[i] ? `Row ${guesses.length + 1}, Column ${i + 1}: ${letter}, correct, locked` : undefined}
            >
              {#if isLocked[i]}
                <span class="letter-text" aria-hidden="true">
                  {letter}
                </span>
              {:else}
                <input 
                  type="text" 
                  maxlength="1" 
                  value={letter} 
                  disabled={isLocked[i]}
                  class="cell-input"
                  bind:this={inputRefs[i]}
                  oninput={(e) => handleInput(e, i)}
                  onkeydown={(e) => handleKeyDown(e, i)}
                  placeholder="•"
                  aria-label="Row {guesses.length + 1}, Column {i + 1}. Current letter: {letter || 'empty'}"
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </main>
{/if}

<style>
  .grid-5x5 { display: flex; flex-direction: column; gap: 12px; }
  .board-row { display: flex; gap: 10px; justify-content: center; }
  .letter-card {
    width: 56px; height: 56px; border-radius: 16px; border: 3px solid #0f172a;
    background: #fff; display: flex; justify-content: center; align-items: center;
    position: relative; box-sizing: border-box; box-shadow: 3px 3px 0px #0f172a;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  .letter-text { font-size: 1.8rem; font-weight: 700; color: #0f172a; text-transform: uppercase; }
  .letter-card.correct { background: #86efac; transform: rotate(2deg) scale(1.03); }
  .letter-card.present { background: #fef08a; transform: rotate(-2deg) scale(1.03); }
  .letter-card.absent { background: #cbd5e1; box-shadow: 1px 1px 0px #0f172a; transform: scale(0.97); }
  .letter-card.absent .letter-text { color: #475569; }
  .letter-card.locked { background: #a7f3d0; border-color: #0f172a; box-shadow: 3px 3px 0px #0f172a; }
  .letter-card.input-card { background: #fff; }
  .letter-card.input-card:focus-within {
    background: #e0f2fe; border-color: #0284c7; transform: translateY(-2px);
    box-shadow: 4px 5px 0px #0f172a; outline: 3px solid #0284c7; outline-offset: 2px;
  }
  .letter-card.input-card.is-wrong {
    background: #ffe4e6 !important; border-color: #e11d48 !important;
    box-shadow: 3px 3px 0px #e11d48 !important; animation: warning-shake 0.3s ease-in-out;
  }
  .letter-card.input-card.is-wrong .cell-input { color: #0f172a !important; }
  .letter-card.shake-orange {
    background: #ffedd5 !important; border-color: #f97316 !important;
    box-shadow: 3px 3px 0px #f97316 !important; animation: cell-shake-orange 0.4s ease-in-out;
  }
  .letter-card.shake-orange .cell-input { color: #c2410c !important; }
  .cell-input {
    background: transparent; border: none; width: 100%; height: 100%; text-align: center;
    font-size: 1.8rem; font-weight: 700; color: #0f172a; outline: none;
    text-transform: uppercase; font-family: inherit;
  }
  .cell-input::placeholder { color: #cbd5e1; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  @media (max-width: 400px) {
    .letter-card { width: 46px; height: 46px; border-radius: 12px; }
    .letter-text, .cell-input { font-size: 1.5rem; }
  }
</style>

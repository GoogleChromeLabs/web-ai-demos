<script lang="ts">
  let {
    gameStatus,
    errorMessage = '',
    guessesCount = 0,
    revealWord = '',
    settingsDescription = '',
    downloadProgress = null
  } = $props<{
    gameStatus: 'loading' | 'playing' | 'won' | 'lost' | 'error';
    errorMessage?: string;
    guessesCount?: number;
    revealWord?: string;
    settingsDescription?: string;
    downloadProgress?: number | null;
  }>();

  const isAiError = $derived(
    errorMessage && (
      errorMessage.toLowerCase().includes('languagemodel') ||
      errorMessage.toLowerCase().includes('prompt') ||
      errorMessage.toLowerCase().includes('on-device') ||
      errorMessage.toLowerCase().includes('offline') ||
      errorMessage.toLowerCase().includes('availability')
    )
  );

  const isDatabaseError = $derived(
    errorMessage && !isAiError && !errorMessage.includes('15 attempts')
  );
</script>

{#if gameStatus === 'loading'}
  <!-- Whimsical Loading Panel -->
  <div class="game-loading-panel" role="status" aria-label="Loading new word">
    <h2 class="game-loading-title">CONJURING A WORD...</h2>
    <p class="game-loading-text">{settingsDescription}</p>
    {#if downloadProgress !== null && downloadProgress < 1}
      <div class="download-progress-container">
        <progress id="model-download-progress" value={downloadProgress}></progress>
        <label for="model-download-progress" class="download-progress-label">Downloading AI Model: {Math.round(downloadProgress * 100)}%</label>
      </div>
    {/if}
  </div>
{:else}
  {#if gameStatus === 'error'}
    <!-- Beautiful Whimsical Error Panel -->
    <div class="game-error-panel" role="alert">
      {#if errorMessage && errorMessage.includes('15 attempts')}
        <h2 class="game-error-title">GENERATION FAILED</h2>
        <p class="game-error-text">The AI could not generate a valid word matching your difficulty and duplicate settings after 15 attempts.</p>
        <p class="game-error-hint">Try relaxing your settings and click the "New Game" button in the menu above to retry!</p>
      {:else if isDatabaseError}
        <h2 class="game-error-title">SYSTEM ERROR</h2>
        <p class="game-error-text">{errorMessage}</p>
        <p class="game-error-hint">An error occurred while accessing the local database. Please try reloading the page or clearing your browser storage.</p>
      {:else}
        <h2 class="game-error-title">AI OFFLINE</h2>
        <p class="game-error-text">{errorMessage}</p>
        <p class="game-error-hint">To play, please ensure you are in a modern browser with on-device AI enabled (Chrome 148+ with optimization-guide-on-device-model enabled) and the built-in language model has finished downloading.</p>
      {/if}
    </div>
  {/if}

  <!-- Game Over Message Area -->
  {#if gameStatus === 'won' || gameStatus === 'lost'}
    <div 
      class="game-over-panel" 
      class:won={gameStatus === 'won'} 
      class:lost={gameStatus === 'lost'}
      role="status"
      aria-label={gameStatus === 'won' ? `Victory! You guessed the word in ${guessesCount} ${guessesCount === 1 ? 'attempt' : 'attempts'}!` : `Game Over. The secret word was ${revealWord}`}
    >
      {#if gameStatus === 'won'}
        <h2 class="game-over-title">VICTORY!</h2>
        <p class="game-over-text">You guessed the word in {guessesCount} {guessesCount === 1 ? 'attempt' : 'attempts'}!</p>
      {:else}
        <h2 class="game-over-title">GAME OVER</h2>
        <p class="game-over-text">The secret word was <span class="reveal-word">{revealWord}</span></p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* Game Over Panel */
  .game-over-panel {
    background: #fef08a;
    border: 3px solid #0f172a;
    border-radius: 20px;
    padding: 20px;
    text-align: center;
    box-shadow: 4px 4px 0px #0f172a;
    animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .game-over-panel.won {
    background: #bbf7d0;
  }

  .game-over-panel.lost {
    background: #fecdd3;
  }

  .game-over-title {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0 0 8px 0;
    color: #0f172a;
  }

  .game-over-text {
    font-size: 1rem;
    margin: 0;
    color: #334155;
  }

  .reveal-word {
    font-weight: 700;
    color: #9f1239;
    letter-spacing: 0.05em;
  }

  @keyframes pop-in {
    0% {
      transform: scale(0.9);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Game Loading Panel */
  .game-loading-panel {
    background: #e0f2fe;
    border: 3px solid #0f172a;
    border-radius: 24px;
    padding: 30px 24px;
    text-align: center;
    box-shadow: 4px 4px 0px #0f172a;
    animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .game-loading-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: #0369a1;
    animation: loading-bounce 1s infinite ease-in-out;
  }

  .game-loading-text {
    font-size: 1rem;
    margin: 0;
    color: #334155;
    font-weight: 500;
  }

  @keyframes loading-bounce {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  /* Game Error Panel */
  .game-error-panel {
    background: #fecdd3;
    border: 3px solid #0f172a;
    border-radius: 24px;
    padding: 24px;
    text-align: center;
    box-shadow: 4px 4px 0px #0f172a;
    animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .game-error-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: #9f1239;
  }

  .game-error-text {
    font-size: 1rem;
    margin: 0;
    color: #1e293b;
    font-weight: 500;
    line-height: 1.4;
  }

  .game-error-hint {
    font-size: 0.75rem;
    margin: 0;
    color: #475569;
    line-height: 1.5;
    border-top: 2px dashed rgba(15, 23, 42, 0.1);
    padding-top: 12px;
  }
  .download-progress-container {
    width: 100%;
    max-width: 240px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  }

  progress {
    width: 100%;
    max-width: 200px;
    height: 14px;
    border-radius: 10px;
    border: 2px solid #0f172a;
    overflow: hidden;
    background-color: #e2e8f0;
  }

  progress::-webkit-progress-bar {
    background-color: #e2e8f0;
  }

  progress::-webkit-progress-value {
    background-color: #38bdf8;
  }

  .download-progress-label {
    font-size: 0.85rem;
    font-weight: 700;
    color: #0369a1;
  }

  @media (max-width: 480px) {
    .game-over-panel {
      padding: 14px;
      border-radius: 16px;
    }
    .game-over-title {
      font-size: 1.3rem;
    }
    .game-over-text {
      font-size: 0.9rem;
    }
    .game-loading-panel, .game-error-panel {
      padding: 18px 14px;
      border-radius: 18px;
      gap: 10px;
    }
    .game-loading-title, .game-error-title {
      font-size: 1.25rem;
    }
    .game-loading-text, .game-error-text {
      font-size: 0.9rem;
    }
  }
</style>

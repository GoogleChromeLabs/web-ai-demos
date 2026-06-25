<script lang="ts">
  let {
    gameStatus,
    isFetchingSuggestions = false,
    guessesLength = 0,
    helpActionsUsed = 0,
    onSubmit,
    onHelp,
    onNewGame
  } = $props<{
    gameStatus: 'loading' | 'playing' | 'won' | 'lost' | 'error';
    isFetchingSuggestions?: boolean;
    guessesLength?: number;
    helpActionsUsed?: number;
    onSubmit: () => void;
    onHelp: () => void;
    onNewGame: () => void;
  }>();

  function autofocus(node: HTMLButtonElement) {
    node.focus();
  }
</script>

<div class="action-area">
  {#if gameStatus === 'playing'}
    <div class="playing-actions">
      <button class="submit-btn" onclick={onSubmit}>
        GUESS!
      </button>
      <button 
        class="help-btn" 
        onclick={onHelp} 
        disabled={isFetchingSuggestions || guessesLength === 0 || (3 - helpActionsUsed) <= 0}
        title="Get AI word hints (costs 1 point)"
        aria-label="Get AI word hints, costs 1 point. {guessesLength === 0 ? 'Unavailable on first turn.' : `${3 - helpActionsUsed} hints remaining.`}"
      >
        {#if isFetchingSuggestions}
          <div class="thinking-loader">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </div>
        {:else}
          ?
          {#if guessesLength > 0}
            <span class="help-count">{3 - helpActionsUsed}</span>
          {/if}
        {/if}
      </button>
    </div>
  {:else if gameStatus === 'loading'}
    <button class="submit-btn loading-btn" disabled>
      LOADING...
    </button>
  {:else if gameStatus === 'error'}
    <button use:autofocus class="submit-btn retry-btn" onclick={onNewGame}>
      RETRY!
    </button>
  {:else}
    <button use:autofocus class="submit-btn play-again-btn" onclick={onNewGame}>
      PLAY AGAIN!
    </button>
  {/if}
</div>

<style>
  .action-area {
    display: flex;
    justify-content: center;
    margin-top: 10px;
  }

  .submit-btn {
    width: 100%;
    padding: 14px;
    border-radius: 16px;
    border: 3px solid #0f172a;
    background: #be185d;
    color: #fff;
    font-family: inherit;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 4px 4px 0px #0f172a;
    transition: all 0.1s ease;
    letter-spacing: 0.05em;
  }

  .submit-btn:hover {
    background: #9f1239;
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0px #0f172a;
  }

  .submit-btn:active {
    transform: translate(2px, 2px);
    box-shadow: 0px 0px 0px #0f172a;
  }

  .play-again-btn {
    background: #047857;
  }

  .play-again-btn:hover {
    background: #065f46;
  }

  .loading-btn {
    background: #94a3b8 !important;
    cursor: not-allowed !important;
    box-shadow: 0px 0px 0px #0f172a !important;
    transform: none !important;
  }

  .retry-btn {
    background: #c2410c;
  }

  .retry-btn:hover {
    background: #9a3412;
  }

  .playing-actions {
    display: flex;
    gap: 12px;
    width: 100%;
    max-width: 350px;
    justify-content: center;
    align-items: center;
  }

  .help-btn {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 3px solid #0f172a;
    background: #fef08a;
    color: #0f172a;
    font-size: 1.5rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 3px 3px 0px #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    user-select: none;
    padding: 0;
  }

  .help-btn:hover:not(:disabled) {
    transform: scale(1.08) translateY(-2px);
    box-shadow: 4px 5px 0px #0f172a;
    background: #fde047;
  }

  .help-btn:active:not(:disabled) {
    transform: scale(0.95);
    box-shadow: 1px 1px 0px #0f172a;
  }

  .help-btn:disabled {
    background: #cbd5e1;
    color: #94a3b8;
    cursor: not-allowed;
    box-shadow: 0px 0px 0px #0f172a;
    transform: none;
  }

  .help-count {
    position: absolute;
    top: -6px;
    right: -6px;
    background: #b91c1c;
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 700;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 1px 1px 0px #0f172a;
  }

  .submit-btn:focus-visible,
  .help-btn:focus-visible {
    outline: 3px solid #0284c7;
    outline-offset: 2px;
  }

  /* Thinking Loader wave animation inside help button */
  .thinking-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    width: 100%;
  }

  .thinking-dot {
    width: 6px;
    height: 6px;
    background-color: #0f172a;
    border-radius: 50%;
    display: inline-block;
    animation: thinking-wave 1.2s infinite ease-in-out;
  }

  .thinking-dot:nth-child(1) { animation-delay: 0s; }
  .thinking-dot:nth-child(2) { animation-delay: 0.15s; }
  .thinking-dot:nth-child(3) { animation-delay: 0.3s; }

  @keyframes thinking-wave {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
</style>

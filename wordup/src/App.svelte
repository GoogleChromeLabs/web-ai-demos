<script lang="ts">
  import { onMount } from 'svelte';
  import { createGameStore } from './lib/gameStore.svelte';
  import { getSuggestions } from './lib/promptClient';
  import Confetti from './lib/components/Confetti.svelte';
  import Header from './lib/components/Header.svelte';
  import Dashboard from './lib/components/Dashboard.svelte';
  import GameBoard from './lib/components/GameBoard.svelte';
  import GameStatusPanel from './lib/components/GameStatusPanel.svelte';
  import SuggestionsCloud from './lib/components/SuggestionsCloud.svelte';
  import ActionArea from './lib/components/ActionArea.svelte';
  import { registerWebMCPTools } from './lib/webmcp';

  const game = createGameStore();
  
  // Reactive states for AI help suggestions
  let suggestions = $state<string[]>([]);
  let isFetchingSuggestions = $state<boolean>(false);
  let suggestionError = $state<string>('');

  let boardRef: any = null;

  const settingsDescription = $derived.by(() => {
    const diff = game.state.difficulty;
    const diffText = diff === 'medium' ? 'a little challenging' : diff === 'very_hard' ? 'very hard' : diff;
    const dupText = game.state.allowDuplicates ? 'duplicate letters allowed' : 'no duplicate letters';
    const capitalizedDiff = diffText.charAt(0).toUpperCase() + diffText.slice(1);
    return `${capitalizedDiff}, ${dupText}`;
  });

  const revealWord = $derived(
    game.state.gameStatus === 'lost' || game.state.gameStatus === 'won' ? game.revealWord() : ''
  );

  onMount(() => {
    const controller = new AbortController();
    game.init().then(() => {
      registerWebMCPTools(game, { signal: controller.signal });
      focusFirstEmptyCell();
    });

    return () => {
      controller.abort();
    };
  });

  function focusFirstEmptyCell() {
    boardRef?.focusFirstEmptyCell();
  }

  async function submitGuess() {
    await game.submitGuess();
    suggestions = []; // Clear suggestions on submit!
    suggestionError = ''; // Clear help error on submit!
    focusFirstEmptyCell();
  }

  async function startNewGame() {
    await game.forceNewGame();
    suggestions = []; // Clear suggestions on new game!
    suggestionError = ''; // Clear help error on new game!
    focusFirstEmptyCell();
  }

  async function triggerHelp() {
    if (!game.canUseHelp) return;
    const expectedGuessesLength = game.state.guesses.length;

    const success = await game.useHelpAction();
    if (success && game.state.guesses.length === expectedGuessesLength) {
      focusFirstEmptyCell();
    }
  }

  function useSuggestion(word: string) {
    game.fillActiveRow(word);
    suggestions = []; // Clear once inserted
    focusFirstEmptyCell();
  }

  function clearErrors() {
    suggestionError = '';
  }
</script>

<Confetti active={game.state.gameStatus === 'won'} />

<div class="mockup-page whimsical">
  <div class="game-wrapper">
    <div class="game-container">
      
      <!-- Game Header with Animated Bubbly Logo -->
      <Header />

      <!-- Dashboard Panel -->
      <Dashboard 
        streak={game.state.streak}
        score={game.state.score}
        highScore={game.state.highScore}
        bind:difficulty={game.difficulty}
        bind:allowDuplicates={game.allowDuplicates}
        gameStatus={game.state.gameStatus}
        onGenerate={startNewGame}
      />

      <!-- Main Game Board -->
      <GameBoard 
        bind:this={boardRef}
        guesses={game.state.guesses}
        activeRow={game.state.activeRow}
        isLocked={game.state.isLocked}
        gameStatus={game.state.gameStatus}
        shakeCells={game.state.shakeCells}
        addLetter={game.addLetter}
        deleteLetter={game.deleteLetter}
        onSubmitGuess={submitGuess}
        onActivity={clearErrors}
      />

      <!-- Floating Suggestions Side Clouds -->
      <SuggestionsCloud 
        {suggestions}
        onSelectSuggestion={useSuggestion}
      />

      <!-- Overlays for Loading, Error, Won, and Lost game states -->
      <GameStatusPanel 
        gameStatus={game.state.gameStatus}
        errorMessage={game.state.errorMessage}
        guessesCount={game.state.guesses.length}
        revealWord={revealWord}
        settingsDescription={settingsDescription}
        downloadProgress={game.state.downloadProgress}
      />

      <!-- Hint Suggestion Error Notice -->
      {#if suggestionError}
        <div class="hint-error-notice">
          {suggestionError}
        </div>
      {/if}

      <!-- Action Area -->
      <ActionArea 
        gameStatus={game.state.gameStatus}
        isFetchingSuggestions={isFetchingSuggestions}
        guessesLength={game.state.guesses.length}
        helpActionsUsed={game.state.helpActionsUsed}
        canUseHelp={game.canUseHelp}
        onSubmit={submitGuess}
        onHelp={triggerHelp}
        onNewGame={startNewGame}
      />

    </div>
  </div>
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
  }

  /* Whimsical Page Setup */
  .mockup-page.whimsical {
    width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
    background: #e0f2fe;
    background-image: radial-gradient(#bae6fd 20%, transparent 20%),
                      radial-gradient(#bae6fd 20%, transparent 20%);
    background-size: 30px 30px;
    background-position: 0 0, 15px 15px;
    color: #1e293b;
    font-family: 'Fredoka', sans-serif;
  }

  .game-wrapper {
    width: 100%;
    flex-grow: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 30px 16px;
    box-sizing: border-box;
  }

  .game-container {
    width: 100%;
    max-width: 480px;
    background: #fff;
    border: 4px solid #0f172a;
    border-radius: 32px;
    padding: 26px 20px;
    box-shadow: 8px 8px 0px #0f172a;
    display: flex;
    flex-direction: column;
    gap: 22px;
    box-sizing: border-box;
    position: relative;
  }

  .hint-error-notice {
    background: #fef2f2;
    border: 3px solid #ef4444;
    color: #b91c1c;
    padding: 12px 20px;
    border-radius: 16px;
    font-size: 0.95rem;
    font-weight: 700;
    text-align: center;
    box-shadow: 3px 3px 0px #ef4444;
    animation: warning-shake 0.3s ease-in-out;
    margin-top: 10px;
    line-height: 1.4;
  }

  @keyframes warning-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px) rotate(-1deg); }
    75% { transform: translateX(4px) rotate(1deg); }
  }

  /* Responsive Design adjustments */
  @media (max-width: 480px) {
    .game-wrapper {
      padding: 16px 10px;
    }
    .game-container {
      padding: 18px 14px;
      gap: 16px;
      border-radius: 24px;
      border-width: 3.5px;
      box-shadow: 5px 5px 0px #0f172a;
    }
  }

  @media (max-width: 360px) {
    .game-wrapper {
      padding: 10px 6px;
    }
    .game-container {
      padding: 14px 10px;
      gap: 12px;
      border-radius: 20px;
      border-width: 3px;
      box-shadow: 4px 4px 0px #0f172a;
    }
  }
</style>

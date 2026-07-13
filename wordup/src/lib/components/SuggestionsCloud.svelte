<script lang="ts">
  let {
    suggestions = [],
    onSelectSuggestion
  } = $props<{
    suggestions: string[];
    onSelectSuggestion: (word: string) => void;
  }>();

  const evenSuggestions = $derived(suggestions.filter((_: string, i: number) => i % 2 === 0));
  const oddSuggestions = $derived(suggestions.filter((_: string, i: number) => i % 2 !== 0));
</script>

{#if suggestions.length > 0}
  <section class="suggestions-clouds-container" aria-label="AI Suggestions">
    <h3 class="sr-only">AI Suggestions</h3>
    <div class="suggestions-cloud left-cloud">
      {#each evenSuggestions as word, idx}
        <button 
          class="suggestion-bubble color-{(idx * 2) % 5}" 
          style="--delay: {idx * 0.3}s"
          onclick={() => onSelectSuggestion(word)}
          aria-label="Use suggestion: {word}"
        >
          {word}
        </button>
      {/each}
    </div>
    <div class="suggestions-cloud right-cloud">
      {#each oddSuggestions as word, idx}
        <button 
          class="suggestion-bubble color-{(idx * 2 + 1) % 5}" 
          style="--delay: {idx * 0.3}s"
          onclick={() => onSelectSuggestion(word)}
          aria-label="Use suggestion: {word}"
        >
          {word}
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .suggestions-cloud {
    display: flex;
    z-index: 10;
    box-sizing: border-box;
  }

  /* Wide Viewports: float clouds absolute on the outside left/right of the card! */
  @media (min-width: 850px) {
    .suggestions-cloud {
      position: absolute;
      top: 120px;
      flex-direction: column;
      gap: 20px;
      width: 150px;
    }

    .suggestions-cloud.left-cloud {
      right: calc(100% + 24px);
      align-items: flex-end;
    }

    .suggestions-cloud.right-cloud {
      left: calc(100% + 24px);
      align-items: flex-start;
    }
  }

  /* Narrow Viewports: fallback inside the card, below the game board! */
  @media (max-width: 849px) {
    .suggestions-cloud {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      margin-top: 12px;
      width: 100%;
    }
  }

  .suggestion-bubble {
    border: 3px solid #0f172a;
    border-radius: 50px;
    padding: 8px 16px;
    font-size: 1rem;
    font-weight: 700;
    box-shadow: 3px 3px 0px #0f172a;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: bubble-float 3s infinite ease-in-out;
    animation-delay: var(--delay, 0s);
  }

  @media (max-width: 480px) {
    .suggestion-bubble {
      padding: 6px 12px;
      font-size: 0.88rem;
      border-width: 2.5px;
      box-shadow: 2px 2px 0px #0f172a;
    }
  }

  .suggestion-bubble:hover {
    transform: scale(1.1) translateY(-3px);
    box-shadow: 4px 5px 0px #0f172a;
  }

  .suggestion-bubble:active {
    transform: scale(0.95);
    box-shadow: 1px 1px 0px #0f172a;
  }

  .suggestion-bubble:focus-visible {
    outline: 3px solid #0284c7;
    outline-offset: 2px;
  }

  .suggestions-clouds-container {
    display: contents;
  }

  /* Visually hidden utility for screen reader announcements */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .suggestion-bubble.color-0 { background: #fdf2f8; color: #be185d; }
  .suggestion-bubble.color-1 { background: #ecfdf5; color: #047857; }
  .suggestion-bubble.color-2 { background: #eff6ff; color: #2563eb; }
  .suggestion-bubble.color-3 { background: #fefce8; color: #854d0e; }
  .suggestion-bubble.color-4 { background: #faf5ff; color: #7c3aed; }

  @keyframes bubble-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
</style>

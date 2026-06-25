<script lang="ts">
  // No script state needed for static header
</script>

<header class="game-header">
  <div class="header-logo-section">
    <h1 class="logo-text" aria-label="Wordup">
      <span class="bubbly-letter letter-w" style="--delay: 0s" aria-hidden="true">W</span>
      <span class="bubbly-letter letter-o" style="--delay: 0.1s" aria-hidden="true">O</span>
      <span class="bubbly-letter letter-r" style="--delay: 0.2s" aria-hidden="true">R</span>
      <span class="bubbly-letter letter-d" style="--delay: 0.3s" aria-hidden="true">D</span>
      <span class="bubbly-letter letter-u" style="--delay: 0.4s" aria-hidden="true">U</span>
      <span class="bubbly-letter letter-p" style="--delay: 0.5s" aria-hidden="true">P</span>
    </h1>
  </div>
</header>

<style>
  .game-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .header-logo-section {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 10px 0;
  }

  /* Bubbly Animated Logo text */
  .logo-text {
    display: flex;
    gap: 6px;
    margin: 0;
    user-select: none;
  }

  .bubbly-letter {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 54px;
    height: 54px;
    font-size: 2.2rem;
    font-weight: 700;
    color: #fff;
    border: 3.5px solid #0f172a;
    border-radius: 16px;
    box-shadow: 3px 3px 0px #0f172a;
    text-shadow: 1px 1px 0px rgba(0,0,0,0.2);
    animation: letter-bobbing 2s infinite ease-in-out;
    animation-delay: var(--delay);
    transform-origin: bottom center;
  }

  /* Individual letter coloring */
  .letter-w { background-color: #f43f5e; } /* Rose */
  .letter-o { background-color: #fb923c; } /* Orange */
  .letter-r { background-color: #facc15; } /* Yellow */
  .letter-d { background-color: #4ade80; } /* Green */
  .letter-u { background-color: #38bdf8; } /* Blue */
  .letter-p { background-color: #c084fc; } /* Purple */

  @keyframes letter-bobbing {
    0%, 100% {
      transform: translateY(0) scaleY(1);
    }
    50% {
      transform: translateY(-12px) scaleY(1.05) scaleX(0.95);
    }
  }

  @media (max-width: 400px) {
    .bubbly-letter {
      width: 44px;
      height: 44px;
      font-size: 1.8rem;
      border-width: 3px;
    }
  }
</style>

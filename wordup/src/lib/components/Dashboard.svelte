<script lang="ts">
  let {
    streak = 0,
    score = 0,
    highScore = 0,
    difficulty = $bindable('easy'),
    allowDuplicates = $bindable(false),
    gameStatus = 'playing',
    onGenerate
  } = $props<{
    streak: number;
    score: number;
    highScore: number;
    difficulty: 'easy' | 'medium' | 'hard' | 'very_hard' | 'impossible';
    allowDuplicates: boolean;
    gameStatus: string;
    onGenerate: () => void;
  }>();
</script>

<section class="dashboard-panel">
  <dl class="stats-grid">
    <div class="stat-box">
      <dt class="stat-label">STREAK</dt>
      <dd class="stat-val">{streak}</dd>
    </div>
    <div class="stat-box">
      <dt class="stat-label">SCORE</dt>
      <dd class="stat-val">{score} pts</dd>
    </div>
    <div class="stat-box">
      <dt class="stat-label">BEST</dt>
      <dd class="stat-val">{highScore} pts</dd>
    </div>
  </dl>

  <div class="settings-control-row">
    <div class="setting-item">
      <label for="difficulty-select" class="sr-only">Difficulty</label>
      <select 
        id="difficulty-select" 
        bind:value={difficulty} 
        class="custom-select"
        disabled={gameStatus === 'loading'}
      >
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
        <option value="very_hard">Very Hard</option>
        <option value="impossible">Impossible</option>
      </select>
    </div>
    <div class="setting-item flex-row">
      <label for="dup-toggle" class="setting-label">DUPLICATES</label>
      <label class="toggle-switch">
        <input 
          type="checkbox" 
          id="dup-toggle" 
          bind:checked={allowDuplicates} 
          disabled={gameStatus === 'loading'}
          aria-label="Allow Duplicate Letters"
        />
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-item">
      <button 
        id="generate-btn"
        class="generate-btn" 
        onclick={onGenerate}
        disabled={gameStatus === 'loading'}
      >
        GENERATE
      </button>
    </div>
  </div>
</section>

<style>
  .dashboard-panel {
    background: #fef08a;
    border: 3px solid #0f172a;
    border-radius: 20px;
    padding: 16px;
    box-shadow: 4px 4px 0px #0f172a;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .stats-grid {
    display: flex;
    justify-content: space-around;
    gap: 10px;
  }

  .stat-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #fff;
    border: 2px solid #0f172a;
    border-radius: 12px;
    padding: 6px 10px;
  }

  .stat-label {
    font-size: 0.65rem;
    color: #64748b;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .stat-val {
    font-size: 1.1rem;
    font-weight: 700;
    color: #be185d;
  }

  .settings-control-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 2px dashed rgba(15, 23, 42, 0.15);
    padding-top: 12px;
    gap: 15px;
  }

  .setting-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .setting-item.flex-row {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }

  .setting-item label, .setting-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: #0f172a;
  }

  .custom-select {
    background: #fff;
    border: 2px solid #0f172a;
    color: #000;
    padding: 4px 10px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }


  .custom-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Custom Toggle Switch styling */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 22px;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-switch input:disabled + .slider {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e1;
    transition: .3s;
    border: 2px solid #0f172a;
    border-radius: 34px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 12px;
    width: 12px;
    left: 3px;
    bottom: 3px;
    background-color: #0f172a;
    transition: .3s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: #ec4899;
  }

  input:checked + .slider:before {
    transform: translateX(22px);
    background-color: #fff;
  }

  /* Whimsical Generate button inside settings section */
  .generate-btn {
    background: #7c3aed;
    color: #fff;
    border: 3px solid #0f172a;
    border-radius: 12px;
    padding: 6px 16px;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 3px 3px 0px #0f172a;
    transition: all 0.1s ease;
    letter-spacing: 0.05em;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }


  .generate-btn:hover:not(:disabled) {
    background: #6d28d9;
    transform: translate(-1px, -1px);
    box-shadow: 4px 4px 0px #0f172a;
  }

  .generate-btn:active:not(:disabled) {
    transform: translate(1px, 1px);
    box-shadow: 0px 0px 0px #0f172a;
  }

  .generate-btn:disabled {
    background: #cbd5e1;
    border-color: #64748b;
    color: #64748b;
    box-shadow: 0px 0px 0px #0f172a;
    cursor: not-allowed;
    transform: none;
  }

  .custom-select:focus-visible,
  .generate-btn:focus-visible {
    outline: 3px solid #0284c7;
    outline-offset: 2px;
  }

  .toggle-switch input:focus-visible + .slider {
    outline: 3px solid #0284c7;
    outline-offset: 2px;
  }

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
</style>


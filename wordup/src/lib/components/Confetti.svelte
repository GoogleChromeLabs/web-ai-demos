<script lang="ts">
  let { active = false } = $props<{ active: boolean }>();

  let canvasRef: HTMLCanvasElement | null = null;
  let animationFrameId: number;

  interface ConfettiParticle {
    x: number;
    y: number;
    size: number;
    color: string;
    speedX: number;
    speedY: number;
    wobble: number;
    wobbleSpeed: number;
    rotation: number;
    rotationSpeed: number;
  }

  // Pre-allocate the particle pool to avoid GC churn
  const particlePool: ConfettiParticle[] = Array.from({ length: 150 }, () => ({
    x: 0,
    y: 0,
    size: 0,
    color: '',
    speedX: 0,
    speedY: 0,
    wobble: 0,
    wobbleSpeed: 0,
    rotation: 0,
    rotationSpeed: 0
  }));

  let activeCount = 0;
  let lastTime = 0;

  function triggerConfetti() {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    canvasRef.width = rect.width * window.devicePixelRatio;
    canvasRef.height = rect.height * window.devicePixelRatio;
    const ctx = canvasRef.getContext('2d')!;
    
    // Scale canvas once for high-DPI displays
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    const colors = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#c084fc'];
    activeCount = 150;
    lastTime = performance.now();

    // Reset particles in-place
    for (let i = 0; i < 150; i++) {
      const p = particlePool[i];
      p.x = rect.width / 2 + (Math.random() - 0.5) * 50;
      p.y = rect.height + 10;
      p.size = Math.random() * 8 + 6;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.speedX = (Math.random() - 0.5) * 15;
      p.speedY = -Math.random() * 15 - 10;
      p.wobble = Math.random() * Math.PI;
      p.wobbleSpeed = Math.random() * 0.1 + 0.05;
      p.rotation = Math.random() * Math.PI;
      p.rotationSpeed = (Math.random() - 0.5) * 0.2;
    }

    function update(currentTime: number) {
      if (!canvasRef || activeCount === 0) return;
      
      // Calculate normalized delta-time (dt = 1.0 at 60 FPS / 16.67ms)
      const elapsed = currentTime - lastTime;
      lastTime = currentTime;
      const dt = Math.min(elapsed / 16.667, 4.0); // Cap dt to avoid large leaps on lag spikes

      ctx.clearRect(0, 0, rect.width, rect.height);

      let writeIdx = 0;

      for (let i = 0; i < activeCount; i++) {
        const p = particlePool[i];
        
        // Scale physics by dt
        p.x += p.speedX * dt;
        p.y += p.speedY * dt;
        p.speedY += 0.4 * dt; // Gravity
        p.speedX *= Math.pow(0.98, dt); // Resistance
        p.wobble += p.wobbleSpeed * dt;
        p.rotation += p.rotationSpeed * dt;

        // Draw particle
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        
        const wobbleWidth = p.size * Math.sin(p.wobble);
        ctx.fillStyle = p.color;
        ctx.fillRect(-wobbleWidth / 2, -p.size / 2, wobbleWidth, p.size);
        ctx.restore();

        // Cull particles that fall below the screen (rect.height + 20)
        // If active, keep it in the active portion of the array
        if (p.y < rect.height + 20) {
          if (writeIdx !== i) {
            // Swap active particle to the front
            const temp = particlePool[writeIdx];
            particlePool[writeIdx] = p;
            particlePool[i] = temp;
          }
          writeIdx++;
        }
      }

      activeCount = writeIdx;

      if (activeCount > 0) {
        animationFrameId = requestAnimationFrame(update);
      } else {
        ctx.clearRect(0, 0, rect.width, rect.height);
      }
    }

    cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(update);
  }

  $effect(() => {
    if (active) {
      triggerConfetti();
    } else {
      cancelAnimationFrame(animationFrameId);
      if (canvasRef) {
        const ctx = canvasRef.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
        }
      }
    }
    // Svelte 5 native effect cleanup function runs on unmount or reactive change
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  });
</script>

<canvas bind:this={canvasRef} class="confetti-canvas"></canvas>

<style>
  .confetti-canvas {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 9999;
  }
</style>

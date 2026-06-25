import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, tick } from 'svelte';
import Confetti from '../src/lib/components/Confetti.svelte';

describe('Confetti Physics and Animation Loop', () => {
  let mockCtx: any;
  let rafCallbacks: ((time: number) => void)[] = [];
  let nextRafId = 1;
  let activeRafIds = new Set<number>();
  let performanceNowMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
    nextRafId = 1;
    activeRafIds.clear();

    // Mock Canvas 2D Context
    mockCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);

    // Mock getBoundingClientRect
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {}
    });

    // Mock requestAnimationFrame and cancelAnimationFrame
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (time: number) => void) => {
      const id = nextRafId++;
      activeRafIds.add(id);
      rafCallbacks.push(cb);
      return id;
    }));

    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      activeRafIds.delete(id);
      // Invalidate callbacks associated with cancelled frames
      rafCallbacks = [];
    }));

    // Mock performance.now
    let currentTime = 1000;
    performanceNowMock = vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should render canvas with correct styles and not start loop if active is false', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let props = $state({ active: false });
    const component = mount(Confetti, {
      target: container,
      props
    });

    await tick();

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.classList.contains('confetti-canvas')).toBe(true);

    // Loop should not be started
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    unmount(component);
    container.remove();
  });

  it('should start loop, initialize particles, and run animation when active is true', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Mock Math.random to return 0.5 for deterministic initialization
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    let props = $state({ active: true });
    const component = mount(Confetti, {
      target: container,
      props
    });

    await tick();

    // Loop should be started
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(1);

    // Context should be initialized (setTransform called)
    expect(mockCtx.setTransform).toHaveBeenCalled();

    // Verify particle initialization properties based on Math.random = 0.5
    // Each particle is reset in-place.
    // Let's run one frame.
    const frameCallback = rafCallbacks[0];
    rafCallbacks = [];

    // Trigger frame at t = 1016.67 (16.67ms elapsed, dt = 1.0)
    mockCtx.translate.mockClear();
    frameCallback(1016.67);

    // clearRect should be called during the frame update
    expect(mockCtx.clearRect).toHaveBeenCalled();

    // It should draw 150 particles
    expect(mockCtx.translate).toHaveBeenCalledTimes(150);
    // Since Math.random = 0.5:
    // x = 400 + (0.5 - 0.5)*50 = 400
    // y starts at 610. speedY = -17.5.
    // With dt = 1.0: y_new = 610 + (-17.5)*1.0 = 592.5
    // So all particles should be drawn at x = 400, y = 592.5
    const firstCallArgs = mockCtx.translate.mock.calls[0];
    expect(firstCallArgs[0]).toBeCloseTo(400);
    expect(firstCallArgs[1]).toBeCloseTo(592.5);

    randomSpy.mockRestore();
    unmount(component);
    container.remove();
  });

  it('should maintain frame-rate independent physics trajectories', async () => {
    // We will run two separate instances and compare the particle positions after 1 real-world second.
    // Instance A: Runs at 60 FPS (60 steps of 16.667ms)
    // Instance B: Runs at 120 FPS (120 steps of 8.333ms)

    const runSimulation = async (steps: number, stepMs: number): Promise<{ x: number; y: number }[]> => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      // Deterministic random
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

      let props = $state({ active: true });
      const component = mount(Confetti, {
        target: container,
        props
      });

      await tick();

      let time = 1000;
      for (let i = 0; i < steps; i++) {
        const callback = rafCallbacks[0];
        if (!callback) break;
        rafCallbacks = [];
        time += stepMs;
        mockCtx.translate.mockClear();
        callback(time);
      }

      // Capture final positions drawn on the last frame
      const draws = mockCtx.translate.mock.calls.map((call: any) => ({
        x: call[0],
        y: call[1]
      }));

      unmount(component);
      container.remove();
      randomSpy.mockRestore();
      return draws;
    };

    // Run 60 FPS simulation (60 frames of 16.667ms = 1000ms)
    const positions60 = await runSimulation(60, 16.667);

    // Run 120 FPS simulation (120 frames of 8.333ms = 1000ms)
    const positions120 = await runSimulation(120, 8.333);

    expect(positions60.length).toBe(150);
    expect(positions120.length).toBe(150);

    // Assert that the final positions are extremely close.
    // Because of Euler integration error, there will be a minor difference in position,
    // but it should be very small (e.g. less than 10 pixels) compared to the overall travel
    // (which is around 200-300 pixels).
    // In unoptimized code, 120 FPS would travel TWICE as far, leading to a difference of hundreds of pixels!
    for (let i = 0; i < 150; i++) {
      const diffX = Math.abs(positions60[i].x - positions120[i].x);
      const diffY = Math.abs(positions60[i].y - positions120[i].y);
      expect(diffX).toBeLessThan(0.1); // speedX is 0, so should be exactly 0
      expect(diffY).toBeLessThan(10.0); // Y position should be within 10 pixels
    }
  });

  it('should cull off-screen particles and stop the animation loop once all are dead', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Mock Math.random to return 0.5:
    // x = 400, y = 610, speedY = -17.5, gravity = 0.4
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    let props = $state({ active: true });
    const component = mount(Confetti, {
      target: container,
      props
    });

    await tick();

    // Verify it starts with 150 particles
    expect(rafCallbacks.length).toBe(1);

    let time = 1000;
    let frames = 0;
    
    // Step forward. Since particles shoot up and then fall down,
    // let's run frames until they all fall below y = 620.
    // Let's trace how many frames it takes:
    // speedY starts at -17.5.
    // Each step, speedY increases by 0.4.
    // It becomes positive after 17.5 / 0.4 = 43.75 frames.
    // Then it starts falling. It will return to y = 610 around frame 88.
    // It will cross y = 620 (culling boundary) shortly after.
    // By frame 100, all particles should have fallen below 620 and been culled.
    
    while (rafCallbacks.length > 0 && frames < 150) {
      const callback = rafCallbacks[0];
      rafCallbacks = [];
      time += 16.667;
      callback(time);
      frames++;
    }

    // The loop should have terminated because all particles fell off-screen
    expect(rafCallbacks.length).toBe(0);
    expect(frames).toBeLessThan(150); // Should terminate way before 150 frames
    
    // Last call to clearRect should have cleared the canvas completely
    expect(mockCtx.clearRect).toHaveBeenCalled();

    randomSpy.mockRestore();
    unmount(component);
    container.remove();
  });

  it('should clean up animation frames on unmount or active=false', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let props = $state({ active: true });
    const component = mount(Confetti, {
      target: container,
      props
    });

    await tick();
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(1);

    // Set active to false
    props.active = false;
    await tick();

    // Should cancel animation frame and clear canvas
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(rafCallbacks.length).toBe(0);
    expect(mockCtx.clearRect).toHaveBeenCalled();

    unmount(component);
    container.remove();
  });
});

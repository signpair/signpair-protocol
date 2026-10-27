// Damped harmonic oscillator, integrated in fixed sub-steps (semi-implicit Euler).
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

export function spring({ from = 0, to = 1, velocity = 0, stiffness = 170, damping = 22, mass = 1, precision = 0.002, onUpdate, onDone }) {
  let x = from, v = velocity, raf = 0, dead = false;
  let last = performance.now();
  const span = Math.max(Math.abs(to - from), 1e-9);
  const tick = (now) => {
    if (dead) return;
    const dt = Math.min((now - last) / 1000, 0.064);
    last = now;
    const n = Math.max(1, Math.round(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      v += ((-stiffness * (x - to) - damping * v) / mass) * h;
      x += v * h;
    }
    if (Math.abs(x - to) < precision * span && Math.abs(v) < precision * span * 4) {
      onUpdate(to);
      onDone && onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

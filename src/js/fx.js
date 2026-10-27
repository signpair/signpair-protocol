// Page-level motion: scroll progress, reveal stagger, parallax, spotlight, count-up.
import { spring, reduced } from './spring.js';

export function initProgress() {
  const bar = document.querySelector('#progress i');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  addEventListener('resize', paint);
  paint();
}

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    batch.forEach((entry, i) => {
      const el = entry.target;
      io.unobserve(el);
      const delay = i * 70;
      setTimeout(() => {
        spring({
          stiffness: 170, damping: 19,
          onUpdate: (p) => { el.style.opacity = String(Math.min(1, Math.max(0, p * 1.15))); el.style.transform = `translate3d(0, ${(1 - p) * 28}px, 0)`; },
          onDone: () => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('is-in'); }
        });
      }, delay);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => { e.classList.add('will-reveal'); io.observe(e); });
}

export function initParallax() {
  const hero = document.querySelector('.hero');
  if (!hero || reduced()) return;
  const layers = [...hero.querySelectorAll('[data-depth]')];
  const t = { x: 0, y: 0 }, c = { x: 0, y: 0 }, s = { x: 0, y: 0 };
  let live = false, raf = 0, last = 0;
  addEventListener('pointermove', (e) => {
    t.x = (e.clientX / innerWidth - 0.5) * 2;
    t.y = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
  const frame = (now) => {
    if (!live) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    const k = 1 - Math.exp(-dt * 7);
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k;
    s.y += (scrollY - s.y) * k;
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${(c.x * d * -20).toFixed(2)}px, ${(c.y * d * -14 + s.y * d * 0.16).toFixed(2)}px, 0)`;
    }
    raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([en]) => {
    live = en.isIntersecting;
    cancelAnimationFrame(raf);
    if (live) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }).observe(hero);
}

export function initSpotlight() {
  if (reduced()) return;
  let queued = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot], .row:not(.skel)');
    if (!el || queued) return;
    queued = requestAnimationFrame(() => {
      queued = null;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }, { passive: true });
}

// Spring-driven count-up. First paint counts from zero; later changes count from the
// previous value and flash by direction.
export function setNumber(el, to, fmt) {
  const prev = el._v;
  if (prev === to) return;
  el._v = to;
  if (el._stop) el._stop();
  if (!Number.isFinite(to)) { el.textContent = fmt(to); return; }
  if (reduced()) { el.textContent = fmt(to); return; }
  const from = Number.isFinite(prev) ? prev : 0;
  if (Number.isFinite(prev)) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(to > prev ? 'flash-up' : 'flash-down');
    clearTimeout(el._ft);
    el._ft = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 1100);
  }
  el._stop = spring({ from, to, stiffness: 110, damping: 19, onUpdate: (v) => { el.textContent = fmt(v); }, onDone: () => { el.textContent = fmt(to); } });
}

export function initCopy() {
  const live = document.getElementById('announce');
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn || btn.disabled) return;
    const text = btn.dataset.copy;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-only';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.classList.toggle('is-done', ok);
    btn.classList.toggle('is-fail', !ok);
    const label = btn.querySelector('.copy-txt');
    if (label) label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    if (live) live.textContent = ok ? 'Address copied' : 'Copy failed';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('is-done', 'is-fail');
      if (label) label.textContent = 'Copy';
      if (live) live.textContent = '';
    }, 1800);
  });
}

export function initTabs(onSort) {
  const list = document.querySelector('.tabs');
  const ink = list.querySelector('.tab-ink');
  const tabs = [...list.querySelectorAll('[role=tab]')];
  const place = () => {
    const a = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    ink.style.width = a.offsetWidth + 'px';
    ink.style.transform = `translateX(${a.offsetLeft}px)`;
  };
  const select = (t, focus) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    document.getElementById('panel').setAttribute('aria-labelledby', t.id);
    place();
    if (focus) t.focus();
    onSort(t.dataset.sort);
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t, false)));
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j >= 0) { e.preventDefault(); select(tabs[j], true); }
  });
  addEventListener('resize', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  place();
}

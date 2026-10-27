// Live board. Follows the market record in the register and nothing else.
import { setNumber, initTabs } from './fx.js';
import { reduced } from './spring.js';
import * as fmt from './format.js';

const reg = JSON.parse(document.getElementById('register').textContent).records;
const feed = reg.market;
const POLL_MS = (feed.pollSeconds || 60) * 1000;
const MAX_ADDR = 30;

const $ = (s, r = document) => r.querySelector(s);
const rowsEl = $('#rows');
const statusEl = $('#status');
const statusText = $('#status-text');
const noteEl = $('#board-note');
const tickerEl = $('#ticker');

const state = { rows: [], sort: 'volume', gen: 0, timer: 0, ctl: null, everLoaded: false, nodes: new Map() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, signal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener('abort', stop);
  const to = setTimeout(stop, 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(to); signal.removeEventListener('abort', stop); }
}

async function withBackoff(fn, signal, tries = 5) {
  let wait = 1000;
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if (signal.aborted || i >= tries - 1) throw err;
      await sleep(wait + Math.random() * 250);
      wait = Math.min(wait * 2, 16000);
    }
  }
}

async function fetchBoard(signal) {
  const boosts = await getJson(feed.url, signal);
  const seen = new Set();
  const addrs = [];
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string' && !seen.has(b.tokenAddress)) { seen.add(b.tokenAddress); addrs.push(b.tokenAddress); }
    if (addrs.length >= MAX_ADDR) break;
  }
  if (!addrs.length) throw new Error('no solana entries');
  const pairs = await getJson(feed.urlTokens.replace('{addresses}', addrs.join(',')), signal);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || p.chainId !== 'solana' || !p.baseToken) continue;
    const a = p.baseToken.address;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const cur = best.get(a);
    if (!cur || liq > cur._liq) best.set(a, { _liq: liq, p });
  }
  const rows = [...best.values()].map(({ p }) => ({
    address: p.baseToken.address,
    symbol: String(p.baseToken.symbol || '?'),
    name: String(p.baseToken.name || ''),
    image: p.info && typeof p.info.imageUrl === 'string' && p.info.imageUrl.startsWith('https://') ? p.info.imageUrl : '',
    price: Number(p.priceUsd),
    change: Number(p.priceChange && p.priceChange.h24),
    volume: Number(p.volume && p.volume.h24),
    liquidity: Number(p.liquidity && p.liquidity.usd)
  })).filter((r) => Number.isFinite(r.volume));
  rows.sort((a, b) => b.volume - a.volume);
  if (!rows.length) throw new Error('no pairs');
  return rows.slice(0, 10);
}

// ---- rendering ------------------------------------------------------------------
function tile(symbol, cls = '') {
  const t = document.createElement('span');
  t.className = 'logo-tile ' + cls;
  const hash = [...symbol].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  t.dataset.tone = String(hash % 5);
  t.textContent = (symbol.trim()[0] || '?').toUpperCase();
  return t;
}

function logo(row, cls = '') {
  if (!row.image) return tile(row.symbol, cls);
  const wrap = document.createElement('span');
  wrap.className = 'logo ' + cls;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => wrap.replaceWith(tile(row.symbol, cls)), { once: true });
  img.src = row.image;
  wrap.appendChild(img);
  return wrap;
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function buildRow(row) {
  const li = el('li', 'row');
  li.dataset.address = row.address;
  const n = el('span', 'c-n');
  const tok = el('span', 'c-tok');
  const names = el('span', 'names');
  names.append(el('b', 'sym', row.symbol), el('span', 'nm', row.name));
  tok.append(logo(row), names);
  const cells = {
    price: el('span', 'c-num c-price', fmt.DASH),
    change: el('span', 'c-num c-change', fmt.DASH),
    volume: el('span', 'c-num c-vol', fmt.DASH),
    liquidity: el('span', 'c-num c-liq', fmt.DASH)
  };
  for (const [k, lbl] of [['price', 'Price'], ['change', 'Day'], ['volume', 'Volume'], ['liquidity', 'Liquidity']]) cells[k].dataset.label = lbl;
  const btn = el('button', 'copy row-copy');
  btn.type = 'button';
  btn.dataset.copy = row.address;
  btn.setAttribute('aria-label', 'Copy address of ' + row.symbol);
  btn.innerHTML = '<span class="copy-ico"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-copy"/></svg></span><span class="copy-txt sr-only">Copy</span>';
  li.append(n, tok, cells.price, cells.change, cells.volume, cells.liquidity, btn);
  return { li, n, cells };
}

function applyRow(node, row, rank) {
  node.n.textContent = String(rank);
  setNumber(node.cells.price, row.price, fmt.price);
  setNumber(node.cells.change, row.change, fmt.change);
  setNumber(node.cells.volume, row.volume, fmt.money);
  setNumber(node.cells.liquidity, row.liquidity, fmt.money);
  node.cells.change.classList.toggle('is-up', row.change > 0);
  node.cells.change.classList.toggle('is-down', row.change < 0);
}

function sorted() {
  const key = state.sort;
  const by = { volume: (r) => r.volume, change: (r) => Math.abs(r.change || 0), liquidity: (r) => r.liquidity };
  return [...state.rows].sort((a, b) => by[key](b) - by[key](a));
}

function renderBoard() {
  const order = sorted();
  const first = !state.nodes.size;
  if (first) {
    rowsEl.replaceChildren();
    rowsEl.setAttribute('aria-busy', 'false');
  }
  const keep = new Set(order.map((r) => r.address));
  for (const [a, node] of state.nodes) if (!keep.has(a)) { node.li.remove(); state.nodes.delete(a); }
  order.forEach((row, i) => {
    let node = state.nodes.get(row.address);
    if (!node) {
      node = buildRow(row);
      state.nodes.set(row.address, node);
      if (!reduced()) { node.li.classList.add('enter'); node.li.style.setProperty('--i', String(i)); node.li.addEventListener('animationend', () => node.li.classList.remove('enter'), { once: true }); }
    }
    applyRow(node, row, i + 1);
    if (rowsEl.children[i] !== node.li) rowsEl.insertBefore(node.li, rowsEl.children[i] || null);
  });
}

function renderTicker() {
  const items = [...state.rows].sort((a, b) => b.volume - a.volume);
  const sig = items.map((r) => r.address).join();
  const half = (aria) => {
    const g = el('div', 'tick-set');
    if (aria) g.setAttribute('aria-hidden', 'true');
    for (const r of items) {
      const it = el('span', 'tick');
      const c = el('span', 'tick-c' + (r.change > 0 ? ' is-up' : r.change < 0 ? ' is-down' : ''), fmt.change(r.change));
      it.append(logo(r, 'sm'), el('b', 'tick-s', r.symbol), el('span', 'tick-p', fmt.price(r.price)), c);
      g.appendChild(it);
    }
    return g;
  };
  if (tickerEl.dataset.sig === sig) {
    // same set: refresh the values in place so the loop never restarts
    tickerEl.querySelectorAll('.tick-set').forEach((set) => {
      [...set.children].forEach((it, i) => {
        const r = items[i];
        it.querySelector('.tick-p').textContent = fmt.price(r.price);
        const c = it.querySelector('.tick-c');
        c.textContent = fmt.change(r.change);
        c.classList.toggle('is-up', r.change > 0);
        c.classList.toggle('is-down', r.change < 0);
      });
    });
    return;
  }
  tickerEl.dataset.sig = sig;
  tickerEl.replaceChildren(half(false), half(true));
  tickerEl.classList.add('is-live');
}

function renderStats() {
  const rows = state.rows;
  const stat = (k) => $(`[data-stat=${k}]`);
  if (!rows.length) { for (const k of ['count', 'volume', 'liquidity', 'mover']) stat(k).textContent = fmt.DASH; return; }
  setNumber(stat('count'), rows.length, fmt.count);
  setNumber(stat('volume'), rows.reduce((s, r) => s + (r.volume || 0), 0), fmt.money);
  setNumber(stat('liquidity'), rows.reduce((s, r) => s + (r.liquidity || 0), 0), fmt.money);
  const top = [...rows].filter((r) => Number.isFinite(r.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const m = stat('mover');
  m.textContent = top ? `${top.symbol} ${fmt.change(top.change)}` : fmt.DASH;
}

function showDashes() {
  rowsEl.replaceChildren();
  rowsEl.setAttribute('aria-busy', 'false');
  for (let i = 0; i < 10; i++) {
    const li = el('li', 'row is-empty');
    li.append(el('span', 'c-n', String(i + 1)), el('span', 'c-tok', fmt.DASH), ...['Price', 'Day', 'Volume', 'Liquidity'].map((l) => { const s = el('span', 'c-num', fmt.DASH); s.dataset.label = l; return s; }));
    rowsEl.appendChild(li);
  }
}

function setStatus(kind, text) {
  statusEl.dataset.state = kind;
  statusText.textContent = text;
}

function note(msg) {
  noteEl.hidden = !msg;
  noteEl.textContent = msg || '';
}

// ---- cycle -------------------------------------------------------------------------
async function cycle() {
  const gen = ++state.gen;
  if (state.ctl) state.ctl.abort();
  const ctl = (state.ctl = new AbortController());
  if (!state.everLoaded) setStatus('loading', 'Connecting');
  try {
    const rows = await withBackoff(() => fetchBoard(ctl.signal), ctl.signal);
    if (gen !== state.gen) return;
    state.rows = rows;
    state.everLoaded = true;
    renderBoard(); renderTicker(); renderStats();
    setStatus('live', 'Live');
    note('');
  } catch (err) {
    if (gen !== state.gen || ctl.signal.aborted) return;
    if (state.everLoaded) {
      setStatus('retry', 'Retrying');
      note('The feed did not answer. The last good board is still showing and a new attempt is coming.');
    } else {
      setStatus('down', 'Feed offline');
      showDashes(); renderStats();
      note('The market feed did not answer. Figures stay blank until it does.');
    }
  }
  if (gen === state.gen && !document.hidden) state.timer = setTimeout(cycle, POLL_MS);
}

export function startMarket() {
  initTabs((sort) => { state.sort = sort; if (state.rows.length) renderBoard(); });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(state.timer);
    if (document.hidden) { state.gen++; if (state.ctl) state.ctl.abort(); }
    else cycle();
  });
  if (!document.hidden) cycle();
}

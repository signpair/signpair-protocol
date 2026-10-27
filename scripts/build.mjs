// Builds src/ + brand/ into dist/. Exported so the gate harness can build mutants.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const LOGO_SOURCE = 'brand/LOGO SIGNPAIR PNG...png'; // the RGBA file with a real alpha channel

export function readTokens() {
  const css = fs.readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8');
  const out = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

// ---- register -------------------------------------------------------------
export function validateRegister(reg) {
  for (const [id, r] of Object.entries(reg.records)) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) throw new Error(`record ${id}: bad state`);
    if (r.state !== 'stated') {
      for (const k of ['value', 'url', 'urlTokens', 'handle']) if (k in r) throw new Error(`inert record ${id} carries ${k}`);
    }
  }
  const ca = reg.records.ca;
  if (ca.state === 'stated' && !SOL_ADDR.test(ca.value || '')) throw new Error('stated CA is not a Solana address');
}

export function handleOf(id, url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  if (id === 'x') return '@' + parts[0];
  if (id === 'github') return parts.slice(0, 2).join('/');
  return parts.join('/');
}

function publicRegister(reg) {
  const out = { records: {} };
  for (const [id, r] of Object.entries(reg.records)) {
    const { checked, ...rest } = r; // dates stay in src/data/register.json, never shipped
    out.records[id] = rest;
  }
  return out;
}

// ---- server-rendered, state-dependent fragments -----------------------------
function renderSocial(id, rec, svgId) {
  const label = rec.label;
  const icon = `<svg viewBox="${id === 'x' ? '0 0 24 24' : '0 0 16 16'}" aria-hidden="true" focusable="false"><use href="#${svgId}"/></svg>`;
  if (rec.state === 'stated') {
    return `<a class="soc" data-record="${id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}, ${esc(handleOf(id, rec.url))}">${icon}</a>`;
  }
  return `<a class="soc is-inert" data-record="${id}" data-state="${rec.state}" role="link" aria-disabled="true" aria-label="${esc(label)}, pending">${icon}</a>`;
}

function renderCa(rec) {
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-copy"/></svg>';
  if (rec.state === 'stated') {
    return `<div class="ca" data-ca-slot data-state="stated">
          <span class="ca-label">${esc(rec.label)}</span>
          <code class="ca-value" id="ca-value">${esc(rec.value)}</code>
          <button class="copy ca-copy" type="button" data-copy="${esc(rec.value)}" aria-label="Copy contract address"><span class="copy-ico">${copyIcon}</span><span class="copy-txt">Copy</span></button>
        </div>`;
  }
  return `<div class="ca" data-ca-slot data-state="${rec.state}">
          <span class="ca-label">${esc(rec.label)}</span>
          <span class="ca-value is-pending" id="ca-value">pending</span>
          <button class="copy ca-copy" type="button" disabled aria-disabled="true" aria-label="Copy contract address, pending"><span class="copy-ico">${copyIcon}</span><span class="copy-txt">Copy</span></button>
        </div>`;
}

function renderChips(reg) {
  const order = ['chain', 'ca', 'x', 'github', 'market'];
  return order.filter((id) => reg.records[id]).map((id) => {
    const r = reg.records[id];
    let val;
    if (r.state !== 'stated') val = '<span class="chip-v is-pending">pending</span>';
    else if ((id === 'x' || id === 'github') && r.url) val = `<a class="chip-v" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(handleOf(id, r.url))}</a>`;
    else if (id === 'ca') val = `<span class="chip-v mono wrapall">${esc(r.value)}</span>`;
    else val = `<span class="chip-v">${esc(r.value)}</span>`;
    const src = r.state === 'stated' && r.source ? `<span class="chip-s">${esc(r.source)}</span>` : '';
    return `<li class="chip" data-spot data-reveal data-record="${id}" data-state="${r.state}"><span class="chip-k">${esc(r.label)}</span> ${val} ${src}</li>`;
  }).join('\n        ');
}

// ---- assets -------------------------------------------------------------------
async function alphaBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1, w: info.width, h: info.height };
}

// Square crop around the artwork; sharp premultiplies alpha for the resize, so the
// pure-black transparent pixels in the source cannot bleed into the edges.
async function squareLogo(size, pad = 0.04) {
  const buf = fs.readFileSync(path.join(root, LOGO_SOURCE));
  const b = await alphaBox(buf);
  const side = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * (1 + pad * 2));
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const left = Math.max(0, Math.min(b.w - side, Math.round(cx - side / 2)));
  const top = Math.max(0, Math.min(b.h - side, Math.round(cy - side / 2)));
  return sharp(buf).extract({ left, top, width: side, height: side }).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 });
}

export async function traceFavicon(tokens) {
  const palette = ['--gold', '--gold-hi', '--gold-lo', '--silver-hi', '--silver', '--silver-lo'].map((k) => ({ k, hex: tokens[k] }));
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const { data } = await (await squareLogo(32, 0.02)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  for (let y = 0; y < 32; y++) {
    let run = null;
    const flush = () => { if (run) { rows.push(`<rect x="${run.x}" y="${y}" width="${run.w}" height="1" fill="${run.c}"/>`); run = null; } };
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      if (data[i + 3] < 128) { flush(); continue; }
      let best = palette[0], bd = Infinity;
      for (const p of palette) { const c = rgb(p.hex); const d = (c[0] - data[i]) ** 2 + (c[1] - data[i + 1]) ** 2 + (c[2] - data[i + 2]) ** 2; if (d < bd) { bd = d; best = p; } }
      if (run && run.c === best.hex && run.x + run.w === x) run.w++;
      else { flush(); run = { x, w: 1, c: best.hex }; }
    }
    flush();
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">\n${rows.join('\n')}\n</svg>\n`;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---- main -------------------------------------------------------------------------
export async function build({ outDir = path.join(root, 'dist'), register } = {}) {
  const reg = register || JSON.parse(fs.readFileSync(path.join(root, 'src/data/register.json'), 'utf8'));
  validateRegister(reg);
  const tokens = readTokens();

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  copyDir(path.join(root, 'src/styles'), path.join(outDir, 'styles'));
  copyDir(path.join(root, 'src/js'), path.join(outDir, 'js'));

  fs.mkdirSync(path.join(outDir, 'assets/fonts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), path.join(outDir, 'assets/fonts/inter.woff2'));
  fs.copyFileSync(path.join(root, 'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'), path.join(outDir, 'assets/fonts/jetbrains-mono.woff2'));

  await (await squareLogo(768)).toFile(path.join(outDir, 'assets/logo.png'));
  await (await squareLogo(128)).toFile(path.join(outDir, 'assets/logo-mark.png'));
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), await traceFavicon(tokens));

  let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const r = reg.records;
  const json = JSON.stringify(publicRegister(reg)).replace(/</g, '\\u003c');
  html = html
    .replace('{{theme_color}}', tokens['--ink-0'])
    .replace('{{socials}}', renderSocial('x', r.x, 'i-x') + '\n        ' + renderSocial('github', r.github, 'i-github'))
    .replace('{{ca_slot}}', renderCa(r.ca))
    .replace('{{registry_chips}}', renderChips(reg))
    .replace('{{register_json}}', json);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  fs.writeFileSync(path.join(outDir, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; connect-src https://api.dexscreener.com; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
    '/index.html',
    '  Cache-Control: no-cache',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return outDir;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('build.mjs')) {
  const out = await build();
  console.log('built ->', path.relative(root, out));
}

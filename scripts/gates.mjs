// Gate runner. Builds the real register into dist/ (already done by `npm run build`),
// then proves both branches of every record by building flipped mutants into .gate-tmp/.
// Mutation anchors are state-independent: each mutant reads the CURRENT record at
// runtime and flips it, so the harness is right whichever state the register holds.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { load } from 'cheerio';
import { build, validateRegister, handleOf, readTokens, LOGO_SOURCE } from './build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const DIST = path.join(root, 'dist');
const TMP = path.join(root, '.gate-tmp');
const read = (p) => fs.readFileSync(p, 'utf8');
const SRC_REG = JSON.parse(read(path.join(root, 'src/data/register.json')));

const results = [];
let currentGroup = 'core';
function gate(name, fn) {
  let ok = false, detail = '';
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async gate must use agate'); ok = r === undefined || r === true || (r && r.ok !== false); detail = r && r.detail ? r.detail : ''; if (r === false) ok = false; }
  catch (e) { ok = false; detail = e.message; }
  results.push({ group: currentGroup, name, ok, detail });
}
async function agate(name, fn) {
  let ok = false, detail = '';
  try { const r = await fn(); ok = r === undefined || r === true || (r && r.ok !== false); detail = r && r.detail ? r.detail : ''; } catch (e) { ok = false; detail = e.message; }
  results.push({ group: currentGroup, name, ok, detail });
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- shared scanners ------------------------------------------------------------
const B58 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const HEX40 = /\b0x[0-9a-fA-F]{40}\b/g;
export function scanAddresses(text, allowed) {
  const found = [];
  for (const m of text.matchAll(B58)) if (/[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /\d/.test(m[0])) found.push(m[0]);
  for (const m of text.matchAll(HEX40)) found.push(m[0]);
  return found.filter((a) => !allowed.has(a));
}
const DATE_PATTERNS = [
  /\b(19|20)\d{2}\b/, /\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\b(as of|checked|updated|last seen|ago|today|yesterday)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
];
export const findDates = (t) => DATE_PATTERNS.filter((re) => re.test(t)).map(String);
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\s*\(/;
const STOP = new Set('a an the and or but of in on at to for with by from as is are was be it its this that these those we you your our their i not no so if then than too very can will just into over under out up down more most each every all any both such only own same'.split(' '));
const BANNER = [
  'Pair Anything. Unlock Everything. 2,000+ PAIRS. HOLDERS EARN IN THE PAIR.',
  'PAIR YOUR COIN WITH ANYTHING. Launch coins paired with SOLANA and 4,084+ supported assets. Signpair brings a new dimension to Solana token launches, connecting crypto communities with the assets they know. BUILT ON SOLANA Signpair.fun'
].join(' ');
const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const bigrams = (t) => { const w = words(t), out = new Set(); for (let i = 0; i < w.length - 1; i++) if (!(STOP.has(w[i]) && STOP.has(w[i + 1]))) out.add(w[i] + ' ' + w[i + 1]); return out; };
export const sharedBigrams = (page, ref) => { const r = bigrams(ref); return [...bigrams(page)].filter((b) => r.has(b)); };

function textFiles(dir, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...textFiles(p, skip));
    else if (/\.(html|css|js|mjs|json|svg|txt|md|toml)$|^_headers$|^LICENSE$/.test(e.name)) out.push(p);
  }
  return out;
}
const visibleAndAttrs = ($) => { const c = $.root().clone(); const $c = load(c.html()); $c('script,style,svg').remove(); let t = $c('body').text(); $c('*').each((_, el) => { for (const [k, v] of Object.entries(el.attribs || {})) if (k !== 'class' && k !== 'href' && k !== 'src' && k !== 'id') t += ' ' + v; }); return t; };

// ---- per-output invariants (run on the real build and on every mutant) ---------
function invariants(dir, reg, tag) {
  const html = read(path.join(dir, 'index.html'));
  const $ = load(html);
  const R = reg.records;
  const stated = new Set(Object.values(R).filter((r) => r.state === 'stated' && r.value).map((r) => r.value));

  gate(`${tag}: CA slot sits in the header, before main, and matches record state`, () => {
    const slot = $('header .ca-band [data-ca-slot]');
    must(slot.length === 1, 'no CA slot in header');
    must(html.indexOf('data-ca-slot') < html.indexOf('<main'), 'CA slot after main');
    must(slot.attr('data-state') === R.ca.state, `slot state ${slot.attr('data-state')} != ${R.ca.state}`);
    const val = slot.find('.ca-value').text().trim();
    const btn = slot.find('.ca-copy');
    if (R.ca.state === 'stated') {
      must(val === R.ca.value, 'full address not shown'); must(btn.attr('disabled') === undefined && btn.attr('data-copy') === R.ca.value, 'copy button not live');
    } else {
      must(val === 'pending', 'inert CA must read pending'); must(btn.attr('disabled') !== undefined && btn.attr('data-copy') === undefined, 'inert copy button must be disabled with no payload');
      must(scanAddresses(slot.html(), new Set()).length === 0, 'inert CA slot carries an address');
    }
  });

  for (const [id, svg] of [['x', 'i-x'], ['github', 'i-github']]) {
    gate(`${tag}: ${id} icon renders, icon-only, href only when stated`, () => {
      const a = $(`header .socials a[data-record="${id}"]`);
      must(a.length === 1, 'icon missing'); must(a.find(`use[href="#${svg}"]`).length === 1, 'official glyph reference missing');
      must(a.text().trim() === '', 'icon carries visible text');
      if (R[id].state === 'stated') {
        must(a.attr('href') === R[id].url, 'href is not the stored url');
        must(a.attr('aria-label').includes(handleOf(id, R[id].url)), 'handle not derived from url');
      } else {
        must(a.attr('href') === undefined, 'inert icon has href'); must(a.attr('aria-disabled') === 'true', 'inert icon not aria-disabled');
      }
    });
  }

  gate(`${tag}: inert chips show label + pending only; stated chips carry their value`, () => {
    for (const [id, r] of Object.entries(R)) {
      const chip = $(`.chips [data-record="${id}"]`);
      must(chip.length === 1, `chip ${id} missing`);
      if (r.state !== 'stated') {
        must(chip.text().replace(/\s+/g, ' ').trim() === `${r.label} pending`, `inert chip ${id}: "${chip.text().trim()}"`);
        must(chip.find('[href]').length === 0, `inert chip ${id} has link`);
      } else must(chip.text().includes(r.value || handleOf(id, r.url || 'https://x/y')), `stated chip ${id} lacks value`);
    }
  });

  gate(`${tag}: shipped register is clean (inert records carry no value/url, no dates)`, () => {
    const j = JSON.parse($('#register').text());
    for (const [id, r] of Object.entries(j.records)) {
      must(!('checked' in r), `${id} ships a date`);
      if (r.state !== 'stated') for (const k of ['value', 'url', 'urlTokens']) must(!(k in r), `inert ${id} ships ${k}`);
    }
    validateRegister(reg);
  });

  gate(`${tag}: address scan - every address-shaped string matches a stated record (CA slot exempt)`, () => {
    const $c = load(html); $c('[data-ca-slot]').remove();
    let bad = scanAddresses($c.html(), stated);
    for (const f of textFiles(dir)) if (!f.endsWith('index.html')) bad = bad.concat(scanAddresses(read(f), stated));
    must(bad.length === 0, 'unregistered address-shaped strings: ' + bad.join(', '));
  });
}

// ===================================================================================
currentGroup = 'real build';
gate('dist/ exists with index.html', () => must(fs.existsSync(path.join(DIST, 'index.html')), 'run npm run build first'));
const html = read(path.join(DIST, 'index.html'));
const $ = load(html);
invariants(DIST, SRC_REG, 'real');

currentGroup = 'logo + favicon';
await agate('logo files are copied into dist/ and index.html references resolve (relative paths)', async () => {
  const refs = $('img[src]').map((_, e) => $(e).attr('src')).get().filter((s) => s.includes('logo'));
  must(refs.length >= 2, 'logo not referenced'); const lowered = refs.join();
  must(/assets\/logo\.png/.test(lowered) && /assets\/logo-mark\.png/.test(lowered), 'expected both logo files referenced');
  for (const r of refs) { must(!r.startsWith('/') && !r.startsWith('..') && !/^[a-z]+:/i.test(r), 'path not relative: ' + r); must(fs.existsSync(path.join(DIST, r)), 'missing in dist: ' + r); }
  const meta = await sharp(path.join(DIST, 'assets/logo.png')).metadata();
  must(meta.format === 'png' && meta.hasAlpha && meta.width === 768, 'logo.png wrong shape');
});
await agate('logo resize is premultiplied: no dark fringe on semi-transparent edge pixels', async () => {
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const stat = async (f, ratioOnly) => { const { data } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); let s = 0, n = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 32 && data[i + 3] < 224) { s += lum(data, i); n++; } return s / Math.max(n, 1); };
  const src = await stat(path.join(root, LOGO_SOURCE)), out = await stat(path.join(DIST, 'assets/logo.png'));
  must(out >= src * 0.9, `edge luminance ${out.toFixed(1)} vs source ${src.toFixed(1)}`);
  return { detail: `edge luminance out ${out.toFixed(1)} / source ${src.toFixed(1)}` };
});
gate('favicon: svg 32x32, linked, no double hyphen in any comment, colours drawn from tokens', () => {
  const svg = read(path.join(DIST, 'favicon.svg'));
  must(/width="32"/.test(svg) && /height="32"/.test(svg) && /viewBox="0 0 32 32"/.test(svg), 'not 32x32');
  must($('link[rel=icon][href="favicon.svg"]').length === 1, 'not linked');
  for (const c of svg.matchAll(/<!--([\s\S]*?)-->/g)) must(!c[1].includes('--'), 'double hyphen inside comment');
  must(!/<\?xml/.test(svg), 'xml prolog present');
  const tok = new Set(Object.values(readTokens()));
  for (const m of svg.matchAll(/fill="(#[0-9a-f]{6})"/g)) must(tok.has(m[1]), 'colour not in tokens: ' + m[1]);
  must((svg.match(/<rect/g) || []).length > 40, 'trace looks empty');
});

currentGroup = 'palette + provenance';
await agate('every token is a real pixel: value re-read from the asset at its stated coordinate', async () => {
  const css = read(path.join(root, 'src/styles/tokens.css'));
  const map = { 'brand transparent PNG': 'brand/LOGO SIGNPAIR PNG...png', 'brand opaque PNG': 'brand/LOGO SIGNPAIR PNG.png', 'reference/SIGNPAIR 1': 'reference/SIGNPAIR 1.jpg.jpeg' };
  let n = 0;
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});\s*\/\*\s*(.+?)\s*@\((\d+),(\d+)\)/g)) {
    const key = Object.keys(map).find((k) => m[3].startsWith(k)); must(key, 'unknown source for ' + m[1]);
    const { data, info } = await sharp(path.join(root, map[key])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Number(m[5]) * info.width + Number(m[4])) * 4;
    const got = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    must(got === m[2], `${m[1]} ${m[2]} but pixel is ${got}`); n++;
  }
  must(n >= 10, 'too few provenance lines: ' + n);
  return { detail: n + ' tokens verified' };
});
gate('colour literals live in tokens.css only (src + dist, theme-color derived)', () => {
  const files = [...textFiles(path.join(root, 'src')), ...textFiles(DIST)].filter((f) => !/tokens\.css$|favicon\.svg$/.test(f));
  for (const f of files) {
    let t = read(f);
    if (f.endsWith('index.html')) t = t.replace(/<meta name="theme-color" content="#[0-9a-f]{6}">/, '');
    must(!COLOUR_LITERAL.test(t), 'literal in ' + path.relative(root, f));
  }
  must(Object.values(readTokens()).includes(/theme-color" content="(#[0-9a-f]{6})"/.exec(html)[1]), 'theme-color not a token');
});
gate('no ch units anywhere in css', () => { for (const f of textFiles(path.join(DIST, 'styles'))) must(!/\d(\.\d+)?ch\b/.test(read(f)), 'ch unit in ' + f); });

currentGroup = 'no dates';
gate('no dates, clocks, "as of", "checked" in visible text, attributes (aria-label, title, alt) or tooltips', () => { const hits = findDates(visibleAndAttrs($)); must(hits.length === 0, 'matched: ' + hits.join(' | ')); });
gate('no date or time APIs and no date strings in shipped js/css/json', () => {
  for (const f of textFiles(DIST)) { if (f.endsWith('index.html')) continue; const t = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    must(!/\bDate\b|toLocale(Date|Time)|DateTimeFormat|RelativeTimeFormat|Date\.now/.test(t), 'date API in ' + path.basename(f));
    if (!/\.(js|svg)$/.test(f)) must(findDates(t).length === 0, 'date pattern in ' + path.basename(f)); }
});
gate('register.json keeps dates as data; dist/ carries none of them', () => {
  must(Object.values(SRC_REG.records).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.checked)), 'src register lacks checked dates');
  must(!/"checked"/.test(html), 'checked key shipped');
});

currentGroup = 'copy + numbers';
gate('no static numerals: nothing on the page asserts a figure before live data arrives', () => {
  const $c = load(html); $c('script,style,svg').remove(); const t = $c('body').text();
  must(!/\d{2,}/.test(t), 'numeric text: ' + (t.match(/\S*\d{2,}\S*/) || [''])[0]);
});
gate('copy shares zero non-trivial 2-grams with the supplied reference banners', () => { const s = sharedBigrams(visibleAndAttrs($), BANNER); must(s.length === 0, 'shared: ' + s.join(' | ')); });

currentGroup = 'social + CA + chain layout';
gate('both social icons are the last items of the top bar and never hidden by a media query', () => {
  const bar = $('header .bar'); must(bar.children().last().hasClass('socials'), 'socials not last in bar');
  must($('header .socials a.soc').length === 2, 'expected two icons');
  const css = read(path.join(DIST, 'styles/main.css'));
  for (const m of css.matchAll(/([^{}]*\.soc[^{}]*)\{([^}]*)\}/g)) must(!/display:\s*none/.test(m[2]), 'hidden rule: ' + m[1].trim());
  must(/\.socials\s*\{[^}]*margin-left:\s*auto/.test(css), 'socials not pushed right');
});
gate('official marks: X glyph path and GitHub Octicon path are present verbatim', () => {
  must(html.includes('M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'), 'X path');
  must(html.includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38'), 'octicon path');
});
gate('CA value is large (min font size >= 18px) and wraps rather than clips', () => {
  const css = read(path.join(DIST, 'styles/main.css')); const m = /\.ca-value\s*\{[^}]*font:\s*\d+\s+clamp\((\d+)px/.exec(css);
  must(m && Number(m[1]) >= 18, 'ca-value font too small'); must(/\.ca-value\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css), 'no wrap');
});

currentGroup = 'market';
gate('market register record is stated and drives the feed; urls exactly as specified', () => {
  const m = SRC_REG.records.market; must(m.state === 'stated', 'market not stated');
  must(m.url === 'https://api.dexscreener.com/token-boosts/top/v1', 'boosts url'); must(m.urlTokens === 'https://api.dexscreener.com/tokens/v1/solana/{addresses}', 'tokens url'); must(m.pollSeconds === 60, 'poll');
});
gate('market.js reads only the market record, never the CA record or slot', () => {
  const js = read(path.join(DIST, 'js/market.js'));
  const used = new Set([...js.matchAll(/\breg\.(\w+)/g)].map((m) => m[1])); must([...used].every((k) => k === 'market') && used.size === 1, 'reads: ' + [...used]);
  must(!/records\.ca|data-ca|ca-value|ca-slot/.test(js), 'touches CA');
});
gate('market.js: solana filter, imageUrl, top 10 by 24h volume, letter-tile fallback, copy-per-address', () => {
  const js = read(path.join(DIST, 'js/market.js'));
  for (const [re, w] of [[/chainId === 'solana'/, 'solana filter'], [/imageUrl/, 'imageUrl'], [/slice\(0, 10\)/, 'top 10'], [/volume\.h24|volume && p\.volume\.h24/, 'h24 volume'], [/logo-tile/, 'tile'], [/addEventListener\('error'/, 'img onerror'], [/btn\.dataset\.copy = row\.address/, 'copy address']]) must(re.test(js), 'missing ' + w);
});
gate('market.js: exponential backoff, 60s poll, pause on hidden, immediate fetch on visible, last good data kept', () => {
  const js = read(path.join(DIST, 'js/market.js'));
  must(/wait = Math\.min\(wait \* 2/.test(js), 'backoff'); must(/POLL_MS/.test(js) && /pollSeconds \|\| 60/.test(js), 'poll');
  must(/visibilitychange/.test(js) && /document\.hidden/.test(js) && /else cycle\(\)/.test(js), 'visibility');
  must(/everLoaded/.test(js) && /showDashes/.test(js) && /last good board/.test(js), 'stale/dash handling');
});
gate('ticker, skeleton rows, stagger fade-in and status pill all present', () => {
  must($('#ticker').length === 1 && $('#rows .row.skel').length === 10 && $('#status .pulse-dot').length === 1, 'static structure');
  const css = read(path.join(DIST, 'styles/main.css')); must(/\.row\.enter/.test(css) && /calc\(var\(--i/.test(css) && /@keyframes marquee/.test(css) && /@keyframes pulse/.test(css), 'css motion');
});

currentGroup = 'motion';
gate('prefers-reduced-motion: css kills animation+transition, js gates every motion path', () => {
  const css = read(path.join(DIST, 'styles/main.css'));
  must(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/.test(css), 'css fallback');
  const fx = read(path.join(DIST, 'js/fx.js')), sp = read(path.join(DIST, 'js/spring.js')), mk = read(path.join(DIST, 'js/market.js'));
  must(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(sp), 'matchMedia'); must((fx.match(/reduced\(\)/g) || []).length >= 4 && /reduced\(\)/.test(mk), 'js paths');
});
gate('spring solver, parallax, scroll progress, spotlight, count-up flash are wired', () => {
  const fx = read(path.join(DIST, 'js/fx.js')), sp = read(path.join(DIST, 'js/spring.js'));
  must(/stiffness/.test(sp) && /damping/.test(sp), 'damped solver'); for (const w of ['initParallax', 'initProgress', 'initSpotlight', 'initReveal', 'flash-up', 'data-depth', '--mx']) must(fx.includes(w), 'missing ' + w);
  must($('.progress').length === 1 && $('[data-depth]').length >= 3 && $('.mesh .blob').length === 3, 'html hooks');
});
gate('every shipped js file parses', () => { for (const f of fs.readdirSync(path.join(DIST, 'js'))) { const r = spawnSync(process.execPath, ['--check', path.join(DIST, 'js', f)], { encoding: 'utf8' }); must(r.status === 0, f + ': ' + r.stderr); } });

currentGroup = 'repo hygiene';
gate('no assistant config file, no assistant dot-directory, no attribution strings in project files', () => {
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.gate-tmp') continue; const p = path.join(d, e.name); o.push(p); if (e.isDirectory()) walk(p, o); } return o; };
  const all = walk(root);
  const nm = 'clau' + 'de';
  must(!all.some((p) => new RegExp('(^|[\\\\/])(' + nm + '\\.md|\\.' + nm + ')$', 'i').test(p)), 'forbidden path present');
  const bad = new RegExp(['clau' + 'de', 'anthro' + 'pic', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot', 'generated ' + '(by|with)', 'artificial ' + 'intelligence', '\\bLL' + 'M\\b'].join('|'), 'i');
  const badCase = new RegExp('\\b' + 'A' + 'I\\b');
  for (const f of all.filter((p) => fs.statSync(p).isFile() && /\.(md|json|html|css|js|mjs|svg|txt)$|LICENSE|_headers/.test(p) && !/package-lock/.test(p))) { const t = read(f); must(!bad.test(t) && !badCase.test(t), 'attribution string in ' + path.relative(root, f)); }
});
gate('README.md, docs/whitepaper.md, LICENSE exist in project root and not in dist/', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) { must(fs.existsSync(path.join(root, f)), 'missing ' + f); }
  for (const f of ['README.md', 'LICENSE', 'whitepaper.md', 'docs']) must(!fs.existsSync(path.join(DIST, f)), f + ' leaked into dist');
  const lic = read(path.join(root, 'LICENSE')); must(/MIT License/.test(lic) && /Copyright \(c\) 2026 Signpair/.test(lic), 'license text');
  const rd = read(path.join(root, 'README.md')); for (const w of ['Signpair', 'signpair.fun', 'Solana', 'Overview', 'Features', 'Links', 'pending']) must(rd.includes(w), 'README lacks ' + w);
  const wp = read(path.join(root, 'docs/whitepaper.md')); for (const w of ['Vision', 'Mission', 'Tokenomics', 'Roadmap', 'Team']) must(wp.includes(w), 'whitepaper lacks ' + w);
  must((wp.match(/^### Phase/gm) || []).length >= 3, 'roadmap phases');
});
gate('dist/ holds no source assets (brand/, reference/, originals)', () => { for (const f of textFiles(DIST).concat(fs.readdirSync(path.join(DIST, 'assets')))) must(!/SAMPUL|SIGNPAIR \d|LOGO SIGNPAIR/i.test(String(f)), 'original in dist: ' + f); });

currentGroup = 'branch proof (mutants)';
fs.rmSync(TMP, { recursive: true, force: true });
const flip = (reg, ids) => {
  const m = JSON.parse(JSON.stringify(reg));
  for (const id of ids) {
    const r = m.records[id];
    if (r.state === 'stated') { r.state = 'absent'; delete r.value; delete r.url; delete r.urlTokens; }
    else { r.state = 'stated'; if (id === 'ca') r.value = synthAddress(); else r.url = id === 'x' ? 'https://x.com/signpair_mutant' : 'https://github.com/signpair-mutant/site'; }
  }
  return m;
};
function synthAddress() { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let s = 7, o = ''; for (let i = 0; i < 44; i++) { s = (s * 1103515245 + 12345) % 2147483648; o += A[s % A.length]; } return o; }
const strip = (reg) => JSON.stringify(reg.records.market);
const marketView = (dir) => { const $m = load(read(path.join(dir, 'index.html'))); return [$m('#board').html(), $m('.ticker').html(), $m('.tiles').html(), read(path.join(dir, 'js/market.js')), JSON.stringify(JSON.parse($m('#register').text()).records.market)].join('\u0000'); };
const baseMarket = marketView(DIST);
const mutants = { 'flip ca': ['ca'], 'flip x': ['x'], 'flip github': ['github'], 'flip all three': ['ca', 'x', 'github'] };
for (const [name, ids] of Object.entries(mutants)) {
  const reg = flip(SRC_REG, ids);
  const dir = path.join(TMP, name.replace(/\s+/g, '-'));
  await build({ outDir: dir, register: reg });
  invariants(dir, reg, name);
  gate(`${name}: market output is byte-identical to the real build (CA state has zero effect)`, () => must(marketView(dir) === baseMarket, 'market output changed'));
  gate(`${name}: state actually flipped (${ids.map((i) => `${i} ${SRC_REG.records[i].state} -> ${reg.records[i].state}`).join(', ')})`, () => { for (const i of ids) must(reg.records[i].state !== SRC_REG.records[i].state, i + ' did not flip'); });
}
currentGroup = 'negative controls';
gate('validator rejects an inert record that carries value or url', () => {
  for (const k of ['value', 'url']) { const m = JSON.parse(JSON.stringify(SRC_REG)); m.records.x = { label: 'X', state: 'absent', [k]: 'https://x.com/a' }; let threw = false; try { validateRegister(m); } catch { threw = true; } must(threw, k + ' accepted'); }
});
gate('address scanner flags an unregistered base58 and an unregistered 0x string', () => {
  must(scanAddresses(' ' + synthAddress() + ' ', new Set()).length === 1, 'base58 missed'); must(scanAddresses(' 0x' + 'ab12'.repeat(10) + ' ', new Set()).length === 1, '0x missed');
});
gate('address scanner does not blanket-reject 0x: a registered 0x string passes', () => { const a = '0x' + 'ab12'.repeat(10); must(scanAddresses(a, new Set([a])).length === 0, 'registered 0x rejected'); });
gate('date detector fires on dates, clocks, "as of"; literal detector fires on hex and rgb()', () => {
  for (const s of ['Oct 3', '2026-10-27', '12:30', 'as of now', 'checked']) must(findDates(s).length > 0, 'missed ' + s);
  must(COLOUR_LITERAL.test('color:#abc123') && COLOUR_LITERAL.test('rgb(0 0 0)'), 'literal detector');
});
gate('2-gram detector fires on a phrase lifted from the banner', () => { must(sharedBigrams('we say pair anything today', BANNER).length > 0, 'missed'); });

fs.rmSync(TMP, { recursive: true, force: true });

// ---- report ---------------------------------------------------------------------------
let lastGroup = '';
for (const r of results) { if (r.group !== lastGroup) { console.log(`\n[${r.group}]`); lastGroup = r.group; } console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  :: ' + r.detail : ''}`); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);

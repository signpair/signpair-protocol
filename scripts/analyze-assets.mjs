// Reads every file in brand/ and reference/: container header, alpha histogram,
// dominant pixels, and a k-means palette snapped to real pixel coordinates.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function ihdr(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const types = { 0: 'grayscale', 2: 'truecolor', 3: 'indexed', 4: 'gray+alpha', 6: 'RGBA' };
  const ct = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colourType: ct, colourName: types[ct] };
}

function kmeans(px, k, iters = 14) {
  const cs = [];
  for (let i = 0; i < k; i++) cs.push(px[Math.floor(((i + 0.5) / k) * px.length)].c.slice());
  let assign = new Int32Array(px.length);
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cs.forEach((c, j) => {
        const d = (p.c[0] - c[0]) ** 2 + (p.c[1] - c[1]) ** 2 + (p.c[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      });
      assign[i] = best;
      sum[best][0] += p.c[0]; sum[best][1] += p.c[1]; sum[best][2] += p.c[2]; sum[best][3]++;
    });
    sum.forEach((s, j) => { if (s[3]) cs[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  return cs.map((c, j) => {
    let best = null, bd = Infinity, n = 0;
    px.forEach((p, i) => {
      if (assign[i] !== j) return;
      n++;
      const d = (p.c[0] - c[0]) ** 2 + (p.c[1] - c[1]) ** 2 + (p.c[2] - c[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    });
    return { share: n / px.length, centroid: hex(c.map(Math.round)), snapped: hex(best.c), x: best.x, y: best.y };
  });
}

for (const dir of ['brand', 'reference']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const file = path.join(root, dir, f);
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf).metadata();
    const head = ihdr(buf);
    console.log(`\n== ${dir}/${f}  ${buf.length} bytes  ${meta.format} ${meta.width}x${meta.height} channels=${meta.channels} alpha=${meta.hasAlpha}`);
    if (head) console.log('   IHDR', JSON.stringify(head));
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const hist = { a0: 0, a1_254: 0, a255: 0 };
    let blackTransparent = 0;
    const step = Math.max(1, Math.floor(Math.min(W, H) / 220));
    const samples = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = data[i + 3];
      if (a === 0) { hist.a0++; if (!data[i] && !data[i + 1] && !data[i + 2]) blackTransparent++; }
      else if (a === 255) hist.a255++; else hist.a1_254++;
      if (x % step === 0 && y % step === 0 && a > 0) samples.push({ x, y, c: [data[i], data[i + 1], data[i + 2]] });
    }
    console.log('   alpha histogram', JSON.stringify(hist), 'pure-black fully-transparent px:', blackTransparent);
    const km = kmeans(samples, 8);
    km.sort((a, b) => b.share - a.share).forEach((k) => console.log(`   k-means ${(k.share * 100).toFixed(1).padStart(5)}%  centroid ${k.centroid}  snapped ${k.snapped} @(${k.x},${k.y})`));
  }
}

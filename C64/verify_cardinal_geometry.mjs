// Host geometry properties and optional actual- bitmap connectivity check.
// Usage: node verify_cardinal_geometry.mjs [previews/rdxtalk.png]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const basic = readFileSync(path.join(here, 'rdxtalk.bas'), 'ascii');
const runtime = readFileSync(path.join(here, 'bitmap-runtime.inc'), 'ascii').trim();
const embedded = basic.trim().split(/\r?\n/).filter(line => parseInt(line) >= 30000).join('\n');
assert.equal(embedded, runtime.replaceAll('\r\n', '\n'), 'Shared renderer differs');
assert(!basic.split(/\r?\n/).some(line => parseInt(line) < 30000 && /\bDATA\b/.test(line)),
  'Earlier DATA would break the BASIC V2 runtime loader');
for (const expected of ['P1 WEST / P2 NORTH', 'P3 SOUTH / P4 EAST',
  'S21: W-N / S31 NEAR: W-S', 'S41 FAR: W-E',
  'CORE MODEL EXCLUDES FANOUTS/BENDS', 'CENTRE RULE IS NOT BODY CLEARANCE']) {
  assert(basic.includes(expected), `Missing port/model description: ${expected}`);
}

function layout(input) {
  const { DW, SG, L, PP, PW, PL, FL, PG } = input;
  const margin = PP - PW;
  let feed = Math.max(FL, 2 * PP - PW / 2, DW / 2 + margin);
  let arm = feed + PL / 2;
  const minimumCenterSeparation = DW + SG / 2;
  if (Math.hypot(arm, arm + minimumCenterSeparation) < PG) {
    arm = (Math.sqrt(2 * PG * PG - minimumCenterSeparation ** 2) - minimumCenterSeparation) / 2;
    feed = arm - PL / 2;
  }
  return { ...input, margin, feed, arm, halfLength: L * 500 };
}
function contacts(model, factor = 1) {
  const { DW, SG, PP, PW, PL, arm, halfLength: x } = model;
  const y = (DW + factor * SG) / 2;
  const ports = [
    { port: 1, side: 'W', x: -x - arm, y, vertical: false },
    { port: 2, side: 'N', x, y: y + arm, vertical: true },
    { port: 3, side: 'S', x: -x, y: -y - arm, vertical: true },
    { port: 4, side: 'E', x: x + arm, y: -y, vertical: false },
  ];
  const pads = ports.flatMap(port => [-1, 0, 1].map(index => {
    const cx = port.x + (port.vertical ? index * PP : 0);
    const cy = port.y + (port.vertical ? 0 : index * PP);
    const halfX = (port.vertical ? PW : PL) / 2;
    const halfY = (port.vertical ? PL : PW) / 2;
    return { port: port.port, contact: index === 0 ? 'S' : 'G',
      x: cx, y: cy, bounds: [cx - halfX, cy - halfY, cx + halfX, cy + halfY] };
  }));
  return { ports, pads, y };
}
function overlaps(a, b) {
  const epsilon = 1e-7;
  return a[0] < b[2] - epsilon && a[2] > b[0] + epsilon &&
    a[1] < b[3] - epsilon && a[3] > b[1] + epsilon;
}
function verify(model) {
  assert(model.feed >= model.FL - 1e-7, 'Requested feed length decreased');
  assert(model.feed >= model.DW / 2 + model.margin - 1e-7, 'Ground pad/core margin absent');
  for (const factor of [.5, 1, 2]) {
    const { ports, pads, y } = contacts(model, factor);
    assert.equal(new Set(ports.map(port => port.side)).size, 4);
    for (const [i, j] of [[0, 1], [1, 3], [3, 2], [2, 0]]) {
      const a = ports[i], b = ports[j];
      assert(Math.hypot(a.x - b.x, a.y - b.y) >= model.PG - 1e-6,
        'Adjacent signal-pad center spacing below target');
    }
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
      assert(!overlaps(pads[i].bounds, pads[j].bounds), 'Landing pad rectangles overlap');
    }
    const x = model.halfLength, w = model.DW / 2;
    const cores = [[-x, y - w, x, y + w], [-x, -y - w, x, -y + w]];
    for (const pad of pads.filter(pad => pad.contact === 'G')) {
      assert(!cores.some(core => overlaps(pad.bounds, core)), 'Ground pad touches signal core');
    }
  }
}

const defaults = layout({ DW: 45, SG: 20, L: 5, PP: 150, PW: 80, PL: 100, FL: 500, PG: 1000 });
assert(Math.abs(defaults.feed - 629.0718293280592) < 1e-8);
assert(Math.abs(defaults.arm - 679.0718293280592) < 1e-8);
const expected = [[-3179.0718293280593, 32.5], [2500, 711.5718293280592],
  [-2500, -711.5718293280592], [3179.0718293280593, -32.5]];
contacts(defaults).ports.forEach((port, i) => {
  assert(Math.abs(port.x - expected[i][0]) < 1e-8);
  assert(Math.abs(port.y - expected[i][1]) < 1e-8);
});
verify(defaults);
console.log('PASS default cardinal fanout length, arm and all four port coordinates');
for (const pad of contacts(defaults).pads) {
  console.log(`P${pad.port} ${pad.contact}: (${pad.x.toFixed(6)}, ${pad.y.toFixed(6)}) um`);
}

let seed = 0xc64f2026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
for (let index = 0; index < 20000; index++) {
  const PP = 1.01 + random() * 4998.99;
  verify(layout({ DW: .1 + random() * 19999.9, SG: .1 + random() * 9999.9,
    L: .000001 + random() * 999.999999, PP, PW: 1 + random() * (PP - 1),
    PL: 1 + random() * 999999, FL: 1 + random() * 999999, PG: 1 + random() * 99999 }));
}
console.log('PASS 20,000 deterministic random geometries, all three gap DOEs');
console.log('PASS no overlapping landing pads or ground-pad/core intersections');

if (process.argv[2]) {
  // bitmap-preview.mjs writes filter-zero RGB PNGs at four-by-two scaling.
  const png = readFileSync(path.resolve(process.argv[2]));
  const chunks = []; let at = 8, width, height;
  while (at < png.length) {
    const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IHDR') { width = png.readUInt32BE(at + 8); height = png.readUInt32BE(at + 12); }
    if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  assert.equal(width, 640); assert.equal(height, 400);
  const pixels = inflateSync(Buffer.concat(chunks));
  function rgb(x, y) {
    const offset = y * 2 * (width * 3 + 1) + 1 + x * 4 * 3;
    return (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
  }
  const signal = 0xbfce72, ground = 0x67b6bd;
  const portPixels = [[13, 82], [110, 20], [50, 180], [146, 118]];
  portPixels.forEach(([x, y]) => assert.equal(rgb(x, y), signal, 'Signal contact missing'));
  for (const [x, y] of [[13, 58], [13, 106], [98, 20], [122, 20],
    [38, 180], [62, 180], [146, 94], [146, 142]]) {
    assert.equal(rgb(x, y), ground, 'Ground contact missing or incorrectly rotated');
  }
  const labels = new Int32Array(160 * 200); let component = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 160; x++) {
    if (labels[y * 160 + x] || rgb(x, y) !== signal) continue;
    component++; const queue = [[x, y]]; labels[y * 160 + x] = component;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx > 159 || ny < 0 || ny > 199 || labels[ny * 160 + nx] || rgb(nx, ny) !== signal) continue;
        labels[ny * 160 + nx] = component; queue.push([nx, ny]);
      }
    }
  }
  const nets = portPixels.map(([x, y]) => labels[y * 160 + x]);
  assert.equal(component, 2, 'Expected exactly two signal nets');
  assert.equal(nets[0], nets[1], 'Aggressor must connect W to N');
  assert.equal(nets[2], nets[3], 'Victim must connect S to E');
  assert.notEqual(nets[0], nets[2], 'Aggressor and victim must not short');
  console.log('PASS actual bitmap: twelve rotated GSG contacts, W-N/S-E connectivity, no crossover');
}

// Usage: node verify_bitmap.mjs "C:\path\to\VICE"
// Exercise the production drawing subroutines and decode actual bitmap RAM.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViceTestClient } from './vice-test-client.mjs';
import { captureBitmap } from './bitmap-preview.mjs';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const vice = process.argv[2];
if (!vice) throw Error('Supply the VICE executable directory.');
const client = await ViceTestClient.start(vice, 6530);
const previews = path.join(root, 'previews'); mkdirSync(previews, { recursive: true });
const onlyArgument = process.argv.indexOf('--only');
const selected = onlyArgument < 0 ? null : new Set(process.argv[onlyArgument + 1].split(','));
const results = selected ? readFileSync(path.join(root, 'bitmap-validation.txt'), 'utf8')
  .split(/\r?\n/).filter(line => line.startsWith('PASS ') && line.includes(':') &&
    !selected.has(line.slice(5).split(':')[0])) : [];
const record = message => { results.push(message); console.log(message); };
function compile(name, lines) {
  lines.sort((a, b) => parseInt(a) - parseInt(b));
  const source = path.join(client.temporary, name + '.bas');
  const output = path.join(client.temporary, name + '.prg');
  writeFileSync(source, lines.join('\n').toLowerCase(), 'ascii');
  execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', output, '--', source]);
  return output;
}
async function assertTextMode() {
  const mode = await client.mode();
  if (mode.bitmap || mode.multicolor || mode.extended || mode.bank !== 3) {
    throw Error('Expected standard text mode: ' + JSON.stringify(mode));
  }
}
async function waitBitmap(waitLine) {
  const until = Date.now() + 120000;
  do {
    const mode = await client.mode();
    if (mode.bitmap && mode.multicolor && !mode.extended && mode.bank === 0 && mode.pointer === 56) {
      if (await client.basicLine() === waitLine) return;
    } else {
      client.assertText(await client.screen());
    }
    await client.resume(300);
  } while (Date.now() < until);
  throw Error(`Bitmap not ready at line ${waitLine}; stopped at ${await client.basicLine()}`);
}
async function save(name, colors = [1]) {
  const frame = await captureBitmap(client, path.join(previews, name + '.png'));
  for (const color of colors) if (!frame.counts[color]) throw Error(`${name} is missing color index ${color}`);
  if (!frame.counts[0]) throw Error(`${name} has no background`);
  record(`PASS ${name}: VIC-II multicolor bitmap, pixel counts ${frame.counts.join('/')}`);
  return frame;
}

function checkGroundPaths(name, frame) {
  const pixel = (x, y) => {
    const offset = (y >> 3) * 320 + (x >> 2) * 8 + (y & 7);
    return (frame.bitmap[offset] >> ((3 - (x & 3)) * 2)) & 3;
  };
  if (name.startsWith('stubtest')) {
    for (const [x, y] of [[80, 30], [80, 55], [80, 68], [30, 68], [130, 68]]) {
      assert.equal(pixel(x, y), 1, name + ': missing P3-to-thru signal at ' + [x, y]);
    }
  }
  const groundPath = (x, y) => pixel(x, y) === 2 || (name === 'rfleak' && pixel(x, y) === 3);
  const labels = new Int32Array(160 * 200), bounds = [];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 160; x++) {
    if (!groundPath(x, y) || labels[y * 160 + x]) continue;
    const id = bounds.length + 1, queue = [[x, y]], box = [x, y, x, y];
    labels[y * 160 + x] = id;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      box[0] = Math.min(box[0], cx); box[1] = Math.min(box[1], cy);
      box[2] = Math.max(box[2], cx); box[3] = Math.max(box[3], cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= 160 || ny < 0 || ny >= 200) continue;
        if (!groundPath(nx, ny) || labels[ny * 160 + nx]) continue;
        labels[ny * 160 + nx] = id; queue.push([nx, ny]);
      }
    }
    bounds.push(box);
  }
  const connected = (a, b) => {
    const id = labels[a[1] * 160 + a[0]];
    return id !== 0 && id === labels[b[1] * 160 + b[0]];
  };
  if (['rdlloss', 'trlset', 'zcoupon'].includes(name)) {
    assert(bounds.length >= 6 && bounds.every(b => b[2] - b[0] > 14), name + ': isolated ground pads');
  } else if (name === 'rdxtalk') {
    for (const [a, b] of [
      [[13, 58], [98, 20]], [[13, 106], [38, 180]],
      [[122, 20], [146, 94]], [[62, 180], [146, 142]],
    ]) assert(connected(a, b), name + ': broken cardinal return');
  } else if (name.startsWith('stubtest')) {
    assert(connected([50, 30], [14, 39]), name + ': broken P3 west ground');
    assert(connected([110, 30], [145, 39]), name + ': broken P3 east ground');
    assert(connected([66, 50], [30, 39]), name + ': broken left branch ground');
    assert(connected([94, 50], [130, 39]), name + ': broken right branch ground');
  } else if (name.startsWith('viamatch')) {
    assert(connected([10, 68], [10, 112]), name + ': disconnected input grounds');
    assert(connected([10, 112], [140, 179]), name + ': disconnected load return');
    assert.equal(pixel(139, 178), 3, name + ': load lead does not reach return');
    for (const x of [24, 59]) {
      assert.equal(pixel(x - 5, 125) === 2, false, name + ': shunt element bypassed by ground');
    }
  } else if (name === 'rfleak') {
    for (const y of [55, 111]) assert(connected([10, y], [150, y]), name + ': disconnected GSG rail');
    for (const x of [80, 137]) for (const y of [55, 83, 111]) {
      assert.equal(pixel(x, y - 5), 3, name + ': missing GSG via marker');
    }
    for (const [x, y, color] of [[40, 147, 1], [80, 160, 1], [110, 177, 3], [137, 160, 1], [150, 147, 1]]) {
      assert.equal(pixel(x, y), color, name + ': broken upper/lower side-view path');
    }
  } else if (name === 'ring-circle' || name === 'ring-six-lobes') {
    assert.equal(bounds.filter(b => b[2] - b[0] > 30 && b[3] - b[1] > 30).length, 2,
      name + ': both outer half-ring returns must reach the launch banks');
  } else return;
  const topology = name.startsWith('stubtest')
    ? 'three-port P3 GSG access and connected ground topology'
    : 'connected ground paths and intended termination/layer topology';
  record(`PASS ${name}: ${topology}`);
}

try {
  const configs = [
    ['rdlloss', 1060, 380, 610, 840],
    ['rdxtalk', 1280, 340, 770, 1060],
    ['rfleak', 1150, 370, 680, 930],
    ['stubtest', 970, 340, 560, 750],
    ['stubtest-short', 970, 340, 560, 750],
    ['trlset', 1060, 350, 620, 840],
    ['viamatch', 1230, 390, 760, 1010],
    ['viamatch-series', 1230, 390, 760, 1010],
    ['zcoupon', 1080, 330, 610, 860],
  ];
  for (const [name, validation, calculate, sketch, close] of configs) {
    if (selected && !selected.has(name)) continue;
    const source = readFileSync(path.join(root, name.replace(/-(short|series)$/, '') + '.bas'), 'ascii').trim().split(/\r?\n/);
    const firstPrint = source.findIndex(line => /^\d+ PRINT CHR\$\(147\)/.test(line));
    source[firstPrint] = source[firstPrint].match(/^\d+/)[0] + ' GOTO 29000';
    const override = name === 'stubtest-short' ? 'SY=2:' : name === 'viamatch-series' ? 'RL=100:' : '';
    source.push(`29000 ${override}GOSUB ${validation}:GOSUB ${calculate}`,
      `29010 GOSUB ${sketch}:GOSUB ${close}`,
      '29020 PRINT "BITMAP TEST DONE":END');
    const program = compile(name, source);
    await client.boot(program);
    await client.waitText(/press return to view bitmap/i);
    await assertTextMode();
    const legendLine = Number(source.find(line => parseInt(line) >= sketch && parseInt(line) < close && /GET K\$/.test(line))?.match(/^\d+/)[0]);
    await client.waitBasicLine(legendLine);
    const waitLine = Number(source.find(line => parseInt(line) >= close && parseInt(line) < close + 100 && /GET K\$/.test(line))?.match(/^\d+/)[0]);
    if (!waitLine) throw Error(name + ': missing close GET');
    await client.keys('\r');
    await waitBitmap(waitLine);
    checkGroundPaths(name, await save(name, [1, 2]));
    await client.keys('\r');
    await client.waitText(/bitmap test done/i);
    await assertTextMode();
    record(`PASS ${name}: standard-text legend -> bitmap -> standard-text completion`);
  }

  // Ring drivers call the unchanged synthesis and production viewer pages.
  const original = readFileSync(path.join(root, 'resonator2.bas'), 'ascii').trim().split(/\r?\n/);
  for (const test of [
    { name: 'ring-circle', n: 0, depth: 0, entry: 3100 },
    { name: 'ring-six-lobes', n: 6, depth: .1, entry: 3100 },
    { name: 'ring-gsg-launch', n: 0, depth: 0, entry: 3800 },
    { name: 'ring-modes', n: 0, depth: 0, entry: 4300 },
    { name: 'ring-zero-modes', n: 0, depth: 0, entry: 4300, fa: 1.1, fb: 1.2 },
  ]) {
    if (selected && !selected.has(test.name)) continue;
    const lines = original.filter(line => parseInt(line) !== 100);
    lines.push('100 GOTO 29000', '29000 DIM WS$(16)',
      '29010 PI=3.14159265359:C0=299.792458',
      '29020 DEF FN RD(A)=INT(A*10000+.5)/10000',
      '29030 ER=11.7:H=.525:MT=.001:MA=3',
      '29040 PP=.15:PW=.1:PL=.1:MF=.002',
      `29050 FA=${test.fa || 1}:FB=${test.fb || 10}:F0=1`,
      `29060 N=${test.n}:AM=${test.depth}:GP=.02`,
      '29070 GOSUB 1200:GOSUB 1300:GOSUB 1600:GOSUB 1800',
      `29080 GOSUB ${test.entry}:GOSUB 7300`,
      '29090 PRINT "BITMAP TEST DONE":END');
    await client.boot(compile(test.name, lines));
    await client.waitText(/any key.*bitmap/i);
    await assertTextMode();
    await client.waitBasicLine(7540);
    await client.keys('x');
    await waitBitmap(7320);
    checkGroundPaths(test.name, await save(test.name, test.entry === 4300 ? (test.fa ? [3] : [1, 3]) : [1, 2, 3]));
    await client.keys('m');
    await client.waitText(/bitmap test done/i);
    await assertTextMode();
    record(`PASS ${test.name}: text legend -> bitmap -> M restores text`);
  }
  record(selected ? 'PASS selected bitmap cases' : 'PASS all 8 graphical programs and viewer variants');
} finally {
  writeFileSync(path.join(root, 'bitmap-validation.txt'),
    'VICE 3.10 / actual C64 BASIC V2 ROM\n' + results.join('\n') + '\n', 'utf8');
  await client.close();
}

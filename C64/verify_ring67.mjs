// Actual C64 BASIC V2 formatter regression and complete RING67 table checks.
// Usage: node verify_ring67.mjs "C:\path\to\VICE"
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViceTestClient } from './vice-test-client.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const vice = process.argv[2];
if (!vice) throw Error('Supply the VICE executable directory.');
const listing = readFileSync(path.join(root, 'RING67.TXT'), 'ascii');
const lines = listing.trim().split(/\r?\n/);
let previous = -1;
for (const line of lines) {
  assert.match(line, /^\d+ [\x20-\x7e]+$/);
  assert.ok(line.length <= 80, line);
  const number = parseInt(line);
  assert.ok(number > previous && number < 60000, line);
  previous = number;
}

const report = [];
const pass = message => { report.push('PASS ' + message); console.log('PASS ' + message); };
const client = await ViceTestClient.start(vice, 6548);
function compile(name, source) {
  const input = path.join(client.temporary, name + '.txt');
  const output = path.join(client.temporary, name + '.prg');
  writeFileSync(input, source.toLowerCase(), 'ascii');
  execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', output, '--', input]);
  return output;
}
function reference(f) {
  const u = .4 / .254;
  const k = 1 / Math.sqrt(1 + 12 / u);
  const g = (1 + k) / 2, h = (1 - k) / 2;
  const er = 4.2 + (3.8 - 4.2) * Math.log(f / .5) / Math.log(67 / .5);
  const theta = 2 * Math.PI * (2 * Math.PI * 5 / 299.792458) * f * Math.sqrt(g * er + h);
  const cx = Math.cos(theta), sx = Math.sin(theta), ta = .9 * .9 * .995;
  const dr = 1 - ta * cx, di = ta * sx, dd = dr * dr + di * di;
  let nr = .9 * (1 - .995 * cx), ni = .9 * .995 * sx;
  const re1 = (nr * dr + ni * di) / dd, im1 = (ni * dr - nr * di) / dd;
  const ca = (1 - .9 * .9) * Math.sqrt(.995);
  nr = ca * Math.cos(theta / 2); ni = -ca * Math.sin(theta / 2);
  const re2 = (nr * dr + ni * di) / dd, im2 = (ni * dr - nr * di) / dd;
  return [10 * Math.log10(Math.max(1e-8, re1 * re1 + im1 * im1)),
    10 * Math.log10(Math.max(1e-8, re2 * re2 + im2 * im2)),
    Math.atan2(im1, re1) * 180 / Math.PI, Math.atan2(im2, re2) * 180 / Math.PI];
}

try {
  const rebuilt = compile('ring67-source', listing);
  assert.deepEqual(readFileSync(rebuilt), readFileSync(path.join(root, 'RING67.PRG')));
  pass('RING67.PRG exactly matches the complete ASCII source');

  const cases = [];
  for (let i = 0; i < 134; i++) {
    const value = .5 + .5 * i;
    cases.push([value, 2, 6, value.toFixed(2).padStart(6)]);
  }
  for (const [value, dp, width, expected] of [
    [48, 2, 6, ' 48.00'], [47.5, 2, 6, ' 47.50'],
    [0, 0, 3, '  0'], [2.5, 0, 3, '  3'], [-2.5, 0, 3, ' -3'],
    [11, 0, 3, ' 11'], [-180, 1, 7, ' -180.0'],
    [180, 1, 7, '  180.0'], [-.04, 1, 7, '    0.0'],
    [-.06, 1, 7, '   -0.1'], [9.96, 1, 4, '10.0'],
    [1.999, 2, 6, '  2.00'], [-1.999, 2, 6, ' -2.00'],
    [.005, 2, 6, '  0.01'], [-.004, 2, 6, '  0.00'],
    [5.49691, 3, 10, '     5.497'], [61.84074, 3, 10, '    61.841'],
    [.0004, 3, 6, ' 0.000'], [9.9996, 3, 6, '10.000'],
    [3.013725, 4, 10, '    3.0137'], [4.004211, 4, 10, '    4.0042'],
    [3.806544, 4, 10, '    3.8065'], [9.99996, 4, 8, ' 10.0000'],
    [-.00004, 4, 8, '  0.0000'], [.00006, 4, 8, '  0.0001'],
    [123.456, 2, 3, '123.46'],
  ]) cases.push([value, dp, width, expected]);
  const harness = [
    '1 GOTO60000', ...lines,
    '60000 PRINT CHR$(147):SP$="                                        "',
    `60010 FOR ZQ=1 TO ${cases.length}:READ V,DP,FW,E$:GOSUB8000`,
    '60020 IF Z$<>E$ THEN PRINT "FAIL";ZQ;" [";Z$;"] [";E$;"]":END',
    '60030 NEXT:PRINT "FORMAT PASS";ZQ-1:END',
    ...cases.map(([v, dp, fw, expected], i) => `${61000 + i * 10} DATA ${v},${dp},${fw},"${expected}"`),
  ].join('\n');
  await client.boot(compile('ring67-format-tests', harness));
  let screen = await client.waitText(/format pass|fail/i);
  assert.ok(/format pass\s*160/i.test(screen), screen);
  pass('160 formatter cases in actual C64 ROM: full sweep, DP 0..4, carries, signs and padding');

  await client.boot(path.join(root, 'RING67.PRG'));
  await client.waitBasicLine(340);
  await client.keys('1', 100);
  await client.waitBasicLine(7820);
  assert.ok((await client.mode()).bitmap);
  pass('Default model reaches its S-parameter bitmap screen');
  await client.keys('t', 100);
  await client.waitText(/ideal s data/i);
  await client.waitBasicLine(7820);
  let checked = 0;
  for (let page = 0; page < 9; page++) {
    screen = await client.screen();
    assert.equal((await client.mode()).bitmap, false);
    const rows = screen.split('\n').filter(line => /^\s*\d+\.\d{2}\s/.test(line));
    assert.equal(rows.length, Math.min(16, 134 - checked), screen);
    for (const row of rows) {
      const match = row.match(/^\s*(\d+\.\d{2})\s+(-?\d+\.\d)\s+(-?\d+\.\d)\s+(-?\d+\.\d)\s+(-?\d+\.\d)\s*$/);
      assert.ok(match, row);
      const f = .5 + checked * .5;
      assert.equal(match[1], f.toFixed(2), row);
      const expected = reference(f);
      match.slice(2).map(Number).forEach((value, i) => {
        let error = Math.abs(value - expected[i]);
        if (i >= 2) error = Math.min(error, Math.abs(error - 360));
        assert.ok(error < .11, `${f} GHz column ${i}: ${value} vs ${expected[i]}`);
      });
      checked++;
    }
    console.log('Checked S-data page ' + (page + 1));
    if (page < 8) {
      // The monitor trims a literal trailing space; send its byte escape.
      await client.command('keybuf \\x20');
      await client.resume(100);
      const firstFrequency = (.5 + checked * .5).toFixed(2).replace('.', '\\.');
      await client.waitText(new RegExp('^\\s*' + firstFrequency + '\\s', 'm'));
      await client.waitBasicLine(7820);
    }
  }
  assert.equal(checked, 134);
  pass('All 134 frequency rows across 9 text pages: 0.50..67.00 GHz, both dB and phase columns agree with independent model');
  await client.keys('q', 100);
  await client.waitText(/ring67 finished/i);
  const mode = await client.mode();
  assert.ok(!mode.bitmap && mode.bank === 3);
  pass('Quit restores the standard text display');
} catch (error) {
  report.push('FAIL ' + error.message);
  throw error;
} finally {
  await client.close();
  writeFileSync(path.join(root, 'ring67-validation.txt'),
    'Actual VICE 3.10 / C64 BASIC V2 ROM\n' + report.join('\n') + '\n', 'utf8');
}

// Verify the Hand BASIC originals, without replacing their native graphics.
// Usage: node verify_handbasic_cardinal.mjs [VICE-tools-directory] [--baseline folder]
// VICE executes only temporary numerical/text drivers; it does not run Hand BASIC graphics.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViceTestClient } from './C64/vice-test-client.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const options = process.argv.slice(2);
const baselineIndex = options.indexOf('--baseline');
const baseline = baselineIndex < 0 ? null : options[baselineIndex + 1];
const vice = options[0] && !options[0].startsWith('--') ? options[0] : null;
const names = ['rdlloss', 'rdxtalk', 'rfleak', 'stubtest', 'trlset', 'viamatch', 'zcoupon', 'resonator2'];
const results = [];
let completed = false, failure = '';
const pass = message => { results.push('PASS ' + message); console.log('PASS ' + message); };
function read(name, directory = root) {
  const text = readFileSync(path.join(directory, name + '.bas'), 'ascii');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const map = new Map(lines.map(line => {
    const match = line.match(/^(\d+)\s+(.*)$/);
    assert(match, name + ': unnumbered source line: ' + line);
    return [Number(match[1]), match[2]];
  }));
  return { text, lines, map };
}
function codeOnly(text) {
  let result = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { quoted = !quoted; result += ' '; continue; }
    if (quoted) { result += ' '; continue; }
    if (text.slice(i, i + 3) === 'REM') break;
    result += text[i];
  }
  assert(!quoted, 'Unclosed string: ' + text);
  return result;
}
function normalized(text) {
  return text.replace(/:GOSUB\s+9000\b/g, '').replace(/\s+/g, ' ').trim();
}
function sameRange(name, before, after, minimum, maximum) {
  let count = 0;
  for (const [number, body] of before.map) {
    if (number < minimum || number > maximum) continue;
    assert.equal(after.map.get(number), body, `${name}: existing numerical line ${number} changed`);
    count++;
  }
  assert(count > 0, `${name}: empty protected numerical range`);
  return count;
}
function includesPattern(name, source, pattern, description) {
  assert(pattern.test(source.text), `${name}: missing ${description}`);
}

const sources = new Map();
try {
  for (const name of names) {
    const source = read(name); sources.set(name, source);
    let previous = -1;
    for (const line of source.lines) {
      assert(!/[^\x20-\x7e]/.test(line), `${name}: non-ASCII source`);
      assert(line.length <= 72, `${name}: source line exceeds 72 columns: ${line}`);
      const number = Number(line.match(/^\d+/)[0]);
      assert(number > previous && number < 64000, `${name}: unordered/duplicate/out-of-range line ${number}`);
      previous = number;
      const code = codeOnly(source.map.get(number));
      const targets = [];
      for (const match of code.matchAll(/\b(?:GOTO|GOSUB)\s+(\d+(?:\s*,\s*\d+)*)/g)) {
        targets.push(...match[1].split(',').map(value => Number(value.trim())));
      }
      for (const match of code.matchAll(/\bTHEN\s+(\d+)/g)) targets.push(Number(match[1]));
      for (const target of targets) assert(source.map.has(target), `${name}:${number}: missing target ${target}`);
      assert(!/\bSYS\s+(?:4915[258]|49161)\b/.test(code), `${name}: copied C64 native drawing calls`);
      assert(!/\bGOSUB\s+9000\b/.test(code) || name === 'resonator2', `${name}: copied C64 pagination helper`);
    }
    assert.equal(source.map.size, source.lines.length, name + ': duplicate line number');
    includesPattern(name, source, /\bSCREEN\s+[12]\b/, 'Hand BASIC graphics-screen selection');
    includesPattern(name, source, /\bGPRINT\b/, 'native graphic text');
    includesPattern(name, source, /\bCSET\b/, 'native color setup');
    includesPattern(name, source, /\bSLEEP\b/, 'touch/keyboard debounce');
    assert(!/NATIVE 160X200 MULTICOLOR BITMAP/.test(source.text), name + ': C64 renderer was appended');
    includesPattern(name, source, /MPI TITAN/, 'MPI TITAN equipment profile');
    includesPattern(name, source, /67\s*GHZ/, '67GHz equipment rating');
    includesPattern(name, source, /150(?:\s*UM|\s*\/|\s*GHZ|\b)/, '150um installed pitch');
    includesPattern(name, source, /MISMATCH/, 'custom-pitch mismatch notice');
    includesPattern(name, source, /(?:EXCEEDS|ABOVE).*67/, 'out-of-rating frequency notice');
    if (name === 'rdxtalk') {
      for (const string of ['P1 WEST', 'P2 NORTH', 'P3 SOUTH', 'P4 EAST', 'S31 NEAR', 'S41 FAR']) {
        assert(source.text.includes(string), name + ': missing ' + string);
      }
    } else if (name === 'viamatch') {
      includesPattern(name, source, /(?:ONE.PORT|ONE EXTERNAL|INTERNAL)/, 'one-port/internal-load description');
      includesPattern(name, source, /EAST.*NORTH.*SOUTH.*PARK/, 'three parked probe heads');
    } else {
      includesPattern(name, source, /WEST/, 'west probe');
      includesPattern(name, source, /EAST/, 'east probe');
      includesPattern(name, source, /NORTH.?SOUTH.*PARK/, 'parked north/south probes');
      if (name !== 'resonator2') includesPattern(name, source, /ONE (?:COUPON|STANDARD) AT A TIME/, 'separate-coupon measurement rule');
    }
    pass(`${name}: native Hand BASIC graphics, 72-column source, branch targets and cardinal profile`);

    if (baseline) {
      const before = read(name, baseline);
      let count = 0;
      if (name === 'resonator2') {
        count += sameRange(name, before, source, 1200, 2230);
        count += sameRange(name, before, source, 9000, 9790);
      } else {
        const start = [...before.map].find(([, body]) => /REM SYNTHESIZE FEED WIDTH/.test(body))?.[0];
        const end = [...before.map].find(([number, body]) => number > start && /^PRINT "GSG PITCH/.test(body))?.[0];
        assert(start && end, name + ': cannot locate protected RF helper range');
        count += sameRange(name, before, source, start, end - 1);
        const ranges = { rdlloss: [[380, 500]], rfleak: [[370, 550]], stubtest: [[340, 460]],
          trlset: [[350, 450], [2330, 2440]], viamatch: [[390, 580], [2370, 2410], [2750, 2960]],
          zcoupon: [[330, 360]], rdxtalk: [] };
        for (const [low, high] of ranges[name]) count += sameRange(name, before, source, low, high);
      }
      pass(`${name}: ${count} existing numerical source lines unchanged from backup`);
    }
  }
  const hand = sources.get('rdxtalk'), c64 = read('rdxtalk', path.join(root, 'C64'));
  for (const [number, body] of c64.map) {
    if ((number >= 11000 && number <= 11070) || (number >= 11200 && number <= 11440)) {
      assert.equal(normalized(hand.map.get(number) || ''), normalized(body), `RDXTALK cardinal calculation/report differs at ${number}`);
    }
  }
  for (const number of [105, 325, 375, 376, 377, 378, 381, 382, 383, 384, 385, 1260]) {
    assert.equal(normalized(hand.map.get(number) || ''), normalized(c64.map.get(number) || ''), `RDXTALK input/guard mismatch at ${number}`);
  }
  pass('RDXTALK cardinal input guards, contact equations and reports agree with C64');

  if (vice) {
    const client = await ViceTestClient.start(vice, 6545);
    try {
      const compile = (name, statements) => {
        const lines = [...sources.get(name).lines, '1 GOTO 60000'];
        statements.forEach((statement, index) => lines.push(`${60000 + index * 10} ${statement}`));
        lines.sort((a, b) => parseInt(a) - parseInt(b));
        const input = path.join(client.temporary, name + '.bas');
        const output = path.join(client.temporary, name + '.prg');
        writeFileSync(input, lines.join('\n').toLowerCase(), 'ascii');
        execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', output, '--', input]);
        return output;
      };
      for (const name of names.filter(value => value !== 'resonator2')) {
        for (const mismatch of [false, true]) {
          await client.boot(compile(name, ['PRINT CHR$(147)',
            `PP=${mismatch ? 100 : 150}:F2=${mismatch ? 68 : 67}:FC=${mismatch ? 68 : 67}`,
            'GOSUB 9600', 'PRINT "PROFILE DONE":END']));
          const text = await client.waitText(/profile done/i);
          assert(/mpi titan/i.test(text) && /67 ghz/i.test(text), name + ': profile text absent');
          assert.equal(/mismatch/i.test(text), mismatch, name + ': pitch warning mismatch');
          assert.equal(/(?:sweep|band) (?:exceeds|above)/i.test(text), mismatch, name + ': frequency warning mismatch');
          pass(`${name}: numerical/text-only C64 driver ${mismatch ? 'flags 100um/68GHz mismatch' : 'accepts 150um/67GHz profile'}`);
        }
      }
      for (const parameters of [
        { DW: 45, SG: 20, L: 5, PP: 150, PW: 80, PL: 100, FL: 500, PG: 1000 },
        { DW: 45, SG: 20, L: 5, PP: 150, PW: 80, PL: 100, FL: 500, PG: 2000 },
        { DW: 45, SG: 20, L: 5, PP: 150, PW: 80, PL: 100, FL: 2000, PG: 1000 },
        { DW: 45, SG: 20, L: .001, PP: 5000, PW: 4900, PL: 100, FL: 1, PG: 1000 },
        { DW: 20000, SG: 10000, L: .001, PP: 150, PW: 80, PL: 100, FL: 1, PG: 1000 },
      ]) {
        const assignments = Object.entries(parameters).map(([key, value]) => `${key}=${value}`);
        const statements = [assignments.slice(0, 4).join(':'), assignments.slice(4).join(':'),
          'GOSUB 11000:PRINT CHR$(147)', 'PRINT "PA=";PA:PRINT "PB=";PB:PRINT "PE=";PE',
          'PRINT "PC=";PC:PRINT "PD=";PD', 'PRINT "COORDS DONE":END'];
        await client.boot(compile('rdxtalk', statements));
        const text = await client.waitText(/coords done/i);
        const { DW, SG, L, PP, PW, PL, FL, PG } = parameters;
        let feed = Math.max(FL, 2 * PP - PW / 2, DW / 2 + PP - PW), arm = feed + PL / 2;
        const closest = DW + SG / 2;
        if (Math.hypot(arm, arm + closest) < PG) {
          arm = (Math.sqrt(2 * PG * PG - closest * closest) - closest) / 2;
          feed = arm - PL / 2;
        }
        const reference = parameters.PG === 1000 && parameters.FL === 500 && parameters.PP === 150
          ? { PA: 679.071829328, PB: 629.071829328, PE: 1007.36360694, PC: 32.5, PD: 2500 }
          : { PA: arm, PB: feed, PE: Math.hypot(arm, arm + DW + SG), PC: (DW + SG) / 2, PD: L * 500 };
        for (const [key, expected] of Object.entries(reference)) {
          const actual = Number(text.match(new RegExp(key + '=\\s*([-+\\d.e]+)', 'i'))?.[1]);
          assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 2e-6 * Math.max(1, Math.abs(expected)), `RDXTALK ${key}: ${text}`);
        }
        pass('RDXTALK numerical-only driver agrees with host geometry: ' + JSON.stringify(parameters));
      }
    } finally { await client.close(); }
  }
  completed = true;
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  writeFileSync(path.join(root, 'HAND_BASIC_VALIDATION.txt'),
    'HAND BASIC CARDINAL PROPAGATION VERIFICATION - 2026-10-30\n' +
    `Run status: ${completed ? 'all requested checks passed' : 'FAILED: ' + failure}\n\n` +
    results.join('\n') + '\n\n' +
    `Numerical/text-only emulator cases passed: ${results.filter(line => /numerical\/text-only C64 driver|numerical-only driver agrees/.test(line)).length}.\n` +
    'Native Hand BASIC graphics were checked statically; this script does not run the Hand BASIC app.\n' +
    (vice ? 'Only temporary numerical/text-only drivers executed in VICE against the C64 BASIC V2 ROM.\n' : 'No emulator execution requested.\n') +
    'No Hand BASIC drawing commands were replaced with C64 graphics code.\n', 'utf8');
}

// Actual C64 ROM checks for cardinal fanout coordinates and MPI fixture notices.
// Usage: node verify_cardinal_profile.mjs "C:\path\to\VICE\bin"
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ViceTestClient } from './vice-test-client.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const vice = process.argv[2];
if (!vice) throw Error('Supply the VICE executable directory.');
const client = await ViceTestClient.start(vice, 6540);
const report = [];
const pass = value => { report.push('PASS ' + value); console.log('PASS ' + value); };
function compile(name, statements, initialize = false) {
  const lines = readFileSync(path.join(root, name + '.bas'), 'ascii').trim().split(/\r?\n/);
  if (initialize) {
    const index = lines.findIndex(line => /^\d+ PRINT CHR\$\(147\)/.test(line));
    lines[index] = parseInt(lines[index]) + ' GOTO 60000';
  } else lines.push('1 GOTO 60000');
  statements.forEach((statement, index) => lines.push(`${60000 + index * 10} ${statement}`));
  lines.sort((a, b) => parseInt(a) - parseInt(b));
  const source = path.join(client.temporary, name + '.bas');
  const program = path.join(client.temporary, name + '.prg');
  writeFileSync(source, lines.join('\n').toLowerCase(), 'ascii');
  execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', program, '--', source]);
  return program;
}
async function textMode() {
  const state = await client.mode();
  if (state.bitmap || state.multicolor || state.extended || state.bank !== 3) throw Error(JSON.stringify(state));
}
try {
  for (const name of ['rdlloss', 'rdxtalk', 'rfleak', 'stubtest', 'trlset', 'viamatch', 'zcoupon']) {
    for (const mismatch of [false, true]) {
      await client.boot(compile(name, [
        'PRINT CHR$(147)',
        `PP=${mismatch ? 100 : 150}:F2=${mismatch ? 68 : 67}:FC=${mismatch ? 68 : 67}`,
        'GOSUB 9600', 'PRINT "PROFILE DONE":END',
      ]));
      const text = await client.waitText(/profile done/i);
      await textMode();
      if (!/mpi titan gsg: 150 um \/ to 67 ghz/i.test(text)) throw Error(text);
      if (/pitch mismatch/i.test(text) !== mismatch || /sweep exceeds/i.test(text) !== mismatch) throw Error(text);
      if (['stubtest', 'viamatch'].includes(name) && /fc above/i.test(text) !== mismatch) throw Error(text);
      pass(`${name}: ${mismatch ? 'mismatched pitch/out-of-rating notices' : '150um / 67GHz profile accepted'}`);
    }
  }
  await client.boot(compile('rdxtalk', [
    'GOSUB 1280:GOSUB 340:PRINT CHR$(147)',
    'PRINT "PA=";PA:PRINT "PB=";PB:PRINT "PE=";PE',
    'PRINT "PC=";PC:PRINT "PD=";PD', 'PRINT "COORDS DONE":END',
  ], true));
  let text = await client.waitText(/coords done/i);
  for (const [name, expected] of Object.entries({ PA: 679.071829328, PB: 629.071829328,
    PE: 1007.36360694, PC: 32.5, PD: 2500 })) {
    const value = Number(text.match(new RegExp(name + '=\\s*([-+\\d.e]+)', 'i'))?.[1]);
    if (!Number.isFinite(value) || Math.abs(value - expected) > 2e-6 * Math.max(1, Math.abs(expected))) throw Error(text);
  }
  pass('RDXTALK actual C64 fanout coordinates agree with independent geometry');
  for (const [override, expected] of [
    ['PG=0', 'adjacent gsg centre spacing'],
    ['PL=1000001', 'cardinal pad/feed length limit'],
    ['DW=2:SG=4', 'fanout needs narrow turn/taper'],
    ['PP=40:PW=39', 'feed overlaps gsg ground pads'],
  ]) {
    await client.boot(compile('rdxtalk', [override,
      'GOSUB 1280:GOSUB 340:PRINT "UNEXPECTED ACCEPT":END'], true));
    text = await client.waitText(/run again with valid input/i);
    if (!text.toLowerCase().includes(expected)) throw Error(text);
    pass('RDXTALK rejects ' + expected);
  }
  for (const mismatch of [false, true]) {
    await client.boot(compile('resonator2', [
      `PP=${mismatch ? .1 : .15}:FB=${mismatch ? 68 : 67}`,
      'GOSUB 5300:END',
    ]));
    text = await client.waitText(/press any key/i);
    await client.waitBasicLine(7411); await textMode();
    if (!/probe: mpi titan gsg150 \/ 67 ghz/i.test(text)) throw Error(text);
    if (/pitch mismatch/i.test(text) !== mismatch || /band exceeds/i.test(text) !== mismatch) throw Error(text);
    pass(`RESONATOR2: ${mismatch ? 'mismatch notices' : '150um / 67GHz profile accepted'}`);
  }
} finally {
  writeFileSync(path.join(root, 'cardinal-profile-validation.txt'),
    'Actual VICE 3.10 / C64 BASIC V2 ROM\n' + report.join('\n') + '\n', 'utf8');
  await client.close();
}

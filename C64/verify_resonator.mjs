// Run the text/bitmap viewer and numerical regressions in an isolated VICE.
// Usage: node verify_resonator.mjs "C:/path/to/VICE/bin"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ViceTestClient } from './vice-test-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const viceDir = process.argv[2];
if (!viceDir) throw Error('Supply the directory containing x64sc.exe and petcat.exe.');
const port = Number(process.env.RESONATOR_VICE_PORT || 6533);
const client = await ViceTestClient.start(viceDir, port);
const temporary = client.temporary;
const log = [];
function record(label, text = '') {
  log.push(label + '\n' + text + '\n');
  fs.writeFileSync(path.join(temporary, 'resonator-results.txt'), log.join('\n'), 'utf8');
  console.log(label);
}
async function textMode(label) {
  const mode = await client.mode();
  if (mode.bitmap || mode.multicolor || mode.extended || mode.bank !== 3) {
    throw Error(`${label}: expected standard text, got ${JSON.stringify(mode)}`);
  }
}
async function waitLine(number, maximumMs = 180000) {
  const deadline = Date.now() + maximumMs;
  do {
    if (await client.basicLine() === number) return;
    const mode = await client.mode();
    if (!mode.bitmap) client.assertText(await client.screen());
    await client.resume(300);
  } while (Date.now() < deadline);
  throw Error(`Timeout waiting for BASIC line ${number}; at ${await client.basicLine()}`);
}
async function waitText(pattern) {
  const text = await client.waitText(pattern);
  await textMode(String(pattern));
  return text;
}
async function keys(value, pattern) {
  await client.keys(value);
  return waitText(pattern);
}
async function legend(label, pattern) {
  let text = await waitText(pattern);
  await waitLine(7540);
  await textMode(label);
  text = await client.screen();
  const lower = text.toLowerCase();
  if (lower.includes('02 / top metal')) {
    if (!lower.includes('west p1 / east p2') || !lower.includes('north/south probes parked') ||
        !lower.includes('white arrows: e/w probe approach')) {
      throw Error('Missing cardinal-prober top-layout labels.\n' + text);
    }
  }
  if (lower.includes('03 / gsg') && (!lower.includes('west launch; east is mirrored') ||
      !lower.includes('north/south probes parked'))) {
    throw Error('Missing cardinal-prober GSG-detail labels.\n' + text);
  }
  record(`PASS ${label}: standard-text legend`, text);
}
async function bitmap(label) {
  await client.keys('x');
  await waitLine(7320);
  const mode = await client.mode();
  if (!mode.bitmap || !mode.multicolor || mode.extended || mode.bank !== 0 || (mode.pointer & 254) !== 56) {
    throw Error(`${label}: expected native multicolor bitmap, got ${JSON.stringify(mode)}`);
  }
  record(`PASS ${label}: native bitmap holds for key`, JSON.stringify(mode));
}
async function menu() {
  const text = await waitText(/ring designer v1\.1 \/ menu/i);
  await waitText(/choice/i);
  return text;
}
async function fillDefaults() {
  const prompts = ['material number', 'relative permittivity', 'substrate thickness',
    'metal thickness', 'probe pitch', 'minimum line / gap', 'landing pad width',
    'landing pad length', 'low frequency', 'high frequency', 'fundamental f1',
    'lobes:', 'ring to feed'];
  for (const prompt of prompts) {
    await waitText(new RegExp(prompt, 'i'));
    await client.keys('\r');
  }
}

try {
  if (!process.env.RESONATOR_NUMERICAL_ONLY) {
    await client.boot(path.join(here, 'resonator2.prg'));
    await fillDefaults();
    let text = await waitText(/01 \/ ring dimensions/i);
    await waitLine(7320);
    if (!text.includes('425.9387') || !text.includes('17.2727')) {
      throw Error('Default dimensions changed unexpectedly.\n' + text);
    }
    record('PASS default circle: W=425.9387 um, R=17.2727 mm', text);

    await client.keys('x');
    await legend('top metal', /02 \/ top metal/i);
    await bitmap('circle/feed/ground/via layout');
    await client.keys('x');
    await legend('GSG launch', /03 \/ gsg/i);
    await bitmap('GSG pads/taper/neck/contact centres');
    await client.keys('x');
    await legend('nominal modes', /04 \/ nominal/i);
    await bitmap('10 mode positions in 1-10 GHz');

    text = await keys('x', /05 \/ model and checks/i);
    await waitLine(7411);
    record('PASS assumptions page restored standard text', text);
    text = await keys('x', /05 \/ checks for this design/i);
    await waitLine(7320);
    record('PASS calculated warning page remains standard text', text);
    await client.keys('x');
    await menu();

    await keys('2\r', /material \/ text report 1 of 5/i);
    for (let report = 1; report <= 5; report++) {
      await waitLine(7411);
      const reportText = await client.screen();
      const lower = reportText.toLowerCase();
      if (!lower.includes(`report ${report} of 5`)) {
        throw Error(`Report ${report} overflowed its heading.\n` + reportText);
      }
      if (report === 2 && (!reportText.includes('425.9387') || !reportText.includes('17.2727'))) {
        throw Error('Graphics altered the stored ring dimensions.\n' + reportText);
      }
      if (report === 3 && (!lower.includes('west p1 / east p2 active') ||
          !lower.includes('north/south probes parked') ||
          !/contact x mm \+\/-\s+21\.157\b/.test(lower) ||
          !/contact y um\s*-150\s+0\s+150\b/.test(lower))) {
        throw Error('Missing cardinal-prober launch report.\n' + reportText);
      }
      if (report === 4 && (!lower.includes('p1 west: -x / p2 east: +x') ||
          !lower.includes('n/s probes do not contact this dut.'))) {
        throw Error('Missing cardinal-prober layout report.\n' + reportText);
      }
      record(`PASS standard-text dimension report ${report}/5`, reportText);
      await client.keys('x');
      if (report < 5) await waitText(new RegExp(`report ${report + 1} of 5`, 'i'));
      else await menu();
    }

    await keys('4\r', /help \/ quick start/i);
    for (const following of [/what the model calculates/i, /paper-related example/i, /\/ menu/i]) {
      await waitLine(7411);
      record('PASS standard-text help page', await client.screen());
      await keys('x', following);
    }

    await keys('1\r', /01 \/ ring dimensions/i);
    await waitLine(7320);
    await client.keys('m');
    record('PASS M from text page returns to text menu', await menu());

    await keys('1\r', /01 \/ ring dimensions/i);
    await waitLine(7320);
    await client.keys('x');
    await legend('M-at-legend test', /02 \/ top metal/i);
    await client.keys('m');
    record('PASS M from graphics legend returns to text menu', await menu());

    await keys('1\r', /01 \/ ring dimensions/i);
    await waitLine(7320);
    await client.keys('x');
    await legend('M-in-bitmap test', /02 \/ top metal/i);
    await bitmap('M-in-bitmap test');
    await client.keys('m');
    record('PASS M from bitmap restores text menu', await menu());
    text = await keys('3\r', /material number/i);
    record('PASS edit inputs retains defaults in standard text', text);
  }

  const source = fs.readFileSync(path.join(here, 'resonator2.bas'), 'ascii');
  const cases = [
    { name: 'paper circle', er: 3.2, h: .762, mt: .018, fa: .5, fb: 6, f0: 1.16,
      n: 0, am: 0, gp: .1, expect: ['width um 1810.0564', 'radius mm 25.8036'] },
    { name: 'six cosine lobes', er: 11.7, h: .525, mt: .001, fa: 1, fb: 10,
      f0: 1, n: 6, am: .1, gp: .02, expect: ['lobes 6', 'depth .1'] },
    { name: 'no mode in band', er: 3.2, h: .762, mt: 0, fa: 1.1, fb: 1.2,
      f0: 1, n: 0, am: 0, gp: .1, expect: ['modes 0'] },
    { name: 'thin substrate asymptote', er: 3.2, h: .001, mt: 0, fa: 1, fb: 10,
      f0: 1, n: 0, am: 0, gp: .002, expect: ['finished'] },
  ];
  for (const test of cases.filter(test => !process.env.RESONATOR_CASE || test.name === process.env.RESONATOR_CASE)) {
    const driver = [
      '100 goto 11000', '11000 dim ws$(16)',
      '11010 pi=3.14159265359:c0=299.792458',
      '11020 def fn rd(a)=int(a*10000+.5)/10000',
      `11030 er=${test.er}:h=${test.h}:mt=${test.mt}:ma=0`,
      '11040 pp=.15:pw=.1:pl=.1:mf=.002',
      `11050 fa=${test.fa}:fb=${test.fb}:f0=${test.f0}`,
      `11060 n=${test.n}:am=${test.am}:gp=${test.gp}`,
      '11070 gosub 1200:gosub 1300:gosub 1600:gosub 1800',
      '11080 print chr$(147)', `11090 print "case ${test.name}"`,
      '11100 print "width um";fn rd(w*1000)',
      '11110 print "radius mm";fn rd(r)',
      '11120 print "effective er";fn rd(ee)',
      '11130 print "minimum bend mm";fn rd(mc)',
      '11140 print "modes";nm;" lobes";n;" depth";am',
      '11150 print "neck ohm";fn rd(zn);" flags";nc',
      '11160 print "finished":end',
    ];
    const modified = source.split(/\r?\n/).filter(line => line && !/^100 /.test(line))
      .concat(driver).sort((a, b) => parseInt(a) - parseInt(b)).join('\n').toLowerCase();
    const input = path.join(temporary, 'case.bas');
    const program = path.join(temporary, 'case.prg');
    fs.writeFileSync(input, modified, 'ascii');
    execFileSync(path.join(viceDir, 'petcat.exe'), ['-w2', '-f', '-o', program, '--', input]);
    await client.boot(program);
    const text = await waitText(/finished/i);
    const normalized = text.replace(/\s+/g, ' ').toLowerCase();
    for (const expected of test.expect) {
      if (!normalized.includes(expected)) throw Error(`Unexpected ${test.name} result:\n${text}`);
    }
    await waitText(/ready\./i);
    record(`PASS numerical case: ${test.name}`, text);
    if (test.n > 0 || test.name === 'no mode in band') {
      const entry = test.n > 0 ? 3100 : 4300;
      await client.keys(`gosub${entry}:gosub7300\r`);
      await legend(test.name, test.n > 0 ? /02 \/ top metal/i : /no estimated resonance in band/i);
      await bitmap(test.name);
      await keys('x', /ready\./i);
      record(`PASS ${test.name}: bitmap exits to standard text`);
    }
  }
  record('PASS full resonator text/bitmap and numerical regression suite');
  console.log(`Transcript: ${path.join(temporary, 'resonator-results.txt')}`);
} finally {
  await client.close();
}

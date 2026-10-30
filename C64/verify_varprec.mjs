// Run after build.ps1. Usage: node verify_varprec.mjs "C:\path\to\VICE"
// Uses its own emulator process and remote-monitor port 6523.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const vice = process.argv[2];
if (!vice) throw new Error('Supply the VICE tools directory.');
const temporary = mkdtempSync(path.join(tmpdir(), 'varprec-c64-check-'));
const port = 6523;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', error => reject(new Error(
    `Port ${port} is already occupied; refusing to connect to an existing emulator.`,
    { cause: error })));
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const emulator = spawn(path.join(vice, 'x64sc.exe'), [
  '-console', '-warp', '+sound', '-remotemonitor',
  '-remotemonitoraddress', `ip4://127.0.0.1:${port}`,
  '-logfile', path.join(temporary, 'vice.log'),
], { windowsHide: true, stdio: 'ignore' });

let socket;
let incoming = '';
let pending;
async function command(value) {
  incoming = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = undefined;
      reject(new Error(`Monitor timeout: ${value}\n${incoming}`));
    }, 10000);
    pending = response => { clearTimeout(timer); resolve(response); };
    socket.write(value + '\n');
  });
}
async function resume(ms = 150) {
  socket.write('x\n');
  await delay(ms);
}
async function keys(value, ms = 150) {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    .replaceAll('\r', '\\x0d').replaceAll('\x14', '\\x14');
  await command(`keybuf ${escaped}`);
  await resume(ms);
}
async function screen() {
  const response = await command('screen');
  const lines = response.split('\n').filter(line => /^\*C:/i.test(line))
    .map(line => line.slice(8).trimEnd());
  return lines.join('\n').trimEnd();
}
function checkScreen(text) {
  if (/\?(?:syntax|overflow|division by zero|illegal quantity|out of memory|next without|return without|bad subscript|type mismatch|undefined)/i.test(text)) {
    throw new Error(text);
  }
}
async function until(pattern, limit = 150) {
  let text;
  for (let step = 0; step < limit; step++) {
    text = await screen();
    checkScreen(text);
    if (pattern.test(text)) return text;
    await resume(150);
  }
  throw new Error(`Expected ${pattern}; screen:\n${text}`);
}
let started = false;
async function start(a, b) {
  if (started) {
    await keys('q');
    await until(/ready\./i);
  }
  await command(`loadbasic "${path.join(root, 'varprec.prg').replaceAll('\\', '/')}" 0`);
  await keys('run\r');
  await until(/first integer:/i);
  await keys(a + '\r');
  await until(/second integer:/i);
  await keys(b + '\r');
  await until(/a=add\s+m=multiply\s+q=quit/i);
  started = true;
}
const report = [];
async function operation(op, expected, label) {
  // Clear the display before the operation so stale output cannot satisfy a check.
  await command('fill 0400 07e7 20');
  await keys(op, 250);
  const text = await until(/result:/i);
  const match = text.match(/result:\s*([\d\s]+)\s*a=add/i);
  const result = match?.[1].replaceAll(/\s/g, '');
  if (result !== expected) throw new Error(`${label}: expected ${expected}; got ${result}\n${text}`);
  report.push(`PASS ${label}\nRESULT ${result}`);
  console.log(`PASS ${label}`);
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(100);
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = net.connect(port, '127.0.0.1');
        candidate.once('error', reject);
        candidate.once('connect', () => resolve(candidate));
      });
      break;
    } catch { /* allow emulator startup */ }
  }
  if (!socket) throw new Error('Cannot connect to VICE.');
  socket.on('data', data => {
    incoming += data.toString();
    if (pending && /\(C:\$[0-9a-f]+\)\s*$/i.test(incoming)) {
      const resolve = pending;
      pending = undefined;
      resolve(incoming);
    }
  });
  await until(/ready\./i);

  const nines = '9'.repeat(88);
  await start(nines, nines);
  await operation('a', (BigInt(nines) * 2n).toString(), '88-digit carry addition');
  await operation('m', (BigInt(nines) ** 2n).toString(), '88-by-88-digit multiplication');
  await operation('a', (BigInt(nines) * 2n).toString(), 'addition after longest multiplication');

  await start('0', '0');
  await operation('a', '0', 'zero plus zero');
  await operation('m', '0', 'zero times zero');
  await start('00012', '00034');
  await operation('m', '408', 'leading-zero multiplication');
  await operation('a', '46', 'leading-zero addition after multiplication');
  await start('12', '34');
  await operation('m', '408', '12 times 34');
  await operation('a', '46', '12 plus 34 after multiplication');
  await start('0', nines);
  await operation('m', '0', 'zero times 88-digit operand');
  await operation('a', nines, 'addition after multiplication by zero');

  await start('\r\x1412x3\x144', '\x140z5');
  await operation('a', '129', 'blank RETURN, delete, and invalid characters');
  await start('1'.repeat(89), '1');
  await operation('a', (BigInt('1'.repeat(88)) + 1n).toString(), '89th digit is rejected');
  await keys('q');
  await until(/ready\./i);
  report.push('PASS Q exits to READY.');
  writeFileSync(path.join(root, 'varprec-notes.txt'),
    'VICE 3.10 / actual C64 BASIC V2 ROM runtime validation\n' +
    'Separate hidden emulator process, remote-monitor port 6523.\n' +
    'Long results compared digit-for-digit against JavaScript BigInt.\n\n' +
    report.join('\n\n') + '\n\n' +
    'All 13 arithmetic/input checks and Q-to-READY passed.\n' +
    'No changes to the shipped varprec.bas were needed.\n' +
    'The 88-digit limit keeps maximum products within 176 characters.\n' +
    'The multiplication accumulators stay below 8000, within signed 16-bit range.\n' +
    'GET permits input beyond the C64 editor\'s 80-column INPUT limit.\n', 'utf8');
} finally {
  if (socket) { socket.write('quit\n'); socket.end(); }
  emulator.kill();
}

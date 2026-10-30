// Run actual C64 BASIC ROM numerical checks under an isolated VICE process.
// Usage: node verify_matrix.mjs C:\path\to\VICE [monitor-port]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const vice = process.argv[2];
if (!vice) throw new Error('Supply the VICE directory containing x64sc.exe and petcat.exe');
const port = Number(process.argv[3] || 6521);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-matrix-'));
const source = fs.readFileSync(path.join(directory, 'MATMUL.BAS'), 'utf8');
const replace = new Map([
  [40, 'M=0:N=0:P=0:Q=0:ZP=3.141592654:GOTO 30000'],
  [1000, 'RETURN'], [1200, 'RETURN'],
  [10000, 'REM TEST DRIVER SUPPLIES R'],
  [12010, 'REM TEST DRIVER SUPPLIES VV'],
  [13010, 'REM TEST DRIVER SUPPLIES R1,R2'],
  [14010, 'REM TEST DRIVER SUPPLIES R1,R2'],
  [18010, 'REM TEST DRIVER SUPPLIES EX'],
]);
let text = source.split(/\r?\n/).filter(Boolean).map(line => {
  const number = Number(line.match(/^\d+/)[0]);
  return replace.has(number) ? `${number} ${replace.get(number)}` : line;
}).join('\n');
let line = 30000;
const driver = [];
function emit(statement) { driver.push(`${line} ${statement}`); line += 10; }
function check(value, expected, tolerance = '1E-6') {
  emit(`YV=${value}:YX=${expected}:YE=${tolerance}:GOSUB 39000`);
}
function reset() { emit('GOSUB 40000'); }
emit('YT=0:YF=0:POKE 49152,0:POKE 49153,0:POKE 49154,0');
reset(); emit('GOSUB 6000'); check('C(1,1)', 6); check('C(2,2)', 12);
emit('GOSUB 7000'); check('C(1,1)', -4); check('C(2,2)', -4);
emit('GOSUB 8000'); check('C(1,1)', 19); check('C(1,2)', 22);
check('C(2,1)', 43); check('C(2,2)', 50);
emit('GOSUB 9000'); check('C(1,2)', 3); check('C(2,1)', 2);
emit('R=3:GOSUB 10000'); check('C(1,1)', 1); check('C(1,2)', 0);
check('C(3,3)', 1); emit('GOSUB 11000'); check('DD', -2);
emit('VV=2:GOSUB 12000'); check('C(1,1)', 2); check('C(2,2)', 8);
emit('R1=1:R2=2:GOSUB 13000'); check('A(1,1)', 3);
emit('GOSUB 14000'); check('A(1,1)', 4); check('A(2,2)', 1);
reset(); emit('GOSUB 15000'); check('GF', 1);
check('C(1,1)', -2); check('C(1,2)', 1);
check('C(2,1)', 1.5); check('C(2,2)', -.5);
emit('GOSUB 16000'); check('D(1,1)', 1); check('D(2,2)', 1);
check('D(1,3)', -2); check('D(2,4)', -.5);
emit('P=2:Q=1:B(1,1)=5:B(2,1)=11:GOSUB 17000');
check('C(1,1)', 1); check('C(2,1)', 2);
emit('EX=0:GOSUB 18000'); check('C(1,1)', 1); check('C(1,2)', 0);
emit('EX=1:GOSUB 18000'); check('C(2,2)', 4);
emit('EX=2:GOSUB 18000'); check('C(1,1)', 7); check('C(2,2)', 22);
emit('GOSUB 19000'); check('C(1,2)', 2);
emit('GOSUB 20000'); check('D(1,1)', 1); check('D(2,2)', 1);
check('D(1,2)', 0); emit('GOSUB 21000'); check('VV', 5);
emit('GOSUB 22000'); check('RC', 2); check('P', 2); check('Q', 1);
emit('GOSUB 23000'); check('C(1,1)', 1); check('C(2,1)', 3);
check('C(2,2)', -2); check('D(1,1)', 1); check('D(1,2)', 2);
check('D(2,2)', 1);
emit('GOSUB 24000'); check('(TR+RR)/2', '(5+SQR(33))/2');
check('(TR-RR)/2', '(5-SQR(33))/2');
emit('A(1,1)=0:A(1,2)=-1:A(2,1)=1:A(2,2)=0:GOSUB 24000');
check('TR', 0); check('RR', 1); check('DX', -4);
emit('M=3:N=3:GOSUB 41000:A(1,1)=1:A(2,2)=2:A(3,3)=3');
emit('GOSUB 25000'); check('L1+L2+L3', 6); check('L1*L2*L3', 6);
check('(L1-1)*(L1-2)*(L1-3)', 0);
check('(L2-1)*(L2-2)*(L2-3)', 0);
check('(L3-1)*(L3-2)*(L3-3)', 0);
emit('GOSUB 41000:A(1,1)=3:A(2,2)=3:A(3,3)=3:GOSUB 25000');
check('L1', 3); check('L2', 3); check('L3', 3);
emit('GOSUB 41000:GOSUB 25000'); check('L1', 0); check('L2', 0);
check('L3', 0);
emit('A(1,1)=-2:A(2,2)=-2:A(3,3)=1:GOSUB 25000');
check('L1', 1); check('L2', -2); check('L3', -2);
emit('GOSUB 41000:A(1,2)=-1:A(2,1)=1:A(3,3)=2:GOSUB 25000');
check('L1', 2); check('L2', 0); check('RR', 1);
check('P', 2); check('Q', 1);
emit('M=2:N=2:GOSUB 41000:A(1,2)=1:A(2,1)=1:GOSUB 15000');
check('C(1,1)', 0); check('C(1,2)', 1); check('C(2,1)', 1);
emit('GOSUB 41000:GOSUB 15000'); check('GF', 0);
emit('GOSUB 22000'); check('RC', 0);
emit('M=2:N=3:GOSUB 41000:A(1,2)=1:A(1,3)=2');
emit('A(2,2)=2:A(2,3)=4:GOSUB 20000');
check('RC', 1); check('D(1,1)', 0); check('D(1,2)', 1);
check('D(1,3)', 2); check('D(2,2)', 0); check('D(2,3)', 0);
emit('M=10:N=10:GOSUB 41000:GOSUB 22000'); check('RC', 0);
emit('FOR I=1 TO 10:A(I,I)=2:NEXT I:GOSUB 15000');
check('GF', 1); check('C(1,1)', .5); check('C(10,10)', .5);
check('C(1,10)', 0); emit('GOSUB 22000'); check('RC', 10);
emit('GOSUB 23000'); check('C(10,10)', 2); check('D(10,10)', 1);
emit('M=1:N=1:P=1:Q=1:A(1,1)=4:B(1,1)=8:GOSUB 15000');
check('C(1,1)', .25); emit('GOSUB 17000'); check('C(1,1)', 2);
emit('GOSUB 16000'); check('D(1,1)', 1); check('D(1,2)', .25);
emit('GOSUB 23000'); check('C(1,1)', 4); check('D(1,1)', 1);
emit('GOSUB 22000'); check('RC', 1); emit('GOSUB 11000'); check('DD', 4);
emit('EX=0:GOSUB 18000'); check('C(1,1)', 1);
emit('POKE 49152,YT:POKE 49153,YF:POKE 49154,1');
emit('PRINT "ROM TESTS";YT;" FAILURES";YF:END');
driver.push('39000 YT=YT+1');
driver.push('39010 IF ABS(YV-YX)<=YE*(1+ABS(YX)) THEN RETURN');
driver.push('39020 YF=YF+1:PRINT "FAIL";YT;YV;"EXPECTED";YX:RETURN');
driver.push('40000 M=2:N=2:P=2:Q=2');
driver.push('40010 A(1,1)=1:A(1,2)=2:A(2,1)=3:A(2,2)=4');
driver.push('40020 B(1,1)=5:B(1,2)=6:B(2,1)=7:B(2,2)=8:RETURN');
driver.push('41000 FOR I=1 TO 10:FOR J=1 TO 10:A(I,J)=0:NEXT J:NEXT I:RETURN');
text += '\n' + driver.join('\n') + '\n';
const testSource = path.join(temporary, 'matrix-test.bas');
const testPrg = path.join(temporary, 'matrix-test.prg');
fs.writeFileSync(testSource, text.toLowerCase(), 'ascii');
execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', testPrg, '--', testSource]);
const availability = net.createServer();
await new Promise((resolve, reject) => {
  availability.once('error', reject);
  availability.listen(port, '127.0.0.1', resolve);
});
await new Promise(resolve => availability.close(resolve));
const emulator = spawn(path.join(vice, 'x64sc.exe'), [
  '-console', '-warp', '+sound', '-remotemonitor',
  '-remotemonitoraddress', `ip4://127.0.0.1:${port}`,
  '-logfile', path.join(temporary, 'vice.log'),
], { windowsHide: true, stdio: 'ignore' });
let socket;
let pending;
let settle;
let response = '';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const connected = await new Promise((resolve, reject) => {
        const candidate = net.connect({ host: '127.0.0.1', port });
        candidate.once('connect', () => resolve(candidate));
        candidate.once('error', reject);
      });
      return connected;
    } catch { await delay(200); }
  }
  throw new Error('VICE remote monitor did not open');
}
function command(value) {
  if (pending) throw new Error('Concurrent monitor commands');
  response = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending = undefined; reject(new Error(`Monitor timeout: ${value}\n${response}`)); }, 15000);
    pending = output => { clearTimeout(timeout); pending = undefined; resolve(output); };
    socket.write(value + '\n');
  });
}
try {
  socket = await connect();
  socket.on('data', data => {
    response += data.toString('utf8');
    clearTimeout(settle);
    if (/\(C:\$[0-9a-f]{4}\)\s*$/i.test(response) && pending) {
      settle = setTimeout(() => { if (pending) pending(response); }, 60);
    }
  });
  await delay(1500);
  await command('screen');
  const loaded = await command(`loadbasic "${testPrg.replaceAll('\\', '/')}" 0`);
  if (/error|cannot/i.test(loaded)) throw new Error(loaded);
  await command('keybuf run\\x0d');
  socket.write('x\n');
  let result;
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(500);
    const memory = await command('m c000 c00f');
    const match = memory.match(/>C:c000\s+([0-9a-f]{2})\s+([0-9a-f]{2})\s+([0-9a-f]{2})/i);
    if (match && parseInt(match[3], 16) === 1) {
      result = { assertions: parseInt(match[1], 16), failures: parseInt(match[2], 16) };
      break;
    }
    const screen = await command('screen');
    if (/\?(?:SYNTAX|TYPE MISMATCH|ILLEGAL QUANTITY|BAD SUBSCRIPT|OUT OF MEMORY|RETURN WITHOUT GOSUB|NEXT WITHOUT FOR|DIVISION BY ZERO|OVERFLOW)/i.test(screen)) {
      throw new Error(`C64 runtime error:\n${screen}`);
    }
    socket.write('x\n');
  }
  const screen = await command('screen');
  if (!result) throw new Error(`C64 test driver did not finish:\n${screen}`);
  if (!result.failures) {
    const originalPrg = path.join(directory, 'MATMUL.prg');
    await command(`loadbasic "${originalPrg.replaceAll('\\', '/')}" 0`);
    async function feed(keys, expected) {
      await command(`keybuf ${keys}`);
      socket.write('x\n');
      for (let attempt = 0; attempt < 20; attempt++) {
        await delay(200);
        const current = await command('screen');
        if (expected.test(current)) return current;
        socket.write('x\n');
      }
      throw new Error(`Original-program UI check failed: ${expected}\n${response}`);
    }
    await feed('run\\x0d', /choice/i);
    await feed('1\\x0d', /rows,cols for a/i);
    await feed('1,1\\x0d', /a\(\s*1\s*,\s*1\s*\)/i);
    await feed('4\\x0d', /a stored/i);
    await feed('\\x0d', /choice/i);
    await feed('2\\x0d', /rows,cols for b/i);
    await feed('1,1\\x0d', /b\(\s*1\s*,\s*1\s*\)/i);
    await feed('8\\x0d', /b stored/i);
    await feed('\\x0d', /choice/i);
    const solved = await feed('16\\x0d', /solution x/i);
    if (!/\(\s*1\s*,\s*1\s*\)=\s*2\s/i.test(solved)) {
      throw new Error(`Original-program solve did not print X=2:\n${solved}`);
    }
    await feed('\\x0d', /choice/i);
    await feed('25\\x0d', /ready\./i);
    result.originalProgramInputSolveExit = 'passed';
  }
  console.log(JSON.stringify({ ...result, emulatorPid: emulator.pid, temporary, screen }, null, 2));
  if (result.failures) process.exitCode = 1;
} finally {
  if (socket) { socket.write('quit\n'); socket.end(); }
  else emulator.kill();
}

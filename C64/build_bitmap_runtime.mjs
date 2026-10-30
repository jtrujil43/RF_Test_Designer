// Assemble the deliberately small 6502 instruction subset in bitmap-runtime.asm.
// No external assembler dependency is required. Regenerates bitmap-runtime.inc.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'bitmap-runtime.asm'), 'ascii');
const ops = {
  JMP: { abs: 0x4c }, JSR: { abs: 0x20 }, RTS: { imp: 0x60 }, RTI: { imp: 0x40 },
  LDA: { imm: 0xa9, abs: 0xad, ax: 0xbd, ay: 0xb9 },
  STA: { abs: 0x8d, ax: 0x9d, ay: 0x99 },
  LDX: { imm: 0xa2, abs: 0xae }, LDY: { imm: 0xa0, abs: 0xac },
  STX: { abs: 0x8e }, STY: { abs: 0x8c },
  AND: { imm: 0x29, abs: 0x2d }, ORA: { imm: 0x09, abs: 0x0d },
  EOR: { imm: 0x49, abs: 0x4d }, ADC: { imm: 0x69, abs: 0x6d },
  SBC: { imm: 0xe9, abs: 0xed }, CMP: { imm: 0xc9, abs: 0xcd },
  CPY: { imm: 0xc0 }, CPX: { imm: 0xe0 }, INC: { abs: 0xee }, DEC: { abs: 0xce },
  ASL: { acc: 0x0a }, LSR: { acc: 0x4a }, ROL: { acc: 0x2a },
  INX: { imp: 0xe8 }, DEX: { imp: 0xca }, INY: { imp: 0xc8 }, DEY: { imp: 0x88 },
  TAX: { imp: 0xaa }, TAY: { imp: 0xa8 }, TXA: { imp: 0x8a }, TYA: { imp: 0x98 },
  CLC: { imp: 0x18 }, SEC: { imp: 0x38 }, CLD: { imp: 0xd8 }, SEI: { imp: 0x78 },
  PHP: { imp: 0x08 }, PLP: { imp: 0x28 }, PHA: { imp: 0x48 }, PLA: { imp: 0x68 },
  BNE: { rel: 0xd0 }, BEQ: { rel: 0xf0 }, BCC: { rel: 0x90 }, BCS: { rel: 0xb0 },
  BPL: { rel: 0x10 }, BMI: { rel: 0x30 },
};
const labels = new Map();
const records = [];
let pc = 0xc000;
for (const original of source.split(/\r?\n/)) {
  let line = original.replace(/;.*/, '').trim();
  if (!line) continue;
  const label = line.match(/^([a-z][a-z0-9]*):\s*(.*)$/i);
  if (label) {
    if (labels.has(label[1])) throw Error(`Duplicate label ${label[1]}`);
    labels.set(label[1], pc); line = label[2];
    if (!line) continue;
  }
  if (/^\.org/i.test(line)) { pc = parseInt(line.split('$')[1], 16); continue; }
  if (/^\.byte/i.test(line)) {
    const values = line.replace(/^\.byte\s+/i, '').split(',').map(s => s.trim());
    records.push({ pc, values }); pc += values.length; continue;
  }
  const match = line.match(/^(\w+)(?:\s+(.*))?$/);
  const mnemonic = match[1].toUpperCase(), operand = match[2] || '';
  const modes = ops[mnemonic];
  if (!modes) throw Error(`Unknown instruction ${line}`);
  let mode = !operand ? 'imp' : operand === 'A' ? 'acc' : operand.startsWith('#') ? 'imm'
    : ',X' === operand.slice(-2) ? 'ax' : ',Y' === operand.slice(-2) ? 'ay'
    : modes.rel !== undefined ? 'rel' : 'abs';
  if (modes[mode] === undefined) throw Error(`Unsupported addressing: ${line}`);
  records.push({ pc, mnemonic, mode, operand });
  pc += mode === 'imp' || mode === 'acc' ? 1 : mode === 'imm' || mode === 'rel' ? 2 : 3;
}
function value(expression) {
  let expr = expression.replace(/^#/, '').replace(/,[XY]$/, '').trim();
  const part = /^[<>]/.test(expr) ? expr[0] : ''; if (part) expr = expr.slice(1);
  const bits = expr.split('+').map(bit => bit.trim());
  let result = 0;
  for (const bit of bits) {
    if (bit.startsWith('$')) result += parseInt(bit.slice(1), 16);
    else if (/^\d+$/.test(bit)) result += Number(bit);
    else if (labels.has(bit)) result += labels.get(bit);
    else throw Error(`Undefined value ${expression}`);
  }
  return part === '<' ? result & 255 : part === '>' ? result >> 8 : result;
}
const bytes = [];
for (const record of records) {
  if (record.pc !== 0xc000 + bytes.length) throw Error('Assembly gap');
  if (record.values) { bytes.push(...record.values.map(value)); continue; }
  bytes.push(ops[record.mnemonic][record.mode]);
  if (record.mode === 'imp' || record.mode === 'acc') continue;
  let operand = value(record.operand);
  if (record.mode === 'rel') {
    operand -= record.pc + 2;
    if (operand < -128 || operand > 127) throw Error(`Branch out of range ${record.mnemonic} ${record.operand}`);
    bytes.push(operand & 255);
  } else {
    bytes.push(operand & 255);
    if (record.mode !== 'imm') bytes.push(operand >> 8);
  }
}
if (bytes.length > 0x7f0) throw Error('Runtime overlaps parameter block');
const basic = [
  '30000 REM NATIVE 160X200 MULTICOLOR BITMAP',
  '30010 IF G9=1 THEN 30050',
  '30020 RESTORE',
  `30030 FOR G0=49152 TO ${49152 + bytes.length - 1}`,
  '30040 READ GX:POKE G0,GX:NEXT G0:G9=1',
  '30050 SYS 49152:RETURN',
  '30100 GOSUB 30600:SYS 49158:RETURN',
  '30200 GOSUB 30600:SYS 49161:RETURN',
  '30300 GOSUB 30600:G6=G1:G7=G2:GX=G3:GY=G4',
  '30310 G4=G7:GOSUB 30100',
  '30320 G1=GX:G2=G7:G3=GX:G4=GY:GOSUB 30100',
  '30330 G1=GX:G2=GY:G3=G6:G4=GY:GOSUB 30100',
  '30340 G1=G6:G2=GY:G3=G6:G4=G7:GOSUB 30100',
  '30350 G1=G6:G2=G7:G3=GX:G4=GY:RETURN',
  '30400 GX=G1:GY=G2:G6=ABS(G3):G7=ABS(G4)',
  '30410 G1=GX+G6:G2=GY',
  '30420 FOR GZ=1 TO 48',
  '30430 G3=GX+G6*COS(GZ*.130899694)',
  '30440 G4=GY+G7*SIN(GZ*.130899694)',
  '30450 GOSUB 30100:G1=G3:G2=G4:NEXT GZ',
  '30460 G1=GX:G2=GY:G3=G6:G4=G7:RETURN',
  '30500 IF G9<>1 THEN RETURN',
  '30510 SYS 49155:RETURN',
  '30600 G1=INT(G1+.5):G2=INT(G2+.5)',
  '30610 G3=INT(G3+.5):G4=INT(G4+.5)',
  '30620 IF G1<0 THEN G1=0',
  '30630 IF G1>159 THEN G1=159',
  '30640 IF G2<0 THEN G2=0',
  '30650 IF G2>199 THEN G2=199',
  '30660 IF G3<0 THEN G3=0',
  '30670 IF G3>159 THEN G3=159',
  '30680 IF G4<0 THEN G4=0',
  '30690 IF G4>199 THEN G4=199',
  '30700 G5=INT(G5) AND 3',
  '30710 POKE 51184,G1:POKE 51185,G2',
  '30720 POKE 51186,G3:POKE 51187,G4:POKE 51188,G5:RETURN',
];
for (let i = 0; i < bytes.length; i += 12) basic.push(`${32000 + i / 12 * 10} DATA ${bytes.slice(i, i + 12).join(',')}`);
if (basic.some(line => line.length > 80)) throw Error('BASIC line exceeds 80 columns');
fs.writeFileSync(path.join(here, 'bitmap-runtime.inc'), basic.join('\r\n') + '\r\n', 'ascii');
console.log(`Built bitmap-runtime.inc: ${bytes.length} native bytes, ${basic.length} BASIC lines`);

if (process.argv[2] === '--test') {
  const vice = process.argv[3];
  if (!vice) throw Error('Supply the directory containing x64sc.exe and petcat.exe');
  const port = 6531;
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bitmap-runtime-'));
  const test = [
    '10 GOSUB 30500:A=123:B$="KEEP":PI=3.141592654',
    '20 GOSUB 30000',
    '30 G1=0:G2=0:G3=159:G4=199:G5=1:GOSUB 30100',
    '40 G1=159:G2=0:G3=0:G4=199:G5=2:GOSUB 30100',
    '50 G1=10:G2=10:G3=30:G4=20:G5=3:GOSUB 30200',
    '55 G1=15:G2=13:G3=18:G4=17:G5=0:GOSUB 30200',
    '60 G1=40:G2=10:G3=60:G4=25:G5=1:GOSUB 30300',
    '70 G1=80:G2=100:G3=30:G4=40:G5=3:GOSUB 30400',
    '71 G1=120:G2=10:G3=120:G4=10:G5=1:GOSUB 30100',
    '72 G1=121:G2=10:G3=121:G4=10:G5=2:GOSUB 30100',
    '73 G1=122:G2=10:G3=122:G4=10:G5=3:GOSUB 30100',
    '74 G1=123:G2=10:G3=123:G4=10:G5=0:GOSUB 30100',
    '80 POKE 49101,PEEK(53265) AND 96',
    '81 POKE 49102,PEEK(53270) AND 16',
    '82 POKE 49103,PEEK(56576) AND 3',
    '83 POKE 49107,PEEK(53272):POKE 49108,PEEK(1)',
    '90 POKE 49100,1',
    '100 GET K$:IF K$="" THEN 100',
    '110 GOSUB 30500',
    '111 POKE 49104,PEEK(53265) AND 96',
    '112 POKE 49105,PEEK(53270) AND 16',
    '113 POKE 49106,PEEK(56576) AND 3',
    '120 IF A<>123 OR B$<>"KEEP" THEN PRINT "FAIL":END',
    '125 IF ABS(PI-3.141592654)>1E-8 THEN PRINT "FAIL":END',
    '130 PRINT "RESTORED":POKE 49100,2:END',
  ].concat(basic).join('\n').toLowerCase();
  const sourceFile = path.join(temporary, 'test.bas');
  const programFile = path.join(temporary, 'test.prg');
  const memoryFile = path.join(temporary, 'memory.bin');
  fs.writeFileSync(sourceFile, test, 'ascii');
  execFileSync(path.join(vice, 'petcat.exe'), ['-w2', '-f', '-o', programFile, '--', sourceFile]);
  const emulator = spawn(path.join(vice, 'x64sc.exe'), [
    '-console', '-warp', '+sound', '-remotemonitor',
    '-remotemonitoraddress', `ip4://127.0.0.1:${port}`,
    '-logfile', path.join(temporary, 'vice.log'),
  ], { windowsHide: true, stdio: 'ignore' });
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let socket, incoming = '', pending, settling;
  async function command(value) {
    incoming = '';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending = undefined; reject(Error(`Monitor timeout: ${value}\n${incoming}`));
      }, 5000);
      pending = value => { clearTimeout(timeout); resolve(value); };
      socket.write(value + '\n');
    });
  }
  async function run(ms) { socket.write('x\n'); await delay(ms); }
  async function memory() {
    await command('bank ram');
    await command(`bsave "${memoryFile.replaceAll('\\', '/')}" 0 0000 ffff`);
    await command('bank cpu');
    return fs.readFileSync(memoryFile);
  }
  function assert(condition, description) { if (!condition) throw Error(description); }
  try {
    await delay(1500);
    socket = await new Promise((resolve, reject) => {
      const candidate = net.connect(port, '127.0.0.1');
      candidate.once('error', reject); candidate.once('connect', () => resolve(candidate));
    });
    socket.on('data', data => {
      incoming += data.toString(); clearTimeout(settling);
      if (pending && /\(C:\$[0-9a-f]+\)\s*$/i.test(incoming)) {
        settling = setTimeout(() => {
          if (!pending) return; const resolve = pending; pending = undefined; resolve(incoming);
        }, 60);
      }
    });
    await delay(150);
    await command('screen');
    await command(`loadbasic "${programFile.replaceAll('\\', '/')}" 0`);
    await command('keybuf run\\x0d');
    await run(500);
    let ram;
    for (let attempt = 0; attempt < 80; attempt++) {
      ram = await memory();
      if (ram[49100] === 1) break;
      await run(250);
    }
    assert(ram[49100] === 1, `Drawing did not finish.\n${await command('screen')}`);
    assert(ram[49101] === 32 && ram[49102] === 16 && ram[49103] === 0,
      'Incorrect multicolor bitmap mode/VIC bank');
    assert((ram[49107] & 254) === 56 && ram[49108] === 55, 'Wrong bitmap base or CPU ROM mapping');
    function pixel(x, y) {
      const at = 0xe000 + Math.floor(y / 8) * 320 + Math.floor(x / 4) * 8 + y % 8;
      return (ram[at] >> (6 - 2 * (x % 4))) & 3;
    }
    for (const [x, y, color] of [
      [0, 0, 1], [159, 199, 1], [159, 0, 2], [0, 199, 2],
      [10, 10, 3], [30, 20, 3], [16, 15, 0],
      [40, 10, 1], [60, 25, 1], [50, 15, 0],
      [110, 100, 3], [50, 100, 3], [80, 60, 3], [80, 140, 3],
      [120, 10, 1], [121, 10, 2], [122, 10, 3], [123, 10, 0],
    ]) assert(pixel(x, y) === color, `Pixel ${x},${y}: wanted ${color}, got ${pixel(x, y)}`);
    assert(ram[0xcc00] === 0x73 && ram[0xcfe7] === 0x73, 'Wrong color matrix');
    console.log('PASS native lines, filled/outline rectangles, ellipse, packed pixels and palette');
    await command('keybuf z'); await run(400);
    ram = await memory();
    assert(ram[49100] === 2, `Text restore did not finish.\n${await command('screen')}`);
    assert(ram[49104] === 0 && ram[49105] === 0 && ram[49106] === 3,
      'Standard text mode/VIC bank not restored');
    assert(/restored/i.test(await command('screen')), 'Restored text is not readable');
    console.log('PASS standard text restoration, CPU mapping and unrelated BASIC variables');
    console.log(`Runtime test files: ${temporary}`);
  } finally {
    if (socket) { socket.write('quit\n'); socket.end(); }
    emulator.kill();
  }
}

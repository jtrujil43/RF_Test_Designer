// Host-side preview of the actual Hand BASIC RDXTALK graphics statements.
// This checks the drawing commands; it is not an emulation of the mobile app.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'rdxtalk.bas'), 'ascii');
function split(value, separator) {
  const result = []; let quoted = false, depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === separator && !depth) { result.push(value.slice(start, i).trim()); start = i + 1; }
    }
  }
  result.push(value.slice(start).trim()); return result;
}
const variables = { DW: 45, SG: 20, L: 5 };
function evaluate(value) {
  let rest = value.trim(), expression = '';
  while (rest) {
    let match;
    if ((match = rest.match(/^\s+/))) expression += ' ';
    else if ((match = rest.match(/^"([^"]*)"/))) expression += JSON.stringify(match[1]);
    else if ((match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/))) expression += match[0];
    else if ((match = rest.match(/^[A-Z][A-Z0-9]*\$?/))) {
      expression += match[0] === 'STR$' ? 'str' : `get(${JSON.stringify(match[0])})`;
    } else if ((match = rest.match(/^(<>|<=|>=|[+*/^(),<>=-])/))) {
      expression += ({ '<>': '!==', '=': '===', '^': '**' })[match[0]] || match[0];
    } else throw Error('Unsupported preview expression: ' + rest);
    rest = rest.slice(match[0].length);
  }
  return Function('get', 'str', `return (${expression})`)(
    name => variables[name] ?? (name.endsWith('$') ? '' : 0),
    number => (number >= 0 ? ' ' : '') + String(number));
}
const statements = [], addresses = new Map();
for (const line of source.trim().split(/\r?\n/)) {
  const match = line.match(/^(\d+)\s+(.*)$/);
  const number = Number(match[1]); addresses.set(number, statements.length);
  for (const body of split(match[2], ':')) statements.push({ number, body });
}
const commands = [], colors = new Map(), calls = [-1], loops = [];
let position = addresses.get(770), width = 480, height = 300, font = 12;
let finished = false;
function execute(body, line) {
  let match;
  if (!body || /^REM\b/.test(body)) return;
  if ((match = body.match(/^IF (.+?) THEN (.+)$/))) {
    if (evaluate(match[1])) {
      if (/^\d+$/.test(match[2])) position = addresses.get(Number(match[2]));
      else execute(match[2], line);
    } else while (statements[position]?.number === line) position++;
  } else if ((match = body.match(/^GOSUB (\d+)$/))) {
    calls.push(position); position = addresses.get(Number(match[1]));
  } else if (body === 'RETURN') {
    position = calls.pop(); if (position === -1) finished = true;
  } else if ((match = body.match(/^FOR ([A-Z][A-Z0-9]*)=(.+?) TO (.+?)(?: STEP (.+))?$/))) {
    const start = evaluate(match[2]), end = evaluate(match[3]), step = match[4] ? evaluate(match[4]) : 1;
    variables[match[1]] = start; loops.push({ name: match[1], end, step, position });
  } else if ((match = body.match(/^NEXT(?: ([A-Z][A-Z0-9]*))?$/))) {
    const loop = loops.at(-1); if (!loop || (match[1] && loop.name !== match[1])) throw Error(body);
    variables[loop.name] += loop.step;
    if (loop.step > 0 ? variables[loop.name] <= loop.end : variables[loop.name] >= loop.end) position = loop.position;
    else loops.pop();
  } else if ((match = body.match(/^([A-Z][A-Z0-9]*\$?)=(.+)$/))) variables[match[1]] = evaluate(match[2]);
  else if ((match = body.match(/^(CSET|FSET|RECT|LINE|GPRINT|CIRCLE|FRAME|SCREEN) (.+)$/))) {
    const values = split(match[2], ',').map(evaluate), type = match[1];
    if (type === 'CSET') colors.set(values[0], `rgb(${values.slice(1, 4).join(',')})`);
    else if (type === 'FSET') font = values[1];
    else if (type !== 'SCREEN') commands.push({ type, values, font });
  } else if (body !== 'CLS') throw Error('Unsupported preview statement: ' + body);
}
for (let step = 0; !finished; step++) {
  if (step > 10000 || position === undefined) throw Error('Preview control flow did not finish.');
  const statement = statements[position++]; execute(statement.body, statement.number);
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const shapes = [];
for (const { type, values: v, font: size } of commands) {
  const color = escape(colors.get(v.at(-1)) || '#000');
  if (type === 'RECT' || type === 'FRAME') shapes.push(`<rect x="${Math.min(v[0], v[2])}" y="${Math.min(v[1], v[3])}" width="${Math.abs(v[2] - v[0])}" height="${Math.abs(v[3] - v[1])}" fill="${type === 'FRAME' ? 'none' : color}" stroke="${color}"/>`);
  else if (type === 'LINE') shapes.push(`<line x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}" stroke="${color}"/>`);
  else if (type === 'GPRINT') shapes.push(`<text x="${v[1]}" y="${v[2]}" fill="${color}" font-family="Courier New,monospace" font-size="${size}">${escape(v[0])}</text>`);
}
const output = path.join(root, 'handbasic-previews'); mkdirSync(output, { recursive: true });
const svg = path.join(output, 'rdxtalk.svg'), png = path.join(output, 'rdxtalk.png');
writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('\n')}</svg>\n`);
execFileSync('magick', ['-background', 'white', svg, png]);
writeFileSync(path.join(output, 'rdxtalk-commands.json'), JSON.stringify(commands, null, 2));
console.log(`Rendered ${commands.length} native Hand BASIC drawing commands to ${png}`);

// Limited source-driven Hand BASIC interpreter for reproducible host previews.
// This is a drawing/numerical check, not an implementation of the mobile app.
import { createHash } from 'node:crypto';

export function splitBasic(value, separator) {
  const result = []; let quoted = false, depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === separator && depth === 0) {
        result.push(value.slice(start, i).trim()); start = i + 1;
      }
    }
  }
  result.push(value.slice(start).trim()); return result;
}

export const xml = value => String(value).replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// Canonical text hashes survive Git's Windows CRLF / repository LF conversion.
// Binary inputs retain ordinary byte-for-byte hashing.
export const sha256 = value => createHash('sha256')
  .update(typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value)
  .digest('hex');

export class HandBasicPreview {
  constructor(source, variables = {}) {
    this.source = source; this.variables = { ...variables };
    this.arrays = new Map(); this.functions = new Map();
    this.commands = []; this.colors = new Map(); this.font = 12;
    this.width = 480; this.height = 300; this.printed = []; this.executed = new Set();
    this.statements = []; this.addresses = new Map();
    for (const line of source.trim().split(/\r?\n/)) {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) throw Error('Invalid numbered BASIC source: ' + line);
      const number = Number(match[1]); this.addresses.set(number, this.statements.length);
      // REM owns the rest of a numbered line, including literal colons.
      const bodies = /^REM\b/.test(match[2]) ? [match[2]] : splitBasic(match[2], ':');
      for (const body of bodies) this.statements.push({ number, body });
    }
  }

  get(name, locals = {}) {
    return name in locals ? locals[name] : this.variables[name] ?? (name.endsWith('$') ? '' : 0);
  }

  evaluate(value, locals = {}) {
    const tokens = []; let rest = value.trim();
    while (rest) {
      let match;
      if ((match = rest.match(/^\s+/))) { rest = rest.slice(match[0].length); continue; }
      if ((match = rest.match(/^"([^"]*)"/))) tokens.push({ type: 'value', value: match[1] });
      else if ((match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/))) tokens.push({ type: 'value', value: Number(match[0]) });
      else if ((match = rest.match(/^[A-Z][A-Z0-9]*\$?/))) tokens.push({ type: 'name', value: match[0] });
      else if ((match = rest.match(/^(<>|<=|>=|[+*/^(),<>=-])/))) tokens.push({ type: 'symbol', value: match[0] });
      else throw Error('Unsupported BASIC expression: ' + rest);
      rest = rest.slice(match[0].length);
    }
    let at = 0;
    const precedence = { OR: 1, AND: 2, '=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
      '+': 4, '-': 4, '*': 5, '/': 5, '^': 7 };
    const invoke = (name, args) => {
      const builtin = {
        ABS: Math.abs, SQR: Math.sqrt, EXP: Math.exp, LOG: Math.log,
        SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATN: Math.atan,
        INT: Math.floor, SGN: Math.sign, LEN: x => String(x).length,
        'STR$': x => (x >= 0 ? ' ' : '') + String(Number(x.toPrecision(9))),
        'CHR$': x => String.fromCharCode(x), ASC: x => String(x).charCodeAt(0),
        'LEFT$': (x, n) => x.slice(0, n), 'RIGHT$': (x, n) => x.slice(-n),
        'MID$': (x, start, n) => x.slice(start - 1, n === undefined ? undefined : start - 1 + n),
      }[name];
      if (builtin) return builtin(...args);
      if (name.startsWith('FN ')) {
        const fn = this.functions.get(name.slice(3));
        if (!fn) throw Error('Undefined function ' + name);
        return this.evaluate(fn.body, { ...locals, [fn.argument]: args[0] });
      }
      if (!this.arrays.has(name)) throw Error('Undefined function/array ' + name);
      return this.arrays.get(name).get(args.join(',')) ?? 0;
    };
    const expression = minimum => {
      let token = tokens[at++], left;
      if (!token) throw Error('Incomplete BASIC expression: ' + value);
      if (token.value === '-' || token.value === '+') {
        left = expression(6); if (token.value === '-') left = -left;
      } else if (token.value === 'NOT') left = expression(3) ? 0 : -1;
      else if (token.value === '(') {
        left = expression(0);
        if (tokens[at++]?.value !== ')') throw Error('Missing parenthesis: ' + value);
      } else if (token.type === 'value') left = token.value;
      else if (token.type === 'name') {
        let name = token.value;
        if (name === 'FN') name += ' ' + tokens[at++].value;
        if (tokens[at]?.value === '(') {
          at++; const args = [];
          if (tokens[at]?.value !== ')') {
            do { args.push(expression(0)); } while (tokens[at]?.value === ',' && ++at);
          }
          if (tokens[at++]?.value !== ')') throw Error('Missing function parenthesis: ' + value);
          left = invoke(name, args);
        } else left = this.get(name, locals);
      } else throw Error('Unexpected token: ' + token.value);
      while (at < tokens.length) {
        const operator = tokens[at].value, level = precedence[operator];
        if (level === undefined || level < minimum) break;
        at++; const right = expression(operator === '^' ? level : level + 1);
        if (operator === '+') left = left + right;
        else if (operator === '-') left -= right;
        else if (operator === '*') left *= right;
        else if (operator === '/') left /= right;
        else if (operator === '^') left **= right;
        else if (operator === 'AND') left = left && right ? -1 : 0;
        else if (operator === 'OR') left = left || right ? -1 : 0;
        else left = ({ '=': () => left === right, '<>': () => left !== right,
          '<': () => left < right, '>': () => left > right,
          '<=': () => left <= right, '>=': () => left >= right })[operator]() ? -1 : 0;
      }
      return left;
    };
    const result = expression(0);
    if (at !== tokens.length) throw Error('Trailing expression tokens: ' + value);
    return result;
  }

  initialize() {
    for (const { number, body } of this.statements) {
      if (/^(PRINT|INPUT|GET|GOTO|GOSUB)\b/.test(body)) break;
      if (/^REM\b/.test(body) || !body) continue;
      this.execute(body, number);
    }
    return this;
  }

  run(entry, { maximumSteps = 200000 } = {}) {
    this.position = this.addresses.get(entry); this.calls = [-1]; this.loops = []; this.finished = false;
    for (let step = 0; !this.finished; step++) {
      if (step > maximumSteps || this.position === undefined) throw Error(`BASIC preview control flow did not finish at ${entry}`);
      const statement = this.statements[this.position++];
      if (!statement) throw Error('BASIC preview fell past source.');
      this.execute(statement.body, statement.number);
    }
    return this;
  }

  execute(body, line) {
    this.executed.add(line); let match;
    if (!body || /^REM\b/.test(body)) return;
    if ((match = body.match(/^IF (.+?) THEN (.+)$/))) {
      if (this.evaluate(match[1])) {
        if (/^\d+$/.test(match[2])) this.position = this.addresses.get(Number(match[2]));
        else this.execute(match[2], line);
      } else while (this.statements[this.position]?.number === line) this.position++;
    } else if ((match = body.match(/^GOSUB\s*(\d+)$/))) {
      this.calls.push(this.position); this.position = this.addresses.get(Number(match[1]));
    } else if ((match = body.match(/^GOTO\s*(\d+)$/))) this.position = this.addresses.get(Number(match[1]));
    else if (body === 'RETURN') {
      this.position = this.calls.pop(); if (this.position === -1) this.finished = true;
    } else if ((match = body.match(/^FOR ([A-Z][A-Z0-9]*)=(.+?) TO (.+?)(?: STEP (.+))?$/))) {
      const start = this.evaluate(match[2]), end = this.evaluate(match[3]), step = match[4] ? this.evaluate(match[4]) : 1;
      this.variables[match[1]] = start;
      this.loops.push({ name: match[1], end, step, position: this.position });
      if (step > 0 ? start > end : start < end) throw Error('Empty FOR not needed by current preview routines.');
    } else if ((match = body.match(/^NEXT(?: ([A-Z][A-Z0-9]*))?$/))) {
      const loop = this.loops.at(-1);
      if (!loop || (match[1] && loop.name !== match[1])) throw Error('Unmatched ' + body);
      this.variables[loop.name] += loop.step;
      if (loop.step > 0 ? this.variables[loop.name] <= loop.end : this.variables[loop.name] >= loop.end) this.position = loop.position;
      else this.loops.pop();
    } else if ((match = body.match(/^DEF FN ([A-Z][A-Z0-9]*)\(([A-Z][A-Z0-9]*)\)=(.+)$/))) {
      this.functions.set(match[1], { argument: match[2], body: match[3] });
    } else if ((match = body.match(/^DIM (.+)$/))) {
      for (const definition of splitBasic(match[1], ',')) this.arrays.set(definition.match(/^([A-Z][A-Z0-9]*)/)[1], new Map());
    } else if ((match = body.match(/^([A-Z][A-Z0-9]*\$?)(?:\(([^)]+)\))?=(.+)$/))) {
      const value = this.evaluate(match[3]);
      if (match[2]) this.arrays.get(match[1]).set(splitBasic(match[2], ',').map(x => this.evaluate(x)).join(','), value);
      else this.variables[match[1]] = value;
      if (typeof value === 'number' && !Number.isFinite(value)) throw Error(`Nonfinite value at BASIC line ${line}: ${body}`);
    } else if ((match = body.match(/^(CSET|FSET|RECT|LINE|GPRINT|CIRCLE|FRAME|TRIANGLE|SCREEN) (.+)$/))) {
      const values = splitBasic(match[2], ',').map(x => this.evaluate(x)), type = match[1];
      if (type === 'CSET') this.colors.set(values[0], `rgb(${values.slice(1, 4).join(',')})`);
      else if (type === 'FSET') this.font = values[1];
      else if (type !== 'SCREEN') this.commands.push({ type, values, font: this.font, sourceLine: line });
    } else if (body === 'CLS') this.commands = [];
    else if ((match = body.match(/^PRINT(?: (.*))?$/))) {
      const values = splitBasic(match[1] ?? '', ';').flatMap(x => splitBasic(x, ',')).filter(Boolean).map(x => this.evaluate(x));
      this.printed.push(values.map(String).join(' '));
    } else if (body === 'END') throw Error('BASIC ended during preview: ' + this.printed.slice(-4).join(' / '));
    else throw Error(`Unsupported preview statement at ${line}: ${body}`);
  }

  svg({ title = 'Hand BASIC source-derived preview', metadata = '', banner = [] } = {}) {
    const shapes = [];
    for (const { type, values: v, font } of this.commands) {
      const colorIndex = type === 'CIRCLE' ? v[3] : v.at(-1);
      const color = xml(this.colors.get(colorIndex) || '#000');
      if (type === 'RECT' || type === 'FRAME') shapes.push(`<rect x="${Math.min(v[0], v[2])}" y="${Math.min(v[1], v[3])}" width="${Math.abs(v[2] - v[0])}" height="${Math.abs(v[3] - v[1])}" fill="${type === 'FRAME' ? 'none' : color}" stroke="${color}"/>`);
      else if (type === 'LINE') shapes.push(`<line x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}" stroke="${color}"/>`);
      else if (type === 'GPRINT') shapes.push(`<text x="${v[1]}" y="${v[2]}" fill="${color}" font-family="Courier New,monospace" font-size="${font}">${xml(v[0])}</text>`);
      else if (type === 'CIRCLE') shapes.push(`<circle cx="${v[0]}" cy="${v[1]}" r="${v[2]}" fill="${v[4] ? color : 'none'}" stroke="${color}"/>`);
      else if (type === 'TRIANGLE') shapes.push(`<polygon points="${v[0]},${v[1]} ${v[2]},${v[3]} ${v[4]},${v[5]}" fill="${color}"/>`);
      else throw Error('Unhandled drawing command ' + type);
    }
    const bannerHeight = banner.length ? 56 : 0;
    const header = banner.length ? `<rect width="${this.width}" height="56" fill="#fff0cf"/><path d="M0 55H${this.width}" stroke="#c4953d"/>\n${banner.map((line, i) => `<text x="${this.width / 2}" y="${16 + 16 * i}" text-anchor="middle" fill="#5e3e0b" font-family="Arial,sans-serif" font-size="${i === 0 ? 12 : 10}"${i === 0 ? ' font-weight="bold"' : ''}>${xml(line)}</text>`).join('\n')}` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height + bannerHeight}" viewBox="0 0 ${this.width} ${this.height + bannerHeight}">\n<title>${xml(title)}</title>\n<desc>${xml(metadata)}</desc>\n${header}\n<g transform="translate(0 ${bannerHeight})">\n${shapes.join('\n')}\n</g>\n</svg>\n`;
  }
}

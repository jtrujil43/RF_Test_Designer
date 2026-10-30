// Execute resonator2.bas numeric and graphics routines on the host.
// These are source-derived previews, not screenshots of the Hand BASIC app.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'resonator2.bas');
const profilePath = path.join(root, 'handbasic-preview-profile.json');
if (!existsSync(profilePath)) throw Error('Create handbasic-preview-profile.json first.');
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const source = readFileSync(sourcePath, 'ascii');
const output = path.join(root, 'handbasic-previews');
mkdirSync(output, { recursive: true });
// Canonical text hashes survive Git's LF/CRLF conversion on every platform.
const hash = text => createHash('sha256')
  .update(String(text).replace(/\r\n?/g, '\n'), 'utf8').digest('hex');

function split(text, separator) {
  const result = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === separator && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
    }
  }
  result.push(text.slice(start).trim()); return result;
}

const statements = [], addresses = new Map();
for (const line of source.trim().split(/\r?\n/)) {
  const [, label, rest] = line.match(/^(\d+)\s+(.*)$/);
  addresses.set(Number(label), statements.length);
  if (/^REM\b/.test(rest)) statements.push({ number: Number(label), body: rest });
  else for (const body of split(rest, ':')) statements.push({ number: Number(label), body });
}

function runtime(seed) {
  const vars = { ...seed }, arrays = {}, commands = [], trace = [];
  const colors = new Map(); let font = 22, lineWidth = 1, position = 0, finished = false;
  let calls = [], loops = [];
  function tokenize(text) {
    const tokens = [];
    while (text.trim()) {
      text = text.trimStart(); let m;
      if ((m = text.match(/^"([^"]*)"/))) tokens.push({ type: 'value', value: m[1] });
      else if ((m = text.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/))) tokens.push({ type: 'value', value: Number(m[0]) });
      else if ((m = text.match(/^(AND|OR|NOT)\b/))) tokens.push({ type: 'op', value: m[0] });
      else if ((m = text.match(/^[A-Z][A-Z0-9]*\$?/))) tokens.push({ type: 'name', value: m[0] });
      else if ((m = text.match(/^(<>|<=|>=|[+*/^(),<>=-])/))) tokens.push({ type: 'op', value: m[0] });
      else throw Error('Unsupported expression: ' + text);
      text = text.slice(m[0].length);
    }
    return tokens;
  }
  function evaluate(text) {
    const tokens = tokenize(text); let at = 0;
    const precedence = { OR: 1, AND: 2, '=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '^': 7 };
    function expr(minimum = 0) {
      const token = tokens[at++];
      if (!token) throw Error('Missing expression term in ' + text);
      let value;
      if (token.type === 'value') value = token.value;
      else if (['-', '+', 'NOT'].includes(token.value)) {
        value = expr(token.value === 'NOT' ? 3 : 6);
        value = token.value === '-' ? -value : token.value === 'NOT' ? ~value : +value;
      } else if (token.value === '(') {
        value = expr(); if (tokens[at++]?.value !== ')') throw Error('Missing closing parenthesis: ' + text);
      } else if (token.value === 'FN') {
        const name = tokens[at++]?.value;
        if (name !== 'RD' || tokens[at++]?.value !== '(') throw Error('Unsupported FN: ' + text);
        value = Math.floor(expr() * 10000 + .5) / 10000;
        if (tokens[at++]?.value !== ')') throw Error('Missing FN closing parenthesis: ' + text);
      } else if (token.type === 'name') {
        const name = token.value;
        if (tokens[at]?.value === '(') {
          at++; const argument = expr();
          if (tokens[at++]?.value !== ')') throw Error('Missing function closing parenthesis: ' + text);
          const functions = { INT: Math.floor, SQR: Math.sqrt, ABS: Math.abs, SIN: Math.sin,
            COS: Math.cos, LOG: Math.log, EXP: Math.exp,
            'STR$': n => (n >= 0 ? ' ' : '') + String(n),
            PEEK: address => ({ 1038: 238, 1039: 2, 1040: 144, 1041: 1 })[address] ?? 0 };
          value = functions[name] ? functions[name](argument) : arrays[name]?.[argument] ?? (name.endsWith('$') ? '' : 0);
        } else value = vars[name] ?? (name.endsWith('$') ? '' : 0);
      } else throw Error('Unexpected token: ' + JSON.stringify(token));
      while (at < tokens.length) {
        const op = tokens[at].value, priority = precedence[op];
        if (priority === undefined || priority < minimum) break;
        at++; const rhs = expr(priority + (op === '^' ? 0 : 1));
        switch (op) {
          case '+': value += rhs; break;
          case '-': value -= rhs; break;
          case '*': value *= rhs; break;
          case '/': value /= rhs; break;
          case '^': value **= rhs; break;
          case '=': value = value === rhs ? -1 : 0; break;
          case '<>': value = value !== rhs ? -1 : 0; break;
          case '<': value = value < rhs ? -1 : 0; break;
          case '>': value = value > rhs ? -1 : 0; break;
          case '<=': value = value <= rhs ? -1 : 0; break;
          case '>=': value = value >= rhs ? -1 : 0; break;
          case 'AND': value &= rhs; break;
          case 'OR': value |= rhs; break;
        }
      }
      return value;
    }
    const result = expr();
    if (at !== tokens.length) throw Error('Unconsumed tokens: ' + text + ' @' + at);
    if (typeof result === 'number' && !Number.isFinite(result)) throw Error('Non-finite expression: ' + text);
    return result;
  }
  function jump(label) {
    const next = addresses.get(Number(label));
    if (next === undefined) throw Error('Unknown BASIC label ' + label);
    position = next;
  }
  function execute(body, line) {
    let m;
    if (!body || /^REM\b/.test(body)) return;
    if ((m = body.match(/^IF (.+?) THEN (.+)$/))) {
      if (evaluate(m[1])) { if (/^\d+$/.test(m[2])) jump(m[2]); else execute(m[2], line); }
      else while (statements[position]?.number === line) position++;
    } else if ((m = body.match(/^GOSUB (\d+)$/))) { calls.push(position); jump(m[1]); }
    else if ((m = body.match(/^GOTO (\d+)$/))) jump(m[1]);
    else if (body === 'RETURN') { position = calls.pop(); if (position === -1) finished = true; }
    else if ((m = body.match(/^FOR ([A-Z][A-Z0-9]*)=(.+?) TO (.+?)(?: STEP (.+))?$/))) {
      const start = evaluate(m[2]), end = evaluate(m[3]), step = m[4] ? evaluate(m[4]) : 1;
      vars[m[1]] = start; loops.push({ name: m[1], end, step, position });
    } else if ((m = body.match(/^NEXT(?: ([A-Z][A-Z0-9]*))?$/))) {
      const loop = loops.at(-1);
      if (!loop || (m[1] && m[1] !== loop.name)) throw Error('Loop mismatch: ' + body);
      vars[loop.name] += loop.step;
      if (loop.step > 0 ? vars[loop.name] <= loop.end : vars[loop.name] >= loop.end) position = loop.position;
      else loops.pop();
    } else if ((m = body.match(/^([A-Z][A-Z0-9]*\$?)\((.+)\)=(.+)$/))) {
      (arrays[m[1]] ??= {})[evaluate(m[2])] = evaluate(m[3]);
    } else if ((m = body.match(/^([A-Z][A-Z0-9]*\$?)=(.+)$/))) vars[m[1]] = evaluate(m[2]);
    else if ((m = body.match(/^(CSET|FSET|LSET|SCREEN|TITLE|RECT|FRAME|LINE|CIRCLE|TRIANGLE|GPRINT) (.+)$/))) {
      const type = m[1], values = split(m[2], ',').map(evaluate);
      if (type === 'CSET') colors.set(values[0], `rgb(${values.slice(1, 4).join(',')})`);
      if (type === 'FSET') font = values[1];
      if (type === 'LSET') lineWidth = values[0];
      commands.push({ line, type, values, font, lineWidth });
    } else if (['BEGINFRAME', 'ENDFRAME', 'CLS'].includes(body)) commands.push({ line, type: body, values: [] });
    else throw Error(`Unsupported source statement at ${line}: ${body}`);
  }
  function call(label) {
    jump(label); calls = [-1]; loops = []; finished = false;
    let count = 0;
    while (!finished) {
      if (++count > 400000) throw Error('Source routine did not finish: ' + label);
      const statement = statements[position++];
      if (!statement) throw Error('Source routine ran beyond listing');
      trace.push(statement.number); execute(statement.body, statement.number);
    }
  }
  return { vars, arrays, commands, colors, call, trace };
}

function initialize(lobes = 0) {
  const rt = runtime({ PI: 3.14159265359, C0: 299.792458,
    MA: 0, 'MN$': 'LTC-25000 (REFERENCE ONLY)', ER: profile.er,
    H: profile.dielectricThicknessUm / 1000, MT: profile.copperThicknessUm / 1000,
    PP: profile.probePitchUm / 1000, PW: .1, PL: .1, MF: .002,
    FA: profile.bandGHz[0], FB: profile.bandGHz[1],
    F0: profile.ringFundamentalGHz ?? 5, N: lobes, AM: lobes ? .1 : 0 });
  rt.call(1200);
  rt.vars.GP = Math.max(.05 * rt.vars.W, rt.vars.MF);
  rt.call(1300); rt.call(1600); rt.call(1800);
  return rt;
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function svgOf(rt) {
  const shapes = [];
  for (const { type, values: v, font, lineWidth } of rt.commands) {
    const color = escape(rt.colors.get(v[type === 'CIRCLE' ? 3 : type === 'TRIANGLE' ? 6 : v.length - 1]) || '#fff');
    if (type === 'RECT' || type === 'FRAME') shapes.push(`<rect x="${Math.min(v[0], v[2])}" y="${Math.min(v[1], v[3])}" width="${Math.abs(v[2] - v[0])}" height="${Math.abs(v[3] - v[1])}" fill="${type === 'RECT' ? color : 'none'}" stroke="${color}" stroke-width="${lineWidth}"/>`);
    else if (type === 'LINE') shapes.push(`<line x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}" stroke="${color}" stroke-width="${lineWidth}"/>`);
    else if (type === 'CIRCLE') shapes.push(`<circle cx="${v[0]}" cy="${v[1]}" r="${v[2]}" stroke="${color}" fill="${v[4] ? color : 'none'}" stroke-width="${lineWidth}"/>`);
    else if (type === 'TRIANGLE') shapes.push(`<polygon points="${v[0]},${v[1]} ${v[2]},${v[3]} ${v[4]},${v[5]}" fill="${v[7] ? color : 'none'}" stroke="${color}" stroke-width="${lineWidth}"/>`);
    else if (type === 'GPRINT') shapes.push(`<text x="${v[1]}" y="${v[2]}" fill="${color}" font-family="Courier New,monospace" font-size="${font}">${escape(v[0])}</text>`);
  }
  const title = `LTC-25000 illustrative profile / ${profile.bandGHz[0]}-${profile.bandGHz[1]} GHz / Cu ${profile.copperThicknessUm} um / MPI GSG ${profile.probePitchUm} um`;
  const outsideGuard = profile.copperThicknessUm > profile.dielectricThicknessUm * .1 + 1e-12;
  const actualStack = `Actual stack: Cu ${profile.copperThicknessUm} um / LTC-25000 ${profile.dielectricThicknessUm} um / EME-G730 ${profile.substrate?.thicknessUm ?? '?'} um / ${profile.bandGHz[0]}-${profile.bandGHz[1]} GHz`;
  const annotationRows = [
    ['HOST PREVIEW | legacy source artwork; numerical labels are hypothetical reference only', 30, 18, '#c5d2df'],
    [actualStack, 58, 18, '#c5d2df'],
    ['Legacy GROUNDED model; actual stack has NO backplane', 89, 24, '#ff8d8d'],
    [outsideGuard ? `Requested Cu ${profile.copperThicknessUm} um also exceeds interactive MT/H <= 0.1 guard; native labels below are NOT physical-stack predictions.`
      : 'Source-derived render, not a mobile app screenshot; native labels below are NOT physical-stack predictions.', 119, 16, '#ffb78a'],
  ];
  const annotations = annotationRows.map(([text,y,size,color], i) => `<text x="52.5" y="${y}" fill="${color}" font-family="Courier New,monospace" font-size="${size}" font-weight="${i === 2 ? 'bold' : 'normal'}">${escape(text)}</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="800" viewBox="0 0 1500 800"><title>${escape(title)}</title><desc>Actual resonator2.bas drawing statements rendered on the host. Source-derived preview, not an app screenshot. Legacy grounded model is inapplicable to actual ungrounded PI/EME-G730 stack. All numerical labels are hypothetical backplane-reference results only. Geometry view uses source scaling and one-pixel minimum trace width.</desc>${shapes.join('\n')}${annotations}</svg>\n`;
}

const common = initialize();
const numericNames = ['ER','H','MT','FA','FB','F0','PP','PW','PL','W','EE','ZM','R','RO','RI','LL','CP','MC','OD','NF','NZ','NM','WN','SN','ZN','EN','ZP','EP','X0','X1','X2','X3','X4','X5','BX','BY','GP','NC','VF','PF'];
const extract = rt => Object.fromEntries(numericNames.map(name => [name, rt.vars[name]]));
const contacts = rt => [-1,1].map((sign, i) => ({
  port: i + 1, side: i ? 'EAST' : 'WEST',
  contacts: [-1,0,1].map(tip => ({
    label: tip ? 'G' : 'S', xUm: sign * (rt.vars.X4 + rt.vars.X5) / 2 * 1000,
    yUm: tip * rt.vars.PP * 1000,
  })),
}));
const manifest = {
  kind: 'source-derived host render; not an actual Hand BASIC screenshot',
  source: 'resonator2.bas', sourceSha256: hash(source),
  profileFile: 'handbasic-preview-profile.json', profileSha256: hash(readFileSync(profilePath)), profile,
  modelApplicability: false,
  modelApplicabilityReason: 'The actual stack has no continuous backside ground: only top-side GSG grounds above 6 um LTC-25000 on 700 um EME-G730. Source homogeneous microstrip and grounded-CPW formulas require a continuous backplane and do not model this ungrounded multilayer stack.',
  numericResultsApplyToRequestedStack: false,
  numericalStatus: 'Archived hypothetical homogeneous-polyimide-over-continuous-ground reference calculations only; no physical-stack impedance, width, resonance or response prediction is established.',
  requiredModel: 'Ungrounded multilayer CPW or full-wave model with connected continuous top-side ground rails, actual polymer/mold thicknesses, exact resin grades and broadband complex permittivities. Isolated GSG landing pads do not by themselves define continuous CPW return conductors.',
  viewport: { width: 1500, height: 800, method: 'PEEK viewport values fixed at the source maximum landscape size' },
  numericRoutines: [1200,1300,1600,1800], sourceVariableUnits: 'Lengths are mm internally; frequency is GHz; impedance ohms.',
  circular: extract(common), contactCoordinatesUm: contacts(common),
  flags: Object.values(common.arrays['WS$'] ?? {}), previews: [],
  limitations: [
    'Actual stack has NO continuous backplane. Legacy numerical labels including 50-ohm width and mode positions are hypothetical grounded-reference values, not design predictions for the requested physical stack.',
    'The mobile Hand BASIC app is not executed. A limited interpreter executes the actual source numeric and drawing statements with host double precision.',
    'GPRINT fonts and baseline are approximated using Courier New SVG text; native mobile font metrics may differ.',
    'Source assumes homogeneous isotropic dielectric between metal and continuous backside ground, with air above; it does not solve a multilayer thin-film stack.',
    'The ring solver predicts geometry and unloaded mode positions, not S21, loss, Q, coupling or bandwidth.',
    'GCPW model uses zero metal thickness and reports source geometry/model flags.',
    'Ring fundamental of ' + (profile.ringFundamentalGHz ?? 5) + ' GHz is an illustrative design choice; the band does not denote continuous ring transmission.',
    'Lobed view uses six cosine lobes at 10 percent depth, preserving source equations; it is not the paper\'s circular-arc geometry.',
  ],
};
if (profile.copperThicknessUm > profile.dielectricThicknessUm * .1 + 1e-12) {
  manifest.interactiveInputConstraint = {
    violated: true, maxCopperThicknessUm: profile.dielectricThicknessUm * .1,
    requestedCopperThicknessUm: profile.copperThicknessUm,
    explanation: 'Source interactive input lines650-660 require MT/H<=0.1. This requested profile is evaluated directly by unchanged numeric routines, outside the interactive input guard; copper is not clipped.',
  };
  manifest.limitations.push(manifest.interactiveInputConstraint.explanation);
} else manifest.interactiveInputConstraint = { violated: false, maxCopperThicknessUm: profile.dielectricThicknessUm * .1 };

for (const [name, entry, lobes] of [
  ['resonator2-dimensions',2600,0], ['resonator2-circle',3100,0],
  ['resonator2-gsg-launch',3800,0], ['resonator2-modes',4300,0],
  ['resonator2-checks',4700,0], ['resonator2-six-lobes',3100,6],
]) {
  const rt = initialize(lobes); rt.call(entry);
  writeFileSync(path.join(output, name + '.svg'), svgOf(rt));
  execFileSync('magick', ['-background', '#0a1423', path.join(output, name + '.svg'), path.join(output, name + '.png')]);
  writeFileSync(path.join(output, name + '-commands.json'), JSON.stringify(rt.commands, null, 2) + '\n');
  manifest.previews.push({ name, entrySubroutine: entry, lobes, depthFraction: lobes ? .1 : 0,
    commands: rt.commands.length, svg: 'handbasic-previews/' + name + '.svg',
    png: 'handbasic-previews/' + name + '.png',
    numeric: extract(rt), contactCoordinatesUm: contacts(rt),
    flags: Object.values(rt.arrays['WS$'] ?? {}),
    uniqueExecutedSourceLines: [...new Set(rt.trace)].sort((a,b) => a-b) });
  console.log(`Rendered ${name}: ${rt.commands.length} source graphics commands`);
}
writeFileSync(path.join(output, 'resonator2-preview-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Ring manifest: ${manifest.previews.length} source previews; physical-stack model: inapplicable; copper input guard: ${manifest.interactiveInputConstraint.violated ? 'exceeded' : 'within range'}.`);

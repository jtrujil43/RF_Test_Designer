// Literal source text previews; these utilities have no RF or material inputs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'handbasic-previews');
mkdirSync(output, { recursive: true });
const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const manifest = { method: 'Literal PRINT strings and first INPUT prompt extracted from the unchanged Hand BASIC source; not an app screenshot or execution test.', programs: [] };
for (const file of ['MATMUL.BAS', 'varprec.bas']) {
  const source = readFileSync(path.join(root, file), 'ascii');
  const commands = [];
  for (const line of source.trim().split(/\r?\n/)) {
    const number = parseInt(line);
    const printed = line.match(/^\d+\s+PRINT\s+"([^"]*)"\s*$/i);
    if (printed) commands.push({ line: number, type: 'PRINT', text: printed[1] });
    const input = line.match(/^\d+\s+INPUT\s+"([^"]*)"/i);
    if (input) { commands.push({ line: number, type: 'INPUT', text: input[1] + '?' }); break; }
  }
  const name = path.parse(file).name.toLowerCase();
  const height = Math.max(220, commands.length * 21 + 95);
  const shapes = [
    '<rect width="800" height="' + height + '" fill="#f8fafc"/>',
    '<rect width="800" height="42" fill="#153047"/>',
    '<text x="24" y="28" fill="white" font-family="Arial,sans-serif" font-size="17">' + escape(file) + ' / SOURCE TEXT PREVIEW</text>',
    ...commands.map((c, i) => '<text x="24" y="' + (69 + i * 21) + '" fill="#172c40" font-family="Courier New,monospace" font-size="18">' + escape(c.text) + '</text>'),
    '<text x="24" y="' + (height - 16) + '" fill="#556879" font-family="Arial,sans-serif" font-size="13">RF frequency, insulation and probe settings do not apply.</text>',
  ];
  writeFileSync(path.join(output, name + '.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' + height + '" viewBox="0 0 800 ' + height + '">' + shapes.join('\n') + '</svg>\n');
  execFileSync('magick', ['-background', 'white', path.join(output, name + '.svg'), path.join(output, name + '.png')]);
  writeFileSync(path.join(output, name + '-commands.json'), JSON.stringify(commands, null, 2));
  manifest.programs.push({ source: file, sourceSha256: createHash('sha256').update(source.replace(/\r\n?/g, '\n'), 'utf8').digest('hex'), image: name + '.png', extractedLines: commands.map(c => c.line), limitations: 'Text extraction only; no arithmetic or menu actions executed.' });
  console.log('Rendered ' + file + ' text preview');
}
writeFileSync(path.join(output, 'utility-preview-manifest.json'), JSON.stringify(manifest, null, 2));

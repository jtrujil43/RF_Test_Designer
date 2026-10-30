// Embed the shared renderer in each standalone BASIC listing.
// Run after changing bitmap-runtime.inc, before build.ps1.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = readFileSync(path.join(root, 'bitmap-runtime.inc'), 'ascii').trim();
if (!/^30000 /m.test(runtime)) throw Error('Runtime must start at BASIC line 30000.');
for (const name of ['rdlloss', 'rdxtalk', 'rfleak', 'stubtest', 'trlset', 'viamatch', 'zcoupon', 'resonator2']) {
  const filename = path.join(root, name + '.bas');
  const lines = readFileSync(filename, 'ascii').split(/\r?\n/)
    .filter(line => line.trim() && Number(line.match(/^\d+/)?.[0]) < 30000);
  writeFileSync(filename, lines.join('\r\n') + '\r\n' + runtime.replace(/\r?\n/g, '\r\n') + '\r\n', 'ascii');
  console.log(`Embedded multicolor renderer in ${name}.bas`);
}

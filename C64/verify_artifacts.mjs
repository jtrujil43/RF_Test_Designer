// Verify PRG line links/memory limits and byte-for-byte disk contents.
// Usage: node verify_artifacts.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const originals = readdirSync(path.dirname(root)).filter(name => /\.bas$/i.test(name));
const disk = readFileSync(path.join(root, 'RFTEST.d64'));
function sectorOffset(track, sector) {
  if (track < 1 || track > 35) throw new Error(`Invalid track ${track}`);
  let sectors = 0;
  for (let t = 1; t < track; t++) sectors += t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17;
  return (sectors + sector) * 256;
}
const entries = new Map();
let track = 18, sector = 1;
while (track) {
  const offset = sectorOffset(track, sector);
  for (let entry = 0; entry < 8; entry++) {
    const at = offset + entry * 32;
    if (disk[at + 2] !== 0x82) continue;
    const name = [...disk.subarray(at + 5, at + 21)]
      .filter(byte => byte !== 0xa0).map(byte => String.fromCharCode(byte)).join('').toLowerCase();
    entries.set(name, [disk[at + 3], disk[at + 4]]);
  }
  track = disk[offset]; sector = disk[offset + 1];
}
for (const name of originals) {
  const source = readFileSync(path.join(root, name), 'ascii');
  const program = readFileSync(path.join(root, path.parse(name).name + '.prg'));
  const expectedLines = source.trim().split(/\r?\n/).filter(line => line.trim())
    .map(line => Number(line.match(/^\d+/)[0]));
  if (program.readUInt16LE(0) !== 0x0801) throw new Error(`${name}: wrong load address`);
  let at = 2, line = 0;
  while (program.readUInt16LE(at)) {
    const next = program.readUInt16LE(at);
    const number = program.readUInt16LE(at + 2);
    if (number !== expectedLines[line++]) throw new Error(`${name}: wrong line ${number}`);
    const end = program.indexOf(0, at + 4);
    if (end < 0 || next !== 0x0801 + end - 1) throw new Error(`${name}: invalid line link`);
    at = end + 1;
  }
  if (line !== expectedLines.length || at + 2 !== program.length) throw new Error(`${name}: truncated PRG`);
  if (program.length > 30000) throw new Error(`${name}: insufficient BASIC memory reserve`);
  const entry = entries.get(path.parse(name).name.toLowerCase());
  if (!entry) throw new Error(`${name}: missing disk entry`);
  [track, sector] = entry;
  const data = [];
  const visited = new Set();
  while (track) {
    const offset = sectorOffset(track, sector);
    if (visited.has(offset)) throw new Error(`${name}: cyclic disk file`);
    visited.add(offset);
    const nextTrack = disk[offset], nextSector = disk[offset + 1];
    data.push(disk.subarray(offset + 2, nextTrack ? offset + 256 : offset + 1 + nextSector));
    track = nextTrack; sector = nextSector;
  }
  if (!Buffer.concat(data).equals(program)) throw new Error(`${name}: disk content differs from PRG`);
  console.log(`PASS ${name}: ${line} BASIC lines, ${program.length} bytes, identical disk copy`);
}
if (entries.size !== originals.length) throw new Error('Unexpected disk directory entries');
console.log(`PASS all ${originals.length} source/PRG/disk sets`);

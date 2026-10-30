// Decode the VIC-II's actual multicolor bitmap RAM to a PNG for visual QA.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const palette = [0x000000, 0xffffff, 0x883932, 0x67b6bd,
  0x8b3f96, 0x55a049, 0x40318d, 0xbfce72,
  0x8b5429, 0x574200, 0xb86962, 0x505050,
  0x787878, 0x94e089, 0x7869c4, 0x9f9f9f];
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
export async function captureBitmap(client, output) {
  const bitmap = await client.dump(0xe000, 0xff3f, 'bitmap.bin');
  const screen = await client.dump(0xcc00, 0xcfe7, 'colors.bin');
  const colors = await client.dump(0xd800, 0xdbe7, 'color-ram.bin', 'cpu');
  const background = (await client.memory(0xd021))[0] & 15;
  const counts = [0, 0, 0, 0];
  const width = 640, height = 400;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 160; x++) {
      const cell = (y >> 3) * 40 + (x >> 2);
      const offset = (y >> 3) * 320 + (x >> 2) * 8 + (y & 7);
      const index = (bitmap[offset] >> ((3 - (x & 3)) * 2)) & 3;
      counts[index]++;
      const number = [background, screen[cell] >> 4, screen[cell] & 15, colors[cell] & 15][index];
      const rgb = palette[number];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) {
        const at = (y * 2 + dy) * (width * 3 + 1) + 1 + (x * 4 + dx) * 3;
        pixels[at] = rgb >> 16; pixels[at + 1] = (rgb >> 8) & 255; pixels[at + 2] = rgb & 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  writeFileSync(output, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  return { counts, bitmap, screen, colors, background };
}

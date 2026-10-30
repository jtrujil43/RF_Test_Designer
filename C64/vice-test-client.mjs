// Isolated VICE console/monitor helpers used by bitmap regression tests.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ViceTestClient {
  static async start(directory, port = 6530) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', () => reject(Error(`Test port ${port} is occupied.`)));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    const client = new ViceTestClient();
    client.temporary = mkdtempSync(path.join(tmpdir(), 'c64-bitmap-'));
    client.process = spawn(path.join(directory, 'x64sc.exe'), [
      '-console', '-warp', '+sound', '-remotemonitor',
      '-remotemonitoraddress', `ip4://127.0.0.1:${port}`,
      '-logfile', path.join(client.temporary, 'vice.log'),
    ], { windowsHide: true, stdio: 'ignore', cwd: directory });
    try {
      await delay(1500);
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          client.socket = await new Promise((resolve, reject) => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => resolve(socket));
            socket.once('error', reject);
          });
          break;
        } catch { await delay(100); }
      }
      if (!client.socket) throw Error('VICE monitor did not start.');
      client.socket.on('data', data => client.received(data));
      client.socket.on('error', error => client.reject?.(error));
      await delay(100);
      await client.resume(300);
      await client.waitText(/ready\./i);
      return client;
    } catch (error) { await client.close(); throw error; }
  }
  incoming = '';
  received(data) {
    this.incoming += data.toString();
    clearTimeout(this.settle);
    if (this.resolve && /\(C:\$[0-9a-f]+\)\s*$/i.test(this.incoming)) {
      this.settle = setTimeout(() => this.resolve?.(this.incoming), 60);
    }
  }
  async command(value) {
    if (this.resolve) throw Error('Concurrent monitor commands.');
    this.incoming = '';
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.reject(Error(`Monitor timeout: ${value}`)), 10000);
      const finish = callback => result => {
        clearTimeout(timeout); this.resolve = undefined; this.reject = undefined;
        callback(result);
      };
      this.resolve = finish(resolve); this.reject = finish(reject);
      this.socket.write(value + '\n');
    });
  }
  async resume(ms = 200) { this.socket.write('x\n'); await delay(ms); }
  async keys(value, ms = 200) {
    const escaped = [...value].map(char => {
      const code = char.charCodeAt(0);
      return code < 32 || code > 126 ? '\\x' + code.toString(16).padStart(2, '0') : char;
    }).join('');
    await this.command('keybuf ' + escaped); await this.resume(ms);
  }
  async screen() {
    const raw = await this.command('screen');
    return raw.split('\n').filter(line => /^\*C:/i.test(line))
      .map(line => line.slice(8).trimEnd()).join('\n').trimEnd();
  }
  async memory(start, end = start) {
    const raw = await this.command(`m ${start.toString(16)} ${end.toString(16)}`);
    const result = [];
    for (const line of raw.split('\n')) {
      const match = line.match(/>C:([0-9a-f]+)\s+((?:[0-9a-f]{2}\s+)+)/i);
      if (!match) continue;
      const address = parseInt(match[1], 16);
      const bytes = match[2].trim().split(/\s+/).map(byte => parseInt(byte, 16));
      bytes.forEach((byte, i) => {
        if (address + i >= start && address + i <= end) result[address + i - start] = byte;
      });
    }
    if (result.length !== end - start + 1 || result.some(value => value === undefined)) {
      throw Error('Cannot parse memory: ' + raw);
    }
    return Buffer.from(result);
  }
  async mode() {
    const vic = await this.memory(0xd011, 0xd018);
    const bank = (await this.memory(0xdd00))[0] & 3;
    return { bitmap: !!(vic[0] & 32), multicolor: !!(vic[5] & 16),
      extended: !!(vic[0] & 64), pointer: vic[7] & 254, bank };
  }
  async basicLine() { return (await this.memory(0x39, 0x3a)).readUInt16LE(); }
  async waitBasicLine(number, maximumMs = 120000) {
    const until = Date.now() + maximumMs;
    do {
      if (await this.basicLine() === number) return;
      if (!(await this.mode()).bitmap) this.assertText(await this.screen());
      await this.resume(250);
    } while (Date.now() < until);
    throw Error(`Expected BASIC line ${number}, stopped at ${await this.basicLine()}`);
  }
  assertText(text) {
    if (/\?(syntax|overflow|division by zero|illegal quantity|out of memory|next without|return without|bad subscript|type mismatch|undefined)/i.test(text)) {
      throw Error('BASIC error:\n' + text);
    }
  }
  async waitText(pattern, maximumMs = 120000) {
    const until = Date.now() + maximumMs;
    let text;
    do {
      text = await this.screen(); this.assertText(text);
      if (pattern.test(text)) return text;
      await this.resume(300);
    } while (Date.now() < until);
    throw Error(`Timeout waiting for ${pattern}:\n${text}\nline ${await this.basicLine()}`);
  }
  async boot(program) {
    this.socket.write('reset 0\n'); await delay(500);
    await this.waitText(/ready\./i);
    const loaded = await this.command(`loadbasic "${program.replaceAll('\\', '/')}" 0`);
    if (/error|cannot/i.test(loaded)) throw Error(loaded);
    await this.keys('run\r');
  }
  async dump(start, end, name, bank = 'ram') {
    const filename = path.join(this.temporary, name);
    await this.command('bank ' + bank);
    await this.command(`bsave "${filename.replaceAll('\\', '/')}" 0 ${start.toString(16)} ${end.toString(16)}`);
    await this.command('bank cpu');
    return readFileSync(filename);
  }
  async close() {
    clearTimeout(this.settle);
    if (this.socket && !this.socket.destroyed) {
      this.socket.write('quit\n'); await delay(200); this.socket.destroy();
    }
    this.process?.kill();
  }
}

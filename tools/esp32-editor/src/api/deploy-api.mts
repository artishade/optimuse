import {spawn} from 'node:child_process';
import {readFile, stat, writeFile, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {packLayout, crc32} from '../layout/package-layout.mts';
import {isRecord, errorMessage} from '../layout/project-model.mts';
import type {LayoutDocument} from '../layout/project-model.mts';

const dist = new URL('../../../../apps/esp32/dist/', import.meta.url);

interface FlashState {
  running: boolean;
  output: string;
  error: string | null;
}

export interface LayoutSlot {
  address: string;
  generation: number;
}

interface DeviceCapabilities {
  protocol: number;
  board: string;
  maxPackageBytes: number;
  revision: unknown;
}

let flash: FlashState = {running: false, output: '', error: null};
let flashPort = '';

/** Runs a process and returns combined stdout/stderr, throwing on non-zero exit. */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true});
    let output = '';
    child.stdout.on('data', (b: Buffer) => {
      output = (output + b).slice(-8000);
      if (flash.running) flash.output = output;
    });
    child.stderr.on('data', (b: Buffer) => {
      output = (output + b).slice(-8000);
      if (flash.running) flash.output = output;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || '命令失败 ' + code));
    });
  });
}

/** Validates a device HTTP origin and returns the request URL. */
function deviceUrl(base: string, requestPath: string): URL {
  const url = new URL(base);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error('填写设备 HTTP 地址，例如 http://192.168.1.50');
  }
  const p = url.hostname.split('.').map(Number);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const lan =
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31));
  if (!local && !lan) throw new Error('设备地址需为本机或局域网 IPv4 地址');
  return new URL(requestPath, url);
}

/** Picks the inactive valid OUI2 slot for the next USB layout write. */
export function nextLayoutSlot(slots: Buffer): LayoutSlot {
  if (slots.length !== 65536) throw new Error('布局分区读取不完整');
  let active = -1;
  let generation = 0;
  for (let i = 0; i < 2; i++) {
    const slot = slots.subarray(i * 32768, (i + 1) * 32768);
    const length = slot.readUInt32LE(4);
    const gen = slot.readUInt32LE(32764);
    const valid =
      slot.subarray(0, 4).toString() === 'OUI2' &&
      length >= 6 &&
      length <= 28656 &&
      slot.readUInt32LE(12) === 1 &&
      crc32(slot.subarray(16, 16 + length)) === slot.readUInt32LE(8);
    if (valid && (active < 0 || gen > generation)) {
      active = i;
      generation = gen;
    }
  }
  if (generation === 0xffffffff) throw new Error('设备布局版本号已达上限');
  return {address: active === 0 ? '0x3e8000' : '0x3e0000', generation: generation + 1};
}

/** Calls a device HTTP JSON endpoint. */
async function device(base: string, requestPath: string, options: RequestInit = {}): Promise<DeviceCapabilities> {
  const res = await fetch(deviceUrl(base, requestPath), {...options, redirect: 'error', signal: AbortSignal.timeout(15000)});
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? '当前固件不支持布局部署，请先烧录基础运行时'
        : `设备 HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return JSON.parse(body) as DeviceCapabilities;
}

/** JSON response helper for deploy HTTP routes. */
function reply(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
}

/** Reads a JSON request body with a hard size cap. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 128 * 1024) throw new Error('请求超过 128 KiB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Serves packaging, Wi-Fi deploy, USB layout and firmware flash HTTP routes. */
export async function deployRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/deploy/')) return false;
  try {
    if (req.method === 'GET' && url.pathname === '/api/deploy/flash') {
      reply(res, 200, flash);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/deploy/ports') {
      const output = await run('python', [
        '-c',
        'import json,serial.tools.list_ports; print(json.dumps([{"port":p.device,"name":p.description} for p in serial.tools.list_ports.comports()]))',
      ]);
      reply(res, 200, {ports: JSON.parse(output) as unknown});
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/deploy/device') {
      const address = url.searchParams.get('address');
      if (!address) throw new Error('填写设备 HTTP 地址，例如 http://192.168.1.50');
      reply(res, 200, await device(address, '/ui/capabilities'));
      return true;
    }
    if (req.method !== 'POST') {
      reply(res, 405, {error: 'POST required'});
      return true;
    }
    const input = await readJson(req);
    if (!isRecord(input)) throw new Error('请求必须是对象');
    if (url.pathname === '/api/deploy/package') {
      const data = packLayout(input.document);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="optimuse-ui.oui"',
        'Cache-Control': 'no-store',
      });
      res.end(data);
      return true;
    }
    if (url.pathname === '/api/deploy/layout') {
      if (typeof input.address !== 'string') throw new Error('填写设备 HTTP 地址，例如 http://192.168.1.50');
      const data = packLayout(input.document);
      const caps = await device(input.address, '/ui/capabilities');
      if (caps.protocol !== 1 || caps.board !== 'ESP32-2432S028' || caps.maxPackageBytes < data.length) {
        throw new Error('设备运行时或布局包规格不匹配');
      }
      const result = await device(input.address, '/ui/package', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Optimuse-Studio': '1',
          Authorization: 'Bearer ' + (typeof input.token === 'string' ? input.token : ''),
        },
        body: data as unknown as BodyInit,
      });
      reply(res, 200, {...result, bytes: data.length, previousRevision: caps.revision});
      return true;
    }
    if (['/api/deploy/flash', '/api/deploy/usb-layout'].includes(url.pathname)) {
      if (flash.running) throw new Error('正在烧录，请等待完成');
      const output = await run('python', [
        '-c',
        'import json,serial.tools.list_ports; print(json.dumps([p.device for p in serial.tools.list_ports.comports()]))',
      ]);
      const ports = JSON.parse(output) as unknown;
      if (!Array.isArray(ports) || typeof input.port !== 'string' || !ports.includes(input.port)) {
        throw new Error('串口已断开，请刷新串口列表');
      }
      if (flash.running) throw new Error('另一项串口任务已开始，请等待完成');
      if (url.pathname.endsWith('usb-layout')) {
        const packet = packLayout(input.document);
        const image = Buffer.alloc(32768, 255);
        image.set(packet);
        const prefix = path.join(tmpdir(), 'optimuse-ui-' + randomUUID());
        const tableFile = prefix + '.table';
        const packageFile = prefix + '.bin';
        const slotsFile = prefix + '.slots';
        const port = input.port;
        flash = {running: true, output: '正在检查设备分区并下发 USB 布局（无需编译）', error: null};
        void (async () => {
          try {
            const common = ['--chip', 'esp32', '--port', port, '--baud', '460800', '--skip-update-check', '--non-interactive'];
            await run('espflash', ['read-flash', ...common, '0x8000', '0xc00', tableFile]);
            const table = await readFile(tableFile);
            let compatible = false;
            for (let i = 0; i + 32 <= table.length; i += 32) {
              if (
                table.readUInt16LE(i) === 0x50aa &&
                table.subarray(i + 12, i + 28).toString().replace(/\0/g, '') === 'ui_layout' &&
                table.readUInt32LE(i + 4) === 0x3e0000 &&
                table.readUInt32LE(i + 8) === 65536
              ) {
                compatible = true;
              }
            }
            if (!compatible) throw new Error('设备未安装支持布局分区的基础运行时，请先烧录基础固件');
            await run('espflash', ['read-flash', ...common, '0x3e0000', '0x10000', slotsFile]);
            const {address, generation} = nextLayoutSlot(await readFile(slotsFile));
            image.writeUInt32LE(generation, 32764);
            await writeFile(packageFile, image);
            await run('espflash', ['write-bin', ...common, address, packageFile]);
            flash.output = `USB 布局下发完成 · ${packet.length} 字节布局 · 设备已重启；未编译、未改动程序和 Wi-Fi 分区`;
          } catch (error) {
            flash.error = errorMessage(error);
          } finally {
            await Promise.all([
              unlink(tableFile).then(() => undefined, () => undefined),
              unlink(packageFile).then(() => undefined, () => undefined),
              unlink(slotsFile).then(() => undefined, () => undefined),
            ]);
            flash.running = false;
          }
        })();
        reply(res, 202, flash);
        return true;
      }
      const files: Array<[string, string]> = [
        ['0x1000', 'bootloader.bin'],
        ['0x8000', 'partition-table.bin'],
        ['0x10000', 'optimuse-esp32.bin'],
      ];
      for (const [, file] of files) await stat(new URL(file, dist));
      // Validate the new data partition exists before allowing runtime deployment.
      if (!(await readFile(new URL('partition-table.bin', dist))).includes(Buffer.from('ui_layout'))) {
        throw new Error('基础运行时产物尚未更新，请由开发者构建一次后再烧录');
      }
      if (flash.running) throw new Error('另一项串口任务已开始，请等待完成');
      flashPort = input.port;
      flash = {running: true, output: '正在烧录现成基础固件（不启动编译）', error: null};
      void (async () => {
        try {
          for (const [address, file] of files) {
            await run('espflash', [
              'write-bin',
              '--chip',
              'esp32',
              '--port',
              flashPort,
              '--baud',
              '460800',
              '--skip-update-check',
              '--non-interactive',
              address,
              fileURLToPath(new URL(file, dist)),
            ]);
          }
          flash.output = '基础运行时烧录完成；连接设备 Wi-Fi 后可直接部署布局';
        } catch (error) {
          flash.error = errorMessage(error);
        } finally {
          flash.running = false;
        }
      })();
      reply(res, 202, flash);
      return true;
    }
    reply(res, 404, {error: 'Unknown deployment action'});
  } catch (error) {
    reply(res, 400, {error: errorMessage(error)});
  }
  return true;
}

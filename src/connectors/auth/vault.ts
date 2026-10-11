/**
 * Credential vault.
 * Primary: OS keychain via optional `keytar`.
 * Fallback: AES-256-GCM encrypted JSON file, key kept in a 0600 file.
 * Secrets are never written to plaintext and never sent to the model.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Credential } from '../types.js';

export interface Vault {
  get(connectorId: string): Promise<Credential | null>;
  set(connectorId: string, cred: Credential): Promise<void>;
  delete(connectorId: string): Promise<void>;
  backend: 'keychain' | 'encrypted-file';
}

const SERVICE = 'optimuse';

export class EncryptedFileVault implements Vault {
  readonly backend = 'encrypted-file' as const;
  private keyPath: string;
  private dataPath: string;

  constructor(dir: string) {
    this.keyPath = path.join(dir, 'vault.key');
    this.dataPath = path.join(dir, 'vault.enc');
  }

  private async key(): Promise<Buffer> {
    try {
      return Buffer.from(await fs.readFile(this.keyPath, 'utf8'), 'base64');
    } catch {
      const k = randomBytes(32);
      await fs.mkdir(path.dirname(this.keyPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(this.keyPath, k.toString('base64'), { mode: 0o600 });
      return k;
    }
  }

  private async readAll(): Promise<Record<string, Credential>> {
    let raw: Buffer;
    try {
      raw = await fs.readFile(this.dataPath);
    } catch {
      return {};
    }
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', await this.key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as Record<string, Credential>;
  }

  private async writeAll(data: Record<string, Credential>): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true, mode: 0o700 });
    const tmp = this.dataPath + '.tmp';
    await fs.writeFile(tmp, Buffer.concat([iv, tag, body]), { mode: 0o600 });
    await fs.rename(tmp, this.dataPath);
  }

  async get(id: string): Promise<Credential | null> {
    return (await this.readAll())[id] ?? null;
  }
  async set(id: string, cred: Credential): Promise<void> {
    const all = await this.readAll();
    all[id] = cred;
    await this.writeAll(all);
  }
  async delete(id: string): Promise<void> {
    const all = await this.readAll();
    delete all[id];
    await this.writeAll(all);
  }
}

/** Try the OS keychain; fall back to the encrypted file if unavailable. */
export async function openVault(dir = path.join(os.homedir(), '.optimuse')): Promise<Vault> {
  try {
    const keytar = await import('keytar');
    await keytar.getPassword(SERVICE, '__probe__');
    return {
      backend: 'keychain',
      async get(id) {
        const raw = await keytar.getPassword(SERVICE, id);
        return raw ? (JSON.parse(raw) as Credential) : null;
      },
      async set(id, cred) {
        await keytar.setPassword(SERVICE, id, JSON.stringify(cred));
      },
      async delete(id) {
        await keytar.deletePassword(SERVICE, id);
      },
    };
  } catch {
    return new EncryptedFileVault(dir);
  }
}

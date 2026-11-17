import { constants } from 'node:fs';
import { mkdir, lstat, open, realpath, unlink } from 'node:fs/promises';
import { resolve, parse, join } from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/app-error.js';

export interface PrivateStorage {
  save(key: string, content: Buffer): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number }>;
  delete(key: string): Promise<void>;
}

export function validStorageKey(key: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key);
}

export class LocalPrivateStorage implements PrivateStorage {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
    if (this.directory === parse(this.directory).root || this.directory === process.cwd()) {
      throw new AppError(500, 'Unsafe upload storage configuration');
    }
  }

  private async path(key: string): Promise<string> {
    if (!validStorageKey(key)) throw new AppError(500, 'Invalid stored file reference');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.directory);
    const actual = await realpath(this.directory);
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!stats.isDirectory() || stats.isSymbolicLink() || normalize(actual) !== normalize(this.directory)) {
      throw new AppError(500, 'Unsafe upload storage configuration');
    }
    // Keys are UUIDs, never filenames or caller-supplied relative paths.
    return join(this.directory, key);
  }

  async save(key: string, content: Buffer): Promise<void> {
    const handle = await open(await this.path(key), 'wx', 0o600);
    try { await handle.writeFile(content); } finally { await handle.close(); }
  }

  async open(key: string) {
    try {
      const filePath = await this.path(key);
      const stats = await lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new AppError(500, 'Stored file is unavailable');
      const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size !== stats.size || opened.ino !== stats.ino) {
          throw new AppError(500, 'Stored file is unavailable');
        }
        return { stream: handle.createReadStream({ autoClose: true }), size: opened.size };
      } catch (error) { await handle.close(); throw error; }
    } catch {
      throw new AppError(500, 'Stored file is unavailable');
    }
  }

  async delete(key: string): Promise<void> {
    try { await unlink(await this.path(key)); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

export const storage: PrivateStorage = new LocalPrivateStorage(env.UPLOAD_DIR);

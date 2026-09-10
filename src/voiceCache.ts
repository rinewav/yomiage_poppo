import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT, CACHE_LOCK_RETRIES, CACHE_LOCK_RETRY_MS, CACHE_LOCK_STALE_MS } from './constants';
import { VoiceCacheEntry } from './types';

export const CACHE_FILE = process.env.CACHE_FILE || path.join(PROJECT_ROOT, 'voice_cache.json');
const LOCK_DIR = CACHE_FILE + '.lock';
const TMP_FILE = `${CACHE_FILE}.${process.pid}.tmp`;

// メモリキャッシュ: mtime/size が変わっていなければディスクを読み直さない
let memCache: Record<string, VoiceCacheEntry> | null = null;
let memMtimeMs = -1;
let memSize = -1;

// 同一プロセス内の updateVoiceCache 呼び出しを直列化する（ロックディレクトリの奪い合い防止）
let mutexTail: Promise<void> = Promise.resolve();

function parseCache(data: string): Record<string, VoiceCacheEntry> {
  const cache = JSON.parse(data);
  if (Array.isArray(cache)) return {};
  return cache || {};
}

async function acquireLockAsync(): Promise<void> {
  for (let i = 0; i < CACHE_LOCK_RETRIES; i++) {
    try {
      await fs.promises.mkdir(LOCK_DIR);
      return;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EEXIST') {
        try {
          const stat = await fs.promises.stat(LOCK_DIR);
          if (Date.now() - stat.mtimeMs > CACHE_LOCK_STALE_MS) {
            try { await fs.promises.rmdir(LOCK_DIR); } catch (_) { /* race — retry */ }
            continue;
          }
        } catch (_) { /* lock dir removed between stat と rmdir の間 — retry */ }
        await new Promise((resolve) => setTimeout(resolve, CACHE_LOCK_RETRY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not acquire cache lock after ${CACHE_LOCK_RETRIES} retries`);
}

async function releaseLockAsync(): Promise<void> {
  try { await fs.promises.rmdir(LOCK_DIR); } catch (_) { /* already released */ }
}

function writeAtomicSync(data: Record<string, VoiceCacheEntry>): void {
  fs.writeFileSync(TMP_FILE, JSON.stringify(data), 'utf8');
  fs.renameSync(TMP_FILE, CACHE_FILE);
}

export function readVoiceCache(): Record<string, VoiceCacheEntry> {
  try {
    const stat = fs.statSync(CACHE_FILE);
    if (memCache !== null && stat.mtimeMs === memMtimeMs && stat.size === memSize) {
      return memCache;
    }
    const data = fs.readFileSync(CACHE_FILE, 'utf8');
    const cache = parseCache(data);
    memCache = cache;
    memMtimeMs = stat.mtimeMs;
    memSize = stat.size;
    return cache;
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[Cache] voice_cache.json の読み込みに失敗しました。空で初期化します。`, err);
    }
    memCache = {};
    memMtimeMs = -1;
    memSize = -1;
    return {};
  }
}

export function updateVoiceCache(updater: (cache: Record<string, VoiceCacheEntry>) => void): Promise<void> {
  const run = async (): Promise<void> => {
    await acquireLockAsync();
    try {
      let cache: Record<string, VoiceCacheEntry> = {};
      let rawData = '';
      try {
        rawData = await fs.promises.readFile(CACHE_FILE, 'utf8');
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }

      if (rawData.trim() !== '') {
        try {
          cache = parseCache(rawData);
        } catch (parseErr) {
          // 破損ファイルは {} で上書きせず、ロックを保持したまま退避してから空で再開する
          const corruptPath = `${CACHE_FILE}.corrupt-${Date.now()}`;
          try {
            await fs.promises.rename(CACHE_FILE, corruptPath);
            console.error(`[Cache] voice_cache.json の解析に失敗したため ${corruptPath} に退避しました。`, parseErr);
          } catch (renameErr) {
            console.error(`[Cache] 破損ファイルの退避に失敗しました。`, renameErr);
          }
          cache = {};
        }
      }

      updater(cache);

      const json = JSON.stringify(cache);
      await fs.promises.writeFile(TMP_FILE, json, 'utf8');
      await fs.promises.rename(TMP_FILE, CACHE_FILE);

      const stat = await fs.promises.stat(CACHE_FILE);
      memCache = cache;
      memMtimeMs = stat.mtimeMs;
      memSize = stat.size;
    } finally {
      await releaseLockAsync();
    }
  };

  const task = mutexTail.then(run);
  // 後続の呼び出しが失敗を引きずらないよう、tail は常に解決させる
  mutexTail = task.catch(() => undefined);
  return task;
}

export function getCacheKey(text: string, speakerId: number, highPitch: boolean = false, ttsEngine: string = 'hybrid'): string {
  const pitchState = highPitch ? '_high' : '';
  const engineState = `_${ttsEngine}`;
  return crypto.createHash('sha256').update(`${speakerId}_${text}${pitchState}${engineState}`).digest('hex');
}

export async function initCacheFile(): Promise<void> {
  if (fs.existsSync(CACHE_FILE)) return;
  await acquireLockAsync();
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      writeAtomicSync({});
    }
  } finally {
    await releaseLockAsync();
  }
}

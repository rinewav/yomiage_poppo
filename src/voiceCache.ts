import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT, CACHE_LOCK_RETRIES, CACHE_LOCK_RETRY_MS, CACHE_LOCK_STALE_MS } from './constants';
import { VoiceCacheEntry } from './types';

export const CACHE_FILE = process.env.CACHE_FILE || path.join(PROJECT_ROOT, 'voice_cache.json');
const LOCK_DIR = CACHE_FILE + '.lock';
const TMP_FILE = CACHE_FILE + '.tmp';

function acquireLock(): void {
  for (let i = 0; i < CACHE_LOCK_RETRIES; i++) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EEXIST') {
        try {
          const stat = fs.statSync(LOCK_DIR);
          if (Date.now() - stat.mtimeMs > CACHE_LOCK_STALE_MS) {
            try { fs.rmdirSync(LOCK_DIR); } catch (_) { /* race — retry */ }
            continue;
          }
        } catch (_) { /* lock dir removed between stat and rmdir — retry */ }
        const deadline = Date.now() + CACHE_LOCK_RETRY_MS;
        while (Date.now() < deadline) { /* busy wait */ }
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not acquire cache lock after ${CACHE_LOCK_RETRIES} retries`);
}

function releaseLock(): void {
  try { fs.rmdirSync(LOCK_DIR); } catch (_) { /* already released */ }
}

function writeAtomic(data: Record<string, VoiceCacheEntry>): void {
  fs.writeFileSync(TMP_FILE, JSON.stringify(data), 'utf8');
  fs.renameSync(TMP_FILE, CACHE_FILE);
}

export function readVoiceCache(): Record<string, VoiceCacheEntry> {
  try {
    const data = fs.readFileSync(CACHE_FILE, 'utf8');
    const cache = JSON.parse(data);
    if (Array.isArray(cache)) return {};
    return cache || {};
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[Cache] voice_cache.json の読み込みに失敗しました。空で初期化します。`, err);
    }
    return {};
  }
}

export function updateVoiceCache(updater: (cache: Record<string, VoiceCacheEntry>) => void): void {
  acquireLock();
  try {
    const cache = readVoiceCache();
    updater(cache);
    writeAtomic(cache);
  } finally {
    releaseLock();
  }
}

export function getCacheKey(text: string, speakerId: number, highPitch: boolean = false, ttsEngine: string = 'hybrid'): string {
  const pitchState = highPitch ? '_high' : '';
  const engineState = `_${ttsEngine}`;
  return crypto.createHash('sha256').update(`${speakerId}_${text}${pitchState}${engineState}`).digest('hex');
}

export function initCacheFile(): void {
  if (!fs.existsSync(CACHE_FILE)) {
    acquireLock();
    try {
      if (!fs.existsSync(CACHE_FILE)) {
        writeAtomic({});
      }
    } finally {
      releaseLock();
    }
  }
}

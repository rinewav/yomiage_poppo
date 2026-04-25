import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT } from './constants';
import { VoiceCacheEntry } from './types';

export const CACHE_FILE = process.env.CACHE_FILE || path.join(PROJECT_ROOT, 'voice_cache.json');

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

export function updateVoiceCache(updater: (cache: Record<string, VoiceCacheEntry>) => void, retries: number = 10, busyWaitMs: number = 20): void {
  for (let i = 0; i < retries; i++) {
    try {
      const cache = readVoiceCache();
      updater(cache);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
      return;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException | null;
      if (nodeErr && (nodeErr.code === 'EBUSY' || nodeErr.code === 'EPERM')) {
        const start = Date.now();
        while (Date.now() - start < busyWaitMs) { /* busy wait */ }
        continue;
      }
      console.error(`[Cache] voice_cache.json の書き込みに失敗しました。`, err);
      break;
    }
  }
}

export function getCacheKey(text: string, speakerId: number, highPitch: boolean = false, ttsEngine: string = 'hybrid'): string {
  const pitchState = highPitch ? '_high' : '';
  const engineState = `_${ttsEngine}`;
  return crypto.createHash('sha256').update(`${speakerId}_${text}${pitchState}${engineState}`).digest('hex');
}

export function initCacheFile(): void {
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({}), 'utf8');
  }
}
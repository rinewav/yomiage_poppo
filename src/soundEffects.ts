import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, SOUNDS_DIR } from './constants';

interface SoundEffectEntry {
  keyword: string;
  file: string;
}

const SOUND_EFFECTS_FILE = path.join(PROJECT_ROOT, 'sound_effects.json');

function readEntries(): SoundEffectEntry[] {
  try {
    const data = fs.readFileSync(SOUND_EFFECTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeEntries(entries: SoundEffectEntry[]): void {
  fs.writeFileSync(SOUND_EFFECTS_FILE, JSON.stringify(entries, null, 2) + '\n');
}

export function loadSoundEffects(): Record<string, string> {
  const entries = readEntries();
  const map: Record<string, string> = {};
  for (const entry of entries) {
    map[entry.keyword] = path.join(SOUNDS_DIR, entry.file);
  }
  return map;
}

export function addSoundEffect(keyword: string, file: string): { success: boolean; message: string } {
  const entries = readEntries();
  const existing = entries.find((e) => e.keyword === keyword);
  if (existing) {
    return { success: false, message: `キーワード「${keyword}」は既に登録されています（ファイル: ${existing.file}）` };
  }

  const filePath = path.join(SOUNDS_DIR, file);
  if (!fs.existsSync(filePath)) {
    return { success: false, message: `ファイルが見つかりません: sounds/${file}` };
  }

  entries.push({ keyword, file });
  writeEntries(entries);
  return { success: true, message: `効果音を追加しました: 「${keyword}」→ sounds/${file}` };
}

export function removeSoundEffect(keyword: string): { success: boolean; message: string } {
  const entries = readEntries();
  const index = entries.findIndex((e) => e.keyword === keyword);
  if (index === -1) {
    return { success: false, message: `キーワード「${keyword}」は登録されていません` };
  }

  const removed = entries.splice(index, 1)[0];
  writeEntries(entries);
  return { success: true, message: `効果音を削除しました: 「${removed.keyword}」→ sounds/${removed.file}` };
}

export function listSoundEffects(): SoundEffectEntry[] {
  return readEntries();
}

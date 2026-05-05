import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT, CACHE_GENERATION_DELAY_MS, MAX_SPEAKER_ID } from './constants';
import { getCacheKey, readVoiceCache, updateVoiceCache, initCacheFile } from './voiceCache';
import { VoiceCacheEntry } from './types';

console.log('事前キャッシュ生成スクリプトを開始します...');

const PRIMARY_VOICEVOX_URL: string = process.env.VOICEVOX_URL || '';
const FALLBACK_VOICEVOX_URL: string = process.env.VOICEVOX_FALLBACK_URL || '';

if (!PRIMARY_VOICEVOX_URL) {
  console.error('エラー: VOICEVOX_URL 環境変数が設定されていません。');
  process.exit(1);
}

const TARGET_SPEAKER_IDS: number[] = Array.from({ length: MAX_SPEAKER_ID }, (_, i) => i + 1);

const CACHE_LIST_FILE: string = path.join(PROJECT_ROOT, 'cache_list.txt');
const PRE_CACHE_DIR: string = path.join(PROJECT_ROOT, 'pre_cache_audio');

async function getVoicevoxAudio(text: string, speakerId: number): Promise<Buffer> {
  let queryData: any;
  try {
    const queryResponse = await axios.post(`${PRIMARY_VOICEVOX_URL}/audio_query`, null, {
      params: { text, speaker: speakerId },
    });
    queryData = queryResponse.data;
    if (/[\uFF61-\uFF9F]/.test(text)) {
      queryData.pitchScale = 0.1;
    }
    const audioResponse = await axios.post(`${PRIMARY_VOICEVOX_URL}/synthesis`, queryData, {
      params: { speaker: speakerId },
      responseType: 'arraybuffer',
    });
    return audioResponse.data;
  } catch (primaryError) {
    console.warn(`[WARN] 優先URL (${PRIMARY_VOICEVOX_URL}) が失敗しました。代替URLを試します。`);
    try {
      const queryResponse = await axios.post(`${FALLBACK_VOICEVOX_URL}/audio_query`, null, {
        params: { text, speaker: speakerId },
      });
      queryData = queryResponse.data;
      if (/[\uFF61-\uFF9F]/.test(text)) {
        queryData.pitchScale = 0.1;
      }
      const audioResponse = await axios.post(`${FALLBACK_VOICEVOX_URL}/synthesis`, queryData, {
        params: { speaker: speakerId },
        responseType: 'arraybuffer',
      });
      return audioResponse.data;
    } catch (fallbackError) {
      console.error(`[ERROR] 代替URL (${FALLBACK_VOICEVOX_URL}) も失敗しました。`);
      throw fallbackError;
    }
  }
}

async function generateCache(): Promise<void> {
  if (!fs.existsSync(CACHE_LIST_FILE)) {
    console.error(`エラー: ${CACHE_LIST_FILE} が見つかりません。`);
    return;
  }
  fs.mkdirSync(PRE_CACHE_DIR, { recursive: true });
  initCacheFile();

  const cache = readVoiceCache();

  const textsToCache: string[] = fs
    .readFileSync(CACHE_LIST_FILE, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (textsToCache.length === 0) {
    console.log('キャッシュする単語がリストにありません。処理を終了します。');
    return;
  }
  console.log(`${textsToCache.length}件の単語、${TARGET_SPEAKER_IDS.length}人の話者でキャッシュを生成します。`);

  for (const text of textsToCache) {
    for (const speakerId of TARGET_SPEAKER_IDS) {
      const isHankaku = /^[\uFF61-\uFF9F]+$/.test(text);
      const key = getCacheKey(text, speakerId, isHankaku, 'hybrid');

      const existing = cache[key];
      if (existing && fs.existsSync(existing.filePath)) {
        console.log(`[SKIP] 「${text}」(ID:${speakerId}) は既にキャッシュされています。`);
        continue;
      }

      try {
        console.log(`[GENERATE] 「${text}」(ID:${speakerId}) の音声を生成中...`);
        const audioData = await getVoicevoxAudio(text, speakerId);

        const filePath = path.join(PRE_CACHE_DIR, `${key}.wav`);
        fs.writeFileSync(filePath, audioData);

        updateVoiceCache((c) => {
          c[key] = {
            text,
            speakerId,
            filePath,
            createdAt: new Date().toISOString(),
          };
        });

        console.log(`[SUCCESS] 「${text}」(ID:${speakerId}) を ${filePath} に保存しました。`);
      } catch (error: any) {
        console.error(`[FAIL] 「${text}」(ID:${speakerId}) の生成に失敗しました:`, error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, CACHE_GENERATION_DELAY_MS));
    }
  }

  console.log('事前キャッシュ生成スクリプトが完了しました。');
}

generateCache();

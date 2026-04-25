import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('事前キャッシュ生成スクリプトを開始します...');

const PRIMARY_VOICEVOX_URL: string = process.env.VOICEVOX_URL || '';
const FALLBACK_VOICEVOX_URL: string = process.env.VOICEVOX_FALLBACK_URL || '';

if (!PRIMARY_VOICEVOX_URL) {
  console.error('エラー: VOICEVOX_URL 環境変数が設定されていません。');
  process.exit(1);
}

const TARGET_SPEAKER_IDS: number[] = Array.from({ length: 50 }, (_, i) => i + 1);

const PROJECT_ROOT = path.resolve(__dirname, '..');

const CACHE_LIST_FILE: string = path.join(PROJECT_ROOT, 'cache_list.txt');
const CACHE_JSON_FILE: string = path.join(PROJECT_ROOT, 'voice_cache.json');
const PRE_CACHE_DIR: string = path.join(PROJECT_ROOT, 'pre_cache_audio');

function getCacheKey(text: string, speakerId: number): string {
  return crypto.createHash('sha256').update(`${speakerId}_${text}`).digest('hex');
}

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

  let voiceCache: Record<string, string> = {};
  if (fs.existsSync(CACHE_JSON_FILE)) {
    try {
      voiceCache = JSON.parse(fs.readFileSync(CACHE_JSON_FILE, 'utf8'));
      console.log('既存の voice_cache.json を読み込みました。');
    } catch (e) {
      console.error('voice_cache.json の読み込みに失敗しました。新しいファイルを作成します。', e);
    }
  }

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
      const key = getCacheKey(text, speakerId);

      if (voiceCache[key] && fs.existsSync(voiceCache[key])) {
        console.log(`[SKIP] 「${text}」(ID:${speakerId}) は既にキャッシュされています。`);
        continue;
      }

      try {
        console.log(`[GENERATE] 「${text}」(ID:${speakerId}) の音声を生成中...`);
        const audioData = await getVoicevoxAudio(text, speakerId);

        const filePath = path.join(PRE_CACHE_DIR, `${key}.wav`);
        fs.writeFileSync(filePath, audioData);

        voiceCache[key] = filePath;

        console.log(`[SUCCESS] 「${text}」(ID:${speakerId}) を ${filePath} に保存しました。`);
      } catch (error: any) {
        console.error(`[FAIL] 「${text}」(ID:${speakerId}) の生成に失敗しました:`, error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  try {
    fs.writeFileSync(CACHE_JSON_FILE, JSON.stringify(voiceCache, null, 2), 'utf8');
    console.log('voice_cache.json の更新が完了しました。');
  } catch (e) {
    console.error('voice_cache.json の書き込みに失敗しました。', e);
  }

  console.log('事前キャッシュ生成スクリプトが完了しました。');
}

generateCache();
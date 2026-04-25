import fs from 'fs';
import axios from 'axios';
import { franc } from 'franc';
import { VoicevoxServer, VoiceCacheEntry } from './types';
import {
  VOICEVOX_QUERY_TIMEOUT_MS,
  VOICEVOX_SYNTHESIS_TIMEOUT_MS,
  HIGH_PITCH_SCALE,
  LANG_CODE_MAP,
  NOSPLIT_PATTERN,
} from './constants';
import { getCacheKey, readVoiceCache, updateVoiceCache } from './voiceCache';

const textToSpeech = require('@google-cloud/text-to-speech');
const googleTTSClient = new textToSpeech.TextToSpeechClient();

export async function synthesizeWithGoogleTTS(text: string, filePath: string, forceEnglish: boolean = false): Promise<void> {
  let languageCode: string;

  if (forceEnglish) {
    languageCode = 'en-US';
  } else {
    let lang3: string;
    if (/^[a-zA-Z0-9\s]+$/.test(text) && text.length < 4) {
      lang3 = 'eng';
    } else {
      lang3 = franc(text, { minLength: 1 });
    }
    languageCode = LANG_CODE_MAP[lang3] || 'en-US';
  }

  console.log(`[Google TTS] Using: '${languageCode}' for text: "${text}"`);

  const request = {
    input: { text },
    voice: {
      languageCode,
      ssmlGender: 'NEURAL' as const,
    },
    audioConfig: {
      audioEncoding: 'LINEAR16' as const,
    },
  };

  try {
    const [response] = await googleTTSClient.synthesizeSpeech(request);
    fs.writeFileSync(filePath, response.audioContent as Buffer, 'binary');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Google TTS でのエラー (Language: ${languageCode}):`, message);
    throw err;
  }
}

export async function getVoicevoxAudio(
  text: string,
  speakerId: number,
  highPitch: boolean,
  servers: VoicevoxServer[]
): Promise<Buffer> {
  const healthyServers = servers.filter((server) => server.healthy);

  if (healthyServers.length === 0) {
    console.error('[TTS] 健全なVOICEVOXサーバーが1台も見つかりません。');
    if (servers.length > 0) {
      healthyServers.push(servers[0]);
      console.warn(`[TTS] 緊急措置として、プライマリサーバー(${servers[0].url})を試行します。`);
    } else {
      throw new Error('No VOICEVOX servers configured.');
    }
  }

  let lastError: Error | null = null;

  for (const server of healthyServers) {
    let queryData: any;
    try {
      const queryResponse = await axios.post(`${server.url}/audio_query`, null, {
        params: { text, speaker: speakerId },
        timeout: VOICEVOX_QUERY_TIMEOUT_MS,
      });
      queryData = queryResponse.data;

      if (highPitch) {
        queryData.pitchScale = HIGH_PITCH_SCALE;
      }

      const audioResponse = await axios.post(`${server.url}/synthesis`, queryData, {
        params: { speaker: speakerId },
        responseType: 'arraybuffer',
        timeout: VOICEVOX_SYNTHESIS_TIMEOUT_MS,
      });

      console.log(`[TTS] 音声合成に成功しました (Server: ${server.url})`);
      return audioResponse.data;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[TTS] VOICEVOXサーバー (${server.url}) でエラーが発生しました。 (エラー: ${lastError.message})`);

      server.healthy = false;
      server.lastErrorTime = Date.now();
    }
  }

  console.error(`[TTS] すべてのVOICEVOXサーバーでの音声合成に失敗しました。`);
  throw lastError;
}

export async function synthesizeMixedTTS(
  text: string,
  speakerId: number,
  outputPath: string,
  highPitch: boolean = false,
  ttsEngine: string = 'hybrid',
  servers: VoicevoxServer[] = []
): Promise<void> {
  if (text) {
    text = text.replace(NOSPLIT_PATTERN, '');
  }
  if (!text || typeof text !== 'string' || text.trim() === '') return;
  try {
    if (ttsEngine === 'google') {
      await synthesizeWithGoogleTTS(text, outputPath, true);
    } else {
      const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF61-\uFF9F]/.test(text);
      if (isJapanese) {
        const audioData = await getVoicevoxAudio(text, speakerId, highPitch, servers);
        fs.writeFileSync(outputPath, audioData);
      } else {
        await synthesizeWithGoogleTTS(text, outputPath, false);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`音声合成(synthesizeMixedTTS)中にエラーが発生しました: "${text}"`, message);
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch (_) { /* ignore */ }
    }
  }
}
import path from 'path';

export const PROJECT_ROOT = path.resolve(__dirname, '..');

export const HEALTH_CHECK_TIMEOUT_MS = 2000;
export const SERVER_COOLDOWN_MS = 60000;
export const VC_CONNECTION_TIMEOUT_MS = 30_000;
export const VC_RECONNECT_TIMEOUT_MS = 5_000;
export const VOICEVOX_QUERY_TIMEOUT_MS = 5000;
export const VOICEVOX_SYNTHESIS_TIMEOUT_MS = 10000;
export const DEFAULT_PLAYBACK_VOLUME = 0.5;
export const SOUND_EFFECT_VOLUME = 0.1;
export const HIGH_PITCH_SCALE = 0.1;
export const DEFAULT_SPEAKER_ID = 3;
export const CACHE_WRITE_RETRIES = 10;
export const CACHE_BUSY_WAIT_MS = 20;
export const MAX_CHUNK_LENGTH = 30;
export const DICT_ITEMS_PER_PAGE = 9;
export const CACHE_ITEMS_PER_PAGE = 5;
export const COLLECTOR_TIMEOUT_MS = 120_000;
export const MAX_MESSAGE_LENGTH = 200;
export const HEALTH_CHECK_INTERVAL_MS = 30_000;
export const CACHE_GENERATION_DELAY_MS = 500;
export const MAX_SPEAKER_ID = 50;

export const DEFAULT_TTS_ENGINE = 'hybrid';

export const SPOILER_REPLACEMENT = '隠しメッセージ';
export const CODE_REPLACEMENT = 'コード';
export const URL_REPLACEMENT = 'リンク';
export const LAUGH_REPLACEMENT = 'わらわら';
export const MEDIA_LABEL = 'メディア';
export const MENTION_REPLACEMENT = 'メンション';
export const CHANNEL_MENTION_REPLACEMENT = 'チャンネルメンション';
export const EMOJI_REPLACEMENT = '絵文字';
export const RELOAD_BUTTON_ID = 'reload_bot';
export const RELOAD_MESSAGE = '🛑 ボットを再起動します...';
export const LEAVE_MESSAGE = '🍏VCから切断しました。';
export const NOSPLIT_PATTERN = /NOSPLIT[a-fA-F0-9]+MARKER/g;

export const LISTENING_CHANNEL_PATTERN = /^👂｜聞き専-(\d+)$/;

export const LANG_CODE_MAP: Record<string, string> = {
  jpn: 'ja-JP',
  kor: 'ko-KR',
  eng: 'en-US',
  cmn: 'cmn-CN',
  rus: 'ru-RU',
  fra: 'fr-FR',
  deu: 'de-DE',
  spa: 'es-ES',
  ita: 'it-IT',
  tha: 'th-TH',
  vie: 'vi-VN',
  ind: 'id-ID',
};

export const SOUNDS_DIR = path.join(PROJECT_ROOT, 'sounds');

export const COORDINATION_TIMEOUT_MS = 2_000;
export const AUTO_JOIN_STAGGER_MS = 200;
export const DASHBOARD_LOG_LINES = 3;
export const DASHBOARD_REFRESH_MS = 5_000;
export const PRESENCE_BUSY_TEXT = '❌ 使用中です！';
export const PRESENCE_IDLE_TEXT = '⭕️ 空いています！';
import axios from 'axios';
import { VoicevoxServer } from './types';
import { VOICEVOX_QUERY_TIMEOUT_MS, AUTOCOMPLETE_MAX_CHOICES } from './constants';

export interface SpeakerStyle {
  id: number;
  speakerName: string;
  styleName: string;
  label: string;
}

let styles: SpeakerStyle[] = [];

// VOICEVOXサーバーからスピーカー一覧を取得し、キャッシュを更新する
export async function refreshSpeakers(servers: VoicevoxServer[]): Promise<void> {
  const server = servers.find((s) => s.healthy === true) ?? servers[0];
  if (!server) return;

  try {
    const response = await axios.get(`${server.url}/speakers`, { timeout: VOICEVOX_QUERY_TIMEOUT_MS });
    const data = response.data as Array<{ name: string; styles: Array<{ id: number; name: string }> }>;

    const nextStyles: SpeakerStyle[] = [];
    for (const speaker of data) {
      for (const style of speaker.styles) {
        nextStyles.push({
          id: style.id,
          speakerName: speaker.name,
          styleName: style.name,
          label: `${speaker.name}（${style.name}）`,
        });
      }
    }
    styles = nextStyles;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[voicevoxSpeakers] スピーカー一覧の取得に失敗しました: ${message}`);
  }
}

export function searchSpeakers(query: string, limit: number = AUTOCOMPLETE_MAX_CHOICES): SpeakerStyle[] {
  const trimmed = query.trim();
  if (!trimmed) return styles.slice(0, limit);

  const lower = trimmed.toLowerCase();
  const isNumeric = /^\d+$/.test(trimmed);

  return styles
    .filter((s) => s.label.toLowerCase().includes(lower) || (isNumeric && String(s.id) === trimmed))
    .slice(0, limit);
}

export function getSpeakerStyle(id: number): SpeakerStyle | undefined {
  return styles.find((s) => s.id === id);
}

export function hasSpeakers(): boolean {
  return styles.length > 0;
}

export function __setStylesForTest(list: SpeakerStyle[]): void {
  styles = list;
}

export interface VoicevoxServer {
  url: string;
  healthy: boolean;
  lastErrorTime: number;
}

export interface VoiceCacheEntry {
  text: string;
  speakerId: number;
  filePath: string;
  createdAt: string;
}

export interface GuildSettings {
  dictionary: Record<string, string>;
  channelId: string | null;
  noSplitWords: string[];
  ttsEngine?: 'hybrid' | 'google';
}

export interface SynthesisItem {
  type: 'text' | 'sound';
  text?: string;
  speakerId?: number;
  userId: string;
  highPitch?: boolean;
  ttsEngine?: string;
  filePath?: string;
}

export interface Segment {
  type: 'text' | 'sound';
  content?: string;
  filePath?: string;
}

export interface BotConfig {
  botNumber: number;
  envPath?: string;
  vcFileSuffix: string;
  intents: number[];
  healthCheckChannelId?: string;
  selfDeaf?: boolean;
}
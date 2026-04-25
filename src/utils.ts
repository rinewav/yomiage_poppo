import crypto from 'crypto';
import { SynthesisItem, Segment } from './types';

export function normalizeText(text: string): string {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    .replace(/　/g, ' ');
}

export function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      const parts = hostname.split('.');
      hostname = `${parts[0]}.***.***.${parts[parts.length - 1]}`;
    } else {
      const parts = hostname.split('.');
      if (parts.length > 2) {
        hostname = `***.${parts.slice(-2).join('.')}`;
      }
    }
    return `${urlObj.protocol}//${hostname}:${urlObj.port}`;
  } catch (_) {
    return url.replace(/([\w.-]+)/g, (match: string, p1: string) => {
      if (p1.length > 2) return p1[0] + '***';
      return '***';
    });
  }
}

export function segmentByLanguage(text: string): Array<{ text: string; lang: 'ja' | 'en' }> {
  const segmentationRegex = /([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF61-\uFF9F]+|[a-zA-Z0-9.,!?'"()\s]+)/g;
  const segments = text.match(segmentationRegex) || [];
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uFF61-\uFF9F]/;
  return segments.map((segment) => {
    const lang = japaneseRegex.test(segment) ? 'ja' : 'en';
    return { text: segment, lang: lang as 'ja' | 'en' };
  });
}

export async function chunkTextByMorphs(
  text: string,
  tokenizer: any | null,
  noSplitWords: string[] = [],
  maxChunkLength: number = 30
): Promise<string[]> {
  const isJapaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  if (!isJapaneseRegex.test(text)) {
    console.log('[chunkTextByMorphs] Non-Japanese text detected. Skipping kuromoji tokenizer.');
    return [text];
  }

  if (!tokenizer || !text) {
    return text.split(/(?<=[。！？\.\!\?])/).filter((s) => s.trim());
  }

  const placeholders: Map<string, string> = new Map();

  if (noSplitWords.length > 0) {
    const sortedNoSplitWords = [...noSplitWords].sort((a, b) => b.length - a.length);
    for (const word of sortedNoSplitWords) {
      const placeholder = `NOSPLIT${crypto.randomBytes(6).toString('hex')}MARKER`;
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      if (text.includes(word)) {
        text = text.replace(regex, ` ${placeholder} `);
        placeholders.set(placeholder, word);
      }
    }
  }

  const tokens = tokenizer.tokenize(text);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const token of tokens) {
    const word = token.surface_form;
    const pos = token.pos;
    const posDetail = token.pos_detail_1;

    if (currentChunk.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = '';
    }

    if (pos === '記号' || pos === '接続詞' || posDetail === '格助詞' || posDetail === '終助詞') {
      currentChunk += word;
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = '';
    } else {
      currentChunk += word;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  const finalChunks = chunks.map((chunk) => {
    let finalChunk = chunk;
    for (const [placeholder, originalWord] of placeholders.entries()) {
      if (finalChunk.includes(placeholder)) {
        finalChunk = finalChunk.replace(new RegExp(placeholder, 'g'), originalWord);
      }
    }
    return finalChunk;
  });

  return finalChunks.filter(Boolean);
}

export function segmentTextWithEffects(
  text: string,
  soundEffectsMap: Record<string, string>,
  fs: typeof import('fs')
): Segment[] {
  if (!text) return [];
  if (Object.keys(soundEffectsMap).length === 0) {
    return text.trim() ? [{ type: 'text' as const, content: text.trim() }] : [];
  }

  const sortedEffectKeys = Object.keys(soundEffectsMap).sort((a, b) => b.length - a.length);

  for (const key of sortedEffectKeys) {
    const index = text.indexOf(key);
    if (index !== -1) {
      const before = text.substring(0, index);
      const after = text.substring(index + key.length);
      const result: Segment[] = [];
      if (before) result.push({ type: 'text' as const, content: before.trim() });

      const soundFilePath = soundEffectsMap[key];
      if (fs.existsSync(soundFilePath)) {
        result.push({ type: 'sound' as const, filePath: soundFilePath });
      } else {
        result.push({ type: 'text' as const, content: key });
        console.warn(`[RUNTIME WARN] Sound effect file for "${key}" not found at: ${soundFilePath}. Treating as text.`);
      }
      result.push(...segmentTextWithEffects(after, soundEffectsMap, fs));
      return result.filter((seg) => (seg.type === 'text' && seg.content !== '') || seg.type === 'sound');
    }
  }
  return [{ type: 'text' as const, content: text.trim() }].filter((seg) => seg.content !== '');
}
import { Segment } from './types';
import { SOFT_CHUNK_LENGTH, MAX_CHUNK_LENGTH, URL_DOMAIN_NAMES, URL_REPLACEMENT } from './constants';

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

// URLをホスト名から読み上げ用の文言に変換する（例: 「YouTubeのリンク」）
export function describeUrl(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch (_) {
    return URL_REPLACEMENT;
  }

  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }

  const matchedKey = Object.keys(URL_DOMAIN_NAMES).find(
    (key) => hostname === key || hostname.endsWith(`.${key}`)
  );

  const name = matchedKey ? URL_DOMAIN_NAMES[matchedKey] : hostname;
  return `${name}の${URL_REPLACEMENT}`;
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
    const portSuffix = urlObj.port ? `:${urlObj.port}` : '';
    return `${urlObj.protocol}//${hostname}${portSuffix}`;
  } catch (_) {
    return url.replace(/([\w.-]+)/g, (match: string, p1: string) => {
      if (p1.length > 2) return p1[0] + '***';
      return '***';
    });
  }
}

// 日本語として扱う文字集合: ひらがな・カタカナ・CJK統合漢字（拡張Aと基本領域）・CJK互換漢字・半角カナ・々〆〇
const JA_CHAR_REGEX =
  /[぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿｡-ﾟ々-〇]/u;
// 日本語以外の文字（ラテン・キリル・ハングル・タイ文字など）
const OTHER_LETTER_REGEX = /[\p{L}\p{M}]/u;
const LETTER_OR_NUMBER_REGEX = /[\p{L}\p{N}]/u;
const HAS_DIGIT_REGEX = /\p{N}/u;

export function segmentByLanguage(text: string): Array<{ text: string; lang: 'ja' | 'en' }> {
  type Lang = 'ja' | 'en';
  const segments: Array<{ text: string; lang: Lang }> = [];
  let currentLang: Lang | null = null;
  let currentText = '';
  let neutralBuffer = '';

  const flush = () => {
    if (currentLang !== null) {
      segments.push({ text: currentText, lang: currentLang });
    }
    currentLang = null;
    currentText = '';
  };

  for (const ch of text) {
    const isJa = JA_CHAR_REGEX.test(ch);
    const isOtherLetter = !isJa && OTHER_LETTER_REGEX.test(ch);

    if (isJa || isOtherLetter) {
      const lang: Lang = isJa ? 'ja' : 'en';
      if (currentLang !== null && currentLang !== lang) {
        flush();
      }
      if (currentLang === null) {
        currentLang = lang;
        currentText = neutralBuffer;
        neutralBuffer = '';
      }
      currentText += ch;
    } else if (currentLang !== null) {
      currentText += ch;
    } else {
      neutralBuffer += ch;
    }
  }
  flush();

  if (segments.length === 0) {
    // 全体が数字・記号などのみ: 数字を含むならVOICEVOXが自然に読めるので'ja'として1セグメント返す
    if (HAS_DIGIT_REGEX.test(neutralBuffer)) {
      return [{ text: neutralBuffer, lang: 'ja' }];
    }
    return [];
  }

  return segments.filter((seg) => LETTER_OR_NUMBER_REGEX.test(seg.text));
}

interface MorphToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  [key: string]: unknown;
}

function splitByNoSplitWords(text: string, noSplitWords: string[]): Array<{ text: string; isNoSplit: boolean }> {
  const words = noSplitWords.filter(Boolean);
  if (words.length === 0) return [{ text, isNoSplit: false }];

  const sortedWords = [...words].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sortedWords.map(escapeRegex).join('|'), 'g');

  const parts: Array<{ text: string; isNoSplit: boolean }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isNoSplit: false });
    }
    parts.push({ text: match[0], isNoSplit: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isNoSplit: false });
  }
  return parts;
}

function isPunctuationSymbolToken(token: MorphToken): boolean {
  if (token.pos !== '記号') return false;
  if (token.pos_detail_1 === '句点' || token.pos_detail_1 === '読点') return true;
  return /^[。、!?！？…‥,\.]+$/.test(token.surface_form);
}

function isSoftBoundaryToken(token: MorphToken): boolean {
  return (
    token.pos === '接続詞' ||
    token.pos_detail_1 === '格助詞' ||
    token.pos_detail_1 === '終助詞' ||
    token.pos_detail_1 === '接続助詞' ||
    token.pos_detail_1 === '係助詞'
  );
}

export async function chunkTextByMorphs(
  text: string,
  tokenizer: any | null,
  noSplitWords: string[] = [],
  maxChunkLength: number = MAX_CHUNK_LENGTH
): Promise<string[]> {
  if (!JA_CHAR_REGEX.test(text)) {
    console.log('[chunkTextByMorphs] Non-Japanese text detected. Skipping kuromoji tokenizer.');
    return [text];
  }

  if (!tokenizer || !text) {
    return text.split(/(?<=[。!?！？\.、,])/).filter((s) => s.trim());
  }

  const parts = splitByNoSplitWords(text, noSplitWords);
  const tokens: MorphToken[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    if (part.isNoSplit) {
      tokens.push({ surface_form: part.text, pos: '名詞', pos_detail_1: '*' });
    } else {
      tokens.push(...(tokenizer.tokenize(part.text) as MorphToken[]));
    }
  }

  const chunks: string[] = [];
  let currentChunk = '';

  const flush = () => {
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    currentChunk = '';
  };

  for (const token of tokens) {
    const word = token.surface_form;

    if (currentChunk.length > 0 && currentChunk.length + word.length > maxChunkLength) {
      flush();
    }

    currentChunk += word;

    if (isPunctuationSymbolToken(token)) {
      flush();
    } else if (isSoftBoundaryToken(token) && currentChunk.length >= SOFT_CHUNK_LENGTH) {
      flush();
    }
  }

  flush();

  return chunks.filter(Boolean);
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

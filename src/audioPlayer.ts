import fs from 'fs';
import path from 'path';
import { createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, VoiceConnection } from '@discordjs/voice';
import { SynthesisItem, Segment } from './types';
import { DEFAULT_PLAYBACK_VOLUME, SOUND_EFFECT_VOLUME, SOUNDS_DIR } from './constants';
import { synthesizeMixedTTS } from './tts';
import { getCacheKey, readVoiceCache, updateVoiceCache } from './voiceCache';
import { segmentByLanguage, chunkTextByMorphs } from './utils';

export async function readAloud(
  guildId: string,
  segments: Segment[],
  userId: string,
  noSplitWords: string[] = [],
  ttsEngine: string = 'hybrid',
  userspeakerDir: string,
  tokenizer: any | null,
  synthesisQueues: Map<string, SynthesisItem[]>,
  playQueues: Map<string, string[]>,
  isSynthesizing: Map<string, boolean>,
  isPlaying: Map<string, boolean>,
  tempDir: string,
  servers: any[]
): Promise<void> {
  if (!synthesisQueues.has(guildId)) synthesisQueues.set(guildId, []);
  if (!playQueues.has(guildId)) playQueues.set(guildId, []);

  const userSpeakerFile = path.join(userspeakerDir, `${userId}.json`);
  let speakerId: number = 3;
  if (fs.existsSync(userSpeakerFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(userSpeakerFile, 'utf8'));
      speakerId = data.speakerId ?? 3;
    } catch (_) { /* Use default */ }
  }

  const synthesisQueue = synthesisQueues.get(guildId)!;
  const itemsToPush: SynthesisItem[] = [];

  for (const segment of segments) {
    if (segment.type === 'sound' && segment.filePath) {
      itemsToPush.push({ type: 'sound', filePath: segment.filePath, userId });
      continue;
    }

    if (segment.type === 'text' && segment.content && segment.content.trim() !== '') {
      const languageSegments = segmentByLanguage(segment.content.trim());

      for (const langSegment of languageSegments) {
        if (langSegment.lang === 'ja') {
          const textChunks = await chunkTextByMorphs(langSegment.text, tokenizer, noSplitWords);
          for (const chunk of textChunks) {
            if (chunk.trim()) {
              const subSegments = chunk.trim().split(/([\uFF61-\uFF9F]+)/);
              for (const subSegment of subSegments) {
                if (!subSegment) continue;
                const isHankaku = /^[\uFF61-\uFF9F]+$/.test(subSegment);
                itemsToPush.push({ type: 'text', text: subSegment, speakerId, userId, highPitch: isHankaku, ttsEngine });
              }
            }
          }
        } else {
          itemsToPush.push({ type: 'text', text: langSegment.text, speakerId, userId, highPitch: false, ttsEngine });
        }
      }
    }
  }

  if (itemsToPush.length > 0) {
    synthesisQueue.push(...itemsToPush);
  }

  if (!isSynthesizing.get(guildId) && synthesisQueue.length > 0) {
    isSynthesizing.set(guildId, true);
    processSynthesisQueue(guildId, synthesisQueues, playQueues, isSynthesizing, isPlaying, tempDir, servers).catch((err) => {
      console.error('Error in processSynthesisQueue (triggered by readAloud):', err);
      isSynthesizing.set(guildId, false);
    });
  }

  if (!isPlaying.get(guildId) && (playQueues.get(guildId)?.length ?? 0) > 0 && synthesisQueue.length === 0) {
    isPlaying.set(guildId, true);
    processPlayQueue(guildId, synthesisQueues, playQueues, isSynthesizing, isPlaying).catch((err) => {
      console.error('Error in processPlayQueue (triggered by readAloud):', err);
      isPlaying.set(guildId, false);
    });
  }
}

export async function processSynthesisQueue(
  guildId: string,
  synthesisQueues: Map<string, SynthesisItem[]>,
  playQueues: Map<string, string[]>,
  isSynthesizing: Map<string, boolean>,
  isPlaying: Map<string, boolean>,
  tempDir: string,
  servers: any[]
): Promise<void> {
  const synthesisQueue = synthesisQueues.get(guildId);
  const playQueue = playQueues.get(guildId);

  if (!synthesisQueue || !playQueue) {
    isSynthesizing.set(guildId, false);
    return;
  }

  while (synthesisQueue.length > 0) {
    const item = synthesisQueue.shift()!;

    if (item.type === 'text') {
      const key = getCacheKey(item.text!, item.speakerId!, item.highPitch, item.ttsEngine);
      let tempPath: string | undefined;

      const currentCache = readVoiceCache();

      if (currentCache[key] && fs.existsSync(currentCache[key].filePath)) {
        tempPath = currentCache[key].filePath;
      } else {
        tempPath = path.join(tempDir, `synth_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
        try {
          await synthesizeMixedTTS(item.text!, item.speakerId!, tempPath, item.highPitch, item.ttsEngine, servers);
          if (fs.existsSync(tempPath)) {
            updateVoiceCache((cache) => {
              cache[key] = {
                text: item.text!,
                speakerId: item.speakerId!,
                filePath: tempPath!,
                createdAt: new Date().toISOString(),
              };
            });
          } else {
            console.warn('合成ファイルが存在しないため、キャッシュ登録をスキップしました:', tempPath, 'Text:', item.text);
            continue;
          }
        } catch (err) {
          console.error(`synthesizeMixedTTS の実行中にエラーが発生: Text: "${item.text}"`, err);
          if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
          }
          continue;
        }
      }
      if (tempPath && fs.existsSync(tempPath)) {
        playQueue.push(tempPath);
      }
    } else if (item.type === 'sound') {
      if (item.filePath && fs.existsSync(item.filePath)) {
        playQueue.push(item.filePath);
      } else {
        console.warn(`効果音ファイルが見つからないかパスが無効です。スキップします: ${item.filePath}`);
        continue;
      }
    } else {
      console.warn('不明なアイテムタイプが合成キューにあります:', item);
      continue;
    }

    if (playQueue.length > 0 && !isPlaying.get(guildId)) {
      isPlaying.set(guildId, true);
      processPlayQueue(guildId, synthesisQueues, playQueues, isSynthesizing, isPlaying).catch((err) => {
        console.error('Error in processPlayQueue (triggered by processSynthesisQueue):', err);
        isPlaying.set(guildId, false);
      });
    }
  }

  isSynthesizing.set(guildId, false);

  if (playQueue.length > 0 && !isPlaying.get(guildId)) {
    isPlaying.set(guildId, true);
    processPlayQueue(guildId, synthesisQueues, playQueues, isSynthesizing, isPlaying).catch((err) => {
      console.error('Error in processPlayQueue (final check in processSynthesisQueue):', err);
      isPlaying.set(guildId, false);
    });
  } else if (playQueue.length === 0 && !isSynthesizing.get(guildId)) {
    isPlaying.set(guildId, false);
  }
}

export async function processPlayQueue(
  guildId: string,
  synthesisQueues: Map<string, SynthesisItem[]>,
  playQueues: Map<string, string[]>,
  isSynthesizing: Map<string, boolean>,
  isPlaying: Map<string, boolean>
): Promise<void> {
  const connection = getVoiceConnection(guildId);
  const playQueue = playQueues.get(guildId);

  if (!connection || !playQueue || playQueue.length === 0) {
    isPlaying.set(guildId, false);
    return;
  }

  let player = (connection.state as any).subscription?.player;
  if (!player) {
    player = createAudioPlayer();
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      if (playQueue.length === 0) {
        isPlaying.set(guildId, false);
      } else {
        playNextAudio(player, playQueue, guildId, isPlaying);
      }
    });

    player.on('error', (error: Error) => {
      console.error(`AudioPlayer Error (guildId: ${guildId}):`, error.message);
      isPlaying.set(guildId, false);
      if (playQueue.length > 0) {
        playNextAudio(player, playQueue, guildId, isPlaying);
      }
    });
  }

  if (player.state.status === AudioPlayerStatus.Idle && playQueue.length > 0) {
    isPlaying.set(guildId, true);
    playNextAudio(player, playQueue, guildId, isPlaying);
  } else if (player.state.status !== AudioPlayerStatus.Playing && player.state.status !== AudioPlayerStatus.Buffering && playQueue.length > 0) {
    isPlaying.set(guildId, true);
    playNextAudio(player, playQueue, guildId, isPlaying);
  } else if (playQueue.length === 0) {
    isPlaying.set(guildId, false);
  }
}

function playNextAudio(currentPlayer: any, playQueue: string[], guildId: string, isPlaying: Map<string, boolean>): void {
  if (playQueue.length === 0) {
    isPlaying.set(guildId, false);
    return;
  }

  const audioPath = playQueue.shift()!;

  if (!fs.existsSync(audioPath)) {
    console.warn(`[WARN] 再生する音声ファイルが見つかりません、スキップします: ${audioPath}`);
    playNextAudio(currentPlayer, playQueue, guildId, isPlaying);
    return;
  }

  let volumeToApply: number;

  if (audioPath.startsWith(SOUNDS_DIR)) {
    volumeToApply = SOUND_EFFECT_VOLUME;
  } else {
    volumeToApply = DEFAULT_PLAYBACK_VOLUME;
  }

  try {
    const resource = createAudioResource(audioPath, { inlineVolume: true });
    resource.volume.setVolume(volumeToApply);
    currentPlayer.play(resource);
  } catch (error) {
    console.error(`[ERROR] 音声リソースの作成または再生に失敗しました (path: ${audioPath}):`, error);
    playNextAudio(currentPlayer, playQueue, guildId, isPlaying);
  }
}
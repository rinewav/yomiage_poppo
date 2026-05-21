import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createAudioPlayer, createAudioResource, AudioPlayerStatus, AudioPlayer, AudioResource, getVoiceConnection, NoSubscriberBehavior, StreamType, VoiceConnectionStatus } from '@discordjs/voice';
import { SynthesisItem, Segment } from './types';
import { DEFAULT_PLAYBACK_VOLUME, SOUND_EFFECT_VOLUME, SOUNDS_DIR } from './constants';
import { synthesizeMixedTTS } from './tts';
import { getCacheKey, readVoiceCache, updateVoiceCache } from './voiceCache';
import { segmentByLanguage, chunkTextByMorphs } from './utils';

const guildPlayers: Map<string, AudioPlayer> = new Map();

export function getGuildPlayer(guildId: string): AudioPlayer | undefined {
  return guildPlayers.get(guildId);
}

export function destroyGuildPlayer(guildId: string): void {
  const player = guildPlayers.get(guildId);
  if (!player) return;
  guildPlayers.delete(guildId);
  player.removeAllListeners(AudioPlayerStatus.Idle);
  player.removeAllListeners(AudioPlayerStatus.Buffering);
  player.removeAllListeners(AudioPlayerStatus.Playing);
  player.removeAllListeners(AudioPlayerStatus.Paused);
  player.removeAllListeners(AudioPlayerStatus.AutoPaused);
  player.removeAllListeners('error');
  try {
    player.stop(true);
  } catch (err) {
    console.warn(`[destroyGuildPlayer] stop() に失敗: ${(err as Error).message}`);
  }
}

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
  if (!getVoiceConnection(guildId)) return;
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
              const subSegments = chunk.trim().split(/([｡-ﾟ]+)/);
              for (const subSegment of subSegments) {
                if (!subSegment) continue;
                const isHankaku = /^[｡-ﾟ]+$/.test(subSegment);
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
    if (synthesisQueues.get(guildId) !== synthesisQueue) return;
    if (playQueues.get(guildId) !== playQueue) return;

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
          if (synthesisQueues.get(guildId) !== synthesisQueue || playQueues.get(guildId) !== playQueue) {
            if (fs.existsSync(tempPath)) {
              try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
            }
            return;
          }
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

  if (synthesisQueues.get(guildId) !== synthesisQueue) return;

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

  if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed || !playQueue || playQueue.length === 0) {
    isPlaying.set(guildId, false);
    return;
  }

  let player = guildPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    guildPlayers.set(guildId, player);
    connection.subscribe(player);

    const guildPlayerRef = player;

    player.on(AudioPlayerStatus.Idle, () => {
      if (guildPlayers.get(guildId) !== guildPlayerRef) return;
      const currentQueue = playQueues.get(guildId);
      if (!currentQueue || currentQueue.length === 0) {
        isPlaying.set(guildId, false);
      } else {
        playNextAudio(guildPlayerRef, currentQueue, guildId, playQueues, isPlaying);
      }
    });

    player.on('error', (error: Error) => {
      console.error(`AudioPlayer Error (guildId: ${guildId}):`, error.message);
      if (guildPlayers.get(guildId) !== guildPlayerRef) return;
      isPlaying.set(guildId, false);
      const currentQueue = playQueues.get(guildId);
      if (currentQueue && currentQueue.length > 0) {
        playNextAudio(guildPlayerRef, currentQueue, guildId, playQueues, isPlaying);
      }
    });
  }

  if (player.state.status === AudioPlayerStatus.Idle && playQueue.length > 0) {
    isPlaying.set(guildId, true);
    playNextAudio(player, playQueue, guildId, playQueues, isPlaying);
  } else if (player.state.status !== AudioPlayerStatus.Playing && player.state.status !== AudioPlayerStatus.Buffering && playQueue.length > 0) {
    isPlaying.set(guildId, true);
    playNextAudio(player, playQueue, guildId, playQueues, isPlaying);
  } else if (playQueue.length === 0) {
    isPlaying.set(guildId, false);
  }
}

function spawnFfmpegOpus(audioPath: string, volume: number) {
  const args = [
    '-hide_banner',
    '-analyzeduration', '0',
    '-loglevel', 'warning',
    '-i', audioPath,
    '-vn',
    '-filter:a', `volume=${volume},aresample=async=1:first_pts=0`,
    '-acodec', 'libopus',
    '-f', 'opus',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '96k',
    '-frame_duration', '20',
    '-application', 'voip',
    '-vbr', 'off',
    'pipe:1',
  ];
  return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function attachFfmpegLifecycle(ffmpeg: ChildProcess, resource: AudioResource, audioPath: string): void {
  let stderrBuf = '';
  ffmpeg.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });
  ffmpeg.on('error', (err) => {
    console.error(`[ffmpeg spawn error] path=${audioPath}:`, err.message);
  });
  ffmpeg.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.warn(`[ffmpeg exit] path=${audioPath} code=${code} signal=${signal} stderr=${stderrBuf.trim()}`);
    }
  });
  const killFfmpeg = () => {
    if (!ffmpeg.killed && ffmpeg.exitCode === null) {
      try { ffmpeg.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }
  };
  resource.playStream.once('end', killFfmpeg);
  resource.playStream.once('close', killFfmpeg);
  resource.playStream.once('error', killFfmpeg);
}

function playNextAudio(currentPlayer: AudioPlayer, playQueue: string[], guildId: string, playQueues: Map<string, string[]>, isPlaying: Map<string, boolean>): void {
  if (guildPlayers.get(guildId) !== currentPlayer) {
    return;
  }

  if (playQueues.get(guildId) !== playQueue) {
    return;
  }

  if (playQueue.length === 0) {
    isPlaying.set(guildId, false);
    return;
  }

  const connection = getVoiceConnection(guildId);
  if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
    isPlaying.set(guildId, false);
    return;
  }

  const audioPath = playQueue.shift()!;

  if (!fs.existsSync(audioPath)) {
    console.warn(`[WARN] 再生する音声ファイルが見つかりません、スキップします: ${audioPath}`);
    playNextAudio(currentPlayer, playQueue, guildId, playQueues, isPlaying);
    return;
  }

  let volumeToApply: number;

  if (audioPath.startsWith(SOUNDS_DIR)) {
    volumeToApply = SOUND_EFFECT_VOLUME;
  } else {
    volumeToApply = DEFAULT_PLAYBACK_VOLUME;
  }

  let ffmpeg: ReturnType<typeof spawnFfmpegOpus> | null = null;
  try {
    ffmpeg = spawnFfmpegOpus(audioPath, volumeToApply);
    if (!ffmpeg.stdout) {
      throw new Error('ffmpeg stdout is not available');
    }
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
    });
    attachFfmpegLifecycle(ffmpeg, resource, audioPath);
    currentPlayer.play(resource);
  } catch (error) {
    console.error(`[ERROR] 音声リソースの作成または再生に失敗しました (path: ${audioPath}):`, error);
    if (ffmpeg && !ffmpeg.killed) {
      try { ffmpeg.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }
    playNextAudio(currentPlayer, playQueue, guildId, playQueues, isPlaying);
  }
}

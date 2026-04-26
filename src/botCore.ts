import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActivityType, PresenceUpdateStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, VoiceChannel, StageChannel, ChatInputCommandInteraction } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import axios from 'axios';
import CustomEmbed from './CustomEmbed';
import { VoicevoxServer, VoiceCacheEntry, GuildSettings, SynthesisItem, Segment, BotConfig } from './types';
import { PROJECT_ROOT, HEALTH_CHECK_TIMEOUT_MS, SERVER_COOLDOWN_MS, VC_CONNECTION_TIMEOUT_MS, VC_RECONNECT_TIMEOUT_MS, DEFAULT_SPEAKER_ID, DICT_ITEMS_PER_PAGE, CACHE_ITEMS_PER_PAGE, COLLECTOR_TIMEOUT_MS, MAX_MESSAGE_LENGTH, HEALTH_CHECK_INTERVAL_MS, RELOAD_BUTTON_ID, RELOAD_MESSAGE, LEAVE_MESSAGE, PRESENCE_BUSY_TEXT, PRESENCE_IDLE_TEXT, DEFAULT_TTS_ENGINE, SPOILER_REPLACEMENT, CODE_REPLACEMENT, URL_REPLACEMENT, LAUGH_REPLACEMENT, MEDIA_LABEL, MENTION_REPLACEMENT, CHANNEL_MENTION_REPLACEMENT, EMOJI_REPLACEMENT, NOSPLIT_PATTERN, LISTENING_CHANNEL_PATTERN, SOUNDS_DIR, AUTO_JOIN_STAGGER_MS } from './constants';
import { normalizeText, escapeRegex, maskUrl, segmentByLanguage, chunkTextByMorphs, segmentTextWithEffects } from './utils';
import { getCacheKey, readVoiceCache, updateVoiceCache, initCacheFile } from './voiceCache';
import { synthesizeWithGoogleTTS, getVoicevoxAudio, synthesizeMixedTTS } from './tts';
import { readAloud, processSynthesisQueue, processPlayQueue } from './audioPlayer';
import { startCoordinatorServer, queryAllBots } from './botCoordinator';
import { initDashboard, getLogBuffer } from './dashboard';
import { loadSoundEffects, addSoundEffect, removeSoundEffect, listSoundEffects } from './soundEffects';

export async function createBot(config: BotConfig): Promise<Client> {
  if (config.envPath) {
    require('dotenv').config({ path: config.envPath });
  } else {
    require('dotenv').config();
  }

  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;

  if (!TOKEN) throw new Error('DISCORD_TOKEN is required but not set in environment.');
  if (!CLIENT_ID) throw new Error('CLIENT_ID is required but not set in environment.');
  if (!GUILD_ID) throw new Error('GUILD_ID is required but not set in environment.');

  const client = new Client({
    intents: config.intents as unknown as number[],
  });

  const VOICEVOX_URLS: string = process.env.VOICEVOX_URLS || 'http://localhost:50021';
  const VOICEVOX_SERVERS: VoicevoxServer[] = VOICEVOX_URLS.split(',').map((url: string) => ({
    url: url.trim(),
    healthy: true,
    lastErrorTime: 0,
  }));

  const TEMP_DIR: string = path.join(PROJECT_ROOT, 'temp');
  const SETTINGS_DIR: string = path.join(PROJECT_ROOT, 'guild_settings');
  const USERSPEAKER_DIR: string = path.join(PROJECT_ROOT, 'user_speakers');
  const VC_FILE: string = path.join(PROJECT_ROOT, `lastVoiceChannel_${config.vcFileSuffix}.json`);

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.mkdirSync(USERSPEAKER_DIR, { recursive: true });
  initCacheFile();

  if (!fs.existsSync(SOUNDS_DIR)) {
    try {
      fs.mkdirSync(SOUNDS_DIR, { recursive: true });
      console.log(`効果音ディレクトリを作成しました: ${SOUNDS_DIR}`);
      console.log(`このディレクトリに .wav などの音声ファイルを配置してください。`);
    } catch (err) {
      console.error(`効果音ディレクトリの作成に失敗しました (${SOUNDS_DIR}):`, err);
    }
  }

  let soundEffects = loadSoundEffects();

  for (const word in soundEffects) {
    if (!fs.existsSync(soundEffects[word])) {
      console.warn(`[注意] 効果音ファイルが見つかりません: 単語「${word}」 ${soundEffects[word]}`);
    }
  }

  let tokenizer: kuromoji.Tokenizer | null = null;

  const activeChannels: Map<string, any> = new Map();
  const synthesisQueues: Map<string, SynthesisItem[]> = new Map();
  const playQueues: Map<string, string[]> = new Map();
  const isSynthesizing: Map<string, boolean> = new Map();
  const isPlaying: Map<string, boolean> = new Map();

  let joining = false;

  const BOT_PORT = parseInt(process.env.BOT_PORT || '0');
  const BOT_PORTS: number[] = (process.env.BOT_PORTS || '').split(',').map(Number).filter(Boolean);

  if (BOT_PORT > 0) {
    startCoordinatorServer(BOT_PORT, () => ({
      botNumber: config.botNumber,
      busy: client.voice.adapters.size > 0,
      joining,
    }), getLogBuffer);
  }

  initDashboard(config.botNumber, BOT_PORTS, () => client.voice.adapters.size > 0);

  function updatePresence(): void {
    const connectionCount = client.voice.adapters.size;

    if (connectionCount > 0) {
      client.user!.setPresence({
        activities: [{ name: PRESENCE_BUSY_TEXT, type: ActivityType.Playing }],
        status: PresenceUpdateStatus.DoNotDisturb,
      });
      console.log('[Presence] ステータスを「使用中」に更新しました。');
    } else {
      client.user!.setPresence({
        activities: [{ name: PRESENCE_IDLE_TEXT, type: ActivityType.Playing }],
        status: PresenceUpdateStatus.Online,
      });
      console.log('[Presence] ステータスを「空き」に更新しました。');
    }
  }

  process.on('uncaughtException', async (error: Error) => {
    console.error(`[FATAL] 捕捉されなかった例外が発生しました:`, error);

    if (client && client.isReady()) {
      console.log('Discordクライアントを安全に破棄します...');
      await client.destroy();
      console.log('クライアントを破棄しました。');
    } else {
      console.log('クライアントが準備できていないため、破棄処理をスキップします。');
    }

    process.exit(1);
  });

  process.on('unhandledRejection', async (reason: unknown) => {
    console.error('[FATAL] ハンドルされなかったPromiseの拒否:', reason);

    if (client && client.isReady()) {
      console.log('Discordクライアントを安全に破棄します...');
      await client.destroy();
      console.log('クライアントを破棄しました。');
    } else {
      console.log('クライアントが準備できていないため、破棄処理をスキップします。');
    }

    process.exit(1);
  });

  async function checkServerHealth(): Promise<void> {
    console.log('[Health Check] VOICEVOXサーバーのヘルスチェックを開始します...');
    const now = Date.now();
    const channelId = config.healthCheckChannelId || process.env.HEALTH_CHECK_CHANNEL_ID;

    if (!channelId) {
      console.warn('[Health Check] HEALTH_CHECK_CHANNEL_ID が設定されていないため、Discord通知はスキップされます。');
    }

    let notificationChannel: any = null;
    if (channelId) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (ch && ch.isTextBased()) {
          notificationChannel = ch;
        } else {
          console.error(`[Health Check] 指定されたチャンネル(${channelId})が見つからないか、テキストチャンネルではありません。`);
          notificationChannel = null;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[Health Check] 通知チャンネルの取得に失敗しました: ${message}`);
        notificationChannel = null;
      }
    }

    for (const server of VOICEVOX_SERVERS) {
      const maskedUrl = maskUrl(server.url);

      if (server.healthy || now - server.lastErrorTime > SERVER_COOLDOWN_MS) {
        try {
          await axios.get(`${server.url}/version`, { timeout: HEALTH_CHECK_TIMEOUT_MS });

          if (!server.healthy) {
            console.log(`[Health Check] ✅ サーバーが復旧しました: ${server.url}`);
            server.healthy = true;

            if (notificationChannel) {
              const embed = new CustomEmbed(client.user!)
                .setTitle('✅ サーバー復旧')
                .setDescription(`VOICEVOXサーバーがオンラインに復旧しました。`)
                .addFields({ name: 'サーバー', value: `\`${maskedUrl}\`` })
                .setColor('#00FF00');
              await notificationChannel.send({ embeds: [embed] });
            }
          } else {
            console.log(`[Health Check] ✅ サーバーは正常です: ${server.url}`);
          }
        } catch (error: unknown) {
          const errMessage = error instanceof Error ? error.message : String(error);
          if (server.healthy) {
            console.warn(`[Health Check] ❌ サーバーが応答しません: ${server.url} (エラー: ${errMessage})`);
            server.healthy = false;
            server.lastErrorTime = now;

            if (notificationChannel) {
              const embed = new CustomEmbed(client.user!)
                .setTitle('❌ サーバーダウン')
                .setDescription(`VOICEVOXサーバーが応答しません。ローテーションから一時的に除外します。`)
                .addFields(
                  { name: 'サーバー', value: `\`${maskedUrl}\`` },
                  { name: 'エラー', value: `\`${errMessage}\`` }
                )
                .setColor('#FF0000');
              await notificationChannel.send({ embeds: [embed] });
            }
          } else {
            console.warn(`[Health Check] ❌ サーバーは引き続き応答しません: ${server.url}`);
            server.lastErrorTime = now;
          }
        }
      } else {
        console.log(`[Health Check] ⏸️ サーバーはクールダウン中です（スキップ）: ${server.url}`);
      }
    }
  }

  async function connectToVC(guildId: string, channelId: string): Promise<any> {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      console.error('指定されたギルドが見つかりません。');
      return null;
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      console.error('指定されたチャンネルが見つかりません。');
      return null;
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, VC_CONNECTION_TIMEOUT_MS);
    return connection;
  }

  function saveLastVC(guildId: string, voiceChannelId: string, textChannelId: string): void {
    fs.writeFileSync(VC_FILE, JSON.stringify({ guildId, voiceChannelId, textChannelId }), 'utf8');
  }

  function loadLastVC(): { guildId: string; voiceChannelId: string; textChannelId: string } | null {
    if (fs.existsSync(VC_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(VC_FILE, 'utf8'));
        return { guildId: data.guildId, voiceChannelId: data.voiceChannelId || data.channelId, textChannelId: data.textChannelId };
      } catch (_) { return null; }
    }
    return null;
  }

  function loadGuildSettings(guildId: string): GuildSettings {
    const settingsPath = path.join(SETTINGS_DIR, `${guildId}.json`);
    const defaults: GuildSettings = { dictionary: {}, channelId: null, noSplitWords: [], ttsEngine: DEFAULT_TTS_ENGINE };
    if (fs.existsSync(settingsPath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        return { ...defaults, ...loaded };
      } catch (e) {
        console.error(`Failed to load settings for guild ${guildId}:`, e);
      }
    }
    return defaults;
  }

  function saveGuildSettings(guildId: string, settings: GuildSettings): void {
    const settingsPath = path.join(SETTINGS_DIR, `${guildId}.json`);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  function cleanupGuildState(guildId: string): void {
    synthesisQueues.delete(guildId);
    playQueues.delete(guildId);
    isSynthesizing.delete(guildId);
    isPlaying.delete(guildId);
    activeChannels.delete(guildId);
  }

  function cleanupVCFile(guildId: string): void {
    if (fs.existsSync(VC_FILE)) {
      try {
        const lastVCData = JSON.parse(fs.readFileSync(VC_FILE, 'utf8'));
        if (lastVCData.guildId === guildId) {
          fs.unlinkSync(VC_FILE);
          console.log(`[Leave] Removed ${VC_FILE} as bot left guild ${guildId}`);
        }
      } catch (e) {
        console.error(`[Leave] Error processing ${VC_FILE}:`, e);
      }
    }
  }

  function stopPlayer(guildId: string): void {
    const connection = getVoiceConnection(guildId);
    if (connection) {
      const subscription = (connection.state as any).subscription;
      if (subscription?.player) {
        subscription.player.stop(true);
      }
    }
  }

  const reloadButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RELOAD_BUTTON_ID)
      .setLabel('ボットを再起動（読み上げが不調なときに使用してください）')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛑')
  );

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId === RELOAD_BUTTON_ID) {
        await interaction.reply({ content: RELOAD_MESSAGE, ephemeral: true });
        console.log('再起動ボタンが押されました。クライアントを安全に破棄します...');
        await client.destroy();
        console.log('クライアントを破棄しました。プロセスを終了します。');
        process.exit(0);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;
    const { commandName, user } = interaction;
    const guildId = interaction.guildId!;

    const userSpeakerFile = path.join(USERSPEAKER_DIR, `${user.id}.json`);
    const settings = loadGuildSettings(guildId);

    if (commandName === 'join') {
      const member = interaction.member;
      if (!member || !('voice' in member) || !(member as any).voice?.channel) {
        return interaction.reply('VCに入ってから実行してください。');
      }

      const voiceChannel = (member as any).voice.channel;
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, VC_RECONNECT_TIMEOUT_MS),
            entersState(connection, VoiceConnectionStatus.Connecting, VC_RECONNECT_TIMEOUT_MS),
          ]);
          console.log(`[VC Status] Guild ${guildId}: Connection is attempting to reconnect.`);
        } catch {
          console.warn(`[VC Status] Guild ${guildId}: Connection permanently disconnected. Destroying and cleaning up.`);
          if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
          }
          cleanupGuildState(guildId);
        }
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
        console.log(`[VC Status] Guild ${guildId}: Connection destroyed. Cleaning up.`);
        cleanupGuildState(guildId);
        updatePresence();
      });

      isPlaying.set(guildId, false);
      synthesisQueues.set(guildId, []);
      playQueues.set(guildId, []);
      updatePresence();

      const joinEmbed = new CustomEmbed(client.user)
        .setColor('#00FFFF')
        .setDescription(`**<@${client.user!.id}>** が参加しました`);

      await interaction.reply({ embeds: [joinEmbed], components: [reloadButtonRow] });
      activeChannels.set(guildId, interaction.channel);
      settings.channelId = interaction.channel!.id;
      saveGuildSettings(guildId, settings);
      await readAloud(interaction.guild.id, [{ type: 'text' as const, content: 'よみあげぽっぽが参加しました' }], client.user!.id, [], settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);
      saveLastVC(guildId, voiceChannel.id, interaction.channel!.id);
    }

    if (commandName === 'leave') {
      const connection = getVoiceConnection(guildId);
      if (connection) {
        stopPlayer(guildId);

        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }

        cleanupGuildState(guildId);
        cleanupVCFile(guildId);

        await interaction.reply(LEAVE_MESSAGE);
        updatePresence();
      }
      activeChannels.delete(guildId);
    }

    if (commandName === 'voice') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const id = interaction.options.getInteger('id');
      if (id === null) {
        return interaction.reply({ content: 'スピーカーIDを指定してください。', ephemeral: true });
      }
      fs.writeFileSync(userSpeakerFile, JSON.stringify({ speakerId: id }));
      await interaction.reply(`📢あなたのスピーカーIDを ${id} に設定しました。`);
    }

    if (commandName === 'setdict') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      let word = interaction.options.getString('word')?.trim();
      const kana = interaction.options.getString('kana')?.trim();

      const emojiRegex = /<a?:(.+?):\d+>/;
      const emojiMatch = word?.match(emojiRegex);
      if (emojiMatch) {
        word = `:${emojiMatch[1]}:`;
      }

      if (!word) {
        return interaction.reply({ content: '単語を入力してください。', ephemeral: true });
      }

      if (kana) {
        settings.dictionary[word] = kana;
        saveGuildSettings(guildId, settings);
        await interaction.reply(`📕辞書を更新しました: 「${word}」は「${kana}」と読み上げます。`);
      } else {
        settings.dictionary[word] = '';
        saveGuildSettings(guildId, settings);
        await interaction.reply(`📗辞書を更新しました: 今後「${word}」は読み上げ時に無視されます。`);
      }
    }

    if (commandName === 'deldict') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const word = interaction.options.getString('word');
      delete settings.dictionary[word!];
      saveGuildSettings(guildId, settings);
      await interaction.reply(`📘辞書から「${word}」を削除しました。`);
    }

    if (commandName === 'addnosplit') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const word = interaction.options.getString('word')?.trim();
      if (!word) {
        return interaction.reply({ content: '分割しない単語を入力してください。', ephemeral: true });
      }
      if (!settings.noSplitWords.includes(word)) {
        settings.noSplitWords.push(word);
        saveGuildSettings(guildId, settings);
        await interaction.reply(`📙分割禁止リストに「${word}」を追加しました。`);
      } else {
        await interaction.reply({ content: `「${word}」はすでにリストに登録されています。`, ephemeral: true });
      }
    }

    if (commandName === 'delnosplit') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const word = interaction.options.getString('word')?.trim();
      if (!word) {
        return interaction.reply({ content: '削除する単語を入力してください。', ephemeral: true });
      }
      const index = settings.noSplitWords.indexOf(word);
      if (index > -1) {
        settings.noSplitWords.splice(index, 1);
        saveGuildSettings(guildId, settings);
        await interaction.reply(`📗分割禁止リストから「${word}」を削除しました。`);
      } else {
        await interaction.reply({ content: `「${word}」はリストに見つかりませんでした。`, ephemeral: true });
      }
    }

    if (commandName === 'reload') {
      await interaction.reply(RELOAD_MESSAGE);
      console.log('再起動コマンドを受け付けました。クライアントを安全に破棄します...');
      await client.destroy();
      console.log('クライアントを破棄しました。プロセスを終了します。');
      process.exit(0);
    }

    if (commandName === 'listdict') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      let dictionaryEntries: [string, string][] = Object.entries(settings.dictionary);

      if (dictionaryEntries.length === 0) {
        return interaction.reply({ content: '現在、辞書に登録されている単語はありません。', ephemeral: true });
      }

      let totalPages = Math.ceil(dictionaryEntries.length / DICT_ITEMS_PER_PAGE);
      let currentPage = 0;
      let currentSelection: string | null = null;

      const generateComponents = (page: number, selection: string | null) => {
        const startIndex = page * DICT_ITEMS_PER_PAGE;
        const currentItems = dictionaryEntries.slice(startIndex, startIndex + DICT_ITEMS_PER_PAGE);

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('delete_dict_select')
          .setPlaceholder('削除する単語を選択...')
          .addOptions(
            currentItems.map(([word, reading]) => ({
              label: word.length > 90 ? word.substring(0, 90) + '...' : word,
              description: `読み: ${reading || '(無視)'}`.substring(0, 90),
              value: word,
            }))
          );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('prev_page').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('next_page').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
          new ButtonBuilder().setCustomId('delete_dict_button').setLabel('🗑️ 選択した項目を削除').setStyle(ButtonStyle.Danger).setDisabled(!selection)
        );

        return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu), buttons];
      };

      const generateEmbed = (page: number) => {
        totalPages = Math.ceil(dictionaryEntries.length / DICT_ITEMS_PER_PAGE);
        currentPage = Math.min(page, totalPages - 1);
        if (currentPage < 0) currentPage = 0;

        const embed = new CustomEmbed(interaction.user)
          .setTitle('📖 登録辞書一覧')
          .setDescription(`**${dictionaryEntries.length}件**の単語が登録されています。`)
          .setFooter({ text: `ページ ${currentPage + 1} / ${totalPages}` });

        const startIndex = currentPage * DICT_ITEMS_PER_PAGE;
        const currentItems = dictionaryEntries.slice(startIndex, startIndex + DICT_ITEMS_PER_PAGE);
        const fields = currentItems.map(([word, reading]) => ({
          name: `\`${word}\``,
          value: `↳ \`${reading === '' ? '（無視）' : reading}\``,
          inline: true,
        }));
        if (fields.length > 0) embed.addFields(fields);
        return embed;
      };

      const reply = await interaction.reply({
        embeds: [generateEmbed(currentPage)],
        components: generateComponents(currentPage, currentSelection),
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });

      collector.on('collect', async (i) => {
        if (i.isStringSelectMenu()) {
          currentSelection = i.values[0];
        } else if (i.isButton()) {
          if (i.customId === 'prev_page') currentPage--;
          else if (i.customId === 'next_page') currentPage++;
          else if (i.customId === 'delete_dict_button' && currentSelection) {
            delete settings.dictionary[currentSelection];
            saveGuildSettings(guildId, settings);
            dictionaryEntries = Object.entries(settings.dictionary);
            currentSelection = null;
          }
        }
        await i.update({ embeds: [generateEmbed(currentPage)], components: generateComponents(currentPage, currentSelection) });
      });

      collector.on('end', () => {
        reply.edit({ embeds: [generateEmbed(currentPage)], components: [] }).catch(() => {});
      });
    }

    if (commandName === 'searchcache') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const query = interaction.options.getString('query');

      let searchResults: [string, VoiceCacheEntry][] = Object.entries(readVoiceCache()).filter(
        ([, value]) => value.text && value.text.includes(query!)
      );

      if (searchResults.length === 0) {
        return interaction.reply({ content: `「${query}」を含むキャッシュは見つかりませんでした。`, flags: 64 });
      }

      let totalPages = Math.ceil(searchResults.length / CACHE_ITEMS_PER_PAGE);
      let currentPage = 0;
      let currentSelection: string | null = null;

      const generateComponents = (page: number, selection: string | null) => {
        const startIndex = page * CACHE_ITEMS_PER_PAGE;
        const currentItems = searchResults.slice(startIndex, startIndex + CACHE_ITEMS_PER_PAGE);
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('delete_cache_select')
          .setPlaceholder('削除するキャッシュを選択...')
          .addOptions(
            currentItems.map(([key, value]) => ({
              label: `"${value.text}" (ID: ${value.speakerId})`.substring(0, 100),
              description: `キー: ${key}`.substring(0, 100),
              value: key,
            }))
          );
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('prev_page').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('next_page').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
          new ButtonBuilder().setCustomId('delete_cache_button').setLabel('🗑️ 選択した項目を削除').setStyle(ButtonStyle.Danger).setDisabled(!selection)
        );
        return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu), buttons];
      };

      const generateEmbed = (page: number) => {
        totalPages = Math.ceil(searchResults.length / CACHE_ITEMS_PER_PAGE);
        currentPage = Math.min(page, totalPages - 1);
        if (currentPage < 0) currentPage = 0;
        const embed = new CustomEmbed(interaction.user)
          .setTitle(`🔍 キャッシュ検索結果: "${query}"`)
          .setDescription(`**${searchResults.length}件**のキャッシュが見つかりました。`)
          .setFooter({ text: `ページ ${currentPage + 1} / ${totalPages}` });
        const startIndex = currentPage * CACHE_ITEMS_PER_PAGE;
        const currentItems = searchResults.slice(startIndex, startIndex + CACHE_ITEMS_PER_PAGE);
        const fields = currentItems.map(([key, value]) => ({
          name: `💬 テキスト: \`${value.text}\``,
          value: `**ID:** \`${value.speakerId}\`\n**キー:** \`${key}\`\n**ファイル:** \`${path.basename(value.filePath)}\``,
          inline: false,
        }));
        if (fields.length > 0) embed.addFields(fields);
        return embed;
      };

      const reply = await interaction.reply({
        embeds: [generateEmbed(currentPage)],
        components: generateComponents(currentPage, currentSelection),
        fetchReply: true,
        ephemeral: true,
      });

      const collector = reply.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: COLLECTOR_TIMEOUT_MS });

      collector.on('collect', async (i) => {
        if (i.isStringSelectMenu()) {
          currentSelection = i.values[0];
        } else if (i.isButton()) {
          if (i.customId === 'prev_page') currentPage--;
          else if (i.customId === 'next_page') currentPage++;
          else if (i.customId === 'delete_cache_button' && currentSelection) {
            const currentCacheRefreshed = readVoiceCache();
            const entryToDelete = currentCacheRefreshed[currentSelection];

            if (entryToDelete) {
              if (fs.existsSync(entryToDelete.filePath)) {
                try {
                  fs.unlinkSync(entryToDelete.filePath);
                  console.log(`キャッシュファイルを削除しました: ${entryToDelete.filePath}`);
                } catch (err) {
                  console.error(`ファイルの削除に失敗しました: ${entryToDelete.filePath}`, err);
                }
              }

              updateVoiceCache((cache) => {
                delete cache[currentSelection!];
              });

              searchResults = Object.entries(readVoiceCache()).filter(
                ([, value]) => value.text && value.text.includes(query!)
              );
              currentSelection = null;
            }
          }
        }
        await i.update({ embeds: [generateEmbed(currentPage)], components: generateComponents(currentPage, currentSelection) });
      });

      collector.on('end', () => {
        reply.edit({ embeds: [generateEmbed(currentPage)], components: [] }).catch(() => {});
      });
    }

    if (commandName === 'toggletts') {
      if (config.botNumber !== 1) return interaction.reply({ content: 'このコマンドは1号機でのみ使用できます。', ephemeral: true });
      const currentMode = settings.ttsEngine || DEFAULT_TTS_ENGINE;
      const newMode = currentMode === 'hybrid' ? 'google' : 'hybrid';

      settings.ttsEngine = newMode;
      saveGuildSettings(guildId, settings);

      const replyMessage =
        newMode === 'google'
          ? '✅ 日本語も含む全ての読み上げを **Google TTS** で行うように設定しました。（調子が悪いときだけつかってね、、）'
          : '✅ 日本語の読み上げを **Voicevox** で行うように設定しました。（デフォルト）';

      await interaction.reply({ content: replyMessage });
    }

    if (commandName === 'addsound') {
      if (config.botNumber !== 1) return;
      const keyword = interaction.options.getString('keyword', true);
      const file = interaction.options.getString('file', true);
      const result = addSoundEffect(keyword, file);
      if (result.success) {
        soundEffects = loadSoundEffects();
      }
      await interaction.reply({ content: result.message, ephemeral: true });
    }

    if (commandName === 'delsound') {
      if (config.botNumber !== 1) return;
      const keyword = interaction.options.getString('keyword', true);
      const result = removeSoundEffect(keyword);
      if (result.success) {
        soundEffects = loadSoundEffects();
      }
      await interaction.reply({ content: result.message, ephemeral: true });
    }

    if (commandName === 'listsounds') {
      if (config.botNumber !== 1) return;
      const entries = listSoundEffects();
      if (entries.length === 0) {
        await interaction.reply({ content: '効果音は登録されていません。', ephemeral: true });
        return;
      }
      const lines = entries.map((e, i) => `\`${i + 1}.\` 「${e.keyword}」→ \`${e.file}\``);
      await interaction.reply({ content: `**効果音一覧**\n${lines.join('\n')}`, ephemeral: true });
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const activeTextChannel = activeChannels.get(message.guild.id);
    if (!activeTextChannel || message.channel.id !== activeTextChannel.id) return;

    const connection = getVoiceConnection(message.guild.id);
    if (!connection) return;

    const settings = loadGuildSettings(message.guild.id);

    let content = message.content;

    content = normalizeText(content);

    content = content.replace(/\|\|.*?\|\|/gs, SPOILER_REPLACEMENT);
    content = content.replace(/```[\s\S]*?```/g, CODE_REPLACEMENT);
    content = content.replace(/`[^`\n]+?`/g, CODE_REPLACEMENT);
    content = content.replace(/https?:\/\/\S+/g, URL_REPLACEMENT);

    content = content
      .replace(/<@!?(\d+)>/g, (m: string, id: string) => {
        const user = message.guild!.members.cache.get(id);
        return user ? `${user.displayName}への${MENTION_REPLACEMENT}` : MENTION_REPLACEMENT;
      })
      .replace(/<#(\d+)>/g, (match: string, channelId: string) => {
        const mentionedChannel = message.guild!.channels.cache.get(channelId);
        return mentionedChannel ? `${mentionedChannel.name}${CHANNEL_MENTION_REPLACEMENT}` : CHANNEL_MENTION_REPLACEMENT;
      })
      .replace(/<a?:(.+?):\d+>/g, (match: string, emojiName: string) => (emojiName ? `:${emojiName}:` : EMOJI_REPLACEMENT));

    if (settings.dictionary && Object.keys(settings.dictionary).length > 0) {
      const dictionaryKeys = Object.keys(settings.dictionary).sort((a, b) => b.length - a.length);
      const escapedKeys = dictionaryKeys.map((key) => escapeRegex(key));
      const dictionaryRegex = new RegExp(escapedKeys.join('|'), 'g');
      content = content.replace(dictionaryRegex, (matchedKey: string) => {
        return settings.dictionary[matchedKey];
      });
    }

    content = content.replace(/(w|ｗ){3,}/gi, LAUGH_REPLACEMENT).replace(/\？{2,}/g, '？');

    let baseTextToProcess = content.trim();

    if (message.attachments.size > 0) {
      let hasMediaAttachment = false;
      for (const attachment of message.attachments.values()) {
        const contentType = attachment.contentType;
        if (contentType?.startsWith('image/') || contentType?.startsWith('video/') || contentType?.startsWith('audio/')) {
          hasMediaAttachment = true;
          break;
        }
      }
      if (hasMediaAttachment) {
        baseTextToProcess = baseTextToProcess ? `${baseTextToProcess} ${MEDIA_LABEL}` : MEDIA_LABEL;
      }
    }
    if (message.stickers.size > 0) {
      const stickerNames = message.stickers.map((sticker) => `${sticker.name}`).join('、');
      baseTextToProcess = baseTextToProcess ? `${baseTextToProcess} ${stickerNames}` : stickerNames;
    }

    baseTextToProcess = baseTextToProcess.slice(0, MAX_MESSAGE_LENGTH);

    const segments: Segment[] = segmentTextWithEffects(baseTextToProcess, soundEffects, fs);

    const hasValidContent = segments.some(
      (seg) => (seg.type === 'text' && seg.content?.trim() !== '') || seg.type === 'sound'
    );

    if (!hasValidContent) {
      return;
    }
    await readAloud(message.guild.id, segments, message.author.id, settings.noSplitWords, settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const guildId = newState.guild.id;
    const connection = getVoiceConnection(guildId);

    if (!connection) return;

    const settings = loadGuildSettings(guildId);

    const botChannelId = connection.joinConfig.channelId;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (newChannelId === botChannelId && oldChannelId !== botChannelId && !newState.member!.user.bot) {
      const username = newState.member!.displayName;
      const message = `${username}が参加しました`;
      await readAloud(guildId, [{ type: 'text' as const, content: message }], newState.member!.id, [], settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);
    }

    if (oldChannelId === botChannelId && newChannelId !== botChannelId && !oldState.member!.user.bot) {
      const username = oldState.member!.displayName;
      const message = `${username}が退出しました`;
      await readAloud(guildId, [{ type: 'text' as const, content: message }], oldState.member!.id, [], settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);
    }

    const channel = newState.guild.channels.cache.get(botChannelId!);

    if (channel && (channel instanceof VoiceChannel || channel instanceof StageChannel)) {
      const membersCount = channel.members.filter((member) => !member.user.bot).size;

      if (membersCount === 0) {
        console.log(`[Auto Leave] Guild ${guildId}: VCが空になったため、自動退出します。`);

        stopPlayer(guildId);

        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          connection.destroy();
        }

        cleanupGuildState(guildId);
        cleanupVCFile(guildId);
      }
    }
  });

  client.on('channelCreate', async (channel) => {
    if (!('isTextBased' in channel) || typeof (channel as any).isTextBased !== 'function' || !(channel as any).isTextBased()) {
      return;
    }

    const namePattern = LISTENING_CHANNEL_PATTERN;
    const match = channel.name.match(namePattern);

    if (!match) return;

    const voiceChannelId = match[1];
    const guild = channel.guild;

    const existingConnection = getVoiceConnection(guild.id);
    if (existingConnection || joining) {
      console.log(`[Auto Join] スキップ: 既にVCに参加中または参加処理中のため、自動参加しません。`);
      return;
    }

    joining = true;

    try {
      if (BOT_PORTS.length > 0 && BOT_PORT > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.botNumber * AUTO_JOIN_STAGGER_MS));

        const otherStatuses = await queryAllBots(BOT_PORTS, BOT_PORT);
        const lowerJoining = otherStatuses.some(
          (s) => s.joining && s.botNumber < config.botNumber
        );

        if (lowerJoining) {
          console.log(`[Auto Join] スキップ: より低い号機が参加中のため (${config.botNumber}号機は待機)。`);
          return;
        }

        const lowerFree = otherStatuses.some(
          (s) => !s.busy && !s.joining && s.botNumber < config.botNumber
        );

        if (lowerFree) {
          await new Promise((resolve) => setTimeout(resolve, AUTO_JOIN_STAGGER_MS * 2));
          const recheck = await queryAllBots(BOT_PORTS, BOT_PORT);
          const lowerJoiningNow = recheck.some(
            (s) => s.joining && s.botNumber < config.botNumber
          );
          if (lowerJoiningNow) {
            console.log(`[Auto Join] スキップ: 再確認で低い号機の参加を検出 (${config.botNumber}号機は待機)。`);
            return;
          }
        }
      }

      console.log(`[Auto Join] ${config.botNumber}号機が当選しました。聞き専チャンネル(${channel.name})のVC(${voiceChannelId})に参加します。`);

      const voiceChannel = await guild.channels.fetch(voiceChannelId);
      if (!voiceChannel || !(voiceChannel instanceof VoiceChannel) && !(voiceChannel instanceof StageChannel)) {
        console.error(`[Auto Join] 対象のボイスチャンネル(${voiceChannelId})が見つからないか、音声チャンネルではありません。`);
        return;
      }

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, VC_CONNECTION_TIMEOUT_MS);

      synthesisQueues.set(guild.id, []);
      playQueues.set(guild.id, []);
      isPlaying.set(guild.id, false);

      connection.on(VoiceConnectionStatus.Destroyed, () => {
        console.log(`[VC Status] Guild ${guild.id}: Connection destroyed. Cleaning up.`);
        cleanupGuildState(guild.id);
        updatePresence();
      });

      activeChannels.set(guild.id, channel);

      updatePresence();

      const settings = loadGuildSettings(guild.id);
      settings.channelId = channel.id;
      saveGuildSettings(guild.id, settings);
      saveLastVC(guild.id, voiceChannel.id, channel.id);

      await readAloud(guild.id, [{ type: 'text' as const, content: 'よみあげぽっぽが参加しました' }], client.user!.id, [], settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);

      console.log(`[Auto Join] ${voiceChannel.name}への参加と、${channel.name}の読み上げ設定が完了しました。`);

      const autoJoinEmbed = new CustomEmbed(client.user)
        .setColor('#00FFFF')
        .setDescription(`**<@${client.user!.id}>** が参加しました`);

      await (channel as any).send('`空のボイスチャットを検知したため、自動で参加処理を行いました。`');
      await (channel as any).send({ embeds: [autoJoinEmbed], components: [reloadButtonRow] });
    } catch (error) {
      console.error('[Auto Join] 自動参加処理中にエラーが発生しました:', error);
    } finally {
      joining = false;
    }
  });

  const basicCommands = [
    new SlashCommandBuilder().setName('join').setDescription('VCに参加'),
    new SlashCommandBuilder().setName('leave').setDescription('VCから退出'),
    new SlashCommandBuilder().setName('reload').setDescription('【⚠️】ボットを再起動します'),
  ];

  const fullCommands = [
    ...basicCommands,
    new SlashCommandBuilder()
      .setName('voice')
      .setDescription('あなた専用のスピーカーIDを設定')
      .addIntegerOption((o) => o.setName('id').setDescription('スピーカーID').setRequired(true).setMinValue(0).setMaxValue(50)),
    new SlashCommandBuilder()
      .setName('setdict')
      .setDescription('辞書に単語を追加または削除')
      .addStringOption((o) => o.setName('word').setDescription('登録する単語').setRequired(true))
      .addStringOption((o) => o.setName('kana').setDescription('読み（空白で送信すると単語を削除）').setRequired(false)),
    new SlashCommandBuilder()
      .setName('deldict')
      .setDescription('辞書から単語を削除')
      .addStringOption((o) => o.setName('word').setDescription('削除する単語').setRequired(true)),
    new SlashCommandBuilder()
      .setName('addnosplit')
      .setDescription('形態素解析で分割しない単語を追加')
      .addStringOption((o) => o.setName('word').setDescription('分割させない単語').setRequired(true)),
    new SlashCommandBuilder()
      .setName('delnosplit')
      .setDescription('分割禁止リストから単語を削除')
      .addStringOption((o) => o.setName('word').setDescription('削除する単語').setRequired(true)),
    new SlashCommandBuilder().setName('listdict').setDescription('登録されている辞書の一覧を表示します'),
    new SlashCommandBuilder()
      .setName('searchcache')
      .setDescription('音声キャッシュを文字列で検索します')
      .addStringOption((o) => o.setName('query').setDescription('検索したい文字列').setRequired(true)),
    new SlashCommandBuilder().setName('toggletts').setDescription('読み上げエンジンを切り替えます (Voicevox ↔ Google TTS)'),
    new SlashCommandBuilder()
      .setName('addsound')
      .setDescription('効果音を追加します')
      .addStringOption((o) => o.setName('keyword').setDescription('トリガーとなるキーワード').setRequired(true))
      .addStringOption((o) => o.setName('file').setDescription('sounds/ 内のファイル名（例: test.wav）').setRequired(true)),
    new SlashCommandBuilder()
      .setName('delsound')
      .setDescription('効果音を削除します')
      .addStringOption((o) => o.setName('keyword').setDescription('削除するキーワード').setRequired(true)),
    new SlashCommandBuilder().setName('listsounds').setDescription('登録されている効果音の一覧を表示します'),
  ];

  const commands = (config.botNumber === 1 ? fullCommands : basicCommands).map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('スラッシュコマンドを登録しました');

  client.once('clientReady', async () => {
    console.log('形態素解析器を初期化しています... (初回は時間がかかる場合があります)');
    try {
      tokenizer = await new Promise<kuromoji.Tokenizer>((resolve, reject) => {
        kuromoji.builder({ dicPath: path.join(PROJECT_ROOT, 'node_modules', 'kuromoji', 'dict') }).build((err: Error | null, t: kuromoji.Tokenizer) => {
          if (err) return reject(err);
          resolve(t);
        });
      });
      console.log('形態素解析器の準備が完了しました。');
    } catch (err) {
      console.error('形態素解析器の初期化に失敗しました:', err);
    }

    try {
      await checkServerHealth();
    } catch (e) {
      console.error('起動時のヘルスチェックに失敗しました。', e);
    }

    setInterval(() => checkServerHealth(), HEALTH_CHECK_INTERVAL_MS);

    console.log(`${client.user!.tag} でログインしました！`);
    updatePresence();
    const lastVC = loadLastVC();
    if (lastVC) {
      const { guildId: lastGuildId, voiceChannelId: lastVoiceChannelId, textChannelId: lastTextChannelId } = lastVC;
      try {
        const connection = await connectToVC(lastGuildId, lastVoiceChannelId);
        if (connection) {
          console.log(`前回のVC (${lastVoiceChannelId}) に再接続しました。`);

          synthesisQueues.set(lastGuildId, []);
          playQueues.set(lastGuildId, []);
          isPlaying.set(lastGuildId, false);

          connection.on(VoiceConnectionStatus.Destroyed, () => {
            console.log(`[VC Status] Guild ${lastGuildId}: Connection destroyed. Cleaning up.`);
            cleanupGuildState(lastGuildId);
            updatePresence();
          });

          const settings = loadGuildSettings(lastGuildId);
          if (lastTextChannelId) {
            settings.channelId = lastTextChannelId;
            saveGuildSettings(lastGuildId, settings);
          }
          await readAloud(lastGuildId, [{ type: 'text' as const, content: 'よみあげぽっぽが正常に再接続しました' }], client.user!.id, [], settings.ttsEngine, USERSPEAKER_DIR, tokenizer, synthesisQueues, playQueues, isSynthesizing, isPlaying, TEMP_DIR, VOICEVOX_SERVERS);

          const guild = await client.guilds.fetch(lastGuildId);
          const textChannelId = lastTextChannelId || settings.channelId;
          if (textChannelId) {
            const textChannel = await guild.channels.fetch(textChannelId);
            if (textChannel && textChannel.isTextBased()) {
              activeChannels.set(lastGuildId, textChannel);
              console.log(`テキストチャンネル ${textChannel.name} で読み上げを再開します。`);
              const reconnectEmbed = new CustomEmbed(client.user)
                .setColor('#00FFFF')
                .setDescription(`**<@${client.user!.id}>** が再接続しました`);

              await (textChannel as any).send({ embeds: [reconnectEmbed], components: [reloadButtonRow] });
            }
          }
          updatePresence();
        }
      } catch (err) {
        console.error('VC再接続に失敗しました:', err);
        updatePresence();
      }
    } else {
      updatePresence();
    }
  });

  await client.login(TOKEN);
  return client;
}
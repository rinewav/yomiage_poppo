# AGENTS.md — yomiagepoppo

Discord TTS bot fleet (5 instances). Reads channel messages aloud in voice channels using VOICEVOX (Japanese) and Google Cloud TTS (non-Japanese/fallback).

## Commands

```bash
npm run start            # 1号機 via tsx (TUI dashboard)
npm run start:2gou       # 2号機 via tsx (also :3gou, :4gou, :5gou)
npm run start:all        # All 5 bots via tsx + central dashboard monitor
npm run build            # tsc → dist/
npm run start:all:compiled  # All 5 bots from dist/ + central dashboard
npm run start:dashboard  # Central dashboard monitor only (bots must be running)
npm run generate-cache   # Pre-cache voice files from cache_list.txt (reads VOICEVOX_URLS from .env; 1st URL primary, 2nd fallback)
```

No lint, typecheck, or test commands are configured.

## Architecture

- **Fleet of 5 bots** (1–5号機). Each has its own entry point (`src/index.ts`, `src/index2gou.ts`, … `index5gou.ts`) and `.env` file (`.env`, `2gou.env`, … `5gou.env`).
- **All logic lives in `src/botCore.ts`** — entry points only pass a `BotConfig` (bot number, env path, vcFileSuffix, intents).
- `src/audioPlayer.ts` — synthesis + playback queues per guild
- `src/tts.ts` — VOICEVOX and Google Cloud TTS integration
- `src/voiceCache.ts` — shared voice cache (`voice_cache.json`); in-memory copy refreshed on mtime change, async lock + atomic writes (multiple bots write the same file)
- `src/voicevoxSpeakers.ts` — fetches `GET /speakers` from VOICEVOX and backs the `/voice` autocomplete (refreshed on every health check)
- `src/utils.ts` — text normalization, morphological chunking (kuromoji), language segmentation
- `src/constants.ts` — all tunables
- `src/soundEffects.ts` — loads/manages sound effects from `sound_effects.json` (keyword → `sounds/<file>`). Users can add/remove at runtime via bot commands.
- `src/botCoordinator.ts` — HTTP-based inter-bot coordination for auto-join (each bot exposes `GET /status` and `GET /logs`)
- `src/dashboard.ts` — TUI dashboard for individual bot runs; `src/dashboardMonitor.ts` — central fleet monitor
- `src/types/` — ambient type declarations for `franc`, `kuromoji`, `prism-media` (no `@types` packages)

## Required environment

Each `.env` needs: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.
Shared across bots: `VOICEVOX_URLS` (comma-separated), `GOOGLE_APPLICATION_CREDENTIALS` (path to `google-credentials.json`), `HEALTH_CHECK_CHANNEL_ID`, `BOT_PORT` (unique per bot, 31001–31005), `BOT_PORTS` (comma-separated all ports).

External services at runtime: one or more VOICEVOX servers, Google Cloud TTS API.

## Key conventions

- TypeScript strict mode, `nodenext` module resolution, target ES2022.
- `constants.ts` uses `__dirname` for `PROJECT_ROOT` — works in both tsx and compiled output.
- Guild settings in `guild_settings/<guildId>.json`. Per-user speaker prefs in `user_speakers/<userId>.json`. Per-bot VC state in `lastVoiceChannel_<N>.json`.
- `voice_cache.json` is shared across all bot instances; `voiceCache.ts` uses `mkdir`-based file locking (cross-process safe, async wait — no busy loop) + atomic writes (per-pid `tmp` + `rename`). `readVoiceCache()` is sync and served from memory unless the file's mtime/size changed; `updateVoiceCache()` is async and must be awaited. A corrupt file is moved to `voice_cache.json.corrupt-<ts>` instead of being overwritten.
- Text pipeline: `segmentByLanguage` splits Japanese-script runs from everything else (digits/punctuation attach to the neighbouring run; non-Japanese scripts such as Korean/Cyrillic go to Google TTS). `chunkTextByMorphs` always splits at punctuation and only splits at particles/conjunctions once a chunk reaches `SOFT_CHUNK_LENGTH`; no-split words are injected as pseudo-tokens (no placeholders).
- Slash commands on every bot: `/join`, `/leave`, `/reload`, `/skip`. 1号機 additionally registers `/voice` (string option with VOICEVOX style-name autocomplete; value is the style id — the setting lives in the shared `user_speakers/` dir so all bots pick it up) plus the dictionary / no-split / cache / TTS-engine / sound-effect commands.
- Only bot `HEALTH_NOTIFY_BOT_NUMBER` (1) posts VOICEVOX down/recovery embeds to `HEALTH_CHECK_CHANNEL_ID`; all bots still track server health.
- Every Discord event handler is wrapped in try/catch and logs instead of crashing; `/join` defers its reply and destroys the connection if the VC handshake times out.
- Uncaught exceptions and unhandled rejections call `process.exit(1)`. The `start.sh` / `start-compiled.sh` wrappers auto-restart after 5 seconds.
- `start.sh` / `start-compiled.sh` redirect each bot's output to `logs/Ngou.log` and run the central dashboard monitor in the foreground. Ctrl+C stops everything cleanly via trap.
- 2–5号機 call `dotenv.config({ path: './Ngou.env' })` before importing anything else (so env is set before `botCore` reads `process.env`). `botCore.ts` also calls `dotenv.config` with `config.envPath` as a safety net.
- 1号機 has `GuildMembers` and `GuildPresences` intents omitted; 2–5号機 include them.
- Bot numbers determine auto-join priority (lowest number wins) for listening channels matching `^👂｜聞き専-(\d+)$`. Coordination is via HTTP (`botCoordinator.ts`): each bot exposes `GET /status` and the lowest-numbered free bot wins. A `joining` lock flag prevents races during VC connection.
- **Production deployment**: GitHub Actions (`deploy.yml`) triggers on release publish → self-hosted Windows runner → PM2 via `ecosystem.config.cjs` (5 apps from `dist/`). All `.env` files and `google-credentials.json` must exist on the production server already.

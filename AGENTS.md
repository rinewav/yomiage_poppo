# AGENTS.md — yomiagepoppo

Discord TTS (text-to-speech) bot fleet. Reads channel messages aloud in voice channels using VOICEVOX (Japanese) and Google Cloud TTS (non-Japanese/fallback).

## Commands

```bash
npm run start            # 1号機 via tsx (TUI dashboard)
npm run start:2gou       # 2号機 via tsx (also :3gou, :4gou, :5gou)
npm run start:all        # All 5 bots via tsx + central dashboard monitor
npm run build            # tsc → dist/
npm run start:all:compiled  # All 5 bots from dist/ + central dashboard
npm run start:dashboard  # Central dashboard monitor only (bots must be running)
npm run generate-cache   # Pre-cache voice files from cache_list.txt
```

No lint, typecheck, or test commands are configured.

## Architecture

- **Fleet of 5 bots** (1–5号機). Each has its own entry point (`src/index.ts`, `src/index2gou.ts`, … `index5gou.ts`) and `.env` file (`.env`, `2gou.env`, … `5gou.env`).
- **All logic lives in `src/botCore.ts`** — entry points only pass a `BotConfig` with bot number, env path, intents, and sound effects map.
- `src/audioPlayer.ts` — synthesis + playback queues per guild
- `src/tts.ts` — VOICEVOX and Google Cloud TTS integration
- `src/voiceCache.ts` — shared voice cache (`voice_cache.json`) with retry-on-busy writes (multiple bots write the same file)
- `src/utils.ts` — text normalization, morphological chunking (kuromoji), language segmentation
- `src/constants.ts` — all tunables; sound effect maps `SOUND_EFFECTS_MAP_FULL` (1号機) and `SOUND_EFFECTS_MAP_SUBSET` (3号機)
- `src/botCoordinator.ts` — HTTP-based inter-bot coordination for auto-join (each bot runs `GET /status` and `GET /logs` endpoints)
- `src/dashboard.ts` — TUI dashboard for individual bot runs (ASCII art banner, fleet health grid, latest 3 logs)
- `src/dashboardMonitor.ts` — Central dashboard monitor for `start.sh` (queries all bots' HTTP endpoints, renders unified view)

## Required environment

Each `.env` needs: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.  
Shared across bots: `VOICEVOX_URLS` (comma-separated), `GOOGLE_APPLICATION_CREDENTIALS` (path to `google-credentials.json`), `HEALTH_CHECK_CHANNEL_ID`, `BOT_PORT` (unique per bot, e.g. 31001–31005), `BOT_PORTS` (comma-separated list of all bot ports).

External services at runtime: one or more VOICEVOX servers, Google Cloud TTS API.

## Key conventions

- TypeScript strict mode, `nodenext` module resolution, target ES2022.
- `constants.ts` uses `__dirname` for `PROJECT_ROOT` — works in both tsx and compiled output.
- Guild settings stored as JSON in `guild_settings/<guildId>.json`. Per-user speaker preferences in `user_speakers/<userId>.json`.
- Sound effects: add `.wav`/`.ogg`/`.mp3` to `sounds/`, then add the keyword→path entry in `SOUND_EFFECTS_MAP_FULL` and/or `SOUND_EFFECTS_MAP_SUBSET` in `src/constants.ts`.
- `voice_cache.json` is shared across all bot instances; writes use retry with EBUSY/EPERM handling.
- Uncaught exceptions and unhandled rejections call `process.exit(1)`. The `start.sh` / `start-compiled.sh` wrappers auto-restart after 5 seconds.
- `start.sh` / `start-compiled.sh` redirect each bot's output to `logs/Ngou.log` and run the central dashboard monitor in the foreground. Ctrl+C stops everything cleanly via trap.
- 2–5号機 call `dotenv.config({ path: './Ngou.env' })` before importing anything else (so env is set before `botCore` reads `process.env`).
- 1号機 has `GuildMembers` and `GuildPresences` intents omitted; 2–5号機 include them.
- Bot numbers determine auto-join priority (lowest number wins) for listening channels matching `^👂｜聞き専-(\d+)$`. Coordination is via HTTP (`botCoordinator.ts`): each bot exposes `GET /status` and the lowest-numbered free bot wins. A `joining` lock flag prevents races during VC connection.

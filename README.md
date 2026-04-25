#🐤 よみあげぽっぽ

プロアマクリエイターズコミュニティ「ぽん酢鯖」の管理用 Discord ボットです。TypeScript + ESM で構築されています。
VOICEVOX（日本語）と Google Cloud TTS（非日本語・フォールバック）を使用して、テキストチャンネルのメッセージをボイスチャンネルで読み上げます。

5台のボット（1〜5号機）を一元管理する構成で、HTTP ベースの連携による自動参加機能を備えています。

## 必要なもの

- Node.js 18+
- [VOICEVOX](https://voicevox.hiroshiba.jp/) サーバー（1つ以上）
- Google Cloud TTS API の認証情報（`google-credentials.json`）
- Discord Bot のトークン（5つ）

## セットアップ

```bash
npm install
cp .env.example .env
# .env に各種設定を記入
# 2号機以降は 2gou.env, 3gou.env ... を作成（内容は .env.example を参照）
# google-credentials.json をプロジェクトルートに配置
```

### 環境変数

各号機の `.env` ファイルに以下を設定します。

| 変数                             | 説明                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `DISCORD_TOKEN`                  | Discord Bot のトークン                                               |
| `CLIENT_ID`                      | Discord Application のクライアント ID                                |
| `GUILD_ID`                       | 対象サーバーの ID                                                    |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud 認証ファイルのパス（例: `"./google-credentials.json"`） |
| `VOICEVOX_URLS`                  | VOICEVOX サーバーの URL（カンマ区切り）                              |
| `HEALTH_CHECK_CHANNEL_ID`        | ヘルスチェック用チャンネル ID                                        |
| `BOT_PORT`                       | HTTP 連携用ポート（1号機: 31001, 2号機: 31002 ...）                  |
| `BOT_PORTS`                      | 全号機のポート（カンマ区切り）                                       |

## 使い方

```bash
npm run start              # 1号機を起動（TUI ダッシュボード付き）
npm run start:2gou         # 2号機を起動（:3gou, :4gou, :5gou も同様）
npm run start:all          # 全5台を起動 + 中央ダッシュボード
npm run build              # TypeScript を dist/ にコンパイル
npm run start:all:compiled # コンパイル済みコードで全5台を起動
```

## スラッシュコマンド

### 全号機共通

| コマンド  | 説明           |
| --------- | -------------- |
| `/join`   | VC に参加      |
| `/leave`  | VC から退出    |
| `/reload` | ボットを再起動 |

### 1号機のみ

| コマンド       | 説明                                                  |
| -------------- | ----------------------------------------------------- |
| `/voice`       | 自分専用のスピーカー ID を設定                        |
| `/setdict`     | 読み上げ辞書に単語を追加                              |
| `/deldict`     | 読み上げ辞書から単語を削除                            |
| `/listdict`    | 辞書の一覧を表示                                      |
| `/addnosplit`  | 形態素解析で分割しない単語を追加                      |
| `/delnosplit`  | 分割禁止リストから単語を削除                          |
| `/searchcache` | 音声キャッシュを検索                                  |
| `/toggletts`   | 読み上げエンジンを切替（Voicevox ↔ Google TTS）       |
| `/addsound`    | 効果音を追加（キーワード + `sounds/` 内のファイル名） |
| `/delsound`    | 効果音を削除                                          |
| `/listsounds`  | 登録済み効果音の一覧を表示                            |

## 効果音

効果音は `sounds/` ディレクトリに音声ファイル（`.wav`, `.ogg`, `.mp3`）を配置し、コマンドでキーワードと紐付けます。

```bash
# 例: sounds/test.wav を追加
/addsound keyword: テスト file: test.wav

# 確認
/listsounds

# 削除
/delsound keyword: テスト
```

効果音の設定は `sound_effects.json` に保存されます。

## 自動参加

`👂｜聞き専-N` という名前のテキストチャンネルが作成されると、空き状態のボットが自動的に対応するボイスチャンネルに参加します。複数ボットが空いている場合は、番号が最も小さいボットが優先されます。

## プロジェクト構成

```
src/
  index.ts 〜 index5gou.ts   各号機のエントリポイント
  botCore.ts                 ボットの全ロジック
  audioPlayer.ts             音声合成・再生キュー
  tts.ts                     VOICEVOX / Google Cloud TTS
  voiceCache.ts              音声キャッシュ管理
  utils.ts                   テキスト正規化・形態素解析
  constants.ts               設定値
  soundEffects.ts            効果音設定の読み書き
  botCoordinator.ts          ボット間 HTTP 連携
  dashboard.ts               個別ボット TUI ダッシュボード
  dashboardMonitor.ts        中央ダッシュボードモニター
```

## ライセンス

ISC

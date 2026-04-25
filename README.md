# 🐤 よみあげぽっぽ

プロアマクリエイターズコミュニティ「ぽん酢鯖」の管理用 Discord ボットです。TypeScript + ESM で構築されています。
VOICEVOX（日本語）と Google Cloud TTS（非日本語・フォールバック）を使用して、テキストチャンネルのメッセージをボイスチャンネルで読み上げます。

5台のボット（1〜5号機）を一元管理する構成で、HTTP ベースの連携による自動参加機能を備えています。

## 必要要件

- Node.js 18+
- npm
- [VOICEVOX Engine](https://voicevox.hiroshiba.jp/) サーバー（1つ以上）
- Google Cloud TTS API の認証情報（`google-credentials.json`）

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

## ライセンスについて

Copyright (c) 2026 りね（ぽん酢鯖）, All Rights Reserved.

このリポジトリは、クリエイターズコミュニティサーバー「ぽん酢鯖」の透明性を上げる目的、及び作者「りね」のポートフォリオとしてソースコードを公開しているものです。
オープンソースライセンスは付与しておらず、すべての著作権は作者に帰属します。

**【許可されていること】**

- ソースコードの閲覧
- コードの書き方などの学習目的での参考

**【禁止されていること】**

- コードの一部または全部の無断使用、複製、改変、再配布
- ご自身のDiscordサーバー等への本ボットの導入・運用
- このコードを流用して作成した派生物の公開や商用利用

## 使用ライブラリ・クレジット

このプロジェクトの開発にあたり、以下の主要なオープンソースソフトウェアおよびライブラリを使用しています。各ライブラリの作者およびコミュニティに深く感謝いたします。

- **[discord.js](https://discord.js.org/)** (Apache-2.0)
- **[@google-cloud/text-to-speech](https://github.com/googleapis/nodejs-text-to-speech)** (Apache-2.0)
- **[kuromoji](https://github.com/takuyaa/kuromoji.js)** (Apache-2.0)
- **[wanakana](https://wanakana.com/)** (MIT)
- **[franc](https://github.com/wooorm/franc)** (MIT)
- **[axios](https://axios-http.com/)** (MIT)
- **[dotenv](https://github.com/motdotla/dotenv)** (BSD-2-Clause)
- **[tsx](https://github.com/privatenumber/tsx)** (MIT)
- **[typescript](https://www.typescriptlang.org/)** (Apache-2.0)

その他の依存ライブラリについては `package.json` および `package-lock.json` を参照してください。

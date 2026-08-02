# 声日記（Voice Diary PWA）

話した内容を音声認識でテキスト化し、GitHubリポジトリにMarkdownファイルとして保存するスマホ向けPWAです。

## 使いはじめる手順

### 1. GitHub Pagesを有効化する

1. このリポジトリの **Settings → Pages** を開く
2. **Source** を `Deploy from a branch` にする
3. **Branch** を `main` / `/(root)` にして **Save**
4. 数分後、`https://<ユーザー名>.github.io/voice-diary/` でアプリが公開されます

### 2. 日記保存用のPersonal Access Tokenを発行する

1. https://github.com/settings/tokens/new を開く
2. 期限（Expiration）とメモを設定
3. スコープの **repo** にチェックを入れて **Generate token**
4. 表示されたトークン（`ghp_...`）をコピーしておく（この画面を閉じると二度と表示されません）

### 3. スマホでアプリを開く

1. スマホのブラウザ（Chrome推奨）で上記のPages URLを開く
2. 右上の歯車アイコンから設定を開き、以下を入力
   - **Personal Access Token**: 手順2で発行したトークン
   - **リポジトリ**: `<あなたのユーザー名>/voice-diary`
   - **ブランチ**: `main`
   - **保存フォルダ**: `diary`（好きな名前に変更可）
3. 「設定を保存」を押す
4. ブラウザメニューから「ホーム画面に追加」するとアプリのように使えます

## 使い方

1. マイクボタンを押して話す（もう一度押すと停止）
2. 文字になった内容はその場で編集できます
3. 「GitHubに保存する」を押すと、その日の `diary/YYYY-MM-DD.md` に時刻見出し付きで追記されます
4. 同じ日に複数回録音すると、同じファイルに追記されていきます

## 技術メモ

- 完全にクライアントサイドで動作する静的PWA（ビルド不要）
- 音声のテキスト化はブラウザ内蔵の Web Speech API を使用（Chrome推奨、対応状況はブラウザに依存）
- 保存は GitHub REST API（Contents API）をブラウザから直接呼び出し
- Personal Access Tokenは端末のlocalStorageにのみ保存され、GitHub以外には送信されません
- オフライン時はアプリの外殻（HTML/CSS/JS）はService Workerでキャッシュされますが、保存にはインターネット接続が必要です

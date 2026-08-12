# 声日記・通話録音アプリのapp-sync基盤統合 設計書

日付: 2026-08-12
ステータス: 承認済み

## 目的

声日記(voice-diary-app)をapp-sync共通基盤に組み込み、他のPWA群と同じ
「1日1回自動バックアップ+今すぐ保存ボタン」の運用に統一する。
あわせて、壊れているPC側の日次同期を修復・一本化し、
両アプリの設定画面を他アプリの標準レイアウトに合わせて整える
(APIキー・トークンをそのまま表示しない)。

## 背景と決定事項

- **音声処理は現状維持**: 声日記=Web Speech API、通話録音=OpenAI Whisper API。今回は触らない
- **PC側同期が故障中**: タスクスケジューラの `VoiceDiaryGitPull`(毎朝7:00)と
  `CallRecordingGitPull`(毎朝7:05)は、スクリプト実体
  (`日記\pull-diary.ps1` 等。「日記」→「01_日記」のフォルダ改名時に消失したとみられる)が
  存在せず、毎日失敗している。8/6以降の声日記は01_日記へ転記されていない
- **通話録音はapp-syncに組み込まない**: sync.jsはブラウザ用JSでKotlinから使えず、
  音声バイナリは日次スナップショット上書きに不適。統一するのは
  「PC側pullの入口」と「PATの1本化」のみ
- **過去データの扱い**: voice-diaryリポジトリ `diary/*.md` の未転記分は
  今回の作業で一括転記して終了。以後このリポジトリの日記データは更新されない
  (リポジトリ自体は削除せず残す。アプリのホスティングは引き続きこのリポジトリのPages)
- **案Aを採用**: PC側の日次同期タスクを `AppDataGitPull` 1本に集約する

## 全体構成(データの流れの対比)

| | 声日記(新) | 通話録音(現行維持) |
|---|---|---|
| 主データの所在 | 端末のlocalStorage(テキスト) | 端末ストレージ(音声m4a) |
| GitHubへ送るタイミング | 1日1回+今すぐ保存 | ユーザーが選んで保存した時だけ |
| 送り方 | 全件スナップショット上書き | 1件ずつ追記(テキスト+音声) |
| 保存先リポジトリ | app-data(非公開・共通) | call-recording-app(専用) |
| 逆方向(復元) | あり(機種変更対応) | なし |
| PC側の処理 | transcribe.mjsで01_日記へ転記 | pullするだけ(既にMarkdown) |

共通化されるのはPC側の入口のみ: 毎朝の `AppDataGitPull` →
`app-sync/tools/app-data-pull.ps1` が app-data のpull・各アプリの転記・
call-recording-app のpullをすべて担当する。

## 設計1: 声日記アプリの改修

### データ層(ローカルファースト化)

- localStorage(キー `voice-diary:entries`)にエントリ配列を保存する
  (time-diary-appの `store.js` と同じパターン。日記テキストは小容量のため十分):
  `{ id: <UUID>, date: "YYYY-MM-DD", time: "HH:MM", text: <本文> }`
- メイン画面の保存ボタンは「GitHubに保存する」→「日記を保存」に変更し、
  即IndexedDBへ保存する(オフラインでも記録できるようになる)。
  保存成功時のスタンプ演出は維持する
- 旧実装のGitHub直接保存コード(Contents API呼び出し)と
  設定キー `vd_token` / `vd_repo` / `vd_branch` / `vd_folder` は削除する
  (初回起動時にlocalStorageからも消す)

### 同期(app-sync組み込み)

- 起動時に動的importで `initDailyBackup({ appId: 'voice-diary', collect, restore })`
  を呼ぶ(失敗時はスキップ、アプリ本体は動く)
- `collect`: `{ version: 1, exportedAt: <ISO8601>, entries: [...] }` を返す
- `restore`: `entries` を丸ごと置き換えて書き戻す
- `sw.js` は `sync.js` をキャッシュしない

### 設定画面(標準レイアウト)

現在の設定モーダル(トークン・リポジトリ・ブランチ・フォルダの4入力)を廃止し、
標準の3セクション構成に置き換える:

1. **GitHubへのバックアップ** — `renderBackupControls`(今すぐ保存・GitHubから復元)
2. **GitHub連携** — `renderTokenSettings`(password型入力。保存済みなら
   「(設定済み。変更時のみ入力)」プレースホルダで実値は表示しない)
3. **インポート・エクスポート** — ローカル実装(「ファイルにエクスポート」
   「ファイルからインポート」。JSON形式、インポートは置換+確認ダイアログ)

①②の描画に失敗した場合(オフライン等)は標準の案内文を表示する。
トークンはfine-grained PAT(対象=app-dataのみ)に統一され、同一オリジンの
他アプリで設定済みならそのまま効く。

## 設計2: PC側転記(transcribe.mjs)

- `voice-diary-app/tools/transcribe.mjs` を新設(time-diary-appの転記パターンを流用):
  - `app-data/voice-diary/backup.json` を読み、日付ごとに
    `## HH:MM` 見出し+本文でセクションを組み立てる
  - `01_日記/YYYY-MM-DD.md` のマーカー区間
    `<!-- 音声日記:start -->` 〜 `<!-- 音声日記:end -->` へ冪等にupsert
    (既存マーカー名を継続使用。マーカーが無ければ末尾に追記)
  - 転記対象は前日以前の日付のみ(当日は記録が増えるため転記しない)
  - backup.jsonが無い・壊れている場合はメッセージを出してスキップ
- `app-sync/tools/app-data-pull.ps1` に以下を追加:
  - 声日記の転記: `node ...\voice-diary-app\tools\transcribe.mjs`(存在チェック付き)
  - 通話録音のpull: `git -C ...\call-recording-app pull`(結果をログに追記)
- スケジュールタスク `VoiceDiaryGitPull` と `CallRecordingGitPull` を削除する
  (スクリプト実体が既に無く、毎日失敗しているため。削除前にユーザーへ最終確認する)
- `call-recording-app/手動で同期するコマンド.md` を
  `Start-ScheduledTask -TaskName "AppDataGitPull"` に更新する

## 設計3: 通話録音アプリの設定画面

- **PAT統一**(ユーザー操作): fine-grained PATの対象リポジトリに
  `call-recording-app` を追加し、そのトークンをアプリに入れ直す。コード変更なし
- **設定画面の改修**(`activity_settings.xml` + `SettingsActivity.kt`):
  - セクション見出しと説明文を付ける: 「文字起こし(Whisper)」「GitHub連携」
  - APIキーとトークンの入力欄を `inputType="textPassword"` にする
  - 保存済みの値はEditTextに読み込まない。ヒントに「設定済み(変更時のみ入力)」を
    表示し、**空欄のまま保存したら既存値を保持**する(sync.jsと同じ挙動)
  - リポジトリ・ブランチ・フォルダ欄は現状どおり(平文でよい)

## 設計4: 過去データの一括転記(移行作業)

- voice-diaryリポジトリをpullし(実施済み)、`diary/` 配下の全日付ファイル
  (8/2〜8/5、8/8)の内容を `01_日記` の該当日ファイルのマーカー区間へ転記する
  (転記済みの8/2〜8/5も同じ内容ならそのまま。差分があれば旧リポジトリ側を正とする)
- この作業は実装フェーズの最後にClaude本体が手動で行い、結果を目視確認する

## エラー処理

- 声日記: バックアップ失敗(オフライン・トークン未設定)は静かにスキップし
  次回起動時に再試行(基盤標準)。ローカル保存は常に成功する
- transcribe.mjs: 日記ファイルの他の部分には一切触れない(マーカー区間のみ置換)。
  エラーはpull-log.txtに残る
- 通話録音の設定保存: 空欄=既存値保持のため、誤って空で保存してもキーは消えない

## テスト

- 声日記: `collect` → `restore` の往復で元データと一致(node:test)。
  store.js(読み書き・追加・バックアップ検証)のテスト
- transcribe.mjs: セクション組み立て・upsert(新規/置換/他部分不変)・
  日付選別(当日除外)のテスト(node:test)
- 通話録音: 「空欄保存で既存値保持」のユニットテスト(JUnit)
- 最終検証(本体が実施): 全テスト実行、実ブラウザで保存→app-dataコミット確認、
  ローカルデータ削除→復元確認、transcribe.mjs実行→01_日記の転記確認、
  app-data-pull.ps1の手動実行確認。Androidアプリはビルド確認+実機確認を依頼

## やらないこと(YAGNI)

- 通話録音アプリのスナップショット化・app-syncへのデータ移動
- voice-diaryリポジトリの削除・アーカイブ・リネーム
- 旧 `diary/*.md` の声日記アプリ(IndexedDB)への取り込み
- 声日記の複数端末マージ(基盤同様、後勝ち上書き)
- 音声整形(誤変換修正)の自動化

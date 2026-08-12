# 声日記・通話録音アプリのapp-sync基盤統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 声日記をapp-sync基盤(1日1回自動バックアップ+今すぐ保存)に組み込み、PC側日次同期をAppDataGitPull 1本に修復・統合し、両アプリの設定画面を標準化(秘密情報のマスク表示)する。

**Architecture:** 声日記はローカルファースト化(localStorage主データ)し、sync.jsで`app-data/voice-diary/backup.json`へ日次スナップショット。PC側はtranscribe.mjsが01_日記へマーカーupsert転記。通話録音はコード上は設定画面のみ改修(データ経路は現行維持)。

**Tech Stack:** Vanilla JS (ESM) / node:test / PowerShell 5.1 / Kotlin (Android, JUnit4)

**Spec:** `docs/superpowers/specs/2026-08-12-app-sync-integration-design.md`

## Global Constraints

- 対象リポジトリは3つ: `D:\Obsidian Vault for Claude Code\Git\voice-diary-app`(=リモート名 voice-diary)、`...\Git\app-sync`、`...\Git\call-recording-app`。コミットは変更したリポジトリごとに行う
- 外部ライブラリ追加禁止(声日記はVanilla JS、テストはnode:testのみ)
- sync.jsの読み込みは必ず動的import+失敗時スキップ。URL: `https://taka070600538-tech.github.io/app-sync/v1/sync.js`
- 設定画面の文言は全アプリ統一: セクション見出し「GitHubへのバックアップ」「GitHub連携」「インポート・エクスポート」、ボタン「ファイルにエクスポート」「ファイルからインポート」
- 秘密情報(APIキー・トークン)は保存済みの実値を画面に出さない。「設定済み(変更時のみ入力)」ヒント+空欄保存=既存値保持
- `.ps1`ファイルはBOM付きUTF-8で保存(Windows PowerShell 5.1の日本語文字化け対策)
- 転記マーカーは既存の `<!-- 音声日記:start -->` / `<!-- 音声日記:end -->` を継続使用
- git commitの末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける

---

### Task 1: 声日記のデータ層 store.js

**Files:**
- Create: `Git/voice-diary-app/js/store.js`
- Create: `Git/voice-diary-app/tests/store.test.js`
- Create: `Git/voice-diary-app/package.json`

**Interfaces:**
- Produces: `loadEntries(storage?) -> Entry[]` / `saveEntries(entries, storage?)` / `addEntry(entries, text, storage?, now?) -> Entry` / `buildBackup(entries) -> {version, exportedAt, entries}` / `parseBackupJson(text) -> Entry[] | null`。Entry = `{ id: string, date: "YYYY-MM-DD", time: "HH:MM", text: string }`

- [ ] **Step 1: package.jsonを作成**

```json
{
  "name": "voice-diary-app",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/**/*.test.js"
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEntries, saveEntries, addEntry, buildBackup, parseBackupJson } from '../js/store.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('loadEntries: 未保存なら空配列', () => {
  assert.deepEqual(loadEntries(memoryStorage()), []);
});

test('loadEntries: 壊れたJSONなら空配列', () => {
  const s = memoryStorage();
  s.setItem('voice-diary:entries', '{broken');
  assert.deepEqual(loadEntries(s), []);
});

test('addEntry: 日時付きで追加され、保存される', () => {
  const s = memoryStorage();
  const entries = [];
  const entry = addEntry(entries, 'テスト本文', s, new Date(2026, 7, 12, 9, 5));
  assert.equal(entry.date, '2026-08-12');
  assert.equal(entry.time, '09:05');
  assert.equal(entry.text, 'テスト本文');
  assert.ok(entry.id.length > 0);
  assert.deepEqual(loadEntries(s), [entry]);
});

test('saveEntries → loadEntries の往復で一致', () => {
  const s = memoryStorage();
  const entries = [{ id: 'a', date: '2026-08-11', time: '07:00', text: 'おはよう' }];
  saveEntries(entries, s);
  assert.deepEqual(loadEntries(s), entries);
});

test('buildBackup: version/exportedAt/entriesを含む', () => {
  const entries = [{ id: 'a', date: '2026-08-11', time: '07:00', text: 'x' }];
  const backup = buildBackup(entries);
  assert.equal(backup.version, 1);
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
  assert.deepEqual(backup.entries, entries);
});

test('parseBackupJson: 正常系はentriesを返し、不正はnull', () => {
  const good = JSON.stringify({ version: 1, entries: [{ id: 'a', date: '2026-08-11', time: '07:00', text: 'x' }] });
  assert.equal(parseBackupJson(good).length, 1);
  assert.equal(parseBackupJson('{broken'), null);
  assert.equal(parseBackupJson('{"entries": "not-array"}'), null);
});
```

- [ ] **Step 3: テスト実行 → 失敗を確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --test tests/store.test.js`
Expected: FAIL(`js/store.js` が存在しない)

- [ ] **Step 4: js/store.jsを実装**

```js
// 日記エントリのデータ層。localStorageに保存し、DOMには触れない。
// storage引数はテスト用で、ブラウザでは省略してlocalStorageを使う。
const KEY = 'voice-diary:entries';

function pad2(n) { return String(n).padStart(2, '0'); }

export function loadEntries(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(entries));
}

// 現在日時からdate/timeを付けて追加保存する。nowはテスト用。
export function addEntry(entries, text, storage = globalThis.localStorage, now = new Date()) {
  const entry = {
    id: crypto.randomUUID(),
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    text,
  };
  entries.push(entry);
  saveEntries(entries, storage);
  return entry;
}

// GitHubバックアップ・エクスポート共通のペイロード。
export function buildBackup(entries) {
  return { version: 1, exportedAt: new Date().toISOString(), entries };
}

// backup.json形式のテキストを検証してentries配列を返す。不正ならnull。
export function parseBackupJson(text) {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries)) return null;
    return data.entries;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: テスト実行 → 全部PASSを確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --test tests/store.test.js`
Expected: PASS(6件)

- [ ] **Step 6: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git add js/store.js tests/store.test.js package.json && git commit -m "feat: 日記エントリのlocalStorageデータ層を追加"
```

---

### Task 2: 声日記メイン画面のローカル保存化 + sync.js組み込み

**Files:**
- Create: `Git/voice-diary-app/js/app.js`(既存 `app.js` を移設・改修)
- Delete: `Git/voice-diary-app/app.js`
- Modify: `Git/voice-diary-app/index.html`

**Interfaces:**
- Consumes: Task 1の `loadEntries` / `addEntry` / `buildBackup` / `saveEntries`
- Produces: グローバル関数 `window.vdRenderSettingsSections`(Task 3で設定モーダルが使う。引数なし、設定セクションを描画する)

- [ ] **Step 1: 既存app.jsをjs/app.jsへ移設(git mv)**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git mv app.js js/app.js
```

- [ ] **Step 2: js/app.jsを改修**

以下の変更を加える。**音声認識部分(`/* ---------- speech recognition ---------- */` から `updateSaveEnabled` 定義まで)と、date header・status line・ink waveの各セクションは一切変更しない。**

(a) ファイル先頭を以下に置き換える(`"use strict";` はESMでは不要なので削除し、importを追加):

```js
import { loadEntries, saveEntries, addEntry, buildBackup } from './store.js';

const SYNC_URL = 'https://taka070600538-tech.github.io/app-sync/v1/sync.js';
const entries = loadEntries();

// 旧実装(GitHub直接保存)の設定キーを掃除する
for (const k of ['vd_token', 'vd_repo', 'vd_branch', 'vd_folder']) localStorage.removeItem(k);
```

(b) `/* ---------- settings storage ---------- */` セクション全体(`STORE_KEYS` 定義から `saveSettingsBtn.addEventListener` のブロックまで)を削除し、element refsから `saveSettingsBtn` / `tokenInput` / `repoInput` / `branchInput` / `folderInput` の参照も削除する。`openSettings` / `closeSettings` は以下に置き換える:

```js
function openSettings() {
  settingsBackdrop.classList.add('is-open');
  window.vdRenderSettingsSections();
}

function closeSettings() {
  settingsBackdrop.classList.remove('is-open');
}
```

(c) `/* ---------- github save ---------- */` セクション全体(`pad2` から `saveBtn.addEventListener` の非同期ブロック終わりまで)を削除し、以下に置き換える:

```js
/* ---------- local save ---------- */
saveBtn.addEventListener('click', () => {
  const text = transcriptEl.value.trim();
  if (!text) return;
  addEntry(entries, text);
  transcriptEl.value = '';
  baseText = '';
  finalText = '';
  currentSegment = '';
  updateSaveEnabled();
  showStamp();
  setStatus('保存しました', 'success');
});

/* ---------- app-sync (1日1回自動バックアップ) ---------- */
import(SYNC_URL)
  .then((sync) => sync.initDailyBackup({
    appId: 'voice-diary',
    collect: async () => buildBackup(loadEntries()),
    restore: async (data) => {
      saveEntries(Array.isArray(data?.entries) ? data.entries : []);
    },
  }))
  .catch(() => {}); // オフライン時はスキップ(アプリ本体は動く)
```

(d) `window.vdRenderSettingsSections` の仮実装を末尾に追加する(Task 3で本実装に差し替える):

```js
window.vdRenderSettingsSections = () => {};
```

- [ ] **Step 3: index.htmlを更新**

- `<script src="app.js"></script>` を `<script type="module" src="js/app.js"></script>` に変更
- 保存ボタンの文言を変更:

```html
  <button class="save-btn" id="save-btn" disabled>
    <span class="hanko" aria-hidden="true">記</span>
    <span>日記を保存</span>
  </button>
```

- `<meta name="description">` を「話すだけで日記を記録するPWA」に変更

- [ ] **Step 4: 構文チェックとテスト**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --check js/app.js && node --test tests/store.test.js`
Expected: 構文エラーなし、テストPASS

- [ ] **Step 5: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git add -A && git commit -m "feat: 保存をローカルファースト化しapp-sync日次バックアップを組み込み"
```

---

### Task 3: 声日記の設定画面を標準3セクション化

**Files:**
- Modify: `Git/voice-diary-app/index.html`(設定モーダル内)
- Modify: `Git/voice-diary-app/js/app.js`(`window.vdRenderSettingsSections` 本実装)
- Modify: `Git/voice-diary-app/style.css`(セクション用スタイル追加)

**Interfaces:**
- Consumes: sync.jsの `renderBackupControls(container)` / `renderTokenSettings(container)`、Task 1の `buildBackup` / `loadEntries` / `saveEntries` / `parseBackupJson`

- [ ] **Step 1: index.htmlの設定モーダル内を置き換える**

`<div class="modal-head">...</div>` は残し、それ以降のモーダル内容(4つの `<label class="field">`、`#save-settings` ボタン、`.settings-note` 段落)をすべて削除して以下に置き換える:

```html
    <div id="sync-backup-section" class="settings-section"></div>
    <div id="sync-token-section" class="settings-section"></div>
    <div class="settings-section">
      <h3 class="settings-heading">インポート・エクスポート</h3>
      <p class="settings-note">バックアップとは別に、日記データをファイルとして手元に保存・復元できます。</p>
      <button type="button" id="export-btn">ファイルにエクスポート</button>
      <button type="button" id="import-btn">ファイルからインポート</button>
      <input type="file" id="import-file" accept="application/json" hidden />
      <span id="import-export-status" role="status"></span>
    </div>
```

- [ ] **Step 2: js/app.jsの `window.vdRenderSettingsSections` を本実装に差し替える**

Task 2 Step 2(d)の仮実装を削除し、以下を追加する:

```js
/* ---------- settings sections ---------- */
let settingsRendered = false;
window.vdRenderSettingsSections = () => {
  if (settingsRendered) return;
  settingsRendered = true;
  const backupEl = $('sync-backup-section');
  const tokenEl = $('sync-token-section');
  import(SYNC_URL)
    .then((sync) => {
      sync.renderBackupControls(backupEl);
      sync.renderTokenSettings(tokenEl);
    })
    .catch(() => {
      const msg = 'GitHubバックアップ機能は現在利用できません（オフラインの可能性）。';
      backupEl.textContent = msg;
      tokenEl.textContent = msg;
      settingsRendered = false; // 次に開いたとき再試行
    });
};

/* ---------- import / export ---------- */
const importFileInput = $('import-file');
const importExportStatus = $('import-export-status');

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildBackup(loadEntries()), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `voice-diary-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import-btn').addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  importFileInput.value = '';
  if (!file) return;
  const imported = parseBackupJson(await file.text());
  if (!imported) {
    importExportStatus.textContent = 'ファイルを読み込めませんでした';
    return;
  }
  if (!confirm(`この端末の日記(${loadEntries().length}件)を、ファイルの内容(${imported.length}件)で置き換えます。よろしいですか？`)) return;
  saveEntries(imported);
  entries.length = 0;
  entries.push(...imported);
  importExportStatus.textContent = 'インポートしました';
});
```

あわせてファイル先頭のimportに `parseBackupJson` を追加する:

```js
import { loadEntries, saveEntries, addEntry, buildBackup, parseBackupJson } from './store.js';
```

- [ ] **Step 3: style.cssにセクション用スタイルを追加**

ファイル末尾に追加(sync.jsが生成する `.settings-heading` / `.settings-note` とボタン・入力欄が既存モーダルの見た目に馴染むように):

```css
/* ---------- settings sections (app-sync標準レイアウト) ---------- */
.settings-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--ink-faint, #b9b2a4);
}
.settings-section:last-child { border-bottom: none; }
.settings-heading {
  font-family: "Shippori Mincho", serif;
  font-size: 1rem;
  margin: 0 0 6px;
}
.settings-note {
  font-size: 0.8rem;
  color: #6b6455;
  margin: 4px 0 10px;
}
.settings-section label {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 8px;
}
.settings-section input[type="password"] {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 10px;
  border: 1px solid #b9b2a4;
  border-radius: 8px;
  font: inherit;
  background: #fffdf8;
}
.settings-section button {
  font: inherit;
  padding: 8px 14px;
  margin: 4px 8px 4px 0;
  border: 1px solid #4a4437;
  border-radius: 8px;
  background: #fffdf8;
  cursor: pointer;
}
.settings-section [role="status"], .settings-section span {
  display: inline-block;
  font-size: 0.8rem;
  margin-top: 6px;
}
```

- [ ] **Step 4: 構文チェックとテスト**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --check js/app.js && node --test tests/store.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git add index.html js/app.js style.css && git commit -m "feat: 設定画面を標準3セクション(バックアップ/GitHub連携/インポート・エクスポート)に統一"
```

---

### Task 4: 声日記sw.jsの更新(sync.js非キャッシュ・シェル更新)

**Files:**
- Modify: `Git/voice-diary-app/sw.js`

**注意:** sync.jsは同一オリジン(`taka070600538-tech.github.io`)なので、既存の「cross-originは触らない」判定だけでは**キャッシュされてしまう**。パスでの除外が必須。

- [ ] **Step 1: sw.jsを更新**

- `CACHE_NAME` を `"voice-diary-shell-v3"` に変更
- `SHELL_FILES` の `"app.js"` を `"js/app.js", "js/store.js"` に変更
- fetchハンドラの `if (url.origin !== self.location.origin) return;` の直後に追加:

```js
  // app-sync共有モジュールはキャッシュしない(更新が届かなくなるため)
  if (url.pathname.includes("/app-sync/")) return;
```

- [ ] **Step 2: 構文チェック**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --check sw.js`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git add sw.js && git commit -m "fix: Service Workerのシェル更新とapp-syncモジュールのキャッシュ除外"
```

---

### Task 5: PC側転記スクリプト transcribe.mjs

**Files:**
- Create: `Git/voice-diary-app/tools/transcribe.mjs`
- Create: `Git/voice-diary-app/tests/transcribe.test.js`

**Interfaces:**
- Consumes: `app-data/voice-diary/backup.json`(Task 1の `buildBackup` が書く形式)
- Produces: `01_日記/YYYY-MM-DD.md` のマーカー区間 `<!-- 音声日記:start -->`〜`<!-- 音声日記:end -->`

- [ ] **Step 1: 失敗するテストを書く**

`tests/transcribe.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaySection, upsertSection, datesToTranscribe } from '../tools/transcribe.mjs';

const entries = [
  { id: 'a', date: '2026-08-10', time: '07:15', text: '朝の散歩をした' },
  { id: 'b', date: '2026-08-10', time: '21:00', text: '早めに寝る' },
  { id: 'c', date: '2026-08-11', time: '08:00', text: '  ' },
  { id: 'd', date: '2026-08-12', time: '09:00', text: '今日の分' },
];

test('buildDaySection: 時刻見出し付きで連結する', () => {
  assert.equal(
    buildDaySection(entries, '2026-08-10'),
    '## 07:15\n\n朝の散歩をした\n\n## 21:00\n\n早めに寝る'
  );
});

test('buildDaySection: 空白のみのエントリは除外し、対象なしならnull', () => {
  assert.equal(buildDaySection(entries, '2026-08-11'), null);
  assert.equal(buildDaySection(entries, '2026-01-01'), null);
});

test('datesToTranscribe: 当日を除いた日付昇順(本文のある日のみ)', () => {
  assert.deepEqual(datesToTranscribe(entries, '2026-08-12'), ['2026-08-10']);
});

test('upsertSection: マーカーが無ければ末尾に追記', () => {
  const out = upsertSection('既存の本文\n', 'セクション');
  assert.equal(out, '既存の本文\n\n<!-- 音声日記:start -->\nセクション\n<!-- 音声日記:end -->\n');
});

test('upsertSection: 既存マーカー区間だけを置換し他は触らない', () => {
  const before = '前文\n\n<!-- 音声日記:start -->\n古い内容\n<!-- 音声日記:end -->\n後文\n';
  const out = upsertSection(before, '新しい内容');
  assert.equal(out, '前文\n\n<!-- 音声日記:start -->\n新しい内容\n<!-- 音声日記:end -->\n後文\n');
});

test('upsertSection: CRLFの日記ではCRLFを保つ', () => {
  const out = upsertSection('本文\r\n', 'A\nB');
  assert.equal(out, '本文\r\n\r\n<!-- 音声日記:start -->\r\nA\r\nB\r\n<!-- 音声日記:end -->\r\n');
});

test('upsertSection: 空ファイルにはブロックのみ', () => {
  assert.equal(upsertSection('', 'S'), '<!-- 音声日記:start -->\nS\n<!-- 音声日記:end -->\n');
});
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --test tests/transcribe.test.js`
Expected: FAIL(`tools/transcribe.mjs` が存在しない)

- [ ] **Step 3: tools/transcribe.mjsを実装**

time-diary-appの `tools/transcribe.mjs` と同じ構造。全文:

```js
// app-data/voice-diary/backup.json を読み、Obsidianデイリーノートに転記する。
// マーカー区間を冪等にupsertするため、再実行のたびに最新内容へ自己修復される。
// 日本語パスはこのファイル(UTF-8)内に持つ(.ps1に書くと文字化けするため)。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const START = '<!-- 音声日記:start -->';
const END = '<!-- 音声日記:end -->';
const DEFAULT_BACKUP = String.raw`D:\Obsidian Vault for Claude Code\Git\app-data\voice-diary\backup.json`;
const DEFAULT_DIARY_DIR = String.raw`D:\Obsidian Vault for Claude Code\01_日記`;

export function todayString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// その日のエントリを「## HH:MM + 本文」で連結する。本文のあるエントリが無ければnull。
export function buildDaySection(entries, date) {
  const dayEntries = entries.filter((e) => e.date === date && e.text?.trim());
  if (dayEntries.length === 0) return null;
  return dayEntries.map((e) => `## ${e.time}\n\n${e.text.trim()}`).join('\n\n');
}

// contentの改行スタイルを保ちながら、マーカー区間を冪等に置換(無ければ末尾に追記)する。
// 日記本文の他の部分には一切触れない。
export function upsertSection(content, section) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const block = `${START}${eol}${section.replaceAll('\n', eol)}${eol}${END}${eol}`;
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1) {
    return content.slice(0, startIdx) + block + content.slice(endIdx + END.length).replace(/^\r?\n/, '');
  }
  if (content === '') return block;
  const sep = content.endsWith(eol) ? eol : eol + eol;
  return content + sep + block;
}

// 転記対象の日付(当日は記録が増えるため除外)。本文のある日だけを返す。
export function datesToTranscribe(entries, today) {
  const dates = new Set(entries.filter((e) => e.text?.trim()).map((e) => e.date));
  return [...dates].filter((d) => d < today).sort();
}

// diaryDir配下の各日付ファイルへ、backup.json記載の内容をupsertする。
// action: 'created'(新規ファイル) / 'updated'(内容変更あり) / 'unchanged'(差分なし) / 'error'
export function runTranscription({ entries, diaryDir, today }) {
  const results = [];
  for (const date of datesToTranscribe(entries, today)) {
    const section = buildDaySection(entries, date);
    if (!section) continue;
    const path = join(diaryDir, `${date}.md`);
    try {
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const next = upsertSection(existing, section);
      if (existing === next) {
        results.push({ date, action: 'unchanged' });
      } else {
        writeFileSync(path, next, 'utf8');
        results.push({ date, action: existing === '' ? 'created' : 'updated' });
      }
    } catch (err) {
      results.push({ date, action: 'error', message: err.message });
    }
  }
  return results;
}

function main() {
  const backupPath = process.argv[2] || DEFAULT_BACKUP;
  const diaryDir = process.argv[3] || DEFAULT_DIARY_DIR;
  if (!existsSync(backupPath)) {
    console.log('backup.jsonがまだありません。スキップします');
    return;
  }
  let entries;
  try {
    const data = JSON.parse(readFileSync(backupPath, 'utf8'));
    entries = Array.isArray(data.entries) ? data.entries : null;
  } catch (err) {
    console.log(`backup.jsonを読めません (${err.message})`);
    return;
  }
  if (!entries) {
    console.log('backup.jsonにentriesがありません。スキップします');
    return;
  }
  mkdirSync(diaryDir, { recursive: true });
  const results = runTranscription({ entries, diaryDir, today: todayString() });
  for (const r of results) {
    console.log(r.action === 'error' ? `${r.date}: ERROR (${r.message})` : `${r.date}: ${r.action}`);
  }
  if (results.length === 0) console.log('転記対象なし');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: テスト実行 → 全部PASSを確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && node --test tests/*.test.js`
Expected: PASS(store 6件 + transcribe 7件)

- [ ] **Step 5: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/voice-diary-app" && git add tools/transcribe.mjs tests/transcribe.test.js && git commit -m "feat: backup.jsonから01_日記へのPC側転記スクリプトを追加"
```

---

### Task 6: app-data-pull.ps1への統合と手動同期コマンドの更新

**Files:**
- Modify: `Git/app-sync/tools/app-data-pull.ps1`
- Modify: `Git/call-recording-app/手動で同期するコマンド.md`

**注意:** `.ps1` はBOM付きUTF-8のまま保存すること。スケジュールタスクの削除はこのタスクに**含めない**(最終検証でユーザー確認後に本体が行う)。

- [ ] **Step 1: app-data-pull.ps1のtryブロック末尾(時間管理ダイアリーのifブロックの後)に追加**

```powershell
    # 声日記の記録を01_日記の該当日ファイルへ転記する(冪等)
    $voiceDiaryTranscribe = "D:\Obsidian Vault for Claude Code\Git\voice-diary-app\tools\transcribe.mjs"
    if (Test-Path $voiceDiaryTranscribe) {
        $vdOut = node $voiceDiaryTranscribe | Out-String
        Add-Content -Path $log -Value "[$stamp] 日記転記(声日記): $($vdOut.Trim())" -Encoding UTF8
    }
    # 通話録音リポジトリをpullする(録音日記と音声がVaultへ届く)
    $crRepo = "D:\Obsidian Vault for Claude Code\Git\call-recording-app"
    $crOut = git -C $crRepo pull 2>&1 | Out-String
    Add-Content -Path $log -Value "[$stamp] 通話録音pull: $($crOut.Trim())" -Encoding UTF8
```

- [ ] **Step 2: BOMを確認して修復**

Run(Git Bash): `head -c 3 "D:/Obsidian Vault for Claude Code/Git/app-sync/tools/app-data-pull.ps1" | xxd | head -1`
Expected: `efbb bf`(BOM付き)。BOMが無ければPowerShellで `$c = Get-Content -Raw <path>; [System.IO.File]::WriteAllText(<path>, $c, (New-Object System.Text.UTF8Encoding $true))` で付け直す

- [ ] **Step 3: 手動で同期するコマンド.mdを全文置き換え**

```markdown

毎朝、AppDataGitPullタスク(app-dataのpull・声日記の転記と同時)で自動実行されるが、急ぎで同期したい場合は以下のコマンドをプロンプトで入力する。

Start-ScheduledTask -TaskName "AppDataGitPull"
```

- [ ] **Step 4: 構文チェック**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw 'D:\Obsidian Vault for Claude Code\Git\app-sync\tools\app-data-pull.ps1'), [ref]$null); 'OK'"`
Expected: `OK`

- [ ] **Step 5: コミット(2リポジトリ)**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/app-sync" && git add tools/app-data-pull.ps1 && git commit -m "feat: 声日記の転記と通話録音リポジトリのpullを日次処理に統合"
cd "D:/Obsidian Vault for Claude Code/Git/call-recording-app" && git add 手動で同期するコマンド.md && git commit -m "docs: 手動同期コマンドをAppDataGitPullに更新"
```

---

### Task 7: 通話録音アプリの設定画面改修

**Files:**
- Create: `Git/call-recording-app/app/src/main/java/com/taka0/callrecorder/SecretInput.kt`
- Create: `Git/call-recording-app/app/src/test/java/com/taka0/callrecorder/SecretInputTest.kt`
- Modify: `Git/call-recording-app/app/src/main/res/layout/activity_settings.xml`(全面書き換え)
- Modify: `Git/call-recording-app/app/src/main/java/com/taka0/callrecorder/SettingsActivity.kt`

**Interfaces:**
- Produces: `fun resolveSecretInput(input: String, existing: String): String`(トップレベル関数)

- [ ] **Step 1: 失敗するテストを書く**

`SecretInputTest.kt`:

```kotlin
package com.taka0.callrecorder

import org.junit.Assert.assertEquals
import org.junit.Test

class SecretInputTest {

    @Test
    fun `空欄・空白のみの入力は既存値を保持する`() {
        assertEquals("sk-old", resolveSecretInput("", "sk-old"))
        assertEquals("sk-old", resolveSecretInput("   ", "sk-old"))
    }

    @Test
    fun `入力があればtrimして置き換える`() {
        assertEquals("sk-new", resolveSecretInput(" sk-new ", "sk-old"))
    }

    @Test
    fun `既存値が空でも入力どおり保存できる`() {
        assertEquals("sk-first", resolveSecretInput("sk-first", ""))
    }
}
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/call-recording-app" && ./gradlew testDebugUnitTest --tests "com.taka0.callrecorder.SecretInputTest" 2>&1 | tail -20`
Expected: コンパイルエラー(`resolveSecretInput` 未定義)

- [ ] **Step 3: SecretInput.ktを実装**

```kotlin
package com.taka0.callrecorder

// 秘密情報の入力欄は保存済みの実値を表示しないため、
// 空欄・空白のみの保存は「変更しない」を意味し、既存値を保持する。
fun resolveSecretInput(input: String, existing: String): String {
    val trimmed = input.trim()
    return if (trimmed.isEmpty()) existing else trimmed
}
```

- [ ] **Step 4: テスト実行 → PASSを確認**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/call-recording-app" && ./gradlew testDebugUnitTest --tests "com.taka0.callrecorder.SecretInputTest" 2>&1 | tail -5`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: activity_settings.xmlを全面書き換え**

```xml
<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/settings_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:padding="16dp">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="文字起こし（Whisper）"
            android:textAppearance="?android:attr/textAppearanceMedium"
            android:textStyle="bold" />

        <TextView
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:text="選んだ録音の文字起こしに使うOpenAIのAPIキーです。この端末の中だけに保存されます。"
            android:textAppearance="?android:attr/textAppearanceSmall" />

        <EditText
            android:id="@+id/openai_key_input"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:hint="OpenAI APIキー"
            android:inputType="textPassword" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="24dp"
            android:text="GitHub連携"
            android:textAppearance="?android:attr/textAppearanceMedium"
            android:textStyle="bold" />

        <TextView
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:text="文字起こしした日記と音声の保存先です。トークンはfine-grained PAT（対象にcall-recording-appを含むもの）を使います。"
            android:textAppearance="?android:attr/textAppearanceSmall" />

        <EditText
            android:id="@+id/github_token_input"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="4dp"
            android:hint="GitHub Personal Access Token"
            android:inputType="textPassword" />

        <EditText
            android:id="@+id/github_repo_input"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="リポジトリ（例: user/call-recording-app）"
            android:inputType="textUri" />

        <EditText
            android:id="@+id/github_branch_input"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="ブランチ（既定: main）"
            android:inputType="text" />

        <EditText
            android:id="@+id/github_folder_input"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:hint="保存フォルダ（既定: diary）"
            android:inputType="text" />

        <Button
            android:id="@+id/save_settings_button"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:text="設定を保存" />
    </LinearLayout>
</ScrollView>
```

- [ ] **Step 6: SettingsActivity.ktを改修**

```kotlin
package com.taka0.callrecorder

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var store: SecureSettingsStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        WindowInsetsUtil.applySystemBarPadding(findViewById(R.id.settings_root))
        store = SecureSettingsStore(applicationContext)

        // 秘密情報は実値を表示しない。設定済みならヒントだけ変える(空欄保存=既存値保持)。
        val openAiInput = findViewById<EditText>(R.id.openai_key_input).apply {
            if (store.openAiApiKey.isNotBlank()) hint = "OpenAI APIキー：設定済み（変更時のみ入力）"
        }
        val tokenInput = findViewById<EditText>(R.id.github_token_input).apply {
            if (store.gitHubToken.isNotBlank()) hint = "トークン：設定済み（変更時のみ入力）"
        }
        val repoInput = findViewById<EditText>(R.id.github_repo_input).apply { setText(store.gitHubRepo) }
        val branchInput = findViewById<EditText>(R.id.github_branch_input).apply { setText(store.gitHubBranch) }
        val folderInput = findViewById<EditText>(R.id.github_folder_input).apply { setText(store.gitHubFolder) }

        findViewById<Button>(R.id.save_settings_button).setOnClickListener {
            store.openAiApiKey = resolveSecretInput(openAiInput.text.toString(), store.openAiApiKey)
            store.gitHubToken = resolveSecretInput(tokenInput.text.toString(), store.gitHubToken)
            store.gitHubRepo = repoInput.text.toString().trim()
            store.gitHubBranch = branchInput.text.toString().trim().ifBlank { "main" }
            store.gitHubFolder = folderInput.text.toString().trim().ifBlank { "diary" }
            Toast.makeText(this, "設定を保存しました", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
```

- [ ] **Step 7: 全ユニットテスト実行**

Run: `cd "D:/Obsidian Vault for Claude Code/Git/call-recording-app" && ./gradlew testDebugUnitTest 2>&1 | tail -5`
Expected: BUILD SUCCESSFUL(既存テストも含め全PASS)

- [ ] **Step 8: コミット**

```bash
cd "D:/Obsidian Vault for Claude Code/Git/call-recording-app" && git add app/src/main/res/layout/activity_settings.xml app/src/main/java/com/taka0/callrecorder/SettingsActivity.kt app/src/main/java/com/taka0/callrecorder/SecretInput.kt app/src/test/java/com/taka0/callrecorder/SecretInputTest.kt && git commit -m "feat: 設定画面をセクション化し秘密情報をマスク表示(空欄保存=既存値保持)"
```

---

### Task 8: 過去データの一括転記と最終検証(本体セッションが実施。サブエージェントに委譲しない)

**Files:**
- Modify: `01_日記/2026-08-08.md`(および8/2〜8/5の差分確認)
- 各リポジトリのpush、スケジュールタスクの削除、実機確認依頼

- [ ] **Step 1: 過去データの一括転記** — `Git/voice-diary-app/diary/`(8/2〜8/5、8/8)の各ファイル本文を、`01_日記` の該当日ファイルのマーカー区間へ転記する。8/2〜8/5は既存マーカー区間と内容を突き合わせ(差分があれば旧リポジトリ側を正とする)、8/8はマーカー区間を新規追記する。転記形式は旧ファイルの見出し(`## HH:MM`)ごと写す
- [ ] **Step 2: 全テストの再実行** — voice-diary-app: `node --test tests/*.test.js` / call-recording-app: `./gradlew testDebugUnitTest`。全PASSを確認
- [ ] **Step 3: push** — voice-diary-app・app-sync・call-recording-appの3リポジトリをpush(声日記はPages配信=これがデプロイ)
- [ ] **Step 4: 実ブラウザ検証** — ローカルサーバーでの検証、またはPages反映後のブラウザ検証: 記録→「日記を保存」→localStorage確認、設定画面の3セクション表示とトークンマスク表示、(トークン設定済みなら)「今すぐ保存」→app-dataリポジトリに `voice-diary/backup.json` コミットが増えることを確認
- [ ] **Step 5: transcribe.mjsの実地確認** — backup.jsonが実在すれば `node tools/transcribe.mjs` を実行し01_日記への転記を確認。無ければテスト用JSONを一時フォルダに作り、一時出力先を指定して動作確認(`node tools/transcribe.mjs <backup> <diaryDir>`)
- [ ] **Step 6: app-data-pull.ps1の手動実行** — `powershell -NoProfile -ExecutionPolicy Bypass -File "...\app-sync\tools\app-data-pull.ps1"` を実行し、pull-log.txtに「日記転記(声日記)」「通話録音pull」の行が追加されることを確認
- [ ] **Step 7: 壊れたスケジュールタスクの削除(ユーザー最終確認後)** — `VoiceDiaryGitPull` と `CallRecordingGitPull` を `Unregister-ScheduledTask` で削除
- [ ] **Step 8: ユーザーへの依頼事項を提示** — ①fine-grained PATの対象リポジトリに `call-recording-app` を追加し、通話録音アプリに再入力 ②スマホで声日記を開き直し(SW更新)、設定画面でトークン確認・動作確認 ③Androidアプリの再ビルド・インストール(実機確認)

---

## Self-Review結果

- スペック網羅: 設計1=Task 1-4、設計2=Task 5-6+8(Step 7)、設計3=Task 7、設計4=Task 8(Step 1)。ギャップなし
- プレースホルダ: なし(全ステップに実コード・実コマンドを記載)
- 型整合: `Entry`型・`resolveSecretInput`・`window.vdRenderSettingsSections` の参照はTask間で一致

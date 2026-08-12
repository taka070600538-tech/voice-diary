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

// app-data/voice-diary/backup.json を読み、Obsidianデイリーノートに転記する。
// マーカー区間を冪等にupsertするため、再実行のたびに最新内容へ自己修復される。
// 日本語パスはこのファイル(UTF-8)内に持つ(.ps1に書くと文字化けするため)。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const START = '<!-- 音声日記:start -->';
const END = '<!-- 音声日記:end -->';
const DEFAULT_BACKUP = String.raw`D:\Obsidian Vault for Claude Code\Git\app-data\voice-diary\backup.json`;
const DEFAULT_DIARY_DIR = String.raw`D:\Obsidian Vault for Claude Code\01-NOTE`;

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
    const path = join(diaryDir, `スマホ - ${date}.md`);
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

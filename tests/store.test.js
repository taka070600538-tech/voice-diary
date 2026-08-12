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

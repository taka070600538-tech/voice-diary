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

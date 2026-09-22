import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sw = readFileSync('sw.js', 'utf8');

test('sw.js: プリキャッシュ取得はHTTPキャッシュを迂回する(cache: reload)', () => {
  // GitHub Pagesはmax-age=600で配信するため、通常のfetchだとCACHE_NAMEを上げても
  // ブラウザのHTTPキャッシュから古いJSを取り込んでしまうことがある。
  assert.match(sw, /cache:\s*['"]reload['"]/);
});

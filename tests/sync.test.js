'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
global.LexiTrail = require('../extension/core');
const S = require('../extension/sync');
const C = global.LexiTrail;
const device = '00000000-0000-4000-8000-000000000001';
const material = { schema: 1, model: 'deepseek-flash', promptVersion: 1, queriedAt: 20, meaning: '释义', definition: 'Definition.', example: 'An example.', exampleTranslation: '一个例句。', context: 'A context.' };
function state(status = 'new', updated = 0) {
  return { ...C.emptyState(), words: { apple: { word: 'apple', level: 'A1', status, translation: '苹果', created: 1, updated, statusUpdated: updated, examples: [] } } };
}
test('fresh CEFR initialization keeps earlier explicit learning/mastered states from another device', () => {
  const fresh = C.emptyState(); C.seed(fresh, ['A1'], { apple: 'A1' }, 1000);
  const prior = state('mastered', 100);
  const merged = S.merge(fresh, prior);
  assert.equal(merged.words.apple.status, 'mastered'); assert.equal(merged.words.apple.statusUpdated, 100);
  const reset = state('new', 2000);
  assert.equal(S.merge(merged, reset).words.apple.status, 'new');
});
test('merge preserves first learned material and unions reading examples independently from status', () => {
  const a = state('learning', 100), b = state('mastered', 200);
  a.words.apple.lookup = material; a.words.apple.studySaved = true;
  a.words.apple.examples = [{ text: 'First', url: 'https://example.org', created: 110 }];
  b.words.apple.lookup = { ...material, queriedAt: 30, context: 'Other context.' };
  b.words.apple.examples = [{ text: 'Second', url: 'javascript:alert(1)', created: 210 }];
  const merged = S.merge(a, b);
  assert.equal(merged.words.apple.status, 'mastered'); assert.equal(merged.words.apple.lookup.context, 'A context.');
  assert.equal(merged.words.apple.examples.length, 2); assert.equal(merged.words.apple.examples[0].url, '');
  assert.deepEqual(S.merge(a, b), S.merge(b, a));
  assert.deepEqual(S.merge(merged, merged), merged);
});
test('annotation preference has its own clock; unknown fields and credentials stay local', () => {
  const a = state(), b = state(); a.enabled = false; a.enabledUpdated = 100; b.enabledUpdated = 50;
  a.deepseekKey = 'private value'; a.sessionToken = 'private token'; a.words.apple.secret = 'private';
  const clean = S.snapshot(S.merge(a, b), device);
  assert.equal(clean.state.enabled, false); assert(!JSON.stringify(clean).includes('private'));
  assert(!Object.hasOwn(clean.state, 'deepseekKey')); assert.equal(S.readSnapshot(clean).words.apple.word, 'apple');
});
test('malformed snapshots, bad timestamps and excessive output fail before local replacement', () => {
  assert.throws(() => S.readSnapshot({ app: 'Other', schema: 1, deviceId: device, state: state() }));
  assert.throws(() => S.cleanState(JSON.parse('{"words":{"__proto__":{}},"levels":[]}')));
  const invalid = state(); invalid.words.apple.status = 'anything'; assert.throws(() => S.cleanState(invalid));
  const future = state(); future.words.apple.updated = Date.now() + 86400000; assert.throws(() => S.cleanState(future));
  const large = C.emptyState();
  for (let i = 0; i < 4000; i++) {
    const term = 'word' + i.toString(26).split('').map(x => String.fromCharCode(97 + parseInt(x, 26))).join('');
    large.words[term] = { word: term, status: 'learning', examples: Array.from({ length: 10 }, (_, n) => ({ text: String(n) + 'x'.repeat(399), created: 1 })), created: 1, updated: 1 };
  }
  assert.throws(() => S.snapshot(large, device), /8 MB/);
});
test('local backup format rejects wrong app, invalid records and oversized payloads', () => {
  const C = global.LexiTrail;
  const state = C.emptyState(); C.mark(state, 'forest', 'learning', {}, { text: 'Context.' }, 100);
  const backup = S.backup(state);
  assert.equal(S.readBackup(JSON.stringify(backup)).words.forest.status, 'learning');
  assert.throws(() => S.readBackup(JSON.stringify({ ...backup, app: 'Other' })), /LexiTrail/);
  assert.throws(() => S.readBackup(' '.repeat(S.LIMIT + 1)), /8 MB/);
  backup.state.words.forest.status = 'invalid'; assert.throws(() => S.readBackup(JSON.stringify(backup)), /词条/);
});

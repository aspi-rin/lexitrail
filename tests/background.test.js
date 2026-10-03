'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { worker } = require('./worker-fixture');
test('worker serializes concurrent writes and persists across worker restarts', async () => {
  const w = worker();
  assert((await w.send({ type: 'INITIALIZE', levels: ['A1', 'C1'] })).ok);
  await Promise.all(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(word => w.send({ type: 'MARK_WORD', word, status: 'learning' })));
  const response = await w.send({ type: 'GET_STATE' });
  assert.equal(response.data.counts.learning, 6); assert.equal(response.data.counts.new, 2);
  assert.equal(w.stored.state.words.obscure.level, 'C1');
  assert.equal(w.calls[0].accessLevel, 'TRUSTED_CONTEXTS');
  const restarted = worker(w.stored);
  assert.equal((await restarted.send({ type: 'GET_STATE' })).data.counts.learning, 6);
});
test('only settings page can change key or initialize; public state excludes key', async () => {
  const w = worker(), key = 'sk-' + 'fixture'.repeat(5);
  assert.equal((await w.send({ type: 'SAVE_SETTINGS', enabled: true, key }, 'https://example.org')).ok, false);
  assert.equal((await w.send({ type: 'INITIALIZE', levels: ['A1'] }, 'https://example.org')).ok, false);
  assert((await w.send({ type: 'SAVE_SETTINGS', enabled: false, key })).ok);
  const data = (await w.send({ type: 'GET_STATE' }, 'https://example.org')).data;
  assert(data.hasKey); assert.equal(data.state.enabled, false); assert(!JSON.stringify(data).includes(key));
  assert((await w.send({ type: 'SAVE_SETTINGS', enabled: true, key: '' })).ok); assert.equal(w.stored.deepseekKey, key);
  await w.send({ type: 'SAVE_SETTINGS', enabled: true, clearKey: true }); assert.equal(w.stored.deepseekKey, '');
});
test('AI outage preserves pronunciation and word marking; failed lookup is retryable', async () => {
  const w = worker(); let requests = 0;
  w.context.LexiTrailAPI.deepseek = async () => { requests++; throw new Error('Key 无效，请在设置中更新。'); };
  w.stored.deepseekKey = 'fixture';
  for (let i = 0; i < 2; i++) {
    const response = await w.send({ type: 'LOOKUP', word: 'apple', context: 'An apple.' });
    assert(response.ok); assert.equal(response.data.audio, 'https://dict.youdao.com/dictvoice?audio=apple&type=2'); assert.match(response.data.notice, /Key/);
  }
  assert.equal(requests, 2);
  assert((await w.send({ type: 'MARK_WORD', word: 'apple', status: 'learning' })).ok);
});
const generated = { meaning: '释义', definition: 'An English definition.', partOfSpeech: 'noun', example: 'One example.', exampleTranslation: '一个例句。' };
test('same word deduplicates concurrent and contextual lookups; unstudied results stay volatile', async () => {
  const w = worker(); let requests = 0;
  w.stored.deepseekKey = 'fixture';
  w.context.LexiTrailAPI.deepseek = async () => { requests++; await new Promise(r => setTimeout(r, 5)); return generated; };
  await w.send({ type: 'INITIALIZE', levels: ['A1'] });
  await Promise.all(['Apple', 'apple'].map(word => w.send({ type: 'LOOKUP', word, context: 'First context.' })));
  const result = await w.send({ type: 'LOOKUP', word: 'APPLE', context: 'Other context.' });
  assert.equal(requests, 1); assert.equal(result.data.context, 'First context.');
  assert.equal(w.stored.state.words.apple.translation, '苹果'); assert.equal(w.stored.state.words.apple.lookup, undefined);
  assert(!JSON.stringify((await w.send({ type: 'GET_STATE' })).data).includes('An English definition.'));
  const restarted = worker(w.stored); let fresh = 0;
  restarted.context.LexiTrailAPI.deepseek = async () => { fresh++; return generated; };
  await restarted.send({ type: 'LOOKUP', word: 'apple' }); assert.equal(fresh, 1);
});
test('unlisted word enrolled after lookup retains material and reuses it after restart, key removal and status change', async () => {
  const w = worker(); w.stored.deepseekKey = 'fixture';
  w.context.LexiTrailAPI.deepseek = async () => generated;
  const lookup = await w.send({ type: 'LOOKUP', word: 'quasar', context: 'A quasar shines.' }); assert(lookup.ok);
  assert.equal(w.stored.state, undefined);
  const marked = await w.send({ type: 'MARK_WORD', word: 'quasar', status: 'learning', example: { text: 'A quasar shines.' } });
  assert.equal(marked.data.lookup.exampleTranslation, generated.exampleTranslation);
  assert.equal(marked.data.translation, generated.meaning); assert.equal(marked.data.lookup.model, 'deepseek-flash');
  await w.send({ type: 'MARK_WORD', word: 'quasar', status: 'mastered' });
  await w.send({ type: 'MARK_WORD', word: 'quasar', status: 'new' });
  await w.send({ type: 'SAVE_SETTINGS', enabled: true, clearKey: true });
  const restarted = worker(w.stored);
  restarted.context.LexiTrailAPI.deepseek = async () => { throw new Error('Must reuse saved results'); };
  const result = await restarted.send({ type: 'LOOKUP', word: 'quasar', context: 'Another sense.' });
  assert(result.ok); assert.equal(result.data.example, generated.example); assert.equal(result.data.notice, '');
  assert.equal(result.data.context, 'A quasar shines.'); assert(result.data.queriedAt > 0);
});
test('enrollment before AI completes saves the eventual result and survives concurrent writes', async () => {
  const w = worker(); w.stored.deepseekKey = 'fixture'; let finish, started;
  const begin = new Promise(r => started = r);
  w.context.LexiTrailAPI.deepseek = () => { started(); return new Promise(r => finish = r); };
  const request = w.send({ type: 'LOOKUP', word: 'quasar', context: 'In flight.' });
  await begin;
  await Promise.all(['quasar', 'other'].map(word => w.send({ type: 'MARK_WORD', word, status: 'learning' })));
  finish(generated); assert((await request).ok);
  assert.equal(w.stored.state.words.quasar.lookup.context, 'In flight.');
  assert.equal(w.stored.state.words.other.status, 'learning');
});
test('LRU holds 1000 completed queries, recently reused entries survive, and oldest entries requery', async () => {
  const w = worker(); w.stored.deepseekKey = 'fixture'; let requests = 0;
  w.context.LexiTrailAPI.deepseek = async () => { requests++; return generated; };
  const wordAt = n => 'cache' + n.toString(26).split('').map(c => String.fromCharCode(97 + parseInt(c, 26))).join('');
  for (let i = 0; i < 1000; i++) assert((await w.send({ type: 'LOOKUP', word: wordAt(i) })).ok);
  await w.send({ type: 'LOOKUP', word: wordAt(0) });
  await w.send({ type: 'LOOKUP', word: wordAt(1000) });
  await w.send({ type: 'LOOKUP', word: wordAt(0) }); assert.equal(requests, 1001);
  await w.send({ type: 'LOOKUP', word: wordAt(1) }); assert.equal(requests, 1002);
  assert.equal(vm.runInContext('lookups.size', w.context), 1000);
  assert.equal(w.stored.state, undefined);
});
test('old wordbooks gain translations while preserving states, contexts and existing AI material', async () => {
  const state = { schema: 1, initialized: true, enabled: true, levels: ['A1'], words: {
    apple: { word: 'apple', status: 'new', examples: [{ text: 'Existing context.' }] },
    forest: { word: 'forest', status: 'learning', lookup: { ...generated, context: 'Saved.' } }
  } };
  const w = worker({ state }); const data = (await w.send({ type: 'GET_STATE' })).data;
  assert.equal(data.state.schema, 2); assert.equal(data.state.words.apple.translation, '苹果');
  assert.equal(data.state.words.apple.status, 'new'); assert.equal(data.state.words.apple.examples[0].text, 'Existing context.');
  assert.equal(data.state.words.forest.lookup.context, 'Saved.'); assert.equal(data.state.words.forest.studySaved, true);
  const noKey = await w.send({ type: 'LOOKUP', word: 'apple' }); assert.equal(noKey.data.meaning, '苹果');
});
test('an open card can enroll its displayed result after the worker has stopped and lost its cache', async () => {
  const w = worker(); w.stored.deepseekKey = 'fixture';
  w.context.LexiTrailAPI.deepseek = async () => generated;
  const card = (await w.send({ type: 'LOOKUP', word: 'quasar', context: 'Original card context.' })).data;
  const restarted = worker(w.stored);
  restarted.context.LexiTrailAPI.deepseek = async () => { throw Error('Enrollment must use visible result'); };
  const result = await restarted.send({ type: 'MARK_WORD', word: 'quasar', status: 'learning', lookup: card });
  assert(result.ok); assert.equal(result.data.lookup.context, 'Original card context.');
  assert.equal(result.data.lookup.example, generated.example);
  assert.equal(result.data.translation, generated.meaning);
  const wrongWord = await restarted.send({ type: 'MARK_WORD', word: 'unrelated', status: 'learning', lookup: card });
  assert.equal(wrongWord.data.lookup, null);
  const malformed = await restarted.send({ type: 'MARK_WORD', word: 'another', status: 'learning', lookup: { word: 'another', model: 'deepseek-flash', meaning: 'Incomplete' } });
  assert.equal(malformed.data.lookup, null);
});
test('settings/key/sync operations are restricted to the trusted options page', async () => {
  const w = worker({ deepseekKey: 'test credential' });
  for (const type of ['GET_SETTINGS', 'DRIVE_CONNECT', 'DRIVE_DISCONNECT', 'DRIVE_SYNC']) assert.equal((await w.send({ type }, 'https://example.org')).ok, false);
  assert.equal((await w.send({ type: 'GET_SETTINGS' })).data.key, 'test credential');
  assert(!JSON.stringify((await w.send({ type: 'GET_STATE' })).data).includes('test credential'));
});
test('sync merges remote changes while local marks during upload remain pending without being lost', async () => {
  const w = worker(); await w.send({ type: 'INITIALIZE', levels: ['A1'] });
  const d = vm.runInContext('drive', w.context), C = w.context.LexiTrail;
  let finish, started; const begin = new Promise(r => started = r); let reads = 0;
  const remote = C.emptyState(); C.mark(remote, 'forest', 'mastered', {}, { text: 'Remote context.' }, 100);
  d.load = async () => { reads++; return [{ state: remote }]; };
  d.save = async snapshot => { started(); await new Promise(r => finish = r); w.stored.driveConfig = { lastSyncRevision: snapshot.revision }; };
  d.status = async () => ({ connected: true, dirty: w.stored.state.revision > (w.stored.driveConfig?.lastSyncRevision ?? -1) });
  const sync = w.send({ type: 'DRIVE_SYNC' }); await begin;
  const shared = w.send({ type: 'DRIVE_SYNC' });
  await w.send({ type: 'MARK_WORD', word: 'quasar', status: 'learning' });
  finish(); const result = await sync; assert(result.ok); assert(result.data.dirty);
  assert((await shared).ok); assert.equal(reads, 1);
  assert.equal(w.stored.state.words.forest.status, 'mastered'); assert.equal(w.stored.state.words.quasar.status, 'learning');
});
test('a malformed remote snapshot leaves the existing local wordbook intact', async () => {
  const w = worker(); await w.send({ type: 'INITIALIZE', levels: ['A1'] });
  const original = JSON.stringify(w.stored.state), d = vm.runInContext('drive', w.context);
  d.load = async () => [{ state: { words: { bad: { status: 'invalid' } } } }];
  const result = await w.send({ type: 'DRIVE_SYNC' }); assert.equal(result.ok, false);
  assert.equal(JSON.stringify(w.stored.state), original);
});
test('backups preserve saved learning material, merge local progress, and exclude credentials', async () => {
  const source = worker({ deepseekKey: 'local credential', driveConfig: { clientId: 'private configuration' } });
  await source.send({ type: 'INITIALIZE', levels: ['A1'] });
  source.context.LexiTrailAPI.deepseek = async () => generated;
  const result = (await source.send({ type: 'LOOKUP', word: 'quasar', context: 'Saved context.' })).data;
  await source.send({ type: 'MARK_WORD', word: 'quasar', status: 'learning', lookup: result, example: { text: 'Reading source.' } });
  const backup = (await source.send({ type: 'EXPORT_BACKUP' })).data;
  const text = JSON.stringify(backup);
  assert(!text.includes('local credential')); assert(!text.includes('private configuration'));
  const target = worker({ deepseekKey: 'target credential' });
  await target.send({ type: 'MARK_WORD', word: 'forest', status: 'mastered' });
  assert((await target.send({ type: 'IMPORT_BACKUP', text })).ok);
  assert.equal(target.stored.deepseekKey, 'target credential');
  assert.equal(target.stored.state.words.forest.status, 'mastered');
  assert.equal(target.stored.state.words.quasar.lookup.context, 'Saved context.');
  assert.equal(target.stored.state.words.quasar.examples[0].text, 'Reading source.');
  const before = JSON.stringify(target.stored.state);
  const malformed = await target.send({ type: 'IMPORT_BACKUP', text: '{invalid' });
  assert.equal(malformed.ok, false); assert.equal(JSON.stringify(target.stored.state), before);
  for (const type of ['EXPORT_BACKUP', 'IMPORT_BACKUP']) assert.equal((await target.send({ type, text }, 'https://example.org')).ok, false);
});

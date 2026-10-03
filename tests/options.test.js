'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../extension');
test('wordbook displays offline Chinese and saved bilingual material, rendering generated text safely', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
  const w = dom.window;
  const state = { initialized: true, enabled: true, levels: ['A1'], words: {
    apple: { word: 'apple', status: 'new', level: 'A1', translation: '苹果', examples: [] },
    quasar: { word: 'quasar', status: 'learning', translation: '类星体', examples: [{ text: 'Original reading context.', url: 'https://example.org/article', title: 'Article' }], lookup: {
      partOfSpeech: 'noun', meaning: '<img src=x onerror=alert(1)>', definition: 'A bright galactic nucleus.',
      example: 'A quasar shines.', exampleTranslation: '一颗类星体在闪耀。', context: 'First context.', model: 'deepseek-flash', queriedAt: Date.now()
    } }
  } };
  w.chrome = { runtime: { sendMessage: async message => ({ ok: true, data: message.type === 'GET_LEVELS' ? [] : { state, hasKey: true } }) }, storage: { onChanged: { addListener: () => {} } } };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  const list = w.document.querySelector('#word-list');
  assert(list.textContent.includes('苹果')); assert.equal(list.querySelector('.saved-lookup'), null);
  w.document.querySelector('[data-tab="learning"]').click();
  assert(list.textContent.includes('类星体')); assert(list.textContent.includes('一颗类星体在闪耀。'));
  assert(list.textContent.includes('First context.')); assert(list.textContent.includes('Original reading context.'));
  assert(list.textContent.includes('<img')); assert.equal(list.querySelector('img'), null);
  assert.equal(list.querySelector('a').href, 'https://example.org/article');
  dom.window.close();
});
test('saved key reopens as a masked configured field, can be deleted, and returns to saved state', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
  const w = dom.window, state = { initialized: true, enabled: true, levels: [], words: {} };
  let key = 'fixture credential';
  w.chrome = { runtime: { sendMessage: async m => {
    if (m.type === 'GET_LEVELS') return { ok: true, data: [] };
    if (m.type === 'GET_STATE') return { ok: true, data: { state, hasKey: Boolean(key) } };
    if (m.type === 'GET_SETTINGS') return { ok: true, data: { key, sync: {} } };
    if (m.type === 'SAVE_SETTINGS') { if (m.clearKey) key = ''; else if (m.key) key = m.key; return { ok: true, data: {} }; }
  } }, storage: { onChanged: { addListener: () => {} } } };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  const input = w.document.querySelector('#api-key'), button = w.document.querySelector('#save-key');
  assert.equal(input.value, 'fixture credential'); assert.equal(input.type, 'password');
  assert.equal(w.document.querySelector('#key-action-label').textContent, '已配置'); assert.equal(button.title, '删除 Key');
  w.document.querySelector('#key-visibility').click(); assert.equal(input.type, 'text');
  button.click(); await new Promise(r => setTimeout(r, 10)); assert.equal(key, ''); assert.equal(input.value, '');
  assert.equal(w.document.querySelector('#key-action-label').textContent, '保存');
  input.value = 'replacement credential'; input.dispatchEvent(new w.Event('input')); button.click();
  await new Promise(r => setTimeout(r, 10)); assert.equal(key, 'replacement credential'); assert.equal(input.type, 'password');
  assert(button.classList.contains('key-configured')); dom.window.close();
});
test('Google sign-in uses shared app configuration and pending registration keeps login disabled', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
  const w = dom.window, state = { initialized: true, enabled: true, levels: [], words: {} }, calls = [];
  let configured = false, connected = false, refresh;
  w.chrome = { runtime: { sendMessage: async m => {
    calls.push(m);
    return { ok: true, data: m.type === 'GET_LEVELS' ? [] : m.type === 'GET_STATE' ? { state, hasKey: false } : m.type === 'GET_SETTINGS' ? { key: '', sync: { configured, supported: true, connected } } : (connected = true, { configured, connected }) };
  } }, storage: { onChanged: { addListener: f => refresh = f } } };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  const button = w.document.querySelector('#drive-connect'); assert(button.disabled); assert.equal(w.document.querySelector('#drive-client'), null);
  assert(w.document.querySelector('#sync-status').textContent.includes('待应用配置'));
  configured = true; refresh({ state: {} }); await new Promise(r => setTimeout(r, 10)); assert(!button.disabled);
  button.click(); await new Promise(r => setTimeout(r, 10));
  const request = calls.find(m => m.type === 'DRIVE_CONNECT'); assert.deepEqual(Object.keys(request), ['type']);
  assert(!w.document.querySelector('#drive-sync').disabled); assert(w.document.querySelector('#sync-status').textContent.includes('已连接'));
  dom.window.close();
});
test('backup buttons download a JSON payload and read a selected file through the trusted worker', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
  const w = dom.window, state = { initialized: true, enabled: true, levels: [], words: {} }, calls = [];
  const backup = { app: 'LexiTrailBackup', schema: 1, state };
  let blob, filename;
  w.Blob = Blob; w.URL.createObjectURL = value => { blob = value; return 'blob:fixture'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  w.chrome = { runtime: { sendMessage: async m => {
    calls.push(m);
    return { ok: true, data: m.type === 'GET_LEVELS' ? [] : m.type === 'GET_STATE' ? { state, hasKey: false } : m.type === 'GET_SETTINGS' ? { key: '', sync: {} } : m.type === 'EXPORT_BACKUP' ? backup : { count: 1 } };
  } }, storage: { onChanged: { addListener: () => {} } } };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 10));
  w.document.querySelector('#export-backup').click(); await new Promise(r => setTimeout(r, 10));
  assert.equal(blob.type, 'application/json'); assert.deepEqual(JSON.parse(await blob.text()), backup); assert.match(filename, /^lexitrail-backup-.*\.json$/);
  const input = w.document.querySelector('#backup-file'), text = JSON.stringify(backup);
  Object.defineProperty(input, 'files', { value: [{ size: text.length, text: async () => text }], configurable: true });
  input.dispatchEvent(new w.Event('change')); await new Promise(r => setTimeout(r, 10));
  assert.equal(calls.find(m => m.type === 'IMPORT_BACKUP').text, text);
  assert(w.document.querySelector('#message').textContent.includes('备份已合并'));
  dom.window.close();
});

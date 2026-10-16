'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const { worker } = require('./worker-fixture');
const root = path.join(__dirname, '../extension');

test('an unresponsive reading tab cannot freeze marking and leave the wordbook at zero with inert navigation', async () => {
  const backend = worker({ state: { initialized: true, enabled: true, levels: ['A1'], revision: 1,
    words: { apple: { word: 'apple', status: 'new', level: 'A1', examples: [] } } } });
  let broadcast;
  const notified = new Promise(resolve => { broadcast = resolve; });
  backend.context.chrome.tabs.sendMessage = () => { broadcast(); return new Promise(() => {}); };
  let marked = false;
  const mark = backend.send({ type: 'MARK_WORD', word: 'apple', status: 'learning' }).then(result => { marked = result.ok; });
  await notified;
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), {
    url: 'https://example.org/options.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.chrome = { runtime: { sendMessage: backend.send }, storage: { onChanged: { addListener() {} } } };
  try {
    w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(w.document.querySelector('#count-learning').textContent, '1', 'saved vocabulary must load while a tab does not answer');
    w.document.querySelector('[data-tab="settings"]').click();
    assert.equal(w.document.querySelector('#settings').hidden, false, 'settings navigation must remain usable');
    assert.equal(marked, true, 'mark must finish without waiting for a reading tab');
    await mark;
  } finally { dom.window.close(); }
});

for (const queryStalls of [false, true]) {
  test(`all persisted changes and state reads finish when tab ${queryStalls ? 'discovery' : 'delivery'} stalls`, async () => {
    const backend = worker({ state: { initialized: false, enabled: true, levels: [], words: {}, revision: 1 } });
    const delivered = [];
    backend.context.chrome.tabs.query = () => queryStalls ? new Promise(() => {}) : Promise.resolve([{ id: 7 }, { id: 8 }]);
    backend.context.chrome.tabs.sendMessage = id => { delivered.push(id); return id === 7 ? new Promise(() => {}) : Promise.resolve(); };
    const messages = [
      { type: 'INITIALIZE', levels: ['A1'] },
      { type: 'MARK_WORD', word: 'apple', status: 'learning' },
      { type: 'SAVE_SETTINGS', enabled: false },
      { type: 'SET_SITE_ENABLED', site: 'example.org', enabled: false },
      { type: 'IMPORT_BACKUP', text: JSON.stringify({ app: 'LexiTrailBackup', schema: 1,
        state: { initialized: true, enabled: true, levels: [], words: { forest: { word: 'forest', status: 'learning', updated: 1, statusUpdated: 1, examples: [] } } } }) }
    ];
    let timeout;
    try {
      const result = await Promise.race([
        (async () => {
          for (const message of messages) {
            const sender = message.type === 'SET_SITE_ENABLED' ? 'chrome-extension://fixture/popup.html' : undefined;
            const response = await backend.send(message, sender);
            assert.equal(response.ok, true, `${message.type}: ${response.error}`);
            assert.equal((await backend.send({ type: 'GET_STATE' })).ok, true);
          }
          return true;
        })(),
        new Promise(resolve => { timeout = setTimeout(() => resolve(false), 250); })
      ]);
      assert.equal(result, true, 'a tab must not hold the write queue or subsequent state reads');
      assert.equal(backend.stored.state.words.apple.status, 'learning');
      assert.equal(backend.stored.state.words.forest.status, 'learning');
      if (!queryStalls) assert(delivered.includes(8), 'healthy tabs still receive the update');
    } finally { clearTimeout(timeout); }
  });
}

test('notification failures do not report a persisted word change as failed', async () => {
  const backend = worker();
  backend.context.chrome.tabs.query = async () => { throw new Error('tab query unavailable'); };
  const response = await backend.send({ type: 'MARK_WORD', word: 'apple', status: 'learning' });
  assert.equal(response.ok, true);
  assert.equal((await backend.send({ type: 'GET_STATE' })).data.state.words.apple.status, 'learning');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../extension');
const wait = ms => new Promise(r => setTimeout(r, ms));
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
// The popup learns the hostname from the page's content script (no tabs/activeTab
// permission) and asks the worker whether that site is disabled.
async function popup({ site = 'www.example.com', disabled = [] } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), { url: 'https://example.org/popup.html', runScripts: 'outside-only' });
  const w = dom.window, sites = new Set(disabled), calls = [], tabMessages = [];
  w.chrome = {
    tabs: {
      query: async query => { calls.push({ query }); return [{ id: 7 }]; },
      sendMessage: async (id, message) => {
        tabMessages.push({ id, message });
        if (!site) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { site };
      }
    },
    runtime: {
      openOptionsPage: () => {},
      sendMessage: async m => {
        calls.push(m);
        if (m.type === 'GET_STATE') return { ok: true, data: { state: { initialized: true, words: {} }, counts: { new: 1200, learning: 3, mastered: 4 }, siteDisabled: sites.has(m.site) } };
        if (m.type === 'SET_SITE_ENABLED') { if (m.enabled) sites.delete(m.site); else sites.add(m.site); return { ok: true, data: { site: m.site, siteDisabled: !m.enabled } }; }
        return { ok: false, error: 'unknown' };
      }
    }
  };
  w.eval(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'));
  await wait(10);
  const $ = selector => w.document.querySelector(selector);
  return { dom, w, $, sites, calls, tabMessages };
}
test('popup shows the active site and toggles its disabled state through the worker', async () => {
  const p = await popup(), toggle = p.$('#site-switch');
  same(p.calls[0], { query: { active: true, currentWindow: true } });
  same(p.tabMessages, [{ id: 7, message: { type: 'GET_SITE' } }]);
  same(p.calls.find(m => m.type === 'GET_STATE'), { type: 'GET_STATE', site: 'www.example.com' });
  assert.equal(p.$('#new').textContent, (1200).toLocaleString());
  assert.equal(p.$('#site-host').textContent, 'www.example.com');
  assert.equal(toggle.getAttribute('role'), 'switch'); assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.match(toggle.getAttribute('aria-label'), /www\.example\.com/);
  toggle.click(); await wait(10);
  same(p.calls.at(-1), { type: 'SET_SITE_ENABLED', site: 'www.example.com', enabled: false });
  assert(p.sites.has('www.example.com'));
  assert.equal(toggle.getAttribute('aria-checked'), 'false'); assert.equal(toggle.disabled, false);
  assert.match(p.$('#site-host').textContent, /已关闭/);
  toggle.click(); await wait(10);
  same(p.calls.at(-1), { type: 'SET_SITE_ENABLED', site: 'www.example.com', enabled: true });
  assert(!p.sites.has('www.example.com')); assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(p.$('#site-host').textContent, 'www.example.com');
  p.dom.window.close();
});
test('popup reopened on a disabled site shows the switch off', async () => {
  const p = await popup({ disabled: ['www.example.com'] });
  assert.equal(p.$('#site-switch').getAttribute('aria-checked'), 'false');
  assert.match(p.$('#site-host').textContent, /www\.example\.com/);
  p.dom.window.close();
});
test('pages without the content script show a disabled switch and an unsupported hint', async () => {
  const p = await popup({ site: '' }), toggle = p.$('#site-switch');
  assert.equal(toggle.disabled, true); assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(p.$('#site-host').textContent, '当前页面不支持');
  assert.equal(p.$('#new').textContent, (1200).toLocaleString());
  toggle.click(); await wait(10);
  assert(!p.calls.some(m => m.type === 'SET_SITE_ENABLED'));
  p.dom.window.close();
});

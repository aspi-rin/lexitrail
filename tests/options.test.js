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
test('single sun/moon button follows system initially, toggles opposite and persists across reloads', async () => {
  const open = (dark, preference = '') => {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
    const w = dom.window; let changed;
    const media = { matches: dark, addEventListener: (_, fn) => changed = fn };
    w.matchMedia = () => media; if (preference) w.localStorage.setItem('lexitrail-theme', preference);
    w.chrome = { runtime: { sendMessage: async m => ({ ok: true, data: m.type === 'GET_LEVELS' ? [] : m.type === 'GET_STATE' ? { state: { initialized: true, enabled: true, levels: [], words: {} } } : {} }) }, storage: { onChanged: { addListener: () => {} } } };
    w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
    return { dom, w, media, change: () => changed() };
  };
  for (const dark of [false, true]) {
    const f = open(dark); const button = f.w.document.querySelector('#theme-toggle');
    assert.equal(f.w.document.documentElement.dataset.theme, undefined); assert.equal(button.title, dark ? '切换为浅色' : '切换为深色');
    assert.equal(f.w.document.querySelector('#theme-sun').hasAttribute('hidden'), !dark);
    button.click(); const chosen = dark ? 'light' : 'dark'; assert.equal(f.w.document.documentElement.dataset.theme, chosen);
    assert.equal(f.w.localStorage.getItem('lexitrail-theme'), chosen);
    f.media.matches = !dark; f.change(); assert.equal(f.w.document.documentElement.dataset.theme, chosen);
    const reload = open(dark, chosen); assert.equal(reload.w.document.documentElement.dataset.theme, chosen);
    await new Promise(r => setTimeout(r, 10)); f.dom.window.close(); reload.dom.window.close();
  }
});
test('WebDAV permission is requested in click gesture, password clears after save and denied permission sends no credentials', async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'options.html'), 'utf8'), { url: 'https://example.org/options.html', runScripts: 'outside-only' });
  const w = dom.window, calls = [], permissions = []; let allowed = false, configured = false;
  w.chrome = { permissions: { request: input => { permissions.push(input.origins[0]); return Promise.resolve(allowed); } }, runtime: { sendMessage: async m => {
    calls.push(m);
    if (m.type === 'GET_LEVELS') return { ok:true, data:[] };
    if (m.type === 'GET_STATE') return { ok:true, data:{state:{initialized:true,enabled:true,levels:[],words:{}}} };
    if (m.type === 'GET_SETTINGS') return { ok:true, data:{provider:'webdav',webdav:{configured,connected:configured,url:configured?'https://dav.example/dav/':'',username:configured?'fixture-user':''}} };
    if (m.type === 'WEBDAV_CONNECT') configured = true;
    return { ok:true, data:{} };
  } }, storage: { onChanged: { addListener: () => {} } } };
  for (const file of ['core.js','webdav.js','options.js']) w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  await new Promise(r => setTimeout(r, 10));
  const input = w.document.querySelector('#webdav-password'), button = w.document.querySelector('#webdav-connect');
  w.document.querySelector('#webdav-url').value = 'https://dav.example/dav'; w.document.querySelector('#webdav-username').value = 'fixture-user'; input.value = 'fixture-password';
  button.click(); assert.deepEqual(permissions,['https://dav.example/*']);
  await new Promise(r => setTimeout(r,10)); assert(!calls.some(m=>m.type==='WEBDAV_CONNECT'));
  allowed = true; button.click(); await new Promise(r => setTimeout(r,10));
  assert.equal(calls.find(m=>m.type==='WEBDAV_CONNECT').password,'fixture-password'); assert.equal(input.value,''); assert(input.placeholder.includes('已保存'));
  assert(!w.document.querySelector('#drive-sync').disabled);
  input.value = 'replacement'; input.dispatchEvent(new w.Event('input')); assert(w.document.querySelector('#drive-sync').disabled);
  dom.window.close();
});

test('WebDAV rejected credentials persist through page reload and sync remains available with a nearby error', async () => {
  global.LexiTrail = require('../extension/core'); global.LexiTrailSync = require('../extension/sync');
  const D = require('../extension/webdav'), local = {state:{initialized:true,enabled:true,levels:['A1'],words:{},revision:1}}, calls = [];
  let response = () => new Response('private server body',{status:401});
  const chrome = {permissions:{request:async()=>true,contains:async()=>true},storage:{local:{
    get:async key=>({[key]:structuredClone(local[key])}),set:async data=>Object.assign(local,structuredClone(data))
  },onChanged:{addListener:()=>{}}}};
  let dav = D.create(chrome,(...args)=>response(...args));
  chrome.runtime = {sendMessage:async m=>{
    calls.push(m.type);
    try {
      let data;
      if (m.type==='GET_LEVELS') data=[];
      else if (m.type==='GET_STATE') data={state:local.state,hasKey:false};
      else if (m.type==='GET_SETTINGS') data={provider:'webdav',webdav:await dav.status(),sync:{}};
      else if (m.type==='WEBDAV_CONNECT') data=await dav.connect(m);
      else if (m.type==='WEBDAV_SYNC') {await dav.load();await dav.save(local.state);data={words:0};}
      return {ok:true,data};
    } catch(e) {return {ok:false,error:e.message};}
  }};
  const open = async () => {
    const dom = new JSDOM(fs.readFileSync(path.join(root,'options.html'),'utf8'),{url:'https://example.org/options.html',runScripts:'outside-only'});
    dom.window.chrome=chrome;
    for (const file of ['core.js','webdav.js','options.js']) dom.window.eval(fs.readFileSync(path.join(root,file),'utf8'));
    await new Promise(r=>setTimeout(r,15)); dom.window.document.querySelector('[data-tab="settings"]').click();
    return dom;
  };
  let dom=await open(), w=dom.window;
  for (const [id,value] of [['webdav-url','https://dav.example/dav/'],['webdav-username','fixture-user'],['webdav-password','fixture-password']]) {
    const input=w.document.querySelector('#'+id);input.value=value;input.dispatchEvent(new w.Event('input'));
  }
  w.document.querySelector('#webdav-connect').click();await new Promise(r=>setTimeout(r,20));
  const feedback=w.document.querySelector('#sync-message');
  assert(!feedback.hidden);assert(feedback.classList.contains('error'));assert.match(feedback.textContent,/已保存到本机.*验证失败/);
  assert(!w.document.querySelector('#drive-sync').disabled);assert.equal(w.document.querySelector('#webdav-password').value,'');
  dom.window.close(); dav=D.create(chrome,(...args)=>response(...args)); dom=await open();w=dom.window;
  assert.equal(w.document.querySelector('#webdav-url').value,'https://dav.example/dav/');
  assert.equal(w.document.querySelector('#webdav-username').value,'fixture-user');
  assert(w.document.querySelector('#webdav-password').placeholder.includes('已保存'));
  assert.match(w.document.querySelector('#sync-status').textContent,/已保存.*验证失败/);
  const sync=w.document.querySelector('#drive-sync');assert(!sync.disabled);
  sync.click();await new Promise(r=>setTimeout(r,20));assert.match(w.document.querySelector('#sync-message').textContent,/密码无效/);assert(!sync.disabled);
  response=(url,opts)=>opts.method==='PROPFIND'?new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(url).pathname}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207}):new Response(null,{status:204});
  sync.click();await new Promise(r=>setTimeout(r,20));
  assert.match(w.document.querySelector('#sync-message').textContent,/词本已同步/);assert(!w.document.querySelector('#sync-message').classList.contains('error'));
  assert.match(w.document.querySelector('#sync-status').textContent,/已保存并验证/);assert.equal(calls.filter(t=>t==='WEBDAV_SYNC').length,2);
  dom.window.close();
});

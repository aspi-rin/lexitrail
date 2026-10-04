'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
global.LexiTrail = require('../extension/core'); global.LexiTrailSync = require('../extension/sync');
const D = require('../extension/webdav');
const device = '00000000-0000-4000-8000-000000000001', name = `lexitrail-device-${device}.json`;
const item = (href, collection = false, status = 200) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 ${status} OK</d:status></d:propstat></d:response>`;
const listing = entries => new Response(`<d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`, { status: 207 });
function fixture() {
  const local = {}, calls = []; let permission = true;
  const chrome = { storage: { local: { get: async key => ({ [key]: local[key] }), set: async data => Object.assign(local, data) } }, permissions: { contains: async () => permission } };
  let response = (url, options) => options.method === 'PROPFIND' ? listing([item(new URL(url).pathname, true)]) : new Response(null, { status: 201 });
  const dav = D.create(chrome, async (url, options) => { calls.push({ url, options }); return response(url, options); });
  const connect = () => dav.connect({ url: 'https://dav.example/dav/', username: 'fixture-user', password: 'fixture-password' });
  return { local, calls, dav, chrome, connect, permission: value => permission = value, respond: f => response = f };
}
test('WebDAV validation requires HTTPS, explicit address permission and valid separate credentials', async () => {
  for (const url of ['http://dav.example/dav/', 'https://name:pass@dav.example/', 'https://dav.example/?key=a', 'https://dav.example/#x']) assert.throws(() => D.endpoint(url));
  assert.equal(D.endpoint('https://dav.example/dav'), 'https://dav.example/dav/');
  const f = fixture(); f.permission(false); await assert.rejects(f.connect(), /允许访问/); assert.equal(f.calls.length, 0);
  f.permission(true); await assert.rejects(f.dav.connect({ url: 'https://dav.example/', username: 'invalid:user', password: 'x' }), /账号/);
  await f.connect(); assert((await f.dav.status()).connected);
  assert(!JSON.stringify(await f.dav.status()).includes('fixture-password'));
  for (const { options } of f.calls) { assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert(options.signal); }
  const original = structuredClone(f.local.webdavConfig);
  f.respond(() => new Response('private body', { status: 401 }));
  await assert.rejects(f.dav.connect({ url: 'https://other.example/', username: 'new', password: 'new-password' }), /密码无效/);
  assert.deepEqual(f.local.webdavConfig, original);
});
test('password stays local, empty password preserves same account, clearing connection removes credentials and preserves device identity', async () => {
  const f = fixture(); await f.connect(); const id = f.local.webdavConfig.deviceId;
  await f.dav.connect({ url: 'https://dav.example/dav', username: 'fixture-user', password: '' });
  assert.equal(f.local.webdavConfig.password, 'fixture-password');
  await assert.rejects(f.dav.connect({ url: 'https://dav.example/else/', username: 'fixture-user', password: '' }), /账号/);
  await f.dav.disconnect(); assert.deepEqual(f.local.webdavConfig, { deviceId: id });
  assert.equal((await f.dav.status()).configured, false); await assert.rejects(f.dav.load(), /先保存/);
});
test('missing app folder is created, all device snapshots load, own PUT is idempotent and excludes config secrets', async () => {
  const f = fixture(); await f.connect(); f.local.webdavConfig.deviceId = device;
  let exists = false; const snapshot = global.LexiTrailSync.snapshot(global.LexiTrail.emptyState(), device);
  f.respond((url, options) => {
    if (options.method === 'MKCOL') { exists = true; return new Response(null, { status: 201 }); }
    if (options.method === 'PROPFIND') return exists ? listing([item('/dav/LexiTrail/', true), item('/dav/LexiTrail/' + name)]) : new Response(null, { status: 404 });
    if (options.method === 'PUT') return new Response(null, { status: 204 });
    return new Response(JSON.stringify(snapshot));
  });
  const remote = await f.dav.load(); assert.equal(remote.length, 1);
  const state = global.LexiTrail.emptyState(); state.revision = 7; state.webdavConfig = { password: 'fixture-password' }; state.deepseekKey = 'local-secret';
  await f.dav.save(state); await f.dav.save(state);
  const uploads = f.calls.filter(c => c.options.method === 'PUT'); assert.equal(uploads.length, 2); assert.equal(uploads[0].url, uploads[1].url);
  assert(!uploads[0].options.body.includes('fixture-password')); assert(!uploads[0].options.body.includes('local-secret'));
  assert.equal(f.local.webdavConfig.lastSyncRevision, 7); assert(f.local.webdavConfig.lastSync > 0);
  f.permission(false); await assert.rejects(f.dav.load(), /撤销/);
});
test('DAV namespace prefixes/default namespace and entity-encoded hrefs are parsed, directories and unrelated files are skipped', () => {
  const xml = `<multistatus xmlns="DAV:">${item('/dav/LexiTrail/', true).replaceAll('d:', '')}${item('/dav/LexiTrail/' + name).replaceAll('d:', '')}${item('/dav/LexiTrail/unrelated.txt').replaceAll('d:', '')}</multistatus>`;
  assert.deepEqual(D.files(xml, 'https://dav.example/dav/LexiTrail/'), ['https://dav.example/dav/LexiTrail/' + name]);
  assert.deepEqual(D.files(`<d:multistatus xmlns:d="DAV:">${item('/dav/LexiTrail/', true)}${item('/dav/LexiTrail/' + name.replace('lexitrail-', 'lexitrail&#x2d;'))}</d:multistatus>`, 'https://dav.example/dav/LexiTrail/'), ['https://dav.example/dav/LexiTrail/' + name]);
  assert.deepEqual(D.files(`<x:multistatus xmlns:x="DAV:">${item('/dav/LexiTrail/', true).replaceAll('d:', 'x:')}${item('https://dav.example/dav/LexiTrail/' + name).replaceAll('d:', 'x:')}</x:multistatus>`, 'https://dav.example/dav/LexiTrail/'), ['https://dav.example/dav/LexiTrail/' + name]);
});
test('XML declarations, truncation, failed resources and hostile hrefs fail before sending credentials to another path or origin', async () => {
  const f = fixture(); await f.connect();
  const originalCalls = f.calls.length;
  for (const href of ['https://evil.example/' + name, '/dav/other/' + name, '../' + name, '/dav/LexiTrail/' + name + '?x=1', 'https://u:p@dav.example/dav/LexiTrail/' + name]) {
    f.respond(() => listing([item(href)])); await assert.rejects(f.dav.load(), /超出/);
  }
  assert.equal(f.calls.length, originalCalls + 5); assert(f.calls.every(c => new URL(c.url).origin === 'https://dav.example'));
  for (const xml of ['<!DOCTYPE x [<!ENTITY s SYSTEM "file:///etc/passwd">]><d:multistatus xmlns:d="DAV:"/>', '<d:multistatus xmlns:d="DAV:">', '<html/>', '<d:multistatus xmlns:d="DAV:"><d:response><d:href>&unknown;</d:href></d:response></d:multistatus>']) {
    f.respond(() => new Response(xml, { status: 207 })); await assert.rejects(f.dav.load(), /XML|无效/);
  }
  f.respond(() => listing([item('/dav/LexiTrail/' + name, false, 403)])); await assert.rejects(f.dav.load(), /无法读取/);
});
test('bad JSON, wrong device ID, oversized streamed data and server errors are bounded without private body disclosure', async () => {
  const f = fixture(); await f.connect();
  for (const content of ['invalid JSON', JSON.stringify({ ...global.LexiTrailSync.snapshot(global.LexiTrail.emptyState(), '00000000-0000-4000-8000-000000000002') })]) {
    f.respond((url, opts) => opts.method === 'PROPFIND' ? listing([item('/dav/LexiTrail/', true), item('/dav/LexiTrail/' + name)]) : new Response(content));
    await assert.rejects(f.dav.load(), /JSON|设备标识/);
  }
  f.respond(() => new Response('x', { status: 207, headers: { 'Content-Length': String(global.LexiTrailSync.LIMIT + 1) } }));
  await assert.rejects(f.dav.load(), /8 MB/);
  f.respond(() => new Response('x'.repeat(global.LexiTrailSync.LIMIT + 1), { status: 207 })); await assert.rejects(f.dav.load(), /8 MB/);
  for (const status of [401, 403, 507]) {
    f.respond(() => new Response('private password body', { status }));
    await assert.rejects(f.dav.load(), e => !e.message.includes('private') && /WebDAV/.test(e.message));
  }
  f.respond(() => { throw Error('private credentials and redirect'); });
  await assert.rejects(f.dav.load(), e => !e.message.includes('private') && /重定向/.test(e.message));
});
test('two independent clients converge through per-device PUT snapshots and a third manual sync', async () => {
  const stored = new Map(); let folder = false;
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    if (options.method === 'MKCOL') { folder = true; return new Response(null, {status:201}); }
    if (options.method === 'PUT') { stored.set(path, options.body); return new Response(null,{status:204}); }
    if (options.method === 'PROPFIND') {
      if (path.endsWith('LexiTrail/') && !folder) return new Response(null,{status:404});
      return listing([item(path,true), ...(options.headers.Depth === '1' ? [...stored.keys()].map(key=>item(key)) : [])]);
    }
    return new Response(stored.get(path));
  };
  const a = fixture(), b = fixture();
  const left = D.create(a.chrome, request), right = D.create(b.chrome, request);
  const input = {url:'https://dav.example/dav/',username:'fixture-user',password:'fixture-password'};
  await left.connect(input); await right.connect(input);
  assert.notEqual(a.local.webdavConfig.deviceId,b.local.webdavConfig.deviceId);
  const alpha = global.LexiTrail.emptyState(), beta = global.LexiTrail.emptyState();
  global.LexiTrail.mark(alpha,'alpha','learning',{}, {text:'Alpha context.'},100);
  global.LexiTrail.mark(beta,'beta','mastered',{}, {text:'Beta context.'},100);
  const sync = async (client,state) => {
    let merged = state; for (const snapshot of await client.load()) merged = global.LexiTrailSync.merge(merged,snapshot.state);
    await client.save(merged); return merged;
  };
  await sync(left,alpha); const second = await sync(right,beta), third = await sync(left,alpha);
  assert.deepEqual(Object.keys(second.words).sort(),['alpha','beta']); assert.deepEqual(third.words,second.words);
  assert.equal(stored.size,2); assert([...stored.values()].every(value=>!value.includes('fixture-password')));
});

'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
global.LexiTrail = require('../extension/core'); global.LexiTrailSync = require('../extension/sync');
const D = require('../extension/google-drive');
const device = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const local = {}, temporary = {}, calls = [];
  const store = object => ({ setAccessLevel: async () => {}, get: async key => ({ [key]: object[key] }), set: async data => Object.assign(object, data), remove: async key => { delete object[key]; } });
  let issued = false;
  const revoked = [];
  const chrome = { runtime: { getManifest: () => ({ oauth2: { client_id: 'fixture.apps.googleusercontent.com', scopes: [D.SCOPE] } }) },
    storage: { local: store(local), session: store(temporary) }, identity: {
      getAuthToken: async ({ interactive }) => {
        if (interactive) issued = true;
        if (!issued) throw Error('fixture signed out');
        return { token: 'fixture-token', grantedScopes: [D.SCOPE] };
      },
      removeCachedAuthToken: async ({ token }) => { revoked.push(token); issued = false; }
    } };
  let response = () => new Response(JSON.stringify({ files: [] }));
  const drive = D.create(chrome, async (url, options) => { calls.push({ url, options }); return response(url, options); });
  return { chrome, drive, local, temporary, calls, revoked, respond: f => response = f };
}
test('native OAuth uses the manifest identity and keeps tokens outside extension storage', async () => {
  const f = fixture(); f.temporary.driveAuth = { token: 'legacy token' };
  const requests = [];
  f.chrome.identity.getAuthToken = async request => { requests.push(request); return { token: 'fixture-token', grantedScopes: [D.SCOPE] }; };
  const status = await f.drive.connect();
  assert(status.connected); assert(status.configured);
  assert(!JSON.stringify(status).includes('fixture-token'));
  assert(!JSON.stringify(f.local).includes('fixture-token')); assert.deepEqual(f.temporary, {});
  assert.deepEqual(requests[0], { interactive: true, scopes: [D.SCOPE], enableGranularPermissions: true });
  await f.drive.disconnect(); assert.deepEqual(f.revoked, ['fixture-token']); assert.equal((await f.drive.status()).connected, false);
});
test('missing app configuration, unsupported browser, cancelled consent and denied scope are actionable', async () => {
  const f = fixture(); f.chrome.runtime.getManifest = () => ({});
  const pending = D.create(f.chrome); assert.equal((await pending.status()).configured, false);
  await assert.rejects(pending.connect(), /应用配置/);
  delete f.chrome.identity.getAuthToken;
  const unsupported = D.create(f.chrome); await assert.rejects(unsupported.connect(), /应用配置/);
  f.chrome.runtime.getManifest = () => ({ oauth2: { client_id: 'fixture.apps.googleusercontent.com', scopes: [D.SCOPE] } });
  await assert.rejects(D.create(f.chrome).connect(), /Chrome/);
  f.chrome.identity.getAuthToken = async () => { throw Error('private provider response'); };
  await assert.rejects(D.create(f.chrome).connect(), e => /未完成/.test(e.message) && !e.message.includes('private'));
  f.chrome.identity.getAuthToken = async () => ({ token: 'denied-scope', grantedScopes: [] });
  await assert.rejects(D.create(f.chrome).connect(), /应用数据权限/); assert(f.revoked.includes('denied-scope'));
});
test('worker recreation resumes native cached authorization, expiry requires explicit sign-in, and old client does not carry connection', async () => {
  const f = fixture(); await f.drive.connect();
  const resumed = D.create(f.chrome, async () => new Response(JSON.stringify({ files: [] })));
  assert((await resumed.status()).connected); await resumed.load();
  f.chrome.identity.getAuthToken = async () => { throw Error('cached auth expired'); };
  await assert.rejects(resumed.load(), /重新登录/); assert.equal((await resumed.status()).connected, false);
  f.local.driveConfig = { clientId: 'other.apps.googleusercontent.com', connected: true, lastSync: 10 };
  assert.equal((await resumed.status()).lastSync, 0); await assert.rejects(resumed.load(), /先使用 Google/);
});
test('Drive snapshots are read across devices, own snapshot is updated, and keys are excluded from uploads', async () => {
  const f = fixture(); await f.drive.connect();
  f.local.driveConfig.deviceId = device;
  const state = global.LexiTrail.emptyState(); state.deepseekKey = 'must stay local'; state.revision = 4;
  const snapshot = global.LexiTrailSync.snapshot(state, device);
  f.respond(url => new Response(JSON.stringify(url.includes('alt=media') ? snapshot : url.includes('uploadType') ? { id: 'own-file' } : { files: [{ id: 'own-file', name: `lexitrail-device-${device}.json` }] })));
  const remote = await f.drive.load(); assert.equal(remote.length, 1);
  await f.drive.save(state, remote);
  const upload = f.calls.at(-1); assert.equal(upload.options.method, 'PATCH'); assert(!upload.options.body.includes('must stay local'));
  assert.equal(upload.options.headers.Authorization, 'Bearer fixture-token'); assert.equal(f.local.driveConfig.lastSyncRevision, 4);
  await f.drive.save(state, []); assert.equal(f.calls.at(-1).options.method, 'POST'); assert(f.calls.at(-1).options.body.includes('appDataFolder'));
});
test('expired authorization and API errors provide bounded messages without credential or response-body disclosure', async () => {
  const f = fixture(); await assert.rejects(f.drive.load(), /登录/);
  await f.drive.connect();
  f.respond(() => new Response('private server details', { status: 401 }));
  await assert.rejects(f.drive.load(), /失效/); assert.equal(f.temporary.driveAuth, undefined); assert.equal(f.local.driveConfig.connected, false);
  await f.drive.connect();
  f.respond(() => new Response('private server details', { status: 403 }));
  await assert.rejects(f.drive.load(), error => /权限/.test(error.message) && !error.message.includes('private'));
});
test('Drive pagination reads every page and rejects malformed or oversize cloud data', async () => {
  const f = fixture(); await f.drive.connect();
  let pages = 0;
  f.respond(url => { pages++; return new Response(JSON.stringify(url.includes('pageToken=next') ? { files: [] } : { files: [], nextPageToken: 'next' })); });
  assert.deepEqual(await f.drive.load(), []); assert.equal(pages, 2);
  f.respond(() => new Response('{}', { headers: { 'Content-Length': String(global.LexiTrailSync.LIMIT + 1) } }));
  await assert.rejects(f.drive.load(), /过大/);
  f.respond(() => new Response('invalid')); await assert.rejects(f.drive.load(), /无效/);
  f.respond(() => new Response(JSON.stringify({ files: [], nextPageToken: 'same' }))); await assert.rejects(f.drive.load(), /重复/);
});

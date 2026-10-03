'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
global.LexiTrail = require('../extension/core'); global.LexiTrailSync = require('../extension/sync');
const D = require('../extension/google-drive');
const device = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const local = {}, temporary = {}, calls = [];
  const store = object => ({ setAccessLevel: async () => {}, get: async key => ({ [key]: object[key] }), set: async data => Object.assign(object, data), remove: async key => { delete object[key]; } });
  const chrome = { storage: { local: store(local), session: store(temporary) }, identity: { getRedirectURL: path => `https://test.chromiumapp.org/${path}`, launchWebAuthFlow: async ({ url }) => {
    const params = new URL(url).searchParams;
    return `https://test.chromiumapp.org/oauth2#${new URLSearchParams({ state: params.get('state'), scope: D.SCOPE, access_token: 'fixture-token', token_type: 'Bearer', expires_in: '3600' })}`;
  } } };
  let response = () => new Response(JSON.stringify({ files: [] }));
  const drive = D.create(chrome, async (url, options) => { calls.push({ url, options }); return response(url, options); });
  return { chrome, drive, local, temporary, calls, respond: f => response = f };
}
test('OAuth validates callback/nonce/scope, and credentials remain in trusted session storage', async () => {
  const f = fixture(); const status = await f.drive.connect('fixture.apps.googleusercontent.com');
  assert(status.connected); assert(!JSON.stringify(status).includes('fixture-token'));
  assert.equal(f.local.driveAuth, undefined); assert(f.temporary.driveAuth.token);
  await f.drive.disconnect(); assert.equal(f.temporary.driveAuth, undefined); assert.equal((await f.drive.status()).connected, false);
  for (const url of ['https://wrong.example/oauth2#state=x', 'https://test.chromiumapp.org/oauth2#state=wrong']) {
    f.chrome.identity.launchWebAuthFlow = async () => url;
    await assert.rejects(f.drive.connect('fixture.apps.googleusercontent.com'), /校验失败/);
  }
});
test('Drive snapshots are read across devices, own snapshot is updated, and keys are excluded from uploads', async () => {
  const f = fixture(); await f.drive.connect('fixture.apps.googleusercontent.com');
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
  const f = fixture(); await assert.rejects(f.drive.load(), /过期/);
  await f.drive.connect('fixture.apps.googleusercontent.com');
  f.respond(() => new Response('private server details', { status: 401 }));
  await assert.rejects(f.drive.load(), /失效/); assert.equal(f.temporary.driveAuth, undefined);
  await f.drive.connect('fixture.apps.googleusercontent.com');
  f.respond(() => new Response('private server details', { status: 403 }));
  await assert.rejects(f.drive.load(), error => /权限/.test(error.message) && !error.message.includes('private'));
});
test('Drive pagination reads every page and rejects malformed or oversize cloud data', async () => {
  const f = fixture(); await f.drive.connect('fixture.apps.googleusercontent.com');
  let pages = 0;
  f.respond(url => { pages++; return new Response(JSON.stringify(url.includes('pageToken=next') ? { files: [] } : { files: [], nextPageToken: 'next' })); });
  assert.deepEqual(await f.drive.load(), []); assert.equal(pages, 2);
  f.respond(() => new Response('{}', { headers: { 'Content-Length': String(global.LexiTrailSync.LIMIT + 1) } }));
  await assert.rejects(f.drive.load(), /过大/);
  f.respond(() => new Response('invalid')); await assert.rejects(f.drive.load(), /无效/);
  f.respond(() => new Response(JSON.stringify({ files: [], nextPageToken: 'same' }))); await assert.rejects(f.drive.load(), /重复/);
});

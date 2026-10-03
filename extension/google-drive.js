(function (root) {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const PREFIX = 'lexitrail-device-';
  function create(chrome, request = fetch) {
    const sessionReady = chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    async function session() { await sessionReady; return (await chrome.storage.session.get('driveAuth')).driveAuth; }
    async function status() {
      const auth = await session(), config = (await chrome.storage.local.get('driveConfig')).driveConfig ?? {};
      const local = (await chrome.storage.local.get('state')).state;
      return { clientId: config.clientId ?? '', connected: Boolean(auth?.expiresAt > Date.now() + 30000), lastSync: config.lastSync ?? 0,
        dirty: Boolean(local && (local.revision ?? 0) > (config.lastSyncRevision ?? -1)), redirect: chrome.identity.getRedirectURL('oauth2') };
    }
    async function connect(clientId) {
      if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw Error('请填写 Google OAuth 客户端 ID。');
      const nonce = crypto.randomUUID(), redirect = chrome.identity.getRedirectURL('oauth2');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: SCOPE, state: nonce, prompt: 'select_account' }).toString();
      let returned;
      try { returned = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }); }
      catch { throw Error('Google 授权未完成，请检查客户端 ID、回调地址及账号权限。'); }
      let result; try { result = new URL(returned); } catch { throw Error('Google 授权响应无效。'); }
      const expected = new URL(redirect), data = new URLSearchParams(result.hash.slice(1));
      if (result.origin !== expected.origin || result.pathname !== expected.pathname || data.get('state') !== nonce) throw Error('Google 授权响应校验失败，请重新连接。');
      if (data.has('error')) throw Error('Google 授权已取消或被拒绝。');
      if (!data.get('scope')?.split(' ').includes(SCOPE)) throw Error('请授权 LexiTrail 的应用数据权限。');
      const token = data.get('access_token'), seconds = Number(data.get('expires_in'));
      if (!token || data.get('token_type')?.toLowerCase() !== 'bearer' || !Number.isFinite(seconds) || seconds <= 0) throw Error('Google 授权缺少有效凭据。');
      const old = (await chrome.storage.local.get('driveConfig')).driveConfig ?? {};
      await chrome.storage.local.set({ driveConfig: { clientId, deviceId: old.deviceId ?? crypto.randomUUID(), lastSync: old.clientId === clientId ? old.lastSync ?? 0 : 0,
        lastSyncRevision: old.clientId === clientId ? old.lastSyncRevision ?? -1 : -1 } });
      await chrome.storage.session.set({ driveAuth: { token, expiresAt: Date.now() + Math.min(seconds, 3600) * 1000 } });
      return status();
    }
    async function disconnect() { await sessionReady; await chrome.storage.session.remove('driveAuth'); return status(); }
    async function token() {
      const auth = await session();
      if (!auth || auth.expiresAt <= Date.now() + 30000) throw Error('Google 连接已过期，请重新连接后同步。');
      return auth.token;
    }
    async function json(url, options = {}) {
      const credential = await token();
      let response;
      try { response = await request(url, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000), headers: { ...options.headers, Authorization: `Bearer ${credential}` } }); }
      catch { throw Error('Google Drive 网络请求失败，请稍后重试。'); }
      if (response.status === 401) { await disconnect(); throw Error('Google 连接已失效，请重新连接。'); }
      if (!response.ok) throw Error(response.status === 403 ? 'Google Drive 权限或空间不足，请检查授权与 Drive API。' : `Google Drive 暂时不可用（${response.status}）。`);
      const limit = root.LexiTrailSync.LIMIT;
      if (Number(response.headers?.get('content-length')) > limit) throw Error('云端同步文件过大。');
      const reader = response.body?.getReader();
      let body = '', total = 0;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > limit) { await reader.cancel(); throw Error('云端同步文件过大。'); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } else body = await response.text();
      if (new TextEncoder().encode(body).byteLength > limit) throw Error('云端同步文件过大。');
      try { return JSON.parse(body); } catch { throw Error('Google Drive 返回了无效数据。'); }
    }
    async function load() {
      let pageToken = '', files = []; const pages = new Set();
      do {
        const query = new URLSearchParams({ spaces: 'appDataFolder', q: `trashed = false and name contains '${PREFIX}'`, fields: 'nextPageToken,files(id,name)', pageSize: '100' });
        if (pages.has(pageToken)) throw Error('Google Drive 返回了重复的分页。');
        pages.add(pageToken);
        if (pageToken) query.set('pageToken', pageToken);
        const result = await json(`${API}?${query}`);
        if (!Array.isArray(result.files)) throw Error('Google Drive 文件清单无效。');
        files.push(...result.files); pageToken = result.nextPageToken || '';
        if (files.length > 1000) throw Error('同步设备文件过多，请检查云端数据。');
      } while (pageToken);
      const snapshots = [];
      for (const file of files) {
        if (!/^lexitrail-device-[a-f0-9-]{36}\.json$/.test(file.name) || !/^[a-zA-Z0-9_-]+$/.test(file.id)) continue;
        const value = await json(`${API}/${encodeURIComponent(file.id)}?alt=media`);
        const state = root.LexiTrailSync.readSnapshot(value);
        if (file.name !== `${PREFIX}${value.deviceId}.json`) throw Error('云端文件的设备标识不一致。');
        snapshots.push({ file, state });
      }
      return snapshots;
    }
    async function save(state, snapshots) {
      const config = (await chrome.storage.local.get('driveConfig')).driveConfig;
      if (!config?.deviceId) throw Error('请先连接 Google Drive。');
      const name = `${PREFIX}${config.deviceId}.json`, existing = snapshots.find(entry => entry.file.name === name);
      const payload = JSON.stringify(root.LexiTrailSync.snapshot(state, config.deviceId));
      if (existing) {
        await json(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.file.id)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: payload });
      } else {
        const boundary = `lexitrail_${crypto.randomUUID()}`;
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
        await json('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      }
      await chrome.storage.local.set({ driveConfig: { ...config, lastSync: Date.now(), lastSyncRevision: state.revision ?? 0 } });
    }
    return { status, connect, disconnect, load, save };
  }
  root.LexiTrailDrive = { create, SCOPE };
  if (typeof module !== 'undefined') module.exports = root.LexiTrailDrive;
})(globalThis);

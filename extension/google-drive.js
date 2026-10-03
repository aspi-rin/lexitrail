(function (root) {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const PREFIX = 'lexitrail-device-';
  function create(chrome, request = fetch) {
    // Native Chrome identity keeps account tokens in its own cache.
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id ?? '';
    const configured = /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) && manifest.oauth2.scopes?.includes(SCOPE);
    const sessionReady = (async () => {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.session.remove('driveAuth'); // Remove the legacy token on upgrade.
    })();
    async function config() { await sessionReady; return (await chrome.storage.local.get('driveConfig')).driveConfig ?? {}; }
    async function status() {
      const current = await config(), local = (await chrome.storage.local.get('state')).state;
      const sameClient = current.clientId === clientId;
      return { configured, supported: typeof chrome.identity.getAuthToken === 'function', connected: Boolean(configured && sameClient && current.connected),
        lastSync: sameClient ? current.lastSync ?? 0 : 0,
        dirty: Boolean(local && (local.revision ?? 0) > (sameClient ? current.lastSyncRevision ?? -1 : -1)) };
    }
    async function authenticate(interactive) {
      if (!configured) throw Error('Google 登录尚待应用配置，请按同步说明登记 Client ID。');
      if (typeof chrome.identity.getAuthToken !== 'function') throw Error('此浏览器暂不支持原生 Google 登录，请使用 Chrome。');
      let result;
      try { result = await chrome.identity.getAuthToken({ interactive, scopes: [SCOPE], enableGranularPermissions: true }); }
      catch { throw Error(interactive ? 'Google 登录未完成，请检查账号与应用登记后重试。' : 'Google 登录已失效，请重新登录后同步。'); }
      if (!result?.token || !Array.isArray(result.grantedScopes) || !result.grantedScopes.includes(SCOPE)) {
        if (result?.token) await chrome.identity.removeCachedAuthToken({ token: result.token });
        throw Error('请授权 LexiTrail 的应用数据权限。');
      }
      return result.token;
    }
    async function connect() {
      await sessionReady;
      await authenticate(true);
      const old = await config(), sameClient = old.clientId === clientId;
      await chrome.storage.local.set({ driveConfig: { clientId, connected: true, deviceId: old.deviceId ?? crypto.randomUUID(),
        lastSync: sameClient ? old.lastSync ?? 0 : 0, lastSyncRevision: sameClient ? old.lastSyncRevision ?? -1 : -1 } });
      return status();
    }
    async function disconnect() {
      const current = await config();
      if (current.connected && current.clientId === clientId) {
        let cached;
        try { cached = await chrome.identity.getAuthToken({ interactive: false, scopes: [SCOPE] }); } catch {}
        if (cached?.token) await chrome.identity.removeCachedAuthToken({ token: cached.token });
      }
      await chrome.storage.local.set({ driveConfig: { ...current, connected: false } });
      return status();
    }
    async function token() {
      const current = await config();
      if (!current.connected || current.clientId !== clientId) throw Error('请先使用 Google 登录后同步。');
      try { return await authenticate(false); }
      catch (error) {
        await chrome.storage.local.set({ driveConfig: { ...current, connected: false } });
        throw error;
      }
    }
    async function json(url, options = {}) {
      const credential = await token();
      let response;
      try { response = await request(url, { ...options, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000), headers: { ...options.headers, Authorization: `Bearer ${credential}` } }); }
      catch { throw Error('Google Drive 网络请求失败，请稍后重试。'); }
      if (response.status === 401) {
        await chrome.identity.removeCachedAuthToken({ token: credential });
        const current = await config();
        await chrome.storage.local.set({ driveConfig: { ...current, connected: false } });
        throw Error('Google 登录已失效，请重新登录。');
      }
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

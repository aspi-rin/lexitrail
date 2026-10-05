(function (root) {
  'use strict';
  const PREFIX = 'lexitrail-device-', NAME = /^lexitrail-device-[a-f0-9-]{36}\.json$/;
  const PROP = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
  function endpoint(value) {
    let url;
    try { url = new URL(value); } catch { throw Error('请填写有效的 HTTPS WebDAV 地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('WebDAV 地址须使用 HTTPS，并单独填写账号和密码。');
    url.pathname = url.pathname.replace(/\/*$/, '/');
    return url.href;
  }
  function originPermission(value) { return new URL(endpoint(value)).origin + '/*'; }
  function xmlText(value) {
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) throw Error('WebDAV 文件清单含无效 XML。');
    return value.replace(/&([^;]+);/g, (_, name) => {
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (Object.hasOwn(entities, name)) return entities[name];
      if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)) {
        const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
      }
      throw Error('WebDAV 文件清单含无效 XML。');
    });
  }
  // Workers have no DOMParser. Parse the bounded XML structurally, resolve namespaces,
  // and reject declarations/entities rather than interpreting server-supplied markup.
  function parseXML(xml) {
    const container = { children: [], ns: {}, text: '' }, stack = [container];
    const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g) || [];
    if (tokens.join('') !== xml) throw Error('WebDAV 文件清单含无效 XML。');
    let nodes = 0;
    for (const token of tokens) {
      const parent = stack.at(-1);
      if (token.startsWith('<!--') || token.startsWith('<?')) continue;
      if (token.startsWith('<![CDATA[')) { parent.text += token.slice(9, -3); continue; }
      if (!token.startsWith('<')) { parent.text += xmlText(token); continue; }
      if (token.startsWith('</')) {
        if (stack.length < 2 || !/^<\/[\w.:-]+\s*>$/.test(token) || token.slice(2, -1).trim() !== parent.tag) throw Error('WebDAV 文件清单含无效 XML。');
        stack.pop(); continue;
      }
      const match = /^<([\w.-]+(?::[\w.-]+)?)([\s\S]*?)(\/?)>$/.exec(token);
      if (!match || ++nodes > 20000 || stack.length > 32) throw Error('WebDAV 文件清单含无效 XML。');
      const [, tag, attributes, selfClosing] = match, ns = { ...parent.ns };
      let remaining = attributes;
      while (remaining.trim()) {
        const attr = /^\s+([\w.:-]+)\s*=\s*("[^"<]*"|'[^'<]*')/.exec(remaining);
        if (!attr) throw Error('WebDAV 文件清单含无效 XML。');
        if (attr[1] === 'xmlns') ns[''] = xmlText(attr[2].slice(1, -1));
        else if (attr[1].startsWith('xmlns:')) ns[attr[1].slice(6)] = xmlText(attr[2].slice(1, -1));
        remaining = remaining.slice(attr[0].length);
      }
      const parts = tag.split(':'), node = { tag, name: parts.at(-1), namespace: ns[parts.length === 2 ? parts[0] : ''], ns, children: [], text: '' };
      parent.children.push(node); if (!selfClosing) stack.push(node);
    }
    if (stack.length !== 1 || container.children.length !== 1 || container.text.trim()) throw Error('WebDAV 文件清单含无效 XML。');
    return container.children[0];
  }
  const children = (node, name) => node.children.filter(child => child.namespace === 'DAV:' && child.name === name);
  function files(xml, folder) {
    const doc = parseXML(xml);
    if (doc.namespace !== 'DAV:' || doc.name !== 'multistatus') throw Error('WebDAV 返回了无效文件清单。');
    const responses = children(doc, 'response'), found = new Set(), base = new URL(folder);
    let folderFound = false;
    if (responses.length > 1001) throw Error('同步设备文件过多，请检查云端数据。');
    for (const response of responses) {
      const hrefs = children(response, 'href');
      if (hrefs.length !== 1) throw Error('WebDAV 文件地址无效。');
      let url, name;
      try {
        url = new URL(hrefs[0].text.trim(), base);
        if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(base.pathname)) throw Error();
        name = decodeURIComponent(url.pathname.slice(base.pathname.length));
      } catch { throw Error('WebDAV 文件地址超出了同步目录。'); }
      const statuses = [...children(response, 'status'), ...children(response, 'propstat').flatMap(node => children(node, 'status'))];
      const successful = statuses.some(node => /^HTTP\/\S+\s+200(?:\s|$)/.test(node.text.trim()));
      if (!name && successful) folderFound = true;
      if (!NAME.test(name)) continue;
      if (!successful) throw Error('WebDAV 设备快照暂时无法读取，请检查权限后重试。');
      // Reconstruct the URL from a whitelisted filename; never fetch a raw href.
      found.add(new URL(name, base).href);
    }
    if (!folderFound) throw Error('WebDAV 文件清单缺少同步文件夹。');
    return [...found];
  }
  function create(chrome, request = fetch) {
    const config = async () => (await chrome.storage.local.get('webdavConfig')).webdavConfig ?? {};
    async function allowed(url) { return Boolean(await chrome.permissions?.contains({ origins: [originPermission(url)] })); }
    async function status() {
      const current = await config(), local = (await chrome.storage.local.get('state')).state;
      return { configured: Boolean(current.password), connected: Boolean(current.password && await allowed(current.url)),
        url: current.url ?? '', username: current.username ?? '', lastSync: current.lastSync ?? 0,
        verified: !current.validationError && Boolean(current.verifiedAt ?? current.lastSync), validationError: current.validationError ?? '',
        dirty: Boolean(local && (local.revision ?? 0) > (current.lastSyncRevision ?? -1)) };
    }
    async function connect(input) {
      const url = endpoint(input.url), old = await config();
      const username = typeof input.username === 'string' ? input.username.trim() : '';
      const password = input.password || (old.url === url && old.username === username ? old.password : '');
      if (!username || username.length > 256 || /[:\x00-\x1f\x7f]/.test(username) || typeof password !== 'string' || !password || password.length > 1024 || /[\x00-\x1f\x7f]/.test(password)) throw Error('请填写有效的 WebDAV 账号与应用密码。');
      if (!await allowed(url)) throw Error('请允许访问此 WebDAV 地址后再保存连接。');
      const same = old.url === url && old.username === username;
      const current = { url, username, password, deviceId: old.deviceId ?? crypto.randomUUID(), lastSync: same ? old.lastSync ?? 0 : 0, lastSyncRevision: same ? old.lastSyncRevision ?? -1 : -1 };
      // Persist the explicit save independently of network validation. A server
      // failure must leave a durable connection the user can correct or retry.
      current.verifiedAt = 0; current.validationError = '';
      await chrome.storage.local.set({ webdavConfig: current });
      try {
        const response = await http(current, url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROP });
        if (response.status !== 207) throw Error('此地址未返回 WebDAV 文件夹，请检查路径。');
        const doc = parseXML(await body(response));
        if (doc.namespace !== 'DAV:' || doc.name !== 'multistatus' || !children(doc, 'response').some(node => children(node, 'propstat').some(prop => children(prop, 'status').some(s => /^HTTP\/\S+\s+200(?:\s|$)/.test(s.text.trim())) && children(prop, 'prop').some(p => children(p, 'resourcetype').some(t => children(t, 'collection').length))))) throw Error('请填写 WebDAV 文件夹地址。');
        current.verifiedAt = Date.now();
      } catch (error) { current.validationError = error.message; }
      await chrome.storage.local.set({ webdavConfig: current }); return status();
    }
    async function disconnect() {
      const old = await config();
      // Retain the installation identity; discard the endpoint and all credentials.
      await chrome.storage.local.set({ webdavConfig: { deviceId: old.deviceId ?? crypto.randomUUID() } }); return status();
    }
    async function http(current, url, options = {}, accepted = []) {
      const bytes = new TextEncoder().encode(`${current.username}:${current.password}`);
      const credential = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      let response;
      try { response = await request(url, { ...options, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000), headers: { ...options.headers, Authorization: `Basic ${credential}` } }); }
      catch { throw Error('WebDAV 请求失败，请检查网络、HTTPS 地址与服务器重定向设置。'); }
      if (!response.ok && !accepted.includes(response.status)) {
        await response.body?.cancel();
        throw Error(response.status === 401 ? 'WebDAV 账号或应用密码无效，请更新连接。' : response.status === 403 ? 'WebDAV 权限不足，请检查文件夹读写权限。' : `WebDAV 请求失败（${response.status}），请检查地址与可用空间。`);
      }
      return response;
    }
    async function body(response) {
      const limit = root.LexiTrailSync.LIMIT;
      if (Number(response.headers?.get('content-length')) > limit) throw Error('WebDAV 文件超过 8 MB。');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let result = '', total = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > limit) { await reader.cancel(); throw Error('WebDAV 文件超过 8 MB。'); }
        result += decoder.decode(chunk.value, { stream: true });
      }
      return result + decoder.decode();
    }
    async function ready() {
      const current = await config();
      if (!current.password) throw Error('请先保存 WebDAV 连接。');
      if (!await allowed(current.url)) throw Error('WebDAV 地址访问权限已撤销，请重新保存连接。');
      return current;
    }
    async function load() {
      const current = await ready(), folder = new URL('LexiTrail/', current.url).href;
      let response = await http(current, folder, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROP }, [404]);
      if (response.status === 404) {
        await http(current, folder, { method: 'MKCOL' }, [405]);
        response = await http(current, folder, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROP });
      }
      if (response.status !== 207) throw Error('WebDAV 未返回有效文件清单。');
      const snapshots = [];
      for (const url of files(await body(response), folder)) {
        let value;
        try { value = JSON.parse(await body(await http(current, url))); } catch (error) {
          if (error instanceof SyntaxError) throw Error('WebDAV 设备快照含无效 JSON。'); throw error;
        }
        const state = root.LexiTrailSync.readSnapshot(value);
        if (new URL(url).pathname.split('/').at(-1) !== `${PREFIX}${value.deviceId}.json`) throw Error('WebDAV 文件的设备标识不一致。');
        snapshots.push({ state });
      }
      return snapshots;
    }
    async function save(state) {
      const current = await ready(), url = new URL(`LexiTrail/${PREFIX}${current.deviceId}.json`, current.url).href;
      const payload = JSON.stringify(root.LexiTrailSync.snapshot(state, current.deviceId));
      const response = await http(current, url, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: payload });
      if (![200, 201, 204].includes(response.status)) throw Error('WebDAV 未确认快照保存，请重试同步。');
      await response.body?.cancel();
      await chrome.storage.local.set({ webdavConfig: { ...current, verifiedAt: Date.now(), validationError: '', lastSync: Date.now(), lastSyncRevision: state.revision ?? 0 } });
    }
    return { status, connect, disconnect, load, save };
  }
  root.LexiTrailWebDAV = { create, endpoint, originPermission, files };
  if (typeof module !== 'undefined') module.exports = root.LexiTrailWebDAV;
})(globalThis);

'use strict';
importScripts('core.js', 'api.js', 'sync.js', 'webdav.js');
const C = LexiTrail;
const dictionaryReady = fetch(chrome.runtime.getURL('data/cefr.json')).then(r => r.json());
const translationsReady = fetch(chrome.runtime.getURL('data/translations.json')).then(r => r.json());
const secured = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let writes = Promise.resolve();
// Completed results are LRU; in-flight requests are deduplicated separately.
// Both maps are intentionally volatile and disappear when the worker stops.
const lookups = new Map(), pendingLookups = new Map();
const CACHE_LIMIT = 1000;
let cacheGeneration = 0;
const webdav = LexiTrailWebDAV.create(chrome);
let syncJob = null, connectionBusy = false;
async function changeConnection(operation) {
  if (syncJob || connectionBusy) throw Error('同步或连接验证正在进行，请完成后再切换连接。');
  connectionBusy = true;
  try { return await operation(); } finally { connectionBusy = false; }
}
async function state() {
  await secured;
  return (await chrome.storage.local.get('state')).state ?? C.emptyState();
}
function serialized(operation) {
  const pending = writes.then(operation);
  writes = pending.catch(() => {});
  return pending;
}
// Local keys left by the removed cloud provider (0.0.6 and earlier). Only these
// are deleted; the wordbook, WebDAV connection and other settings are untouched.
const OBSOLETE_KEYS = ['driveConfig', 'syncProvider'];
const initialized = serialized(async () => {
  await secured;
  await chrome.storage.local.remove(OBSOLETE_KEYS).catch(() => {});
  const translations = await translationsReady, current = await state();
  if (C.enrich(current, translations)) await chrome.storage.local.set({ state: current });
});
// Sites switched off from the toolbar popup, stored as a sorted hostname list
// under its own local key so it never enters the wordbook, sync or backups.
function siteName(value) {
  if (typeof value !== 'string' || !value || value.length > 253) return '';
  try { return new URL(`http://${value}`).hostname === value ? value : ''; } catch { return ''; }
}
async function disabledSites() {
  await secured;
  const value = (await chrome.storage.local.get('disabledSites')).disabledSites;
  return Array.isArray(value) ? value : [];
}
function trusted(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
}
function notify() {
  // A busy/frozen tab may never answer. Notifications must never hold the
  // persisted-write queue, which GET_STATE and the wordbook also wait on.
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED' }).catch(() => {});
  }).catch(() => {});
}
function cached(term) {
  const result = lookups.get(term);
  if (result) { lookups.delete(term); lookups.set(term, result); }
  return result;
}
function remember(term, result) {
  lookups.delete(term); lookups.set(term, result);
  if (lookups.size > CACHE_LIMIT) lookups.delete(lookups.keys().next().value);
}
function view(term, dict, translations, result, notice = '') {
  return {
    word: term, level: Object.hasOwn(dict, term) ? dict[term] : '',
    meaning: Object.hasOwn(translations, term) ? translations[term] : '', ...result,
    audio: C.dictionaryAudio(term), source: result ? C.materialSource(result) : 'ECDICT / LexiTrail', notice
  };
}
async function retain(term, result, generation = cacheGeneration) {
  return serialized(async () => {
    const current = await state(), record = Object.hasOwn(current.words, term) ? current.words[term] : null;
    if (generation !== cacheGeneration || !record?.studySaved || record.lookup) return;
    record.lookup = result;
    record.translation ||= result.meaning;
    record.updated = Date.now();
    current.revision = (current.revision ?? 0) + 1;
    await chrome.storage.local.set({ state: current });
    await notify();
  });
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('请求来源无效。');
  await initialized;
  const [dict, translations] = await Promise.all([dictionaryReady, translationsReady]);
  switch (message.type) {
    case 'GET_STATE': {
      await writes;
      const current = await state(), site = siteName(message.site);
      const siteDisabled = Boolean(site) && (await disabledSites()).includes(site);
      const provider = C.provider((await chrome.storage.local.get('aiProvider')).aiProvider);
      return { state: current, hasKey: Boolean((await chrome.storage.local.get(C.PROVIDERS[provider].keyName))[C.PROVIDERS[provider].keyName]), counts: C.counts(current), siteDisabled };
    }
    case 'GET_LEVELS': {
      return C.LEVELS.map(level => ({ level, count: Object.values(dict).filter(v => v === level).length }));
    }
    case 'GET_SETTINGS': {
      if (!trusted(sender)) throw new Error('请在设置页查看配置。');
      const provider = C.provider((await chrome.storage.local.get('aiProvider')).aiProvider);
      return { provider, key: (await chrome.storage.local.get(C.PROVIDERS[provider].keyName))[C.PROVIDERS[provider].keyName] ?? '', webdav: await webdav.status() };
    }
    case 'WEBDAV_CONNECT': {
      if (!trusted(sender)) throw Error('请在设置页保存 WebDAV 连接。');
      return changeConnection(() => webdav.connect(message));
    }
    case 'WEBDAV_DISCONNECT': {
      if (!trusted(sender)) throw Error('请在设置页清除 WebDAV 连接。');
      return changeConnection(() => webdav.disconnect());
    }
    case 'WEBDAV_SYNC': {
      if (!trusted(sender)) throw new Error('请在设置页同步词本。');
      if (connectionBusy) throw Error('连接验证正在进行，请完成后同步。');
      if (!syncJob) syncJob = (async () => {
        const snapshots = await webdav.load();
        const merged = await serialized(async () => {
          const local = await state();
          let combined = LexiTrailSync.cleanState(local);
          for (const snapshot of snapshots) combined = LexiTrailSync.merge(combined, snapshot.state);
          combined.revision = (local.revision ?? 0) + 1;
          C.enrich(combined, translations);
          await chrome.storage.local.set({ state: combined }); await notify(); return combined;
        });
        await webdav.save(merged);
        return { ...await webdav.status(), words: Object.keys(merged.words).length };
      })();
      const job = syncJob;
      try { return await job; } finally { if (syncJob === job) syncJob = null; }
    }
    case 'EXPORT_BACKUP': {
      if (!trusted(sender)) throw new Error('请在设置页导出词本。');
      await writes;
      return LexiTrailSync.backup(await state());
    }
    case 'IMPORT_BACKUP': {
      if (!trusted(sender)) throw new Error('请在设置页导入词本。');
      const imported = LexiTrailSync.readBackup(message.text);
      return serialized(async () => {
        const local = await state(), combined = LexiTrailSync.merge(local, imported);
        combined.revision = (local.revision ?? 0) + 1;
        C.enrich(combined, translations);
        await chrome.storage.local.set({ state: combined }); await notify();
        return { count: Object.keys(combined.words).length };
      });
    }
    case 'INITIALIZE': {
      if (!trusted(sender)) throw new Error('请在设置页初始化词本。');
      return serialized(async () => {
        const current = C.seed(await state(), Array.isArray(message.levels) ? message.levels : [], dict);
        C.enrich(current, translations);
        await chrome.storage.local.set({ state: current });
        await notify();
        return { count: Object.keys(current.words).length };
      });
    }
    case 'MARK_WORD': {
      return serialized(async () => {
        const current = await state();
        const record = C.mark(current, message.word, message.status, dict, message.example);
        if (record.studySaved && !record.lookup) record.lookup = C.learningMaterial(message.lookup, record.word) ?? cached(record.word) ?? null;
        C.enrich(current, translations);
        await chrome.storage.local.set({ state: current });
        await notify();
        return record;
      });
    }
    case 'SAVE_SETTINGS': {
      if (!trusted(sender)) throw new Error('请在设置页保存配置。');
      return serialized(async () => {
        const current = await state();
        if (typeof message.enabled === 'boolean' && current.enabled !== message.enabled) {
          current.enabled = Boolean(message.enabled); current.enabledUpdated = Date.now(); current.revision = (current.revision ?? 0) + 1;
        }
        const update = { state: current };
        if (message.provider != null && !Object.hasOwn(C.PROVIDERS, message.provider)) throw Error('请选择支持的 AI 供应商。');
        const provider = message.provider ?? C.provider((await chrome.storage.local.get('aiProvider')).aiProvider);
        const config = C.PROVIDERS[provider];
        if (message.provider != null) update.aiProvider = provider;
        if (message.clearKey) update[config.keyName] = '';
        else if (message.key) {
          if (typeof message.key !== 'string' || !/^sk-[a-zA-Z0-9_-]{16,240}$/.test(message.key.trim())) throw new Error(`请填写有效的 ${config.label} Key。`);
          update[config.keyName] = message.key.trim();
        }
        await chrome.storage.local.set(update);
        if (Object.hasOwn(update, 'aiProvider') || Object.hasOwn(update, config.keyName)) { cacheGeneration++; lookups.clear(); pendingLookups.clear(); }
        await notify();
        return { saved: true };
      });
    }
    case 'SET_SITE_ENABLED': {
      if (sender.url !== chrome.runtime.getURL('popup.html')) throw Error('请在工具栏弹窗中切换网站开关。');
      const site = siteName(message.site);
      if (!site) throw Error('当前页面不支持。');
      const enabled = Boolean(message.enabled);
      return serialized(async () => {
        const sites = new Set(await disabledSites());
        if (enabled) sites.delete(site); else sites.add(site);
        await chrome.storage.local.set({ disabledSites: [...sites].sort() });
        await notify();
        return { site, siteDisabled: !enabled };
      });
    }
    case 'OPEN_OPTIONS': { await chrome.runtime.openOptionsPage(); return {}; }
    case 'LOOKUP': {
      const term = C.word(message.word);
      if (!term) throw new Error('请选择一个英文单词。');
      await writes;
      const current = await state(), record = Object.hasOwn(current.words, term) ? current.words[term] : null;
      if (record?.lookup) return view(term, dict, translations, record.lookup);
      const existing = cached(term);
      if (existing) { await retain(term, existing); return view(term, dict, translations, existing); }
      if (pendingLookups.has(term)) return pendingLookups.get(term);
      const generation = cacheGeneration;
      const promise = (async () => {
        const provider = C.provider((await chrome.storage.local.get('aiProvider')).aiProvider), config = C.PROVIDERS[provider];
        const key = (await chrome.storage.local.get(config.keyName))[config.keyName] ?? '';
        if (!key) return view(term, dict, translations, null, `在设置中添加 ${config.label} Key，可生成简短中文释义和例句。`);
        let result;
        try {
          const context = C.short(message.context, 300);
          const generated = await LexiTrailAPI[provider](term, context, key);
          result = { ...generated, schema: 1, model: config.model, promptVersion: 1, queriedAt: Date.now(), context };
        } catch (error) { return view(term, dict, translations, null, error.message); }
        // A key change cancels admission of old requests to both stores.
        if (generation !== cacheGeneration) return view(term, dict, translations, null, 'AI 配置已更新，请重新查词。');
        remember(term, result); await retain(term, result, generation);
        if (generation !== cacheGeneration) return view(term, dict, translations, null, 'AI 配置已更新，请重新查词。');
        return view(term, dict, translations, result);
      })();
      pendingLookups.set(term, promise);
      try { return await promise; }
      finally { if (pendingLookups.get(term) === promise) pendingLookups.delete(term); }
    }
    default: throw new Error('未知请求。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});

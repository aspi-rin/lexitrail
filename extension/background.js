'use strict';
importScripts('core.js', 'api.js', 'sync.js', 'google-drive.js');
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
const drive = LexiTrailDrive.create(chrome);
let syncJob = null;
async function state() {
  await secured;
  return (await chrome.storage.local.get('state')).state ?? C.emptyState();
}
function serialized(operation) {
  const pending = writes.then(operation);
  writes = pending.catch(() => {});
  return pending;
}
const initialized = serialized(async () => {
  const translations = await translationsReady, current = await state();
  if (C.enrich(current, translations)) await chrome.storage.local.set({ state: current });
});
function trusted(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
}
async function notify() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'STATE_CHANGED' }).catch(() => {})));
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
    audio: C.dictionaryAudio(term), source: result ? 'DeepSeek Flash' : 'ECDICT / LexiTrail', notice
  };
}
async function retain(term, result) {
  return serialized(async () => {
    const current = await state(), record = Object.hasOwn(current.words, term) ? current.words[term] : null;
    if (!record?.studySaved || record.lookup) return;
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
      const current = await state();
      return { state: current, hasKey: Boolean((await chrome.storage.local.get('deepseekKey')).deepseekKey), counts: C.counts(current) };
    }
    case 'GET_LEVELS': {
      return C.LEVELS.map(level => ({ level, count: Object.values(dict).filter(v => v === level).length }));
    }
    case 'GET_SETTINGS': {
      if (!trusted(sender)) throw new Error('请在设置页查看配置。');
      return { key: (await chrome.storage.local.get('deepseekKey')).deepseekKey ?? '', sync: await drive.status() };
    }
    case 'DRIVE_CONNECT': {
      if (!trusted(sender)) throw new Error('请在设置页连接 Google Drive。');
      if (syncJob) throw new Error('同步正在进行，请完成后切换连接。');
      return drive.connect(String(message.clientId ?? '').trim());
    }
    case 'DRIVE_DISCONNECT': {
      if (!trusted(sender)) throw new Error('请在设置页断开连接。');
      if (syncJob) throw new Error('同步正在进行，请完成后断开连接。');
      return drive.disconnect();
    }
    case 'DRIVE_SYNC': {
      if (!trusted(sender)) throw new Error('请在设置页同步词本。');
      if (!syncJob) syncJob = (async () => {
        const snapshots = await drive.load();
        const merged = await serialized(async () => {
          const local = await state();
          let combined = LexiTrailSync.cleanState(local);
          for (const snapshot of snapshots) combined = LexiTrailSync.merge(combined, snapshot.state);
          combined.revision = (local.revision ?? 0) + 1;
          C.enrich(combined, translations);
          await chrome.storage.local.set({ state: combined }); await notify(); return combined;
        });
        await drive.save(merged, snapshots);
        return { ...await drive.status(), words: Object.keys(merged.words).length };
      })();
      const job = syncJob;
      try { return await job; } finally { if (syncJob === job) syncJob = null; }
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
        if (current.enabled !== Boolean(message.enabled)) {
          current.enabled = Boolean(message.enabled); current.enabledUpdated = Date.now(); current.revision = (current.revision ?? 0) + 1;
        }
        const update = { state: current };
        if (message.clearKey) update.deepseekKey = '';
        else if (message.key) {
          if (typeof message.key !== 'string' || !/^sk-[a-zA-Z0-9_-]{16,200}$/.test(message.key.trim())) throw new Error('请填写有效的 DeepSeek Key。');
          update.deepseekKey = message.key.trim();
        }
        await chrome.storage.local.set(update);
        if (Object.hasOwn(update, 'deepseekKey')) { cacheGeneration++; lookups.clear(); pendingLookups.clear(); }
        await notify();
        return { saved: true };
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
        const key = (await chrome.storage.local.get('deepseekKey')).deepseekKey ?? '';
        if (!key) return view(term, dict, translations, null, '在设置中添加 DeepSeek Key，可生成简短中文释义和例句。');
        let result;
        try {
          const context = C.short(message.context, 300);
          const generated = await LexiTrailAPI.deepseek(term, context, key);
          result = { ...generated, schema: 1, model: 'deepseek-flash', promptVersion: 1, queriedAt: Date.now(), context };
        } catch (error) { return view(term, dict, translations, null, error.message); }
        // A key change cancels admission of old requests to both stores.
        if (generation === cacheGeneration) { remember(term, result); await retain(term, result); }
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

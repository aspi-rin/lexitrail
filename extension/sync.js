(function (root) {
  'use strict';
  const C = root.LexiTrail;
  const LIMIT = 8 * 1024 * 1024;
  function clock(value) {
    if (value == null) return 0;
    if (!Number.isFinite(value) || value < 0 || value > Date.now() + 300000) throw Error('同步数据中的时间无效，请检查设备时间。');
    return value;
  }
  function statusTime(record) {
    return clock(record.statusUpdated ?? (record.status !== 'new' || record.studySaved || record.examples?.length ? record.updated : 0));
  }
  function examples(values) {
    const byText = new Map();
    for (const value of values) {
      const text = C.short(value?.text, 400); if (!text) continue;
      let url = ''; try { const parsed = new URL(value.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href.slice(0, 1000); } catch {}
      const entry = { text, url, title: C.short(value.title, 120), created: clock(value.created) };
      const prior = byText.get(text);
      if (!prior || entry.created > prior.created || entry.created === prior.created && entry.url > prior.url) byText.set(text, entry);
    }
    return [...byText.values()].sort((a, b) => b.created - a.created || a.text.localeCompare(b.text)).slice(0, 10);
  }
  function cleanState(input) {
    if (!input || typeof input !== 'object' || !input.words || typeof input.words !== 'object' || Array.isArray(input.words)) throw Error('云端词本格式无效。');
    if (Object.keys(input.words).length > 50000) throw Error('云端词本超出支持的容量。');
    const state = { schema: 2, initialized: Boolean(input.initialized), enabled: input.enabled !== false,
      enabledUpdated: clock(input.enabledUpdated), levels: C.LEVELS.filter(level => input.levels?.includes(level)), words: {} };
    for (const [term, value] of Object.entries(input.words)) {
      if (C.word(term) !== term || !value || !Object.hasOwn(C.STATUSES, value.status)) throw Error('云端词条格式无效。');
      const lookup = value.lookup ? C.learningMaterial({ ...value.lookup, word: term }, term) : null;
      if (value.lookup && !lookup) throw Error('云端释义格式无效。');
      if (lookup) clock(lookup.queriedAt);
      if (value.examples != null && !Array.isArray(value.examples)) throw Error('云端语境格式无效。');
      state.words[term] = { word: term, level: C.LEVELS.includes(value.level) ? value.level : '', status: value.status,
        statusUpdated: statusTime(value), translation: C.short(value.translation, 60),
        examples: examples(value.examples ?? []), studySaved: Boolean(value.studySaved || lookup || value.status !== 'new'),
        created: clock(value.created), updated: clock(value.updated) };
      if (lookup) state.words[term].lookup = lookup;
    }
    return state;
  }
  function merge(first, second) {
    const a = cleanState(first), b = cleanState(second);
    const result = { ...a, initialized: a.initialized || b.initialized, levels: C.LEVELS.filter(l => a.levels.includes(l) || b.levels.includes(l)), words: { ...a.words } };
    if (b.enabledUpdated > a.enabledUpdated) { result.enabled = b.enabled; result.enabledUpdated = b.enabledUpdated; }
    else if (b.enabledUpdated === a.enabledUpdated) result.enabled = a.enabled && b.enabled;
    const rank = { new: 0, learning: 1, mastered: 2 };
    for (const [term, right] of Object.entries(b.words)) {
      const left = Object.hasOwn(result.words, term) ? result.words[term] : null;
      if (!left) { result.words[term] = right; continue; }
      const winner = right.statusUpdated > left.statusUpdated || right.statusUpdated === left.statusUpdated && rank[right.status] > rank[left.status] ? right : left;
      const lookups = [left.lookup, right.lookup].filter(Boolean).sort((x, y) => x.queriedAt - y.queriedAt || JSON.stringify(x).localeCompare(JSON.stringify(y)));
      result.words[term] = { ...winner, level: [left.level, right.level].filter(Boolean).sort()[0] || '',
        translation: [left.translation, right.translation].filter(Boolean).sort()[0] || lookups[0]?.meaning || '',
        examples: examples([...left.examples, ...right.examples]), studySaved: left.studySaved || right.studySaved,
        created: Math.min(left.created, right.created), updated: Math.max(left.updated, right.updated) };
      if (lookups.length) result.words[term].lookup = lookups[0];
    }
    return result;
  }
  function snapshot(state, deviceId) {
    if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw Error('同步设备标识无效。');
    const value = { app: 'LexiTrail', schema: 1, deviceId, savedAt: Date.now(), state: cleanState(state) };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMIT) throw Error('本次词本超过 8 MB，请精简收藏语境后同步。');
    return value;
  }
  function readSnapshot(value) {
    if (value?.app !== 'LexiTrail' || value.schema !== 1 || !/^[a-f0-9-]{36}$/.test(value.deviceId)) throw Error('云端文件属于其他应用或版本。');
    return cleanState(value.state);
  }
  const api = { LIMIT, statusTime, cleanState, merge, snapshot, readSnapshot };
  root.LexiTrailSync = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

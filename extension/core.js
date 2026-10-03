(function (root) {
  'use strict';
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const STATUSES = { new: '生词本', learning: '学习中', mastered: '已掌握' };
  function word(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replaceAll('’', "'");
    return /^[a-z]+(?:['-][a-z]+)*$/.test(normalized) && normalized.length <= 48 ? normalized : '';
  }
  function emptyState() {
    return { schema: 2, initialized: false, levels: [], enabled: true, words: {} };
  }
  function seed(state, levels, dictionary, now = Date.now()) {
    const selected = [...new Set(levels)].filter(l => LEVELS.includes(l));
    if (state.initialized) throw new Error('初始词本已经建立。');
    if (!selected.length) throw new Error('请选择至少一个等级。');
    for (const [term, level] of Object.entries(dictionary)) {
      if (selected.includes(level) && !Object.hasOwn(state.words, term)) {
        state.words[term] = { word: term, level, status: 'new', examples: [], created: now, updated: now };
      }
    }
    state.initialized = true;
    state.levels = selected;
    state.revision = (state.revision ?? 0) + 1;
    return state;
  }
  function mark(state, value, status, dictionary, example, now = Date.now()) {
    const term = word(value);
    if (!term || !Object.hasOwn(STATUSES, status)) throw new Error('单词或状态无效。');
    const record = Object.hasOwn(state.words, term) ? state.words[term] : { word: term, level: Object.hasOwn(dictionary, term) ? dictionary[term] : '', examples: [], created: now };
    record.examples ??= [];
    record.status = status;
    record.statusUpdated = now;
    state.revision = (state.revision ?? 0) + 1;
    if (status === 'learning' || status === 'mastered') record.studySaved = true;
    record.updated = now;
    if (example?.text?.trim()) {
      const text = String(example.text).trim().slice(0, 400);
      let url = '';
      try { const u = new URL(example.url); if (['http:', 'https:'].includes(u.protocol)) url = u.href.slice(0, 1000); } catch {}
      if (!record.examples.some(e => e.text === text)) {
        record.examples.unshift({ text, url, title: String(example.title ?? '').slice(0, 120), created: now });
        record.examples = record.examples.slice(0, 10);
      }
    }
    state.words[term] = record;
    return record;
  }
  function enrich(state, translations) {
    let changed = state.schema !== 2;
    state.schema = 2;
    for (const record of Object.values(state.words)) {
      if (!record.translation) {
        const translation = Object.hasOwn(translations, record.word) ? translations[record.word] : record.lookup?.meaning;
        if (translation) { record.translation = translation; changed = true; }
      }
      if ((record.status === 'learning' || record.status === 'mastered') && !record.studySaved) {
        record.studySaved = true; changed = true;
      }
    }
    return changed;
  }
  function counts(state) {
    const result = { new: 0, learning: 0, mastered: 0 };
    for (const record of Object.values(state.words)) if (Object.hasOwn(result, record.status)) result[record.status]++;
    return result;
  }
  function tokens(text) {
    // ASCII words only; avoid partial matches inside accented or other alphabetic words.
    return [...String(text).matchAll(/(?<![\p{L}\p{N}_'-])[a-z]+(?:['’\-][a-z]+)*(?![\p{L}\p{N}_'-])/giu)]
      .map(m => ({ word: word(m[0]), start: m.index, end: m.index + m[0].length })).filter(t => t.word);
  }
  function short(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
  function parseAI(response) {
    const choice = response?.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new Error('释义输出未完整结束，请重试。');
    const data = JSON.parse(choice.message?.content ?? '');
    return aiFields(data);
  }
  function aiFields(data) {
    const result = {
      partOfSpeech: short(data.partOfSpeech, 30), meaning: short(data.meaning, 80),
      definition: short(data.definition, 180), example: short(data.example, 180),
      exampleTranslation: short(data.exampleTranslation, 100)
    };
    if (!result.meaning || !result.example) throw new Error('释义结果缺少必要内容，请重试。');
    return result;
  }
  function learningMaterial(value, term) {
    if (!value || word(value.word) !== term || value.model !== 'deepseek-flash') return null;
    try {
      const fields = aiFields(value);
      return { ...fields, schema: 1, model: 'deepseek-flash', promptVersion: 1,
        queriedAt: Number.isFinite(value.queriedAt) && value.queriedAt > 0 ? value.queriedAt : Date.now(),
        context: short(value.context, 300) };
    } catch { return null; }
  }
  function safeAudio(value) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      const allowed = ['dict.youdao.com'];
      return url.protocol === 'https:' && allowed.includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function dictionaryAudio(value) {
    const term = word(value);
    return term ? `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&type=2` : '';
  }
  const api = { LEVELS, STATUSES, word, emptyState, seed, mark, enrich, counts, tokens, short, parseAI, learningMaterial, safeAudio, dictionaryAudio };
  root.LexiTrail = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

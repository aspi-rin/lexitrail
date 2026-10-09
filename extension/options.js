(async function () {
  'use strict';
  const C = LexiTrail;
  let state = C.emptyState(), tab = 'new', page = 0, hasKey = false, keyDirty = false, syncBusy = false, webdavState = {}, webdavDirty = false;
  const PAGE_SIZE = 40, $ = selector => document.querySelector(selector);
  function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error ?? '操作失败。');
    return response.data;
  }
  function message(text, error = false) { $('#message').textContent = text; $('#message').classList.toggle('error', error); }
  function render() {
    document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#page-title').textContent = C.STATUSES[tab] ?? '设置';
    $('#page-description').textContent = tab === 'settings' ? '为您的阅读习惯留一点空间。' : '在阅读中遇见，让词汇留下来。';
    $('#settings').hidden = tab !== 'settings'; $('#vocabulary').hidden = tab === 'settings';
    $('#onboarding').hidden = state.initialized || tab === 'settings';
    const counts = C.counts(state);
    for (const status of Object.keys(C.STATUSES)) $(`#count-${status}`).textContent = counts[status].toLocaleString();
    const query = $('#search').value.trim().toLowerCase();
    const records = Object.values(state.words).filter(r => r.status === tab && r.word.includes(query)).sort((a, b) => a.word.localeCompare(b.word));
    const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    $('#word-list').replaceChildren();
    for (const record of records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = el('tr'); row.append(el('td', record.word));
      const level = el('td'), badge = el('span', record.level || '—'); badge.className = 'level-tag'; level.append(badge); row.append(level);
      const translation = el('td', record.translation || record.lookup?.meaning || '添加 Key 后查词可补充释义');
      translation.className = 'word-translation'; row.append(translation);
      const context = el('td'); context.className = 'context';
      if (record.lookup) {
        const saved = record.lookup, details = el('details'); details.className = 'saved-lookup';
        details.append(el('summary', '已保存的释义与例句'));
        if (saved.partOfSpeech) details.append(el('p', saved.partOfSpeech));
        details.append(el('p', saved.meaning));
        if (saved.definition) details.append(el('p', saved.definition));
        details.append(el('p', saved.example));
        if (saved.exampleTranslation) details.append(el('p', saved.exampleTranslation));
        if (saved.context) details.append(el('p', `首次查询语境：${saved.context}`, 'muted'));
        details.append(el('p', `${saved.model} · ${new Date(saved.queriedAt).toLocaleDateString()}`, 'muted'));
        context.append(details);
      }
      if (record.examples?.length) {
        const details = el('details'); details.append(el('summary', `${record.examples.length} 条收藏语境`));
        for (const example of record.examples) {
          details.append(el('p', example.text));
          if (example.url) { const link = el('a', example.title || '来源页面 ↗'); link.href = example.url; link.target = '_blank'; link.rel = 'noreferrer'; link.className = 'source-link'; details.append(link); }
        }
        context.append(details);
      } else if (!record.lookup) context.textContent = '等您在阅读中遇见';
      row.append(context);
      const status = el('td'), select = el('select'); select.setAttribute('aria-label', `${record.word} 的状态`);
      for (const [value, label] of Object.entries(C.STATUSES)) { const option = el('option', label); option.value = value; option.selected = value === record.status; select.append(option); }
      select.addEventListener('change', async () => {
        select.disabled = true;
        try { await send({ type: 'MARK_WORD', word: record.word, status: select.value }); await refresh(); message(`${record.word} 已移至${C.STATUSES[select.value]}`); }
        catch (e) { message(e.message, true); select.value = record.status; select.disabled = false; }
      });
      status.append(select); row.append(status); $('#word-list').append(row);
    }
    $('#list-count').textContent = `${records.length.toLocaleString()} 个词`;
    $('#empty').hidden = records.length > 0;
    $('#page-number').textContent = `${page + 1} / ${pages}`; $('#previous').disabled = page === 0; $('#next').disabled = page >= pages - 1;
    $('#seed-description').textContent = state.initialized ? `初始等级：${state.levels.join('、')}。现在由三个个人词本维护每个词的状态。` : '首次使用时，您可以选择多个 CEFR 等级。';
  }
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  let theme = '';
  try { theme = localStorage.getItem('lexitrail-theme') || ''; } catch {}
  if (!['light', 'dark'].includes(theme)) theme = '';
  function renderTheme() {
    const dark = theme ? theme === 'dark' : Boolean(systemTheme?.matches);
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    $('#theme-sun').toggleAttribute('hidden', !dark);
    $('#theme-moon').toggleAttribute('hidden', dark);
    $('#theme-toggle').title = dark ? '切换为浅色' : '切换为深色';
    $('#theme-toggle').setAttribute('aria-label', $('#theme-toggle').title);
  }
  renderTheme(); systemTheme?.addEventListener('change', renderTheme);
  $('#theme-toggle').addEventListener('click', () => {
    const dark = theme ? theme === 'dark' : Boolean(systemTheme?.matches);
    theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('lexitrail-theme', theme); } catch {}
    renderTheme();
  });
  async function refresh() {
    const data = await send({ type: 'GET_STATE' }); state = data.state;
    hasKey = data.hasKey;
    const settings = await send({ type: 'GET_SETTINGS' });
    if (!keyDirty) $('#api-key').value = settings.key || '';
    webdavState = settings.webdav || {};
    if (!webdavDirty) {
      $('#webdav-url').value = webdavState.url || ''; $('#webdav-username').value = webdavState.username || '';
      $('#webdav-password').placeholder = webdavState.configured ? '已保存；留空沿用原密码' : '输入应用密码';
    }
    renderKey(); renderSync();
    $('#enabled').checked = state.enabled;
    render();
  }
  try {
    const levels = await send({ type: 'GET_LEVELS' });
    for (const { level, count } of levels) {
      const label = el('label'); label.className = 'level-card'; const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = level;
      label.append(checkbox, el('strong', level), el('span', `${count.toLocaleString()} 个词`)); $('#levels').append(label);
    }
    await refresh(); $('#enabled').checked = state.enabled;
  } catch (e) { message(e.message, true); }
  document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => { tab = button.dataset.tab; page = 0; render(); message(''); }));
  $('#search').addEventListener('input', () => { page = 0; render(); });
  $('#previous').addEventListener('click', () => { page--; render(); }); $('#next').addEventListener('click', () => { page++; render(); });
  $('#initialize').addEventListener('click', async () => {
    const button = $('#initialize'); button.disabled = true;
    try {
      const levels = [...document.querySelectorAll('#levels input:checked')].map(i => i.value);
      const result = await send({ type: 'INITIALIZE', levels }); await refresh(); message(`已建立初始词本，共 ${result.count.toLocaleString()} 个词。`);
    } catch (e) { message(e.message, true); } finally { button.disabled = false; }
  });
  function renderKey() {
    const configured = hasKey && !keyDirty, button = $('#save-key');
    button.classList.toggle('key-configured', configured);
    $('#key-action-label').textContent = configured ? '已配置' : '保存';
    button.title = configured ? '删除 Key' : '保存 Key';
    button.setAttribute('aria-label', configured ? '已配置，点击删除 Key' : '保存 Key');
  }
  $('#api-key').addEventListener('input', () => { keyDirty = true; renderKey(); });
  $('#api-key').addEventListener('keydown', e => { if (e.key === 'Enter' && (keyDirty || !hasKey)) $('#save-key').click(); });
  $('#key-visibility').addEventListener('click', () => {
    const input = $('#api-key'), visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
    $('#key-visibility').setAttribute('aria-label', visible ? '隐藏 Key' : '显示 Key');
    $('#key-visibility').title = visible ? '隐藏 Key' : '显示 Key';
  });
  $('#save-key').addEventListener('click', async () => {
    const button = $('#save-key'), clearKey = hasKey && !keyDirty;
    if (!clearKey && !$('#api-key').value.trim()) { message('请填写 DeepSeek Key。', true); return; }
    button.disabled = true;
    try {
      await send({ type: 'SAVE_SETTINGS', enabled: state.enabled, key: clearKey ? '' : $('#api-key').value, clearKey });
      keyDirty = false; $('#api-key').type = 'password'; $('#key-visibility').setAttribute('aria-label', '显示 Key');
      await refresh(); message(clearKey ? 'Key 已删除。' : 'Key 已配置。');
    } catch (e) { message(e.message, true); } finally { button.disabled = false; }
  });
  $('#enabled').addEventListener('change', async () => {
    try { await send({ type: 'SAVE_SETTINGS', enabled: $('#enabled').checked }); await refresh(); message('阅读标注设置已保存。'); }
    catch (e) { message(e.message, true); $('#enabled').checked = state.enabled; }
  });
  function renderSync() {
    const current = webdavState;
    let summary;
    if (!current.configured) summary = '填写 WebDAV 地址与应用密码后保存连接';
    else if (!current.connected) summary = '连接已保存，请重新保存并允许地址访问';
    else if (current.validationError) summary = 'WebDAV 连接已保存 · 验证失败：' + current.validationError;
    else summary = current.verified ? 'WebDAV 连接已保存并验证' : 'WebDAV 连接已保存，可点击立即同步';
    const parts = [summary];
    if (current.lastSync) parts.push('上次同步：' + new Date(current.lastSync).toLocaleString());
    if (current.dirty) parts.push('有本地变更待同步');
    if (webdavDirty) parts.push('连接已修改，请先保存再同步');
    $('#sync-status').textContent = syncBusy ? '正在处理连接或读取、合并并保存词本…' : parts.join(' · ');
    $('#sync-now').disabled = syncBusy || !current.connected || webdavDirty;
    for (const id of ['webdav-url', 'webdav-username', 'webdav-password', 'webdav-connect', 'webdav-disconnect']) $('#' + id).disabled = syncBusy;
    $('#webdav-disconnect').hidden = !webdavState.configured;
  }
  function syncFeedback(text, error = false) {
    const node = $('#sync-message'); node.textContent = text; node.hidden = !text; node.classList.toggle('error', error);
  }
  async function syncAction(type, fields = {}) {
    syncFeedback(''); syncBusy = true; renderSync();
    try {
      const result = await send({ type, ...fields });
      webdavDirty = false; $('#webdav-password').value = '';
      await refresh();
      syncFeedback(result.validationError ? '连接已保存到本机，验证失败：' + result.validationError : type.endsWith('_SYNC') ? '词本已同步，共 ' + result.words.toLocaleString() + ' 个词。' : type.endsWith('_CONNECT') ? '连接已保存并验证，可点击立即同步。' : '本机连接已清除，云端词本继续保留。', Boolean(result.validationError));
    } catch (e) { syncFeedback(e.message, true); }
    finally { syncBusy = false; renderSync(); }
  }
  $('#sync-now').addEventListener('click', () => syncAction('WEBDAV_SYNC'));
  for (const id of ['webdav-url', 'webdav-username', 'webdav-password']) $('#' + id).addEventListener('input', () => { webdavDirty = true; renderSync(); });
  $('#webdav-connect').addEventListener('click', async () => {
    let fields, permission;
    syncFeedback('');
    try {
      fields = { url: LexiTrailWebDAV.endpoint($('#webdav-url').value.trim()), username: $('#webdav-username').value, password: $('#webdav-password').value };
      // Call request during the click gesture, before any asynchronous work.
      permission = chrome.permissions.request({ origins: [LexiTrailWebDAV.originPermission(fields.url)] });
    } catch { syncFeedback('请填写有效的 HTTPS WebDAV 地址。', true); return; }
    syncBusy = true; renderSync();
    try {
      if (!await permission) throw Error('请允许访问此 WebDAV 地址后再保存连接。');
      await syncAction('WEBDAV_CONNECT', fields);
    } catch (e) { syncFeedback(e.message, true); }
    finally { syncBusy = false; renderSync(); }
  });
  $('#webdav-disconnect').addEventListener('click', () => syncAction('WEBDAV_DISCONNECT'));
  $('#export-backup').addEventListener('click', async () => {
    const button = $('#export-backup'); button.disabled = true;
    try {
      const backup = await send({ type: 'EXPORT_BACKUP' });
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = `lexitrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      message('词本备份已导出。');
    } catch (e) { message(e.message, true); } finally { button.disabled = false; }
  });
  $('#import-backup').addEventListener('click', () => $('#backup-file').click());
  $('#backup-file').addEventListener('change', async () => {
    const input = $('#backup-file'), file = input.files[0], button = $('#import-backup');
    if (!file) return;
    button.disabled = true;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('词本备份超过 8 MB。');
      const result = await send({ type: 'IMPORT_BACKUP', text: await file.text() });
      await refresh(); message(`备份已合并，现有 ${result.count.toLocaleString()} 个词。`);
    } catch (e) { message(e.message, true); }
    finally { button.disabled = false; input.value = ''; }
  });
  chrome.storage.onChanged.addListener(changes => { if (changes.state) refresh().catch(e => message(e.message, true)); });
})();

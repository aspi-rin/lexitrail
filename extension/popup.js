(async function () {
  document.querySelector('#open').addEventListener('click', () => chrome.runtime.openOptionsPage());
  const toggle = document.querySelector('#site-switch'), hostLabel = document.querySelector('#site-host');
  let site = '';
  function renderSite(disabled) {
    if (!site) {
      toggle.disabled = true; toggle.setAttribute('aria-checked', 'false');
      toggle.setAttribute('aria-label', '当前页面不支持 LexiTrail');
      toggle.title = '浏览器内部页面不支持；刚安装或更新扩展时请刷新网页。';
      hostLabel.textContent = '当前页面不支持'; hostLabel.className = 'unsupported'; hostLabel.title = '';
      return;
    }
    toggle.disabled = false; toggle.setAttribute('aria-checked', String(!disabled));
    toggle.setAttribute('aria-label', `在 ${site} 启用 LexiTrail`);
    toggle.title = disabled ? `已在 ${site} 关闭，点击重新开启` : `点击在 ${site} 关闭`;
    hostLabel.textContent = disabled ? `${site} · 已关闭` : site; hostLabel.className = disabled ? 'off' : '';
    hostLabel.title = site;
  }
  // Ask the page's content script for its hostname: no tabs/activeTab permission is
  // needed, and pages without the content script (chrome://, new tab) stay unsupported.
  async function activeSite() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const reply = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'GET_SITE' });
      return typeof reply?.site === 'string' ? reply.site : '';
    } catch { return ''; }
  }
  toggle.addEventListener('click', async () => {
    if (!site) return;
    const wasDisabled = toggle.getAttribute('aria-checked') !== 'true';
    toggle.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SET_SITE_ENABLED', site, enabled: wasDisabled });
      if (!response?.ok) throw new Error(response?.error ?? '切换失败，请重试。');
      renderSite(response.data.siteDisabled);
    } catch (e) { renderSite(wasDisabled); document.querySelector('#hint').textContent = e.message; }
  });
  try {
    site = await activeSite();
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE', site });
    if (!response?.ok) throw new Error(response?.error ?? '加载失败。');
    renderSite(response.data.siteDisabled);
    for (const [status, count] of Object.entries(response.data.counts)) document.getElementById(status).textContent = count.toLocaleString();
    document.querySelector('#hint').textContent = response.data.state.initialized ? '词汇状态保存在本机。' : '打开词本，选择初始 CEFR 等级。';
  } catch (e) {
    // State unknown: keep the switch inert rather than guessing on or off.
    toggle.disabled = true; hostLabel.textContent = site || '当前页面不支持';
    document.querySelector('#hint').textContent = e.message;
  }
})();

(async function () {
  document.querySelector('#open').addEventListener('click', () => chrome.runtime.openOptionsPage());
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!response?.ok) throw new Error(response?.error ?? '加载失败。');
    for (const [status, count] of Object.entries(response.data.counts)) document.getElementById(status).textContent = count.toLocaleString();
    document.querySelector('#hint').textContent = response.data.state.initialized ? '词汇状态保存在本机。' : '打开词本，选择初始 CEFR 等级。';
  } catch (e) { document.querySelector('#hint').textContent = e.message; }
})();

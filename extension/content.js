(function () {
  'use strict';
  const C = LexiTrail;
  const EXCLUDED = 'script,style,noscript,pre,code,textarea,input,select,button,svg,math,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[hidden],[aria-hidden="true"]';
  let current = C.emptyState(), scanVersion = 0, refreshVersion = 0, lookupVersion = 0, timer;
  let selected = null, cardSelection = null, cardWord = '', lastResult = null, returnFocus = null;
  let hitTargets = new WeakMap(), hoverTimer, closeTimer, hoverWord = '', pinned = false;
  const annotations = new Map();
  const ANNOTATION = 'data-lexitrail-translation';
  const host = document.createElement('div');
  host.id = 'lexitrail-root';
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{color-scheme:light}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #3979dc;outline-offset:3px}
    .trigger{position:fixed;pointer-events:auto;border:1px solid #e3e6ec;border-radius:9px;background:#fff;color:#3979dc;width:32px;height:30px;box-shadow:0 3px 12px #152a4325;font:bold 17px system-ui;display:none}
    .card{position:fixed;pointer-events:auto;width:350px;max-width:calc(100vw - 24px);background:#fff;color:#253143;border:1px solid #e5e8ef;border-radius:16px;box-shadow:0 10px 40px #152a4328;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:none;max-height:calc(100vh - 24px);overflow:auto}
    .header{padding:18px 20px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #edf0f4}.word{font-size:24px;font-weight:650;line-height:1.2;overflow-wrap:anywhere}.level{font-size:11px;padding:2px 7px;background:#f1f4f8;border-radius:5px;color:#7b8798}.grow{flex:1}.icon{background:none;border:0;color:#8590a0;padding:5px;font-size:17px}.phonetic{font-size:12px;color:#8891a0}.content{padding:16px 20px}.meaning{font-size:17px;font-weight:600;margin:0 0 6px}.definition{margin:0 0 16px;color:#667386}.example{border-left:2px solid #d8e5fb;padding-left:12px;margin:12px 0;color:#455468}.example p{margin:4px 0}.translation{color:#8b95a5;font-size:12px}.notice{font-size:12px;color:#9b784e;margin:10px 0}.status{font-size:12px;color:#8994a5;margin:0 0 10px}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{border:1px solid #e2e7ee;background:#fff;border-radius:8px;padding:7px 11px;color:#637086;font-size:12px}.actions button[data-status="learning"]{background:#fff6ea;border-color:#f0dcc0;color:#bc7427}.actions button[data-status="new"]{color:#3979dc}.actions button.active{box-shadow:inset 0 0 0 1px currentColor}.footer{display:flex;justify-content:space-between;margin-top:15px;font-size:11px;color:#a1aaba}.footer button{border:0;background:none;font-size:11px;color:#8a95a5;padding:0}.original-link{display:block;margin-top:12px;color:#3979dc;font-size:12px;text-decoration:none}.saving{font-size:11px;color:#7c8898;margin-top:8px}.loader{color:#8a95a5;padding:8px 0}
    @media(prefers-reduced-motion:no-preference){.card{animation:appear .12s ease-out}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}}
  </style><button class="trigger" title="查词并标记" aria-label="查词并标记">L</button>
  <section class="card" role="dialog" aria-label="英文查词卡"><div class="header"><div class="grow"><div class="word"></div><span class="phonetic"></span></div><span class="level"></span><button class="icon speak" title="发音" aria-label="播放单词发音">♬</button><button class="icon close" title="关闭" aria-label="关闭查词卡">×</button></div><div class="content"></div></section>`;
  document.documentElement.append(host);
  const trigger = shadow.querySelector('.trigger'), card = shadow.querySelector('.card'), body = shadow.querySelector('.content');
  function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
  async function send(message) {
    let response;
    try { response = await chrome.runtime.sendMessage(message); }
    catch { throw new Error('扩展已更新，请刷新网页。'); }
    if (!response?.ok) throw new Error(response?.error ?? '操作失败，请重试。');
    return response.data;
  }
  function eligible(node) {
    return node.nodeType === Node.TEXT_NODE && node.parentElement && !node.parentElement.closest(EXCLUDED) && !host.contains(node);
  }
  async function highlight() {
    const version = ++scanVersion;
    if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
    // Generated CSS text adds a visible translation while keeping copied text
    // and selected English words intact. Only our own spans are reversible.
    observer.disconnect();
    for (const [span, original] of annotations) {
      const record = current.words[original.word];
      if (!span.isConnected) { annotations.delete(span); continue; }
      if (!current.enabled || record?.status !== 'new' || !record.translation || span.textContent !== original.text) {
        span.replaceWith(...span.childNodes); annotations.delete(span);
      } else span.setAttribute(ANNOTATION, record.translation);
    }
    observe();
    const nodes = [], walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (eligible(node) && !node.parentElement.closest(`[${ANNOTATION}]`)) nodes.push(node);
    if (current.enabled) for (let i = 0; i < nodes.length; i++) {
      if (version !== scanVersion) return;
      node = nodes[i];
      if (!node.isConnected || !eligible(node)) continue;
      const matches = C.tokens(node.data).filter(token => current.words[token.word]?.status === 'new' && current.words[token.word].translation);
      if (matches.length) {
        const fragment = document.createDocumentFragment(); let offset = 0;
        for (const token of matches) {
          fragment.append(document.createTextNode(node.data.slice(offset, token.start)));
          const text = node.data.slice(token.start, token.end), span = document.createElement('span');
          span.textContent = text; span.setAttribute(ANNOTATION, current.words[token.word].translation);
          annotations.set(span, { word: token.word, text }); fragment.append(span); offset = token.end;
        }
        fragment.append(document.createTextNode(node.data.slice(offset)));
        observer.disconnect(); node.replaceWith(fragment); observe();
      }
      if (i % 250 === 249) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const fresh = new Highlight(), learning = new Highlight(), targets = new WeakMap();
    if (current.enabled) {
      const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
      let node, processed = 0;
      while ((node = walker.nextNode())) {
        if (version !== scanVersion) return;
        if (eligible(node)) for (const token of C.tokens(node.data)) {
          const status = current.words[token.word]?.status;
          if (status !== 'new' && status !== 'learning') continue;
          const range = document.createRange(); range.setStart(node, token.start); range.setEnd(node, token.end);
          (status === 'new' ? fresh : learning).add(range);
          const entries = targets.get(node) ?? []; entries.push({ word: token.word, range }); targets.set(node, entries);
        }
        if (++processed % 250 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (version === scanVersion) {
      hitTargets = targets;
      CSS.highlights.set('lexitrail-new', fresh); CSS.highlights.set('lexitrail-learning', learning);
    }
  }
  function scheduleHighlight() { clearTimeout(timer); timer = setTimeout(() => highlight(), 180); }
  async function refresh() {
    const version = ++refreshVersion;
    try {
      const data = await send({ type: 'GET_STATE' });
      if (version !== refreshVersion) return;
      current = data.state;
      scheduleHighlight();
      if (cardWord && card.style.display === 'block') renderCard(lastResult);
    } catch {}
  }
  function position(el, rect, width) {
    el.style.left = `${Math.max(12, Math.min(rect.right + 6, innerWidth - width - 12))}px`;
    el.style.top = `${Math.max(12, Math.min(rect.top - 6, innerHeight - (el === card ? 420 : 36)))}px`;
  }
  function contextFor(node, term, rect) {
    const parent = node.parentElement.closest('p,li,blockquote,article,section,div') ?? node.parentElement;
    const paragraph = parent.textContent.trim(), offset = paragraph.toLowerCase().indexOf(term);
    let link = '';
    try {
      const href = node.parentElement.closest('a[href]')?.getAttribute('href');
      if (href) { const parsed = new URL(href, location.href); if (['https:', 'http:'].includes(parsed.protocol)) link = parsed.href; }
    } catch {}
    return { word: term, context: paragraph.slice(Math.max(0, offset - 140), Math.max(0, offset - 140) + 300).trim(), rect, link, url: location.href, title: document.title };
  }
  function hit(event) {
    if (!current.enabled || event.composedPath().includes(host)) return null;
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const legacy = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.offsetNode ?? legacy?.startContainer;
    if (!node || !eligible(node)) return null;
    for (const entry of hitTargets.get(node) ?? []) {
      const status = current.words[entry.word]?.status;
      if (status !== 'new' && status !== 'learning') continue;
      // Range rectangles cover the English text, excluding the CSS translation.
      for (const rect of entry.range.getClientRects()) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
          return contextFor(node, entry.word, rect);
      }
    }
    return null;
  }
  function cancelHover() { clearTimeout(hoverTimer); hoverWord = ''; }
  function closeHover() {
    clearTimeout(closeTimer);
    if (!pinned && card.style.display === 'block') closeTimer = setTimeout(hide, 250);
  }
  function hover(event) {
    if (event.pointerType === 'touch' || event.buttons || event.composedPath().includes(host)) { cancelHover(); return; }
    if (pinned && card.style.display === 'block') return;
    const target = hit(event);
    if (!target) { cancelHover(); closeHover(); return; }
    clearTimeout(closeTimer);
    if (card.style.display === 'block' && cardWord === target.word) return;
    if (hoverWord === target.word) return;
    cancelHover(); hoverWord = target.word;
    hoverTimer = setTimeout(() => {
      hoverWord = '';
      if (current.enabled && ['new', 'learning'].includes(current.words[target.word]?.status)) openCard(target, false);
    }, 300);
  }
  function selection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) { trigger.style.display = 'none'; return; }
    const range = selection.getRangeAt(0);
    if (!eligible(range.startContainer) || !eligible(range.endContainer)) { trigger.style.display = 'none'; return; }
    const term = C.word(selection.toString());
    if (!term) { trigger.style.display = 'none'; return; }
    const rect = range.getBoundingClientRect();
    selected = contextFor(range.startContainer, term, rect);
    position(trigger, { right: rect.right, top: rect.top - 26 }, 32);
    trigger.style.display = 'block';
  }
  function hide() {
    cancelHover(); clearTimeout(closeTimer); pinned = false;
    lookupVersion++; cardWord = ''; lastResult = null; card.style.display = 'none'; trigger.style.display = 'none';
    returnFocus?.focus?.({ preventScroll: true }); returnFocus = null;
  }
  function renderCard(result) {
    body.replaceChildren();
    const record = current.words[cardWord];
    body.append(element('p', `词汇状态 · ${C.STATUSES[record?.status] ?? '尚未加入词本'}`, 'status'));
    if (result) {
      if (result.meaning) body.append(element('p', `${result.partOfSpeech ? `${result.partOfSpeech} · ` : ''}${result.meaning}`, 'meaning'));
      if (result.definition) body.append(element('p', result.definition, 'definition'));
      if (result.example) {
        const example = element('div', '', 'example'); example.append(element('p', result.example));
        if (result.exampleTranslation) example.append(element('p', result.exampleTranslation, 'translation'));
        body.append(example);
      }
      if (result.notice) body.append(element('p', result.notice, 'notice'));
      if (result.audioNotice) body.append(element('p', result.audioNotice, 'notice'));
      shadow.querySelector('.phonetic').textContent = result.phonetic ?? '';
      shadow.querySelector('.level').textContent = result.level || record?.level || 'EN';
    } else body.append(element('div', '正在查词…', 'loader'));
    const actions = element('div', '', 'actions');
    for (const [status, label] of Object.entries(C.STATUSES)) {
      const button = element('button', status === 'learning' ? '☆ 加入学习中' : label);
      button.dataset.status = status; button.classList.toggle('active', record?.status === status);
      button.setAttribute('aria-pressed', String(record?.status === status));
      button.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach(b => b.disabled = true);
        const term = cardWord;
        try {
          const updated = await send({ type: 'MARK_WORD', word: term, status, lookup: lastResult, example: { text: cardSelection?.context ?? '', url: cardSelection?.url ?? '', title: cardSelection?.title ?? '' } });
          current.words[term] = updated;
          await highlight();
          if (cardWord === term) { renderCard(lastResult); body.append(element('div', '已保存词汇状态和原文语境', 'saving')); }
        } catch (error) { body.append(element('p', error.message, 'notice')); actions.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      actions.append(button);
    }
    body.append(actions);
    if (cardSelection?.link) {
      const link = element('a', '前往原链接 ↗', 'original-link'); link.href = cardSelection.link; link.target = '_blank'; link.rel = 'noreferrer'; body.append(link);
    }
    const footer = element('div', '', 'footer'); footer.append(element('span', result?.source ?? 'LexiTrail'));
    const settings = element('button', '词本与设置'); settings.addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }).catch(() => {})); footer.append(settings); body.append(footer);
    if (result?.notice || result?.error) {
      const retry = element('button', '重新查词'); retry.className = 'icon'; retry.addEventListener('click', () => openCard(cardSelection)); body.append(retry);
    }
  }
  async function openCard(target = selected, focus = true) {
    if (!target) return;
    cancelHover(); clearTimeout(closeTimer); pinned = focus;
    const version = ++lookupVersion;
    cardSelection = { ...target };
    cardWord = cardSelection.word; lastResult = null; returnFocus = focus ? document.activeElement : null;
    shadow.querySelector('.word').textContent = cardWord;
    shadow.querySelector('.phonetic').textContent = '';
    shadow.querySelector('.level').textContent = current.words[cardWord]?.level || 'EN';
    card.style.display = 'block'; trigger.style.display = 'none'; position(card, target.rect, 350); renderCard(null);
    if (focus) shadow.querySelector('.close').focus({ preventScroll: true });
    try {
      const result = await send({ type: 'LOOKUP', word: cardWord, context: cardSelection.context });
      if (version !== lookupVersion) return;
      lastResult = result; renderCard(result);
    } catch (error) {
      if (version !== lookupVersion) return;
      lastResult = { error: true, notice: error.message }; renderCard(lastResult);
    }
  }
  function systemSpeak() {
    if (!globalThis.speechSynthesis) { body.append(element('p', '当前浏览器暂时无法发音。', 'notice')); return; }
    speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(cardWord); utterance.lang = 'en-US'; speechSynthesis.speak(utterance);
  }
  shadow.querySelector('.speak').addEventListener('click', () => {
    const source = C.safeAudio(lastResult?.audio ?? C.dictionaryAudio(cardWord));
    if (source) { const audio = new Audio(source); audio.play().catch(systemSpeak); }
    else systemSpeak();
  });
  shadow.querySelector('.close').addEventListener('click', hide);
  trigger.addEventListener('mousedown', event => event.preventDefault()); trigger.addEventListener('click', () => openCard());
  shadow.addEventListener('click', event => event.stopPropagation());
  shadow.addEventListener('mousedown', event => { pinned = true; event.stopPropagation(); });
  card.addEventListener('pointerenter', () => { cancelHover(); clearTimeout(closeTimer); });
  card.addEventListener('pointerleave', closeHover);
  shadow.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); hide(); }
    if (event.key === 'Tab' && card.style.display === 'block') {
      const controls = [...card.querySelectorAll('button:not(:disabled),a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('pointermove', hover, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) { cancelHover(); closeHover(); } }, { passive: true });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = hit(event);
    if (!target?.link) return;
    event.preventDefault(); event.stopPropagation();
    if (cardWord === target.word && card.style.display === 'block') { pinned = true; cancelHover(); clearTimeout(closeTimer); }
    else openCard(target, true);
  }, true);
  document.addEventListener('mouseup', event => { if (!event.composedPath().includes(host)) setTimeout(selection, 0); });
  document.addEventListener('keyup', event => { if (event.key === 'Escape') hide(); else if (event.shiftKey) selection(); });
  document.addEventListener('mousedown', event => { if (!event.composedPath().includes(host)) hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'STATE_CHANGED') refresh(); });
  const observer = new MutationObserver(scheduleHighlight);
  function observe() { observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true }); }
  observe();
  refresh();
})();

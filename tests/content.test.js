'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../extension');
async function fixture({ siteDisabled = false } = {}) {
  const dom = new JSDOM('<!doctype html><title>Fixture</title><article><p id="reading">Apple grows in a forest. Quasar shines.</p><code id="code">apple forest</code><div contenteditable="true" id="edit">apple</div><a id="link" href="https://example.org">apple</a></article>', { url: 'https://example.org/article', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, highlights = new Map(); let shadow, listener;
  const original = w.HTMLElement.prototype.attachShadow;
  w.HTMLElement.prototype.attachShadow = function (options) { shadow = original.call(this, options); return shadow; };
  w.CSS = { highlights }; w.Highlight = Set;
  w.Range.prototype.getBoundingClientRect = () => ({ right: 250, left: 100, top: 100, bottom: 120 });
  w.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  const requests = [];
  let hitNode = null; w.document.caretPositionFromPoint = () => hitNode ? { offsetNode: hitNode, offset: 0 } : null;
  const current = { initialized: true, enabled: true, words: { apple: { word: 'apple', status: 'new', level: 'A1', translation: '苹果' }, forest: { word: 'forest', status: 'learning', level: 'A2', translation: '森林' } } };
  let lookupResolve; const site = { disabled: siteDisabled };
  w.chrome = { runtime: { onMessage: { addListener: f => listener = f }, sendMessage: async m => {
    requests.push(m);
    if (m.type === 'GET_STATE') return { ok: true, data: { state: structuredClone(current), siteDisabled: site.disabled } };
    if (m.type === 'MARK_WORD') { const record = { word: m.word, status: m.status, examples: [m.example] }; current.words[m.word] = record; return { ok: true, data: record }; }
    if (m.type === 'LOOKUP') return new Promise(r => lookupResolve = r);
    return { ok: true, data: {} };
  } } };
  w.eval(fs.readFileSync(path.join(root, 'core.js'), 'utf8')); w.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 260));
  return { dom, w, shadow, highlights, current, site, listener, requests, point: node => { hitNode = node; }, resolve: data => lookupResolve({ ok: true, data }) };
}
test('translations preserve text and selection, exclude editing/code, and restore on status changes', async () => {
  const f = await fixture(), paragraph = f.w.document.querySelector('#reading');
  assert.equal(paragraph.querySelector('[data-lexitrail-translation]').getAttribute('data-lexitrail-translation'), '苹果');
  assert.equal(paragraph.textContent, 'Apple grows in a forest. Quasar shines.');
  assert.equal(f.w.document.querySelector('#code').childNodes.length, 1);
  assert.equal(f.w.document.querySelector('#edit').childNodes.length, 1);
  assert.equal(f.highlights.get('lexitrail-new').size, 2); assert.equal(f.highlights.get('lexitrail-learning').size, 1);
  assert([...f.highlights.values()].flatMap(h => [...h]).every(r => !['code', 'edit'].includes(r.startContainer.parentElement.id)));
  paragraph.append(f.w.document.createTextNode(' Another apple.')); await new Promise(r => setTimeout(r, 260));
  assert.equal(f.highlights.get('lexitrail-new').size, 3);
  f.current.words.apple.status = 'mastered'; f.listener({ type: 'STATE_CHANGED' }); await new Promise(r => setTimeout(r, 260));
  assert.equal(f.highlights.get('lexitrail-new').size, 0);
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0);
  f.current.words.apple.status = 'new'; f.listener({ type: 'STATE_CHANGED' }); await new Promise(r => setTimeout(r, 260));
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 3);
  f.current.enabled = false; f.listener({ type: 'STATE_CHANGED' }); await new Promise(r => setTimeout(r, 260));
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0);
  assert.equal(paragraph.textContent, 'Apple grows in a forest. Quasar shines. Another apple.');
  f.dom.window.close();
});
test('unlisted selected word can be marked before AI completes; hostile definitions render as text', async () => {
  const f = await fixture(), paragraph = f.w.document.querySelector('#reading');
  const text = [...paragraph.childNodes].find(n => n.nodeType === 3 && n.data.includes('Quasar'));
  const start = text.data.indexOf('Quasar');
  const range = f.w.document.createRange(); range.setStart(text, start); range.setEnd(text, start + 6);
  assert.equal(range.toString(), 'Quasar');
  f.w.getSelection().addRange(range); f.w.document.dispatchEvent(new f.w.MouseEvent('mouseup', { bubbles: true }));
  await new Promise(r => setTimeout(r, 10));
  const trigger = f.shadow.querySelector('.trigger'); assert.equal(trigger.style.display, 'block'); trigger.click();
  await new Promise(r => setTimeout(r, 10));
  f.shadow.querySelector('[data-status="learning"]').click(); await new Promise(r => setTimeout(r, 30));
  assert.equal(f.current.words.quasar.status, 'learning');
  f.resolve({ meaning: '<img src=x onerror=alert(1)>', example: 'A quasar shines.', source: 'Fixture' });
  await new Promise(r => setTimeout(r, 10));
  assert(f.shadow.querySelector('.meaning').textContent.includes('<img')); assert.equal(f.shadow.querySelectorAll('img').length, 0);
  assert.equal(paragraph.textContent, 'Apple grows in a forest. Quasar shines.');
  f.dom.window.close();
});
test('rescans avoid duplicate translations and preserve host edits inside annotated words', async () => {
  const f = await fixture(), paragraph = f.w.document.querySelector('#reading');
  for (let i = 0; i < 3; i++) { paragraph.append(f.w.document.createTextNode(' ')); await new Promise(r => setTimeout(r, 210)); }
  assert.equal(paragraph.querySelectorAll('[data-lexitrail-translation]').length, 1);
  assert.equal(paragraph.querySelector('[data-lexitrail-translation] [data-lexitrail-translation]'), null);
  paragraph.querySelector('[data-lexitrail-translation]').textContent = 'Forest'; await new Promise(r => setTimeout(r, 260));
  assert.equal(paragraph.querySelector('[data-lexitrail-translation]'), null);
  assert(paragraph.textContent.startsWith('Forest grows'));
  assert.equal(f.highlights.get('lexitrail-learning').size, 2);
  f.dom.window.close();
});

test('marked English hover opens a card without stealing focus, translation area and quick passes avoid lookup', async () => {
  const f = await fixture(), apple = f.w.document.querySelector('#reading [data-lexitrail-translation]');
  f.point(apple.firstChild);
  const move = x => apple.dispatchEvent(new f.w.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 110 }));
  const focus = f.w.document.activeElement;
  move(310); await new Promise(r => setTimeout(r, 340));
  assert.equal(f.requests.filter(m => m.type === 'LOOKUP').length, 0);
  move(150); await new Promise(r => setTimeout(r, 50)); move(310);
  await new Promise(r => setTimeout(r, 340)); assert.equal(f.requests.filter(m => m.type === 'LOOKUP').length, 0);
  move(150); await new Promise(r => setTimeout(r, 340));
  assert.equal(f.shadow.querySelector('.card').style.display, 'block'); assert.equal(f.w.document.activeElement, focus);
  assert.equal(f.requests.filter(m => m.type === 'LOOKUP').length, 1); assert.equal(f.shadow.querySelector('.trigger').style.display, 'none');
  move(160); await new Promise(r => setTimeout(r, 340)); assert.equal(f.requests.filter(m => m.type === 'LOOKUP').length, 1);
  move(310); f.shadow.querySelector('.card').dispatchEvent(new f.w.Event('pointerenter'));
  await new Promise(r => setTimeout(r, 280)); assert.equal(f.shadow.querySelector('.card').style.display, 'block');
  f.shadow.querySelector('.card').dispatchEvent(new f.w.Event('pointerleave'));
  await new Promise(r => setTimeout(r, 280)); assert.equal(f.shadow.querySelector('.card').style.display, 'none');
  f.resolve({ meaning: 'Late result' }); await new Promise(r => setTimeout(r, 10)); assert.equal(f.shadow.querySelector('.card').style.display, 'none');
  f.dom.window.close();
});
test('learning words hover too; marked link clicks open a pinned card while modifier clicks retain native behavior', async () => {
  const f = await fixture(), forest = [...f.highlights.get('lexitrail-learning')][0].startContainer;
  f.point(forest); forest.parentElement.dispatchEvent(new f.w.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 110 }));
  await new Promise(r => setTimeout(r, 340)); assert.equal(f.shadow.querySelector('.word').textContent, 'forest');
  f.w.document.dispatchEvent(new f.w.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  const anchor = f.w.document.querySelector('#link'); f.point(anchor.querySelector('[data-lexitrail-translation]').firstChild);
  const click = new f.w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 110 });
  anchor.dispatchEvent(click); await new Promise(r => setTimeout(r, 10)); assert(click.defaultPrevented);
  const original = f.shadow.querySelector('.original-link'); assert.equal(original.href, 'https://example.org/'); assert.equal(original.rel, 'noreferrer');
  f.shadow.querySelector('.card').dispatchEvent(new f.w.Event('pointerleave')); await new Promise(r => setTimeout(r, 280));
  assert.equal(f.shadow.querySelector('.card').style.display, 'block');
  // Observe our capture listener before cancelling navigation in a page listener.
  let prevented; anchor.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault(); });
  anchor.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 150, clientY: 110 }));
  assert.equal(prevented, false);
  f.current.enabled = false; f.listener({ type: 'STATE_CHANGED' }); await new Promise(r => setTimeout(r, 260));
  f.point(anchor.firstChild); prevented = null;
  anchor.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 110 })); assert.equal(prevented, false);
  f.dom.window.close();
});

const wait = ms => new Promise(r => setTimeout(r, ms));
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
function selectWord(f, word) {
  const text = [...f.w.document.querySelectorAll('#reading, #reading *')].flatMap(el => [...el.childNodes]).find(n => n.nodeType === 3 && n.data.includes(word));
  const start = text.data.indexOf(word), range = f.w.document.createRange();
  range.setStart(text, start); range.setEnd(text, start + word.length);
  f.w.getSelection().removeAllRanges(); f.w.getSelection().addRange(range);
  f.w.document.dispatchEvent(new f.w.MouseEvent('mouseup', { bubbles: true }));
}
test('a site disabled from the popup is torn down immediately and restored without reload', async () => {
  const f = await fixture(), paragraph = f.w.document.querySelector('#reading');
  same(f.requests.find(m => m.type === 'GET_STATE'), { type: 'GET_STATE', site: 'example.org' });
  let reply; f.listener({ type: 'GET_SITE' }, { id: 'fixture' }, value => { reply = value; });
  same(reply, { site: 'example.org' });
  selectWord(f, 'Quasar'); await wait(10);
  assert.equal(f.shadow.querySelector('.trigger').style.display, 'block');
  const apple = paragraph.querySelector('[data-lexitrail-translation]'); f.point(apple.firstChild);
  apple.dispatchEvent(new f.w.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 110 })); await wait(340);
  assert.equal(f.shadow.querySelector('.card').style.display, 'block');
  f.site.disabled = true; f.listener({ type: 'STATE_CHANGED' }); await wait(20);
  // No scan delay: marks, translations, card and selection button disappear at once.
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0);
  assert.equal(paragraph.textContent, 'Apple grows in a forest. Quasar shines.');
  assert(!f.highlights.get('lexitrail-new')?.size); assert(!f.highlights.get('lexitrail-learning')?.size);
  assert.equal(f.shadow.querySelector('.card').style.display, 'none'); assert.equal(f.shadow.querySelector('.trigger').style.display, 'none');
  const lookups = f.requests.filter(m => m.type === 'LOOKUP').length;
  selectWord(f, 'Quasar'); await wait(10); assert.equal(f.shadow.querySelector('.trigger').style.display, 'none');
  f.point(paragraph.firstChild);
  paragraph.dispatchEvent(new f.w.MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 110 })); await wait(340);
  assert.equal(f.shadow.querySelector('.card').style.display, 'none'); assert.equal(f.requests.filter(m => m.type === 'LOOKUP').length, lookups);
  paragraph.append(f.w.document.createTextNode(' Another apple.')); await wait(260);
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0); assert(!f.highlights.get('lexitrail-new')?.size);
  f.site.disabled = false; f.listener({ type: 'STATE_CHANGED' }); await wait(20);
  assert.equal(paragraph.querySelectorAll('[data-lexitrail-translation]').length, 2);
  assert.equal(f.highlights.get('lexitrail-new').size, 3); assert.equal(f.highlights.get('lexitrail-learning').size, 1);
  selectWord(f, 'Quasar'); await wait(10); assert.equal(f.shadow.querySelector('.trigger').style.display, 'block');
  f.dom.window.close();
});
test('a page on a disabled site does no marking on load and stays idle until re-enabled', async () => {
  const f = await fixture({ siteDisabled: true }), paragraph = f.w.document.querySelector('#reading');
  assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0);
  assert.equal(f.highlights.size, 0);
  paragraph.append(f.w.document.createTextNode(' Another apple.')); await wait(260);
  assert.equal(f.highlights.size, 0); assert.equal(f.w.document.querySelectorAll('[data-lexitrail-translation]').length, 0);
  selectWord(f, 'Quasar'); await wait(10); assert.equal(f.shadow.querySelector('.trigger').style.display, 'none');
  f.site.disabled = false; f.listener({ type: 'STATE_CHANGED' }); await wait(20);
  assert.equal(paragraph.querySelectorAll('[data-lexitrail-translation]').length, 2);
  assert.equal(f.highlights.get('lexitrail-new').size, 3);
  f.dom.window.close();
});

test('continuous page mutations still annotate newly inserted vocabulary promptly', async () => {
  const f = await fixture();
  const reading = f.w.document.querySelector('#reading');
  const live = f.w.document.createElement('div'); f.w.document.body.append(live);
  const added = f.w.document.createElement('p'); added.textContent = 'apple'; reading.append(added);
  const interval = setInterval(() => { live.textContent = String(Date.now()); }, 35);
  try {
    await wait(650);
    assert(added.querySelector('[data-lexitrail-translation]'), 'new vocabulary must appear while a live ticker keeps updating');
  } finally { clearInterval(interval); f.dom.window.close(); }
});

test('offline dictionary meaning is visible while the AI service is still pending', async () => {
  const f = await fixture();
  try {
    selectWord(f, 'Apple'); await wait(10); f.shadow.querySelector('.trigger').click(); await wait(10);
    assert.equal(f.shadow.querySelector('.meaning')?.textContent, '苹果');
    assert(f.shadow.querySelector('.loader'));
    assert.equal(f.shadow.querySelector('[data-status="learning"]').disabled, false);
  } finally { f.dom.window.close(); }
});

'use strict';
// Production UI and background logic; Chrome APIs and paid model are test doubles.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { worker } = require('./worker-fixture');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../extension');
const dictionary = require('../extension/data/cefr.json'), translations = require('../extension/data/translations.json');
const backend = worker({}, { dictionary, translations });
backend.stored.deepseekKey = 'fixture-only';
backend.context.LexiTrailAPI.deepseek = async (term) => {
  await new Promise(r => setTimeout(r, 700));
  if (term === 'quasar') return { meaning: '类星体', definition: 'A very bright, distant galactic nucleus.', partOfSpeech: 'noun', example: 'A quasar shines far beyond our galaxy.', exampleTranslation: '一颗类星体在我们银河系之外的远处闪耀。' };
  return { meaning: translations[term] || '测试释义', definition: 'Able to recover quickly after difficulty.', partOfSpeech: 'adjective', example: 'The resilient forest grows again after the storm.', exampleTranslation: '这片有韧性的森林在风暴后重新生长。' };
};
// Simulated Drive for browser UI checks; production OAuth/REST is unit-tested separately.
const cloudFiles = new Map();
const cloudRequest = async (url, options) => {
  const parsed = new URL(url), id = parsed.pathname.split('/').at(-1);
  let data;
  if (options.method === 'POST') {
    const boundary = options.headers['Content-Type'].split('boundary=')[1];
    const sections = options.body.split('--' + boundary).filter(section => section.includes('Content-Type:'));
    const values = sections.map(section => JSON.parse(section.slice(section.indexOf('\r\n\r\n') + 4).trim()));
    const fileId = `fixture-${cloudFiles.size + 1}`; cloudFiles.set(fileId, { name: values[0].name, value: values[1] }); data = { id: fileId };
  } else if (options.method === 'PATCH') { cloudFiles.get(id).value = JSON.parse(options.body); data = { id }; }
  else if (parsed.searchParams.get('alt') === 'media') data = cloudFiles.get(id).value;
  else data = { files: [...cloudFiles].map(([id, file]) => ({ id, name: file.name })) };
  return new Response(JSON.stringify(data));
};
Object.assign(vm.runInContext('drive', backend.context), backend.context.LexiTrailDrive.create(backend.context.chrome, cloudRequest));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain' };
const stub = `(() => {
  const listeners = [], channel = new BroadcastChannel('lexitrail-fixture');
  const originalShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) { return originalShadow.call(this, {...options, mode:'open'}); };
  const changed = () => listeners.forEach(f => f({state:{}}));
  channel.onmessage = changed;
  window.chrome = {storage:{onChanged:{addListener:f=>listeners.push(f)}},runtime:{
    onMessage:{addListener:f=>listeners.push(()=>f({type:'STATE_CHANGED'}))},
    openOptionsPage:async()=>{location.href='/options.html'},
    sendMessage: async message => {
      if(message.type==='OPEN_OPTIONS'){location.href='/options.html';return {ok:true,data:{}};}
      const response = await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,settings:location.pathname==='/options.html'})}).then(r=>r.json());
      if(['INITIALIZE','MARK_WORD','SAVE_SETTINGS','LOOKUP','DRIVE_CONNECT','DRIVE_DISCONNECT','DRIVE_SYNC','IMPORT_BACKUP'].includes(message.type) && response.ok){changed();channel.postMessage('changed');}
      return response;
    }
  }};
})();`;
const article = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LexiTrail reading fixture</title><link rel="stylesheet" href="highlight.css"><style>body{font:19px/1.9 Georgia,serif;color:#3d454d;margin:60px auto;max-width:750px;padding:0 30px}h1{font-size:42px;line-height:1.2}small{font:11px system-ui;color:#8a97a8;letter-spacing:2px}a{color:#3979dc;font:13px system-ui}.meta{color:#a1a9b3;font:13px system-ui}</style><script src="core.js" defer></script><script src="fixture.js" defer></script><script src="content.js" defer></script></head><body><small>READING NOTES · ENGLISH · BROWSER FIXTURE</small><h1>A forest remembers</h1><p class="meta">A short article for vocabulary practice</p><article><p>The forest is <a id="marked-link" href="https://example.org/lexitrail-fixture"><span id="pick">resilient</span></a>. After a storm, the trees recover and new plants begin to grow. Every trail reveals a different story about nature.</p><p>Walking slowly, we notice how sunlight reaches the ground. A curious observer can discover patterns in the leaves and branches.</p><p id="dynamic">A <span id="outside">quasar</span> shines far beyond the forest. Language grows in the same way: one word, one example, and one new encounter at a time.</p></article><a href="options.html">Open vocabulary & settings →</a></body></html>`;
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/rpc' && req.method === 'POST') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 9 * 1024 * 1024) throw Error('Too large'); }
      const { message, settings } = JSON.parse(body);
      const data = await backend.send(message, settings ? 'chrome-extension://fixture/options.html' : 'http://127.0.0.1:8781/article.html');
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(data));
    } catch { res.writeHead(400); return res.end(); }
  }
  if (pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(stub); }
  if (pathname === '/article.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(article); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/options.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(file);
  if (file.endsWith('options.html')) data = data.toString().replace('<script src="options.js"', '<script src="fixture.js" defer></script><script src="options.js"').replace('<main>', '<main><p class="muted">浏览器测试页 · 模拟 LLM / Google Drive</p>');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(data);
}).listen(8781, '127.0.0.1', () => console.log('Browser fixture: http://127.0.0.1:8781/options.html'));

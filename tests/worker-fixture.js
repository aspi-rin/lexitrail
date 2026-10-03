'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../extension');
function worker(initial = {}, data = {}) {
  const stored = structuredClone(initial), calls = [], listeners = [], temporary = {};
  const runtime = { id: 'fixture', getManifest: () => ({ oauth2: { client_id: 'fixture.apps.googleusercontent.com', scopes: ['https://www.googleapis.com/auth/drive.appdata'] } }), getURL: p => `chrome-extension://fixture/${p}`, onMessage: { addListener: f => listeners.push(f) }, openOptionsPage: async () => {} };
  const context = vm.createContext({ console, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
    chrome: { runtime, identity: { getAuthToken: async () => ({ token: 'fixture-token', grantedScopes: ['https://www.googleapis.com/auth/drive.appdata'] }), removeCachedAuthToken: async () => {} }, storage: { session: {
      setAccessLevel: async () => {}, get: async key => ({ [key]: structuredClone(temporary[key]) }),
      set: async values => Object.assign(temporary, structuredClone(values)), remove: async key => { delete temporary[key]; }
    }, local: {
      setAccessLevel: async options => { calls.push(options); }, get: async key => ({ [key]: structuredClone(stored[key]) }),
      set: async values => { await new Promise(r => setTimeout(r, 1)); Object.assign(stored, structuredClone(values)); }
    } }, tabs: { query: async () => [{ id: 7 }], sendMessage: async () => {} } },
    fetch: async url => {
      if (url.endsWith('data/translations.json')) return { json: async () => (data.translations ?? { apple: '苹果', forest: '森林', obscure: '晦涩的' }) };
      assert(url.endsWith('data/cefr.json')); return { json: async () => (data.dictionary ?? { apple: 'A1', forest: 'A2', obscure: 'C1' }) };
    }
  });
  context.importScripts = (...names) => names.forEach(name => vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context));
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  return { stored, calls, context, send: (message, url = runtime.getURL('options.html')) => new Promise(resolve => listeners[0](message, { id: 'fixture', url }, resolve)) };
}

module.exports = { worker };

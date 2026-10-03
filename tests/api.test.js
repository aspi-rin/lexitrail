'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/core');
const API = require('../extension/api');
test('Flash request uses bounded context, JSON output and disabled thinking', async () => {
  const original = global.fetch; let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"meaning":"小径","example":"We walked along the trail."}' } }] }) };
  };
  try {
    await API.deepseek('trail', 'x'.repeat(900), 'fixture');
    assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.body.model, 'deepseek-flash'); assert.equal(request.body.thinking.type, 'disabled');
    assert.equal(request.body.max_tokens, 320); assert.equal(request.body.response_format.type, 'json_object');
    assert.equal(JSON.parse(request.body.messages[1].content).context.length, 300);
    assert.equal(request.options.credentials, 'omit'); assert(request.options.signal);
  } finally { global.fetch = original; }
});
test('API errors are actionable and omit response bodies and credentials', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ credential: 'private' }) });
  try { await assert.rejects(API.deepseek('trail', '', 'fixture'), { message: 'Key 无效，请在设置中更新。' }); }
  finally { global.fetch = original; }
});

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

test('Anthropic sends a bounded Messages request and accepts only completed JSON text', async () => {
  const original = global.fetch; let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"meaning":"小径","example":"We followed the trail."}' }] }) };
  };
  try {
    const result = await API.anthropic('trail', 'x'.repeat(900), 'fixture');
    assert.equal(result.meaning, '小径');
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.options.headers['x-api-key'], 'fixture');
    assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.options.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(request.body.thinking.type, 'disabled');
    assert.equal(JSON.parse(request.body.messages[0].content).context.length, 300);
    global.fetch = async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"meaning":"小径","example":"We followed the trail."}' }] }) });
    await assert.rejects(API.anthropic('trail', '', 'fixture'), /完整/);
  } finally { global.fetch = original; }
});

test('malformed service output uses a short retryable error without leaking the response', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('private response data'); } });
  try { await assert.rejects(API.deepseek('trail', '', 'fixture'), { message: '服务返回格式异常，请重试。' }); }
  finally { global.fetch = original; }
});

test('both providers bound slow requests and translate timeout into a retryable error', async () => {
  const originalFetch = global.fetch, originalSignal = global.AbortSignal;
  const keepAlive = setTimeout(() => {}, 200);
  global.AbortSignal = { timeout: () => originalSignal.timeout(5) };
  global.fetch = async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(API.deepseek('trail', '', 'fixture'), { message: '请求超时，请重试。' });
    await assert.rejects(API.anthropic('trail', '', 'fixture'), { message: '请求超时，请重试。' });
  } finally { clearTimeout(keepAlive); global.fetch = originalFetch; global.AbortSignal = originalSignal; }
});

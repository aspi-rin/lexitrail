'use strict';
const fs = require('node:fs');
require('../extension/core');
const API = require('../extension/api');
async function main() {
  const provider = process.env.LEXITRAIL_TEST_PROVIDER || 'deepseek';
  if (!Object.hasOwn(LexiTrail.PROVIDERS, provider)) throw Error('Unknown provider');
  const keyFile = process.env.LEXITRAIL_TEST_KEY_FILE;
  if (!keyFile) throw Error('Set LEXITRAIL_TEST_KEY_FILE to a local protected key file.');
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  for (const [word, context] of [['trail', 'The narrow trail leads through the forest.'], ['resilient', 'A resilient community can recover after a storm.']]) {
    const start = Date.now();
    const result = await API[provider](word, context, key);
    if (!result.meaning || !result.example) throw Error('Missing AI result');
    let audioStatus = null;
    audioStatus = (await fetch(LexiTrail.dictionaryAudio(word), { method: 'HEAD', signal: AbortSignal.timeout(15000) })).status;
    console.log(JSON.stringify({ word, model: LexiTrail.PROVIDERS[provider].model, elapsedMs: Date.now() - start, ...result, audioStatus }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

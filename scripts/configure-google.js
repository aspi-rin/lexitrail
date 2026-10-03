'use strict';
const fs = require('node:fs'), crypto = require('node:crypto');
const file = require('node:path').join(__dirname, '../extension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const id = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)]
  .map(value => String.fromCharCode(97 + parseInt(value, 16))).join('');
const clientId = process.argv[2];
if (clientId) {
  if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw Error('Pass the public Google OAuth Client ID.');
  manifest.oauth2 = { client_id: clientId, scopes: ['https://www.googleapis.com/auth/drive.appdata'] };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`Chrome Extension Item ID: ${id}\nGoogle Client ID: ${manifest.oauth2?.client_id || '(pending registration)'}`);

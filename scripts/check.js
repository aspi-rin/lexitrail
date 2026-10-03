'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..'), folder = path.join(root, 'extension');
for (const entry of fs.readdirSync(folder)) {
  if (entry.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(folder, entry)]);
}
const manifest = require('../extension/manifest.json');
if (manifest.version !== require('../package.json').version) throw Error('Version mismatch');
const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...manifest.content_scripts.flatMap(s => [...s.js, ...s.css]), 'data/cefr.json', 'data/translations.json', 'data/ECDICT-LICENSE.txt'];
for (const name of files) if (!fs.existsSync(path.join(folder, name))) throw Error(`Missing ${name}`);
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/sk-[a-zA-Z0-9]{24,}/.test(fs.readFileSync(file, 'utf8'))) throw Error(`Credential-shaped literal in ${file}`);
  }
}
scan(folder);
console.log('Syntax, manifest paths, versions and extension credential scan passed.');

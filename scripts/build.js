'use strict';
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const manifest = require('../extension/manifest.json'), version = manifest.version;
const migration = process.argv.includes('--migration');
// A stable directory name makes subsequent manual updates straightforward.
const output = path.join(root, 'dist', migration ? 'lexitrail-migration' : 'lexitrail');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(root, 'extension'), output, { recursive: true });
if (migration) {
  const legacy = { ...manifest }; delete legacy.key; delete legacy.oauth2;
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(legacy, null, 2) + '\n');
}
for (const name of ['cefrj.csv', 'octanove.csv']) fs.rmSync(path.join(output, 'data', name));
fs.copyFileSync(path.join(root, 'README.md'), path.join(output, 'README.md'));
fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
fs.cpSync(path.join(root, 'docs'), path.join(output, 'docs'), { recursive: true });
const archive = path.join(root, 'dist', `lexitrail-${version}${migration ? '-migration' : ''}.zip`);
fs.rmSync(archive, { force: true });
execFileSync('/usr/bin/zip', ['-qr', archive, path.basename(output)], { cwd: path.dirname(output) });
console.log(`Unpacked: ${output}\nZIP: ${archive}\nGoogle: ${migration ? 'legacy backup bridge' : manifest.oauth2 ? 'configured' : 'pending app registration'}`);

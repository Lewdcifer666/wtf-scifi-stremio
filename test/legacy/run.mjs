// Recreate the original path of an archived suite in a disposable checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const available = fs.readdirSync(path.join(root, 'test/legacy'))
  .filter(name => /^[-a-z]+\.test\.mjs$/.test(name)).sort();
const requested = process.argv.slice(2);
const names = requested.length ? [...new Set(requested)] : available;
if (!names.length || names.some(name => !available.includes(name))) {
  throw new Error('Use npm run test:legacy to run all archived suites, or npm run test:legacy -- <name.test.mjs> for selected archived suites');
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'wtf-legacy-audit-'));
try {
  fs.cpSync(root,temp,{recursive:true,filter:s=>!['.git','site','node_modules'].includes(path.basename(s))});
  if (fs.existsSync(path.join(root,'node_modules'))) fs.cpSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),{recursive:true});
  for (const name of names) {
    console.log(`Legacy suite: ${name}`);
    fs.copyFileSync(path.join(temp,'test/legacy',name),path.join(temp,'test',name));
    const result=spawnSync(process.execPath,[`test/${name}`],{cwd:temp,stdio:'inherit'});
    if (result.status !== 0) process.exitCode=1;
  }
  console.log(`Executed ${names.length} archived suite(s); failures retain their nonzero exit status.`);
} finally {
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('wtf-legacy-audit-')) throw new Error('Unexpected legacy fixture cleanup target');
  fs.rmSync(resolved,{recursive:true,force:true});
}

// Recreate the original path of an archived suite in a disposable checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = process.argv.slice(2);
if (!names.length || names.some(n=>!/^[-a-z]+\.test\.mjs$/.test(n) || !fs.existsSync(path.join(root,'test/legacy',n)))) throw new Error('Supply existing archived suite filenames');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'wtf-legacy-audit-'));
try {
  fs.cpSync(root,temp,{recursive:true,filter:s=>!['.git','site','node_modules'].includes(path.basename(s))});
  if (fs.existsSync(path.join(root,'node_modules'))) fs.cpSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),{recursive:true});
  for (const name of names) {
    fs.copyFileSync(path.join(temp,'test/legacy',name),path.join(temp,'test',name));
    const result=spawnSync(process.execPath,[`test/${name}`],{cwd:temp,stdio:'inherit'});
    if (result.status !== 0) process.exitCode=1;
  }
} finally { fs.rmSync(temp,{recursive:true,force:true}); }

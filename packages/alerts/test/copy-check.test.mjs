import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('validation metadata',root),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>s.split(/\n/).filter(l=>!l.startsWith('import ')).join('\n').replaceAll(".ts'","'").trim();
test('copied bodies match the pinned source after documented cuts and import changes',()=>{
 assert.match(manifest.commit,/^[a-f0-9]{40}$/);
 for(const [path,expected] of Object.entries(manifest.unchangedBodyHashes))assert.equal(hash(normalize(readFileSync(new URL(path,root),'utf8'))),expected,path);
 for(const [path,expected] of Object.entries(manifest.adaptedFileHashes))assert.equal(hash(readFileSync(new URL(path,root))),expected,path);
});

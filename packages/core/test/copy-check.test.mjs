import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('validation metadata',root),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>s.split(/\r?\n/).filter(l=>!l.startsWith('import ')).join('\n').replaceAll(".ts'","'").trim();
test('copied implementation bodies remain identical to pinned source',()=>{
 for(const [path,expected] of Object.entries(manifest.unchangedBodyHashes)) assert.equal(hash(normalize(readFileSync(new URL(path,root),'utf8'))),expected,path);
 assert.equal(hash(readFileSync(new URL('src/time/timestamp.ts',root),'utf8')),manifest.combinedTimeHash);
});

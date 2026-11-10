import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(new URL(e.name+'/',dir)):[new URL(e.name,dir)]); }
test('source stays portable: no DOM storage, no website imports, only self-referenced package imports',()=>{
 for(const path of files(new URL('../src/',import.meta.url))) {
  const source=readFileSync(path,'utf8');
  const ast=ts.createSourceFile(fileURLToPath(path),source,ts.ScriptTarget.Latest,true);
  const visit=node=>{
   if(ts.isIdentifier(node)) assert.ok(!['window','document','localStorage'].includes(node.text),`${path}: ${node.text}`);
   ts.forEachChild(node,visit);
  };
  visit(ast);
  for(const node of ast.statements) {
   if(!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))continue;
   const specifier=node.moduleSpecifier?.text;
   if(!specifier)continue;
   assert.ok(!specifier.startsWith('@/') && !/(^|\/)config\//.test(specifier),`website import: ${specifier}`);
   if(specifier.startsWith('.')) {assert.ok(specifier.endsWith('.ts'),specifier);continue;}
   assert.ok(specifier.startsWith('@edgewarn/web-utils/'),`${path}: ${specifier}`);
  }
 }
});

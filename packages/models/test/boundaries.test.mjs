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
   // A dynamic import is held to the same rule as a static one: relative, or through the package name.
   if(ts.isCallExpression(node) && node.expression.kind===ts.SyntaxKind.ImportKeyword) {
    const spec=node.arguments[0];
    assert.ok(ts.isStringLiteral(spec),`${path}: dynamic import with a computed specifier`);
    assert.ok(spec.text.startsWith('.') ? spec.text.endsWith('.ts') : spec.text.startsWith('@edgewarn/web-utils/'),`${path}: ${spec.text}`);
    assert.ok(!/(^|\/)om(\/|$)|openmeteo/.test(spec.text),`${path}: GPL reader import ${spec.text}`);
   }
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
test('the GPL-2.0 Open-Meteo reader and its adapter never enter the package',()=>{
 for(const path of files(new URL('../src/',import.meta.url))) {
  assert.ok(!/(^|\/)om(\/|\.ts$)/.test(fileURLToPath(path)),`${path} is OM reader code`);
  const specifiers=[...readFileSync(path,'utf8').matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const specifier of specifiers) assert.ok(!/(^|\/)om(\/|$)|openmeteo\//i.test(specifier),`${path}: ${specifier}`);
 }
});


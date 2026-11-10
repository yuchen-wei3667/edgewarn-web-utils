import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(new URL(e.name+'/',dir)):[new URL(e.name,dir)]); }
test('source closure stays portable and free of application dependencies/configuration',()=>{
 for(const path of files(new URL('src/',root))) {
 const text=readFileSync(path,'utf8');
 assert.doesNotMatch(text,/@\/|@edgewarn\/|\/api\/v\d|storm-snapshots|alert-snapshots|\/health\/|edgewarn-api|ashk3000|:5000|source: 'official'|@openmeteo|process\.env|localStorage|sessionStorage|\bdocument\b|\bnavigator\b/);
 const ast=ts.createSourceFile(fileURLToPath(path),text,ts.ScriptTarget.Latest,true);
 for(const node of ast.statements) {
 if(!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
 const specifier=node.moduleSpecifier?.text;
 if(!specifier) continue;
 assert.ok(specifier.startsWith('.') || (specifier==='geojson' && node.importClause?.isTypeOnly),specifier);
 if(specifier.startsWith('.')) assert.ok(specifier.endsWith('.ts'),specifier);
 }
 }
});
test('public barrels expose only documented runtime names and subpaths',async()=>{
 for(const specifier of ['@edgewarn/web-utils/cache','@edgewarn/web-utils/net/edgewarn/api','@edgewarn/web-utils/dist/net/normalize.js','@edgewarn/web-utils/colormap/rgba','@edgewarn/web-utils/colormap/bundle','@edgewarn/web-utils/packages/core/dist/colormap/index.js','@edgewarn/web-utils/net/clients/spc','@edgewarn/web-utils/net/clients/wpc','@edgewarn/web-utils/net/clients/shared']) await assert.rejects(import(specifier),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
});

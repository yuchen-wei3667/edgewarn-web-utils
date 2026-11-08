import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as geo from '@edgewarn/web-utils/geo';
import * as time from '@edgewarn/web-utils/time';
import * as net from '@edgewarn/web-utils/net';
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
 assert.deepEqual(Object.keys(geo).sort(),['toRad','clamp','normalizeLongitude','distanceMiles','calculateDestination','calculateBearing','pointInGeometry','geometryAreaM2','formatAlertCoverage','getPolygonCentroid','getConvexHull','getPolygonApproxRadius','projectAndScalePolygon','generatePolygonSegmentHulls'].sort());
 assert.deepEqual(Object.keys(time).sort(),['parseTimestampUTC','formatTimeLabel','findClosestTimestamp','formatExpiresIn','formatDateUTC','roundTimestampToHour','timestampToMs','msToTimestamp'].sort());
 assert.deepEqual(Object.keys(net).sort(),['EdgeWARNAPI','NWSAPI','setNwsUserAgent','normalizeStormcellFeatures','toNWSFeature','extractNWSAlertItems'].sort());
 for(const specifier of ['@edgewarn/web-utils/cache','@edgewarn/web-utils/net/edgewarn/api','@edgewarn/web-utils/dist/net/normalize.js']) await assert.rejects(import(specifier),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
});

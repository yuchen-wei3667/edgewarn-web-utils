import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as alerts from '@edgewarn/web-utils/alerts';
import * as nws from '@edgewarn/web-utils/alerts/nws';
function files(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(new URL(e.name+'/',dir)):[new URL(e.name,dir)]); }
test('alert source imports only core geometry, core wire types and GeoJSON types',()=>{
 for(const path of files(new URL('../src/',import.meta.url))) {
  const source=readFileSync(path,'utf8');
  const ast=ts.createSourceFile(fileURLToPath(path),source,ts.ScriptTarget.Latest,true);
  const visit=node=>{
   if(ts.isIdentifier(node)) assert.ok(!['window','document','navigator','localStorage','sessionStorage'].includes(node.text),`${path}: ${node.text}`);
   if(ts.isPropertyAccessExpression(node)) assert.notEqual(node.getText(ast),'process.env');
   if(ts.isElementAccessExpression(node)) assert.ok(!(node.expression.getText(ast)==='process' && node.argumentExpression?.text==='env'));
   if(ts.isCallExpression(node)) {
    assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword,'dynamic imports are not part of the source contract');
    if(!path.pathname.includes('/nws/')) assert.notEqual(node.expression.getText(ast),'fetch');
   }
   ts.forEachChild(node,visit);
  };
  visit(ast);
  for(const node of ast.statements) {
   if(!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))continue;
   const specifier=node.moduleSpecifier?.text;
   if(!specifier)continue;
   if(specifier.startsWith('.')) {assert.ok(specifier.endsWith('.ts'),specifier);continue;}
   assert.ok(['@edgewarn/web-utils/geo','@edgewarn/web-utils/net','geojson'].includes(specifier),specifier);
   if(specifier!=='@edgewarn/web-utils/geo' && !(specifier==='@edgewarn/web-utils/net' && path.pathname.includes('/nws/')))assert.ok(node.isTypeOnly || node.importClause?.isTypeOnly,specifier);
  }
 }
});
test('public runtime names and deep import restrictions are explicit',async()=>{
 assert.deepEqual(Object.keys(alerts).sort(),[
  'normalizeAlertId','normalizeOfficialAlertId','getFeatureAlertCacheKey','normalizeAlertGeometry',
  'filterNwsAlerts','formatAlertTime','formatAlertTimeUntil','formatNwsAlertText',
  'alertPriorityRank','compareAlertPriority','mostUrgentAlertForHour','hasEASActivation',
  'isSevereThunderstormWarning','isFlashFloodWarning','alertsForPeriod','CRITICAL_EVENTS',
  'isCriticalAlertEvent','isDashboardSignificantAlert','isDashboardTopBannerAlert','sortDashboardAlerts',
  'hasEASActivationRequest','findAlertsAtPoint','mergeLocationAlerts','extractSevereHazards','isSevereTabAlert',
  'getSPCWatchTypeFromEvent','extractSpcWatchNumber','tornadoAlertText','isTornadoWarning',
  'isTornadoEmergency','isPdsTornado','isConfirmedTornado',
  'alertMatchesFilter','alertEASKey','isEASVerificationCandidate','getDismissedAlerts','saveDismissedAlert','selectAlertsToSound',
  'isFlashFloodEmergency','hazardParts','hazardLine','warningCopy','heroTitleForAlert','hazardTypeForAlert','getEventColors',
 ].sort());
 assert.deepEqual(Object.keys(nws).sort(),['checkNWSRawAlertForEAS','loadLocationAlerts','loadRegionAlerts','createEdgeWARNAlertSource','createNWSAlertSource','createWWAAlertSource'].sort());
 for(const specifier of ['@edgewarn/web-utils/alerts/alert-id','@edgewarn/web-utils/alerts/dist/index.js','@edgewarn/web-utils/packages/alerts/dist/index.js'])await assert.rejects(import(specifier),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
});

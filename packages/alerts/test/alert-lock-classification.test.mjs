import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPriorityRank, hasEASActivation, extractSevereHazards, isConfirmedTornado, compareAlertPriority, sortDashboardAlerts, findAlertsAtPoint } from '@edgewarn/web-utils/alerts';
const feature = (event,description='',headline='') => ({id:event,properties:{event,description,headline,severity:'Severe',expires:'2026-11-08T16:00:00Z'},geometry:{type:'Polygon',coordinates:[[[-100,30],[-90,30],[-90,40],[-100,40],[-100,30]]]}});
test('EAS boost reads description only; radar wording precedes confirmation (Q8/Q11)',()=>{
 const text='BULLETIN - EAS ACTIVATION REQUESTED';
 const a=feature('Tornado Warning','SOURCE...Radar indicated rotation and confirmed damage.');
 assert.equal(isConfirmedTornado(a),false);
 assert.equal(extractSevereHazards(a).tornadoConfirmation,'radar-indicated');
 assert.equal(hasEASActivation(feature('Tornado Warning','',text)),false);
 assert.equal(alertPriorityRank(feature('Tornado Warning',text)),alertPriorityRank(feature('Tornado Warning'))-100);
 assert.deepEqual(extractSevereHazards(feature('Flash Flood Warning','MAX WIND GUST...70 MPH')), {wind:null,hail:null,hazard:null,tornadoConfirmation:null});
});
test('priority, dashboard and geographic lists retain distinct ordering (Q7)',()=>{
 const svr=feature('Severe Thunderstorm Warning'), flood=feature('Flash Flood Warning');
 assert.deepEqual([flood,svr].sort(compareAlertPriority),[svr,flood]);
 assert.deepEqual(sortDashboardAlerts([svr,flood]),[flood,svr]);
 svr.properties.expires='2026-11-08T17:00:00Z';
 assert.deepEqual(findAlertsAtPoint(31,-99,[svr,flood]).map(a=>a.feature),[flood,svr]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  alertMatchesFilter, filterNwsAlerts, alertEASKey, isEASVerificationCandidate,
  getDismissedAlerts, saveDismissedAlert, selectAlertsToSound,
  hazardTypeForAlert, getEventColors, isFlashFloodEmergency, hazardParts,
  hazardLine, warningCopy, heroTitleForAlert,
} from '@edgewarn/web-utils/alerts';

const fixture = JSON.parse(readFileSync(new URL('fixtures/alerts.json',import.meta.url)));
const template = fixture.alerts[0];
const feature = (event, properties = {}) => ({ ...template, properties: { ...template.properties, event, ...properties } });

test('shared filter retains All, missing severity, and exact event matching', () => {
  for (const alert of fixture.alerts) {
    for (const severity of ['All','Severe','Unknown','severe']) {
      for (const event of ['All','Tornado Warning','tornado warning']) {
        const expected = (severity === 'All' || (alert.properties.severity || 'Unknown') === severity)
          && (event === 'All' || alert.properties.event === event);
        assert.equal(alertMatchesFilter(alert,severity,event),expected);
        assert.deepEqual(filterNwsAlerts([alert],severity,event),expected?[alert]:[]);
      }
    }
  }
  assert.equal(alertMatchesFilter(feature('Test',{severity:''}),'Unknown','All'),true);
});

test('sound selection preserves all preceding noncritical alerts and stops at first unplayed critical (Q5)', () => {
  const alerts = ['a','b','c','d'].map((alertId,i)=>({alertId,isCritical:i===2,feature:template}));
  const played = new Set(['b']);
  assert.deepEqual(selectAlertsToSound(alerts,played).map(a=>a.alertId),['a','c']);
  assert.deepEqual([...played],['b']);
  assert.deepEqual(selectAlertsToSound(alerts,new Set(['c'])).map(a=>a.alertId),['a','b','d']);
  assert.deepEqual(selectAlertsToSound([alerts[0],alerts[0],alerts[2]],new Set()).map(a=>a.alertId),['a','c']);
  assert.deepEqual(selectAlertsToSound([],new Set()),[]);
});

test('dismissals use dismissedAt retention rather than alert expiry (Q14)', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
  saveDismissedAlert('expired-alert','1970-01-01',storage,100,1000);
  saveDismissedAlert('future-alert','2099-01-01',storage,100,1010);
  assert.deepEqual(getDismissedAlerts(storage,100,1050).map(d=>d.id),['expired-alert','future-alert']);
  assert.deepEqual(getDismissedAlerts(storage,100,1100).map(d=>d.id),['future-alert']);
  assert.equal(values.has('edgewarn_dismissed_alerts'),true);
  saveDismissedAlert('future-alert','updated',storage,100,1110);
  assert.deepEqual(getDismissedAlerts(storage,100,1110),[{id:'future-alert',expires:'updated',dismissedAt:1110}]);
  assert.deepEqual(getDismissedAlerts(storage,100,1100),[]); // future dismissal times are discarded
  storage.setItem('edgewarn_dismissed_alerts','invalid JSON');
  assert.deepEqual(getDismissedAlerts(storage,100,1200),[]);
  const unavailable = { getItem(){throw Error('denied');},setItem(){throw Error('denied');} };
  assert.deepEqual(getDismissedAlerts(unavailable,100),[]);
  assert.doesNotThrow(()=>saveDismissedAlert('a','',unavailable,100));
});

test('hazard classification keeps the historical ordering, including ice before snow (Q15)', () => {
  for (const [event,type] of [
    ['Tornado Warning','severe'],['Watch for severe thunderstorms',null],['Watch for severe thunderstorm','severe'],
    ['Dense Fog Advisory',null],['Ice Storm Warning','cold'],['Winter Storm Warning','winter'],
    ['Hurricane Force Wind Warning','wind'],['Tropical Storm Warning','tropical'],
    ['Flash Flood Warning','flood'],['Red Flag Warning','fire'],['Excessive Heat Warning','heat'],
  ]) assert.equal(hazardTypeForAlert(event),type,event);
});

test('EAS eligibility excludes special statements and keys by official ID plus sent time', () => {
  assert.equal(alertEASKey({...template,id:'official:abc',properties:{...template.properties,sent:'sent'}}),'abc:sent');
  assert.equal(isEASVerificationCandidate(feature('Special Weather Statement',{description:'Severe thunderstorms with 70 mph winds'})),false);
  assert.equal(isEASVerificationCandidate(feature('Tornado Warning')),true);
  assert.equal(isEASVerificationCandidate(feature('Dense Fog Advisory')),false);
});

test('warning copy, parsed hazards and event colors retain Website wording and fallbacks', () => {
  const flood = feature('Flash Flood Warning',{description:'FLASH FLOOD EMERGENCY'});
  assert.equal(isFlashFloodEmergency(flood),true);
  assert.equal(warningCopy(flood).title,'Flash flood emergency');
  assert.equal(heroTitleForAlert(flood),'Flash flood emergency — get to high ground now');
  assert.equal(heroTitleForAlert(feature('Special Weather Statement')),'Thunderstorm activity — stay weather aware');
  assert.equal(warningCopy(feature('Tornado Watch')).command,'Tornadoes are possible. Know where you’d shelter and keep alerts on.');
  const severe = feature('Severe Thunderstorm Warning', {description:'',parameters:{}});
  assert.deepEqual(hazardParts(severe),[]);
  assert.equal(hazardLine(severe),null);
  assert.deepEqual(getEventColors('Tornado Warning','Minor'),{bg:'#450a0a',border:'#FF0000',dot:'#FF0000'});
  assert.deepEqual(getEventColors('Unrecognized','Unrecognized'),{bg:'#374151',border:'#6b7280',dot:'#9ca3af'});
});

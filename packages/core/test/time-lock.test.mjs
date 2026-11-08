import test from 'node:test';
import assert from 'node:assert/strict';
import * as t from '@edgewarn/core/time';
test('UTC conversion and distinct parser acceptance',()=>{
 const ts='20260102-030405', ms=Date.UTC(2026,0,2,3,4,5);
 assert.equal(t.timestampToMs(ts),ms); assert.equal(t.msToTimestamp(ms+999),ts);
 assert.equal(t.parseTimestampUTC(' 2026.01.02.03.04.05 ').getTime(),ms);
 for(const invalid of ['bad',' '+ts,'2026.01.02.03.04.05']) assert.equal(t.timestampToMs(invalid),null);
 assert.equal(t.parseTimestampUTC('x'+ts),null);
 assert.equal(t.timestampToMs('00991332-250000'),Date.UTC(99,12,32,25));
 assert.equal(t.parseTimestampUTC('20260230-000000').getTime(),Date.UTC(2026,1,30));
 assert.deepEqual(t.formatTimeLabel('x'+ts+'x'),{date:'2026-01-02',time:'03:04'});
 assert.deepEqual(t.formatTimeLabel('bad'),{date:'bad',time:''});
});
test('closest match tolerance, tie order, invalid inputs and seconds truncation',()=>{
 const target='20260102-030459';
 assert.equal(t.findClosestTimestamp(target,[]),null);
 assert.equal(t.findClosestTimestamp('bad',[target]),null);
 assert.equal(t.findClosestTimestamp(target,['bad']),null);
 assert.equal(t.findClosestTimestamp(target,['20260102-030300','20260102-030500'],60000),'20260102-030300');
 assert.equal(t.findClosestTimestamp(target,['20260102-030400'],0),'20260102-030400');
 assert.equal(t.findClosestTimestamp(target,['20260102-030600'],60000),null);
});
test('DST local matching remains timezone dependent',()=>{
 const result=t.findClosestTimestamp('20260308-025000',['20260308-020000','20260308-030000'],3600000);
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 if(zone==='UTC') assert.equal(result,'20260308-030000');
 else if(zone==='America/New_York') assert.equal(result,'20260308-020000');
 else assert.ok(['20260308-020000','20260308-030000'].includes(result));
});
test('rounding, label fallbacks and countdown boundaries',()=>{
 assert.equal(t.roundTimestampToHour('20261231-233000'),'20270101-000000');
 assert.equal(t.roundTimestampToHour('20261231-232959'),'20261231-230000');
 assert.equal(t.roundTimestampToHour('bad'),'bad'); assert.equal(t.roundTimestampToHour(null),null);
 assert.equal(t.formatExpiresIn(1,0),'Expires in 0 min'); assert.equal(t.formatExpiresIn(48*3600000,0),'Expires in 2 days');
 assert.equal(t.formatDateUTC('bad'),'bad'); assert.equal(t.formatDateUTC(NaN),'Unknown');
 assert.match(t.formatDateUTC(Date.UTC(2026,0,2,3,4),true),/2026.*03:04 UTC/);
});

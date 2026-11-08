import test from 'node:test';
import assert from 'node:assert/strict';
import {formatAlertTime,formatAlertTimeUntil} from '@edgewarn/web-utils/alerts';
test('formatting uses caller clock and the host local time zone',()=>{
 const iso='2026-11-08T16:00:00Z', now=Date.parse(iso);
 assert.equal(formatAlertTime(iso),new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}));
 assert.equal(formatAlertTimeUntil(iso,now),'Expired');
 assert.equal(formatAlertTimeUntil(iso,now-60001),'2m');
 assert.equal(formatAlertTimeUntil(iso,now-((26*60+5)*60000)),'1d 2h 5m');
 assert.equal(formatAlertTimeUntil('invalid',now),formatAlertTime('invalid'));
});

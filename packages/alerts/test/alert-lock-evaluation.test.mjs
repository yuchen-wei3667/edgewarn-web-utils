import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as alerts from '@edgewarn/web-utils/alerts';
import { evaluate } from './helpers/evaluate.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`,import.meta.url),'utf8'));
test('every P0 export agrees with outputs captured from the pinned Website', () => {
  assert.deepEqual(evaluate(alerts,fixture('alerts')), fixture('expected'));
});
test('point matching keeps expired, future, cancelled and test alerts; geometry and severity alone gate matches (Q3/Q4)', () => {
  const { alerts: features } = fixture('alerts');
  const ids = alerts.findAlertsAtPoint(31,-99,features).map(a => a.feature.id);
  for(const id of ['expired','future-sent','cancel','test']) assert.ok(ids.includes(id),id);
  assert.ok(!ids.includes('no-geometry'));
  const hole = features.find(f => f.id === 'hole');
  assert.equal(alerts.findAlertsAtPoint(35,-95,[hole]).length,0);
  assert.equal(alerts.findAlertsAtPoint(33,-97,[hole]).length,0);
  assert.equal(alerts.findAlertsAtPoint(30,-100,[hole]).length,1);
  assert.equal(alerts.findAlertsAtPoint(31,-99,[{feature:features.find(f => f.id==='no-geometry'),geometry:hole.geometry}]).length,1);
});
test('period validity keeps onset, sent, ends and status rules (Q10)', () => {
 const { alerts: features, now } = fixture('alerts');
 const ids = alerts.alertsForPeriod(features,now,now+3600000,now).map(f=>f.id);
 for(const id of ['expired','future-sent','cancel','test','onset']) assert.ok(!ids.includes(id),id);
 assert.ok(ids.includes('ends-early'));
 assert.ok(!alerts.alertsForPeriod(features,now+3600000,now+7200000,now).some(f=>f.id==='ends-early'));
 assert.equal(alerts.alertsForPeriod(undefined,now,now+1,now).length,0);
 assert.equal(alerts.mostUrgentAlertForHour(undefined,now),null);
});

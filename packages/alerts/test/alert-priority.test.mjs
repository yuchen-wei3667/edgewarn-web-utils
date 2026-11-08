import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertPriorityRank,
  compareAlertPriority,
  hasEASActivation,
  isFlashFloodWarning,
  isSevereThunderstormWarning,
  mostUrgentAlertForHour,
} from '@edgewarn/web-utils/alerts';

function alert(event, description = '', headline = '', severity = 'Severe') {
  return {
    id: `test-${event}-${description.length}-${severity}`,
    properties: { event, headline, description, instruction: '', severity },
  };
}

function timedAlert(event, effective, expires) {
  return {
    id: `test-${event}-${effective}`,
    properties: { event, headline: '', description: '', instruction: '', severity: 'Severe', effective, expires },
  };
}

const EAS = 'BULLETIN - EAS ACTIVATION REQUESTED';

test('event classifiers match exact warning types', () => {
  assert.equal(isSevereThunderstormWarning(alert('Severe Thunderstorm Warning')), true);
  assert.equal(isSevereThunderstormWarning(alert('Severe Thunderstorm Watch')), false);
  assert.equal(isFlashFloodWarning(alert('Flash Flood Warning')), true);
  assert.equal(isFlashFloodWarning(alert('Flood Warning')), false);
  assert.equal(hasEASActivation(alert('Tornado Warning', `...${EAS}...`)), true);
  assert.equal(hasEASActivation(alert('Tornado Warning', 'No activation here.')), false);
});

test('base order is tornado, severe thunderstorm, flash flood, other', () => {
  const ordered = [
    alert('Tornado Warning'),
    alert('Severe Thunderstorm Warning'),
    alert('Flash Flood Warning'),
    alert('Flood Watch'),
  ].sort(compareAlertPriority).map(item => item.properties.event);
  assert.deepEqual(ordered, [
    'Tornado Warning',
    'Severe Thunderstorm Warning',
    'Flash Flood Warning',
    'Flood Watch',
  ]);
});

test('tornado sub-ordering and destructive severe thunderstorms rank first in tier', () => {
  const emergency = alert('Tornado Warning', '...TORNADO EMERGENCY...');
  const pds = alert('Tornado Warning', '...PARTICULARLY DANGEROUS SITUATION...');
  const indicated = alert('Tornado Warning');
  const destructiveSvr = alert('Severe Thunderstorm Warning', '...DESTRUCTIVE...hail...');
  const standardSvr = alert('Severe Thunderstorm Warning');
  assert.ok(alertPriorityRank(emergency) < alertPriorityRank(pds));
  assert.ok(alertPriorityRank(pds) < alertPriorityRank(indicated));
  assert.ok(alertPriorityRank(destructiveSvr) < alertPriorityRank(standardSvr));
  assert.ok(alertPriorityRank(indicated) < alertPriorityRank(destructiveSvr));
  assert.ok(alertPriorityRank(standardSvr) < alertPriorityRank(alert('Flash Flood Warning')));
});

test('EAS activation alerts outrank non-EAS alerts in the same event order', () => {
  const easTornado = alert('Tornado Warning', `...${EAS}...`);
  const easSvr = alert('Severe Thunderstorm Warning', `...${EAS}...`);
  const easFlood = alert('Flash Flood Warning', `...${EAS}...`);
  const plainTornado = alert('Tornado Warning');
  const ordered = [easFlood, plainTornado, easSvr, easTornado]
    .sort(compareAlertPriority)
    .map(item => item.properties.event);
  assert.deepEqual(ordered, [
    'Tornado Warning',
    'Severe Thunderstorm Warning',
    'Flash Flood Warning',
    'Tornado Warning',
  ]);
});

test('mostUrgentAlertForHour matches alerts overlapping the hour', () => {
  const hour = Date.parse('2026-09-15T14:00:00Z');
  const covering = timedAlert('Severe Thunderstorm Warning', '2026-09-15T13:00:00Z', '2026-09-15T15:00:00Z');
  const later = timedAlert('Tornado Warning', '2026-09-15T16:00:00Z', '2026-09-15T17:00:00Z');
  const expired = timedAlert('Flash Flood Warning', '2026-09-15T12:00:00Z', '2026-09-15T14:00:00Z');
  assert.equal(mostUrgentAlertForHour([later, expired, covering], hour)?.properties.event, 'Severe Thunderstorm Warning');
  assert.equal(mostUrgentAlertForHour([later, expired], hour), null);
  assert.equal(mostUrgentAlertForHour(undefined, hour), null);
});

test('mostUrgentAlertForHour prefers the most urgent overlapping alert', () => {
  const hour = Date.parse('2026-09-15T14:00:00Z');
  const svr = timedAlert('Severe Thunderstorm Warning', '2026-09-15T13:00:00Z', '2026-09-15T15:00:00Z');
  const tornado = timedAlert('Tornado Warning', '2026-09-15T14:30:00Z', '2026-09-15T15:30:00Z');
  assert.equal(mostUrgentAlertForHour([svr, tornado], hour)?.properties.event, 'Tornado Warning');
});

test('warnings outrank watches at the same severity', () => {
  // Flood Warning and Tornado Watch share the same event-rank bucket,
  // so severity ties and the warning/watch tiebreak decides.
  const ordered = [
    alert('Tornado Watch'),
    alert('Flood Warning'),
    alert('Severe Thunderstorm Watch'),
  ].sort(compareAlertPriority).map(item => item.properties.event);
  assert.deepEqual(ordered, [
    'Flood Warning',
    'Tornado Watch',
    'Severe Thunderstorm Watch',
  ]);
});

test('higher severity wins before the warning/watch tiebreak', () => {
  const ordered = [
    alert('Flood Watch', '', '', 'Severe'),
    alert('Flood Warning', '', '', 'Moderate'),
    alert('Flood Warning', '', '', 'Extreme'),
  ].sort(compareAlertPriority).map(item => `${item.properties.severity} ${item.properties.event}`);
  assert.deepEqual(ordered, [
    'Extreme Flood Warning',
    'Severe Flood Watch',
    'Moderate Flood Warning',
  ]);
});

test('event rank still decides across tiers regardless of severity', () => {
  const tornado = alert('Tornado Warning', '', '', 'Moderate');
  const watch = alert('Severe Thunderstorm Watch', '', '', 'Extreme');
  assert.ok(compareAlertPriority(tornado, watch) < 0);
});

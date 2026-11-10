import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCodsus } from '@edgewarn/web-utils/net';

const BULLETIN = `
000
ASUS02 KWBC 171500
CODSUS

CODED SURFACE FRONTAL POSITIONS
NWS WEATHER PREDICTION CENTER COLLEGE PARK MD
1212 PM EDT SAT OCT 17 2026

VALID 171500Z
HIGHS 1036 4371107 1039 4001072 1025
4301165
LOWS 994 5821432 1004 5511257
COLD WK 3869 3475 2981
OCFNT 5159 5259 5258
STNRY 7441 7346
TROF 24114 23114
WARM 5054

$$
`;

test('highs and lows decode to west-negative points with pressures, across a wrapped line', () => {
  const { features } = parseCodsus(BULLETIN, true);
  const points = features.filter((f) => f.geometry.type === 'Point');
  assert.equal(points.length, 5);
  assert.deepEqual(points[0].geometry.coordinates, [-110.7, 43.7]);
  assert.deepEqual(points[0].properties, { type: 'HIGH', pressure: 1036 });
  assert.deepEqual(points[2].geometry.coordinates, [-116.5, 43]);
  assert.deepEqual(points[3].properties, { type: 'LOW', pressure: 994 });
  assert.deepEqual(points[4].geometry.coordinates, [-125.7, 55.1]);
});

test('whole-degree positions decode when tenths is off', () => {
  const { features } = parseCodsus(BULLETIN, false);
  const lines = features.filter((f) => f.geometry.type === 'LineString');
  assert.deepEqual(lines[1].geometry.coordinates[0], [-59, 51]);
  assert.deepEqual(lines[0].geometry.coordinates[0], [-69, 38]);
});

test('fronts keep their type and strength, and one-position records are dropped', () => {
  const lines = parseCodsus(BULLETIN, false).features.filter((f) => f.geometry.type === 'LineString');
  assert.deepEqual(lines.map((l) => l.properties.type), ['COLD', 'OCCLUDED', 'STATIONARY', 'TROUGH']);
  assert.equal(lines[0].properties.strength, 'WK');
  assert.equal(lines[0].geometry.coordinates.length, 3);
});

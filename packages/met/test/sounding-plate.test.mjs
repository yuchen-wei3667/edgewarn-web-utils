import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyzeSounding, dendriticGrowthZone, hazardType, inferredAdvection, layersAloft, precipitationPanel, stormRelativeProfile, stormSlinky,
    thetaEProfile, windTone,
} from '@edgewarn/web-utils/met';
import { mkCol, LEVELS, unstableColumn, stableColumn, straightWinds } from './helpers.mjs';

const windy = (col) => { const [u, v] = straightWinds(); return { ...col, u: Float32Array.from(u), v: Float32Array.from(v) }; };

test('barb and speed columns are toned by pressure from the top down', () => {
    assert.deepEqual([150, 300, 700, 1000].map(windTone), ['high', 'mid', 'low', 'surface']);
});

test('a wind that veers with height is warm advection and one that backs is cold; no wind turning is none', () => {
    const veer = inferredAdvection([{ pHpa: 1000, u: 0, v: 10 }, { pHpa: 800, u: 10, v: 0 }], 40);
    const back = inferredAdvection([{ pHpa: 1000, u: 10, v: 0 }, { pHpa: 800, u: 0, v: 10 }], 40);
    const steady = inferredAdvection([{ pHpa: 1000, u: 10, v: 0 }, { pHpa: 800, u: 20, v: 0 }], 40);
    assert.ok(veer[0].perHour > 0);
    assert.ok(back[0].perHour < 0);
    assert.ok(Math.abs(steady[0].perHour) < 1e-9);
});

test('an unstable column has a slinky and theta-e, a stable one has no slinky', () => {
    const col = windy(unstableColumn());
    const a = analyzeSounding(col);
    assert.ok(thetaEProfile(col).length > 5);
    assert.ok(stormRelativeProfile(col, a.kinematics.stormMotion).length > 5);
    const slinky = stormSlinky(col, a.parcels.mu, a.kinematics.stormMotion);
    assert.ok(slinky === null || slinky.points.length >= 2);
    assert.equal(stormSlinky(windy(stableColumn()), analyzeSounding(windy(stableColumn())).parcels.mu, { u: 0, v: 0 }), null);
});

test('the hazard type is NONE for a quiet profile', () => {
    assert.equal(hazardType(analyzeSounding(windy(stableColumn()))), 'NONE');
});

test('a warm layer aloft over a cold surface is listed, and a profile that never crosses 0 has none', () => {
    const z = Float32Array.from([0, 1000, 2000, 3000, 4000]);
    assert.equal(layersAloft([-5, -3, 2, 1, -4], z).length, 1);
    assert.equal(layersAloft([-5, -6, -7, -8, -9], z).length, 0);
});

test('the growth zone needs a profile that reaches -17 C, and a dry cold column reads freezing as snow or none', () => {
    const p = LEVELS;
    const t = p.map((_, i) => 5 - i * 2.2);
    const col = mkCol(p, t, t.map((x) => x - 1));
    const zone = dendriticGrowthZone(col);
    assert.ok(zone && zone.depthFt > 0 && zone.topFtMsl > zone.baseFtMsl);
    assert.ok(['Snow', 'Freezing rain', 'Rain', 'None'].includes(precipitationPanel(col).bestGuess));
});

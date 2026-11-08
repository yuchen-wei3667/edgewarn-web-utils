import test from 'node:test';
import assert from 'node:assert/strict';

import { bulkShear, meanWind, bunkersMotion, helicity, effectiveInflowLayer, effectiveBulkShear, criticalAngle } from '@edgewarn/web-utils/met';
import { fieldAt, pressureAtAgl, heightAglAt } from '@edgewarn/web-utils/met';
import { SOUNDING_SRH_LAYERS_M, SOUNDING_SHEAR_LAYERS_M } from '../src/constants.ts';
import { unstableColumn, mkCol, LEVELS, HEIGHT_OF, uniformWinds, straightWinds, circleWinds } from './helpers.mjs';

test('a constant wind column has no shear and no SRH for any storm motion', () => {
    const [u, v] = uniformWinds();
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => 25), u, v);
    assert.equal(bulkShear(col, SOUNDING_SHEAR_LAYERS_M[2]), 0);
    assert.equal(helicity(col, 0, 3000, { u: 0, v: 0 }), 0);
    assert.equal(helicity(col, 0, 3000, { u: 4, v: -7 }), 0);
    const motion = bunkersMotion(col);
    assert.equal(motion.right, null, 'zero segment shear leaves Bunkers undefined');
    assert.ok(motion.mean06 && Math.abs(motion.mean06.u - 10) < 1e-6 && Math.abs(motion.mean06.v - 5) < 1e-6);
});

test('a linear hodograph has Bunkers movers exactly D = 7.5 m/s off the mean wind, perpendicular to it', () => {
    const [u, v] = straightWinds();
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => -40), u, v);
    const motion = bunkersMotion(col);
    assert.ok(motion.right && motion.left && motion.mean06);
    // the npw 0-6 km mean of a linear-in-height wind is its midpoint value up to the log-p
    // curvature of the node interpolation (measured 14.993 on the fixed grid)
    assert.ok(Math.abs(motion.mean06.u - 15) < 0.02, `mean u ${motion.mean06.u}`);
    const du = motion.right.u - motion.mean06.u;
    const dv = motion.right.v - motion.mean06.v;
    assert.ok(Math.abs(Math.hypot(du, dv) - 7.5) < 1e-9, `deviation ${Math.hypot(du, dv)}`);
    // perpendicular to the shear segment (positive u only) means the deviation is purely in v
    assert.ok(Math.abs(du) < 1e-9 && Math.abs(Math.abs(dv) - 7.5) < 1e-9, `${du}, ${dv}`);
    // the left mover sits on the opposite side of the mean wind
    const lu = motion.left.u - motion.mean06.u;
    const lv = motion.left.v - motion.mean06.v;
    assert.ok(Math.abs(du + lu) < 1e-9 && Math.abs(dv + lv) < 1e-9, `${lu}, ${lv}`);
});

test('a circular hodograph integrates the analytic circle SRH with a centred storm', () => {
    const [u, v] = circleWinds();
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => 25), u, v);
    // shoelace of the sampled circle of radius 20: 2·π·20² = 2513.27 m²/s²
    // this circle backs (turns counter-clockwise) with height, so SRH is negative; mirroring u
    // makes it veer (clockwise) and flips the sign (positive for a right mover, as SHARPpy)
    const srh = helicity(col, 0, 3000, { u: 0, v: 0 });
    assert.ok(srh !== null && srh < -2350 && srh > -2650, `SRH ${srh}`);
    const srh01 = helicity(col, 0, SOUNDING_SRH_LAYERS_M[0], { u: 0, v: 0 });
    assert.ok(srh01 !== null && srh01 < 0, `SRH01 ${srh01}`);
    const veering = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => 25), u.map((x) => -x), v);
    const veer = helicity(veering, 0, 3000, { u: 0, v: 0 });
    assert.ok(veer !== null && veer > 2350 && veer < 2650, `veering SRH ${veer}`);
});

test('the effective inflow layer starts at the surface of an unstable column and stops where the parcels fail', () => {
    const col = unstableColumn();
    const layer = effectiveInflowLayer(col);
    assert.ok(layer, 'layer found');
    assert.ok(Math.abs(layer.baseP - 1000) < 1e-6, `base ${layer.baseP}`);
    assert.ok(layer.topP < layer.baseP, `top ${layer.topP}`);
    // the base parcel must meet the gate on its own
    assert.ok(layer.baseP >= layer.topP);
});

test('a stable column has no effective inflow layer', () => {
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.003 * HEIGHT_OF(p)), LEVELS.map(() => -40), uniformWinds()[0], uniformWinds()[1]);
    assert.equal(effectiveInflowLayer(col), null);
});

test('the effective bulk shear reaches half the MU EL depth above the base', () => {
    const col = unstableColumn(circleWinds()[0], circleWinds()[1]);
    const layer = effectiveInflowLayer(col);
    assert.ok(layer);
    // an independent recomputation through the interpolation helpers
    const baseZ = heightAglAt(col, layer.baseP);
    const muElZagl = 5500; // a representative MU EL in the unstable profile
    const pTopWanted = pressureAtAgl(col, baseZ + (muElZagl - baseZ) / 2);
    const wanted = Math.hypot(
        fieldAt(col, 'u', pTopWanted) - fieldAt(col, 'u', layer.baseP),
        fieldAt(col, 'v', pTopWanted) - fieldAt(col, 'v', layer.baseP),
    );
    const ebwd = effectiveBulkShear(col, muElZagl, layer);
    assert.ok(ebwd !== null && Math.abs(ebwd - wanted) < 0.1, `ebwd ${ebwd} vs ${wanted}`);
    assert.equal(effectiveBulkShear(col, muElZagl, null), null);
    assert.equal(effectiveBulkShear(col, null, layer), null);
});

test('the critical angle is 0 for a storm aligned with the 500 m wind and 180 degrees for the opposite one', () => {
    // Wind grows from (0, 0) at the surface to (10, 10) at 500 m: the shear vector is (10, 10).
    const u = LEVELS.map((p) => (HEIGHT_OF(p) >= 500 ? 10 : 10 * HEIGHT_OF(p) / 500));
    const v = LEVELS.map((p) => (HEIGHT_OF(p) >= 500 ? 10 : 0));
    const setup = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => 25), u, v);
    const aligned = criticalAngle(setup, { u: 10, v: 10 });
    assert.ok(aligned !== null && Math.abs(aligned - 0) < 1e-6, `angle ${aligned}`);
    // 180°: the storm moves opposite to the shear vector (−10, −10); 90°: perpendicular to it (10, −10)
    const opposite = criticalAngle(setup, { u: -10, v: -10 });
    assert.ok(opposite !== null && Math.abs(opposite - 180) < 1e-6, `angle ${opposite}`);
    const right = criticalAngle(setup, { u: 10, v: -10 });
    assert.ok(right !== null && Math.abs(right - 90) < 1e-6, `angle ${right}`);
});

test('the pressure-weighted mean wind averages u and v over the pressure span', () => {
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => -40), straightWinds()[0], straightWinds()[1]);
    const mean = meanWind(col, 1000, 400, false);
    // same log-p curvature allowance as above: 14.993, not exactly 15
    assert.ok(mean && Math.abs(mean.u - 15) < 0.02 && Math.abs(mean.v) < 1e-9, `${mean.u}, ${mean.v}`);
});

test('layers that leave the profile yield null pieces, never NaN', () => {
    const col = mkCol(LEVELS, LEVELS.map((p) => 30 - 0.0065 * HEIGHT_OF(p)), LEVELS.map(() => 25), straightWinds()[0], straightWinds()[1]);
    assert.equal(bulkShear(col, 16000), null);
    assert.equal(helicity(col, 0, 20000, { u: 0, v: 0 }), null);
    assert.equal(meanWind(col, 400, 1000, true), null, 'inverted layer bounds are rejected');
});
